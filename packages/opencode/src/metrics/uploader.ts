import { MetricsQueue } from "./queue"
import { MetricsConfig } from "./config"
import { Log } from "@/util/log"
import type { MetricsAggregator } from "./aggregator"

export namespace MetricsUploader {
    const log = Log.create({ service: "metrics.uploader" })

    const CATEGORIES = ["session", "message", "tool", "step"] as const
    const API_PATHS: Record<string, string> = {
        session: "/api/v1/sessions/report",
        message: "/api/v1/messages/report",
        tool: "/api/v1/tools/report",
        step: "/api/v1/messages/report",
    }

    let uploadTimer: ReturnType<typeof setInterval> | null = null

    /**
     * Build the client info header for upload payloads.
     */
    export function getClientInfo() {
        return {
            client_id: MetricsConfig.getClientId(),
            client_version: "1.0.0", // will be replaced with Installation.VERSION in prod
            machine_id: MetricsConfig.getMachineId(),
        }
    }

    /**
     * Start periodic upload timer.
     */
    export function start() {
        const interval = MetricsConfig.getUploadInterval()
        if (uploadTimer) clearInterval(uploadTimer)
        uploadTimer = setInterval(() => {
            uploadAll().catch((e) => log.error("periodic upload failed", { error: e }))
        }, interval)
    }

    /**
     * Stop periodic upload timer.
     */
    export function stop() {
        if (uploadTimer) {
            clearInterval(uploadTimer)
            uploadTimer = null
        }
    }

    /**
     * Upload all pending data across all categories.
     */
    export async function uploadAll(): Promise<void> {
        for (const category of CATEGORIES) {
            await uploadCategory(category)
        }
    }

    /**
     * Upload a single category's data.
     */
    export async function uploadCategory(category: string): Promise<void> {
        const records = await MetricsQueue.dequeue(category)
        if (records.length === 0) return

        const batchSize = MetricsConfig.getBatchSize()

        // Split into batches if needed
        for (let i = 0; i < records.length; i += batchSize) {
            const batch = records.slice(i, i + batchSize)
            const apiPath = API_PATHS[category] ?? "/api/v1/metrics/batch"
            const payload = {
                ...getClientInfo(),
                timestamp: Date.now(),
                events: batch,
            }

            try {
                await httpPost(apiPath, payload)
                log.info(`uploaded ${batch.length} ${category} records`)
            } catch (e) {
                log.warn(`upload failed for ${category}, requeueing ${batch.length} records`, {
                    error: e,
                })
                await MetricsQueue.requeue(category, batch)
            }
        }
    }

    /**
     * Upload aggregated metrics to the batch endpoint.
     */
    export async function uploadAggregated(
        metrics: MetricsAggregator.AggregatedMetrics,
    ): Promise<void> {
        const payload = {
            ...getClientInfo(),
            timestamp: Date.now(),
            ...metrics,
        }

        try {
            await httpPost("/api/v1/metrics/batch", payload)
            log.info("uploaded aggregated metrics")
        } catch (e) {
            log.warn("aggregated metrics upload failed", { error: e })
        }
    }

    /**
     * Send heartbeat to the platform.
     */
    export async function sendHeartbeat(currentSessionId?: string): Promise<void> {
        const payload = {
            ...getClientInfo(),
            timestamp: Date.now(),
            status: "active",
            current_session_id: currentSessionId,
        }

        try {
            await httpPost("/api/v1/heartbeat", payload)
        } catch (e) {
            log.warn("heartbeat failed", { error: e })
        }
    }

    /**
     * HTTP POST with retry logic.
     */
    async function httpPost(urlPath: string, body: any): Promise<void> {
        const baseUrl = MetricsConfig.getApiBaseUrl()
        const url = `${baseUrl}${urlPath}`
        const maxRetries = 3

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Client-ID": body.client_id ?? "",
                    },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(10_000),
                })

                if (response.ok) return

                if (response.status >= 500) {
                    // Server error – retry
                    await sleep(1000 * (attempt + 1))
                    continue
                }

                // Client error – don't retry
                log.error("upload rejected by server", {
                    status: response.status,
                    body: await response.text().catch(() => ""),
                })
                return
            } catch (e) {
                if (attempt < maxRetries - 1) {
                    await sleep(1000 * (attempt + 1))
                    continue
                }
                throw e
            }
        }
    }

    function sleep(ms: number): Promise<void> {
        return new Promise((r) => setTimeout(r, ms))
    }
}
