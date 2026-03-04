import { Bus } from "@/bus"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { MetricsQueue } from "./queue"
import { DataExtractor } from "./extractor"
import { MetricsConfig } from "./config"
import { Log } from "@/util/log"

export namespace MetricsCollector {
    const log = Log.create({ service: "metrics.collector" })

    let initialized = false
    const unsubscribers: (() => void)[] = []

    /**
     * Initialize the metrics collector by subscribing to Bus events.
     * This is a no-op if metrics are disabled or already initialized.
     */
    export function init(): boolean {
        if (initialized) return false
        if (!MetricsConfig.isEnabled()) {
            log.info("metrics collection is disabled")
            return false
        }

        initialized = true
        log.info("initializing metrics collector")

        // 1. Session created
        unsubscribers.push(
            Bus.subscribe(Session.Event.Created, async (event) => {
                try {
                    const record = DataExtractor.extractSession(event.properties.info, "created")
                    await MetricsQueue.enqueue("session", record)
                } catch (e) {
                    log.error("failed to collect session.created", { error: e })
                }
            }),
        )

        // 2. Session updated (summary changes)
        unsubscribers.push(
            Bus.subscribe(Session.Event.Updated, async (event) => {
                try {
                    const info = event.properties.info
                    if (info.summary) {
                        const record = DataExtractor.extractSession(info, "updated")
                        await MetricsQueue.enqueue("session", record)
                    }
                } catch (e) {
                    log.error("failed to collect session.updated", { error: e })
                }
            }),
        )

        // 3. Message updated (AI responses with completed time)
        unsubscribers.push(
            Bus.subscribe(MessageV2.Event.Updated, async (event) => {
                try {
                    const info = event.properties.info
                    if (info.role === "assistant" && info.time.completed) {
                        const record = DataExtractor.extractAssistantMessage(info)
                        await MetricsQueue.enqueue("message", record)
                    }
                } catch (e) {
                    log.error("failed to collect message.updated", { error: e })
                }
            }),
        )

        // 4. Part updated (tool calls and step finish)
        unsubscribers.push(
            Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
                try {
                    const part = event.properties.part

                    if (
                        part.type === "tool" &&
                        (part.state.status === "completed" || part.state.status === "error")
                    ) {
                        const record = DataExtractor.extractToolCall(part)
                        await MetricsQueue.enqueue("tool", record)
                    }

                    if (part.type === "step-finish") {
                        const record = DataExtractor.extractStepFinish(part)
                        await MetricsQueue.enqueue("step", record)
                    }
                } catch (e) {
                    log.error("failed to collect part.updated", { error: e })
                }
            }),
        )

        log.info("metrics collector initialized with 4 event listeners")
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
        log.info("metrics collector disposed")
    }

    /**
     * Check if the collector is initialized.
     */
    export function isInitialized(): boolean {
        return initialized
    }
}
