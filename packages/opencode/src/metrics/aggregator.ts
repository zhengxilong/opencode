import { Log } from "@/util/log"
import type { DataExtractor } from "./extractor"

export namespace MetricsAggregator {
    const log = Log.create({ service: "metrics.aggregator" })

    /**
     * Aggregate period result structure
     */
    export interface AggregatedMetrics {
        period: {
            start: number
            end: number
            type: "hourly" | "daily"
        }
        metrics: {
            session_count: number
            message_count: number
            total_cost: number
            total_tokens: {
                input: number
                output: number
                reasoning: number
                cache_read: number
                cache_write: number
                total: number
            }
            api_call_count: number
            avg_cost_per_call: number
            avg_generation_time_ms: number
            total_additions: number
            total_deletions: number
            total_files_modified: number
            tool_distribution: Record<string, number>
            language_distribution: Record<string, number>
            model_distribution: Record<string, number>
            error_count: number
            error_types: Record<string, number>
        }
    }

    /**
     * Compute aggregated metrics from raw event records.
     * This is a pure function – it accepts arrays of records already extracted.
     */
    export function computeFromRecords(input: {
        sessionRecords: DataExtractor.EventRecord[]
        messageRecords: DataExtractor.EventRecord[]
        toolRecords: DataExtractor.EventRecord[]
        stepRecords: DataExtractor.EventRecord[]
        periodStart: number
        periodEnd: number
    }): AggregatedMetrics | null {
        const { sessionRecords, messageRecords, toolRecords, stepRecords, periodStart, periodEnd } =
            input

        if (
            sessionRecords.length === 0 &&
            messageRecords.length === 0 &&
            toolRecords.length === 0 &&
            stepRecords.length === 0
        ) {
            return null
        }

        // Aggregate message-level data
        let totalCost = 0
        let totalDuration = 0
        let messageCount = 0
        let errorCount = 0
        const totalTokens = {
            input: 0,
            output: 0,
            reasoning: 0,
            cache_read: 0,
            cache_write: 0,
            total: 0,
        }
        const modelDist: Record<string, number> = {}
        const errorTypes: Record<string, number> = {}

        for (const record of messageRecords) {
            const d = record.data
            messageCount++
            totalCost += d.cost ?? 0

            if (d.tokens) {
                totalTokens.input += d.tokens.input ?? 0
                totalTokens.output += d.tokens.output ?? 0
                totalTokens.reasoning += d.tokens.reasoning ?? 0
                totalTokens.cache_read += d.tokens.cache_read ?? 0
                totalTokens.cache_write += d.tokens.cache_write ?? 0
                totalTokens.total += d.tokens.total ?? 0
            }

            if (d.duration_ms != null) {
                totalDuration += d.duration_ms
            }

            const modelKey = `${d.provider_id}/${d.model_id}`
            modelDist[modelKey] = (modelDist[modelKey] ?? 0) + 1

            if (d.has_error) {
                errorCount++
                const etype = d.error_type ?? "unknown"
                errorTypes[etype] = (errorTypes[etype] ?? 0) + 1
            }
        }

        // Aggregate session-level data
        let totalAdditions = 0
        let totalDeletions = 0
        let totalFilesModified = 0
        // Use a Set to count unique sessions
        const sessionIds = new Set<string>()

        for (const record of sessionRecords) {
            const d = record.data
            sessionIds.add(d.session_id)
            if (d.summary) {
                totalAdditions += d.summary.additions ?? 0
                totalDeletions += d.summary.deletions ?? 0
                totalFilesModified += d.summary.files ?? 0
            }
        }

        // Aggregate tool-level data
        const toolDist: Record<string, number> = {}
        const langDist: Record<string, number> = {}

        for (const record of toolRecords) {
            const d = record.data
            const toolName = d.tool_name ?? "unknown"
            toolDist[toolName] = (toolDist[toolName] ?? 0) + 1

            if (d.language) {
                langDist[d.language] = (langDist[d.language] ?? 0) + 1
            }
        }

        return {
            period: {
                start: periodStart,
                end: periodEnd,
                type: "hourly",
            },
            metrics: {
                session_count: sessionIds.size,
                message_count: messageCount,
                total_cost: Math.round(totalCost * 1_000_000) / 1_000_000, // 6 decimal places
                total_tokens: totalTokens,
                api_call_count: messageCount,
                avg_cost_per_call:
                    messageCount > 0
                        ? Math.round((totalCost / messageCount) * 1_000_000) / 1_000_000
                        : 0,
                avg_generation_time_ms:
                    messageCount > 0 ? Math.round(totalDuration / messageCount) : 0,
                total_additions: totalAdditions,
                total_deletions: totalDeletions,
                total_files_modified: totalFilesModified,
                tool_distribution: toolDist,
                language_distribution: langDist,
                model_distribution: modelDist,
                error_count: errorCount,
                error_types: errorTypes,
            },
        }
    }
}
