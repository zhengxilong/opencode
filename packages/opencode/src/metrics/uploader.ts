import { MetricsQueue } from "./queue"
import { MetricsConfig } from "./config"
import { MetricsTransformer } from "./transformer"
import { Log } from "@/util/log"
import type { MetricsAggregator } from "./aggregator"

export namespace MetricsUploader {
    const log = Log.create({ service: "metrics.uploader" })

    const CATEGORIES = ["session", "message", "tool", "step"] as const
    const API_PATHS: Record<string, string> = {
        session: "/api/v1/metrics/report",    // unified event endpoint
        message: "/api/v1/metrics/report",    // unified event endpoint
        tool: "/api/v1/metrics/report",    // unified event endpoint
        step: "/api/v1/metrics/report",    // unified event endpoint
        aggregated: "/api/data-entry/batch",     // reuse existing batch data entry
        heartbeat: "/api/v1/heartbeat",         // new heartbeat endpoint
    }

    let uploadTimer: ReturnType<typeof setInterval> | null = null

    // ── JWT Token Management ──────────────────────────────────────────

    let cachedToken: string | null = null
    let tokenExpireAt: number = 0

    /**
     * Get a valid JWT token. Priority:
     * 1. Directly configured token (auth_token)
     * 2. Cached token if not expired
     * 3. Login with username/password to obtain new token
     */
    async function getAuthToken(): Promise<string> {
        // 1. Use directly configured token
        const configToken = MetricsConfig.getAuthToken()
        if (configToken) return configToken

        // 2. Use cached token if still valid (refresh 1h before expiry)
        if (cachedToken && Date.now() < tokenExpireAt - 3600_000) {
            return cachedToken
        }

        // 3. Login with username/password
        const username = MetricsConfig.getAuthUsername()
        const password = MetricsConfig.getAuthPassword()
        if (!username || !password) {
            throw new Error("metrics auth: username/password not configured")
        }

        const baseUrl = MetricsConfig.getApiBaseUrl()
        const resp = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
            signal: AbortSignal.timeout(10_000),
        })

        if (!resp.ok) {
            throw new Error(`metrics auth failed: ${resp.status} ${resp.statusText}`)
        }

        const body = await resp.json()
        cachedToken = body.data.token
        // Default 24h expiry
        tokenExpireAt = Date.now() + (body.data.expiresIn || 86400) * 1000
        log.info("obtained JWT token", { expiresIn: body.data.expiresIn })
        return cachedToken!
    }

    /**
     * Fetch with JWT Bearer token injected.
     */
    async function authenticatedFetch(url: string, options: RequestInit): Promise<Response> {
        const token = await getAuthToken()
        const headers = {
            ...(options.headers as Record<string, string>),
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        }
        return fetch(url, { ...options, headers })
    }

    // ── For testing: reset cached token ────────────────────────────────
    export function resetAuthState() {
        cachedToken = null
        tokenExpireAt = 0
    }

    // ── Client Info ────────────────────────────────────────────────────

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

    // ── Timer Management ───────────────────────────────────────────────

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

    // ── Upload Logic ───────────────────────────────────────────────────

    /**
     * Upload all pending data across all categories.
     */
    export async function uploadAll(): Promise<void> {
        for (const category of CATEGORIES) {
            await uploadCategory(category)
        }
    }

    /**
     * Upload a single category's data as a batch of events.
     */
    export async function uploadCategory(category: string): Promise<void> {
        const records = await MetricsQueue.dequeue(category)
        if (records.length === 0) return

        const batchSize = MetricsConfig.getBatchSize()

        // Split into batches if needed
        for (let i = 0; i < records.length; i += batchSize) {
            const batch = records.slice(i, i + batchSize)
            const apiPath = API_PATHS[category] ?? "/api/v1/metrics/report"

            // Wrap events with client envelope
            const payload = {
                ...getClientInfo(),
                events: batch.map((record) => ({
                    event_type: record.event_type ?? category,
                    event_action: record.event_action,
                    timestamp: record.timestamp ?? Date.now(),
                    data: record.data ?? record,
                })),
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
     * Upload aggregated metrics to the platform's batch data entry endpoint.
     * Uses MetricsTransformer to convert from AggregatedMetrics to platform format.
     */
    export async function uploadAggregated(
        aggregated: MetricsAggregator.AggregatedMetrics,
    ): Promise<void> {
        // 1. Transform to platform format
        const entries = MetricsTransformer.transformAggregated(
            aggregated.metrics,
            aggregated.period.start,
            aggregated.period.end,
        )

        if (entries.length === 0) return

        // 2. Upload via platform batch data entry endpoint
        try {
            const baseUrl = MetricsConfig.getApiBaseUrl()
            const resp = await authenticatedFetch(`${baseUrl}${API_PATHS.aggregated}`, {
                method: "POST",
                body: JSON.stringify({ data: entries }),
            })

            if (resp.ok) {
                log.info("aggregated metrics uploaded", { count: entries.length })
            } else if (resp.status === 400) {
                // Possible duplicate data
                const body = await resp.json()
                log.warn("batch upload had conflicts", { message: body.message })
            } else {
                throw new Error(`upload failed: ${resp.status}`)
            }
        } catch (e) {
            log.error("aggregated upload failed, requeueing", { error: e })
            await MetricsQueue.enqueue("aggregated_pending", {
                entries,
                timestamp: Date.now(),
            })
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
            await httpPost(API_PATHS.heartbeat, payload)
        } catch (e) {
            log.warn("heartbeat failed", { error: e })
        }
    }

    /**
     * HTTP POST with retry logic and JWT authentication.
     */
    async function httpPost(urlPath: string, body: any): Promise<void> {
        const baseUrl = MetricsConfig.getApiBaseUrl()
        const url = `${baseUrl}${urlPath}`
        const maxRetries = 3

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await authenticatedFetch(url, {
                    method: "POST",
                    body: JSON.stringify(body),
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
