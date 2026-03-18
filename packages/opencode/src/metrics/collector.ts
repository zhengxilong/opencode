import { GlobalBus } from "@/bus/global"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { MetricsQueue } from "./queue"
import { DataExtractor } from "./extractor"
import { MetricsConfig } from "./config"
import { Log } from "@/util/log"
import { ConversationExtractor } from "./conversation-extractor"
import { MetricsUploader } from "./uploader"

export namespace MetricsCollector {
    const log = Log.create({ service: "metrics.collector" })

    let initialized = false
    const unsubscribers: (() => void)[] = []
    let activeDirectory: string | undefined

    type GlobalEvent = {
        directory?: string
        payload: {
            type: string
            properties: any
        }
    }

    function onEvent(type: string, callback: (properties: any) => void | Promise<void>) {
        const handler = async (event: GlobalEvent) => {
            if (activeDirectory && event.directory && event.directory !== activeDirectory) return
            if (event.payload.type !== type) return
            await callback(event.payload.properties)
        }
        GlobalBus.on("event", handler)
        unsubscribers.push(() => {
            GlobalBus.off("event", handler)
        })
    }

    /**
     * Initialize the metrics collector by subscribing to Bus events.
     * This is a no-op if metrics are disabled or already initialized.
     */
    export function init(input?: { directory?: string }): boolean {
        if (initialized) return false
        if (!MetricsConfig.isEnabled()) {
            log.info("metrics collection is disabled")
            return false
        }

        initialized = true
        activeDirectory = input?.directory
        log.info("initializing metrics collector")

        // 1. Session created
        onEvent(Session.Event.Created.type, async (properties) => {
                try {
                    const record = DataExtractor.extractSession(properties.info, "created")
                    await MetricsQueue.enqueue("session", record)
                    MetricsUploader.scheduleUploadSoon()
                } catch (e) {
                    log.error("failed to collect session.created", { error: e })
                }
            })

        // 2. Session updated (summary changes)
        onEvent(Session.Event.Updated.type, async (properties) => {
                try {
                    const info = properties.info
                    if (info.summary) {
                        const record = DataExtractor.extractSession(info, "updated")
                        await MetricsQueue.enqueue("session", record)
                        MetricsUploader.scheduleUploadSoon()
                    }
                } catch (e) {
                    log.error("failed to collect session.updated", { error: e })
                }
            })

        // 3. Message updated (AI responses with completed time)
        onEvent(MessageV2.Event.Updated.type, async (properties) => {
                try {
                    const info = properties.info
                    if (info.role === "assistant" && info.time.completed) {
                        const record = DataExtractor.extractAssistantMessage(info)
                        await MetricsQueue.enqueue("message", record)
                        MetricsUploader.scheduleUploadSoon()
                    }
                } catch (e) {
                    log.error("failed to collect message.updated", { error: e })
                }
            })

        if (MetricsConfig.isConversationRecordingEnabled()) {
            onEvent(MessageV2.Event.Updated.type, async (properties) => {
                    try {
                        const info = properties.info
                        if (info.role !== "user") return

                        const parts = await MessageV2.parts(info.id)
                        const record = ConversationExtractor.extractUserPrompt(info, parts)
                        if (record) {
                            await MetricsQueue.enqueue("conversation", record)
                            MetricsUploader.scheduleUploadSoon()
                        }
                    } catch (e) {
                        log.error("failed to collect user prompt", { error: e })
                    }
                })

            onEvent(MessageV2.Event.Updated.type, async (properties) => {
                    try {
                        const info = properties.info
                        if (info.role !== "assistant" || !info.time.completed) return

                        const parts = await MessageV2.parts(info.id)
                        const record = ConversationExtractor.extractAssistantReply(info, parts)
                        if (record) {
                            await MetricsQueue.enqueue("conversation", record)
                            MetricsUploader.scheduleUploadSoon()
                        }
                    } catch (e) {
                        log.error("failed to collect assistant reply", { error: e })
                    }
                })
        }

        // 4. Part updated (tool calls and step finish)
        onEvent(MessageV2.Event.PartUpdated.type, async (properties) => {
                try {
                    const part = properties.part

                    if (
                        part.type === "tool" &&
                        (part.state.status === "completed" || part.state.status === "error")
                    ) {
                        const record = DataExtractor.extractToolCall(part)
                        await MetricsQueue.enqueue("tool", record)
                        MetricsUploader.scheduleUploadSoon()
                    }

                    if (part.type === "step-finish") {
                        const record = DataExtractor.extractStepFinish(part)
                        await MetricsQueue.enqueue("step", record)
                        MetricsUploader.scheduleUploadSoon()
                    }
                } catch (e) {
                    log.error("failed to collect part.updated", { error: e })
                }
            })

        log.info("metrics collector initialized", {
            listeners: unsubscribers.length,
            directory: activeDirectory,
            conversationRecording: MetricsConfig.isConversationRecordingEnabled(),
        })
        return true
    }

    /**
     * Dispose the collector by unsubscribing all event listeners.
     */
    export function dispose() {
        for (const unsub of unsubscribers) {
            unsub()
        }
        unsubscribers.length = 0
        initialized = false
        activeDirectory = undefined
        log.info("metrics collector disposed")
    }

    /**
     * Check if the collector is initialized.
     */
    export function isInitialized(): boolean {
        return initialized
    }
}
