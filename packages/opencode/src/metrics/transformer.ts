import { Log } from "@/util/log"
import type { MetricsAggregator } from "./aggregator"

export namespace MetricsTransformer {
    const log = Log.create({ service: "metrics.transformer" })

    // Exchange rate constant (configurable in future)
    const USD_TO_RMB = 7.2

    export interface PlatformDataEntry {
        indicatorCode: string
        value: number
        recordDate: string // YYYY-MM-DD
        additionalData?: Record<string, any>
    }

    /**
     * Transform AggregatedMetrics into platform batch data entries.
     * Maps OpenCode aggregated fields to the management platform indicator codes.
     */
    export function transformAggregated(
        metrics: MetricsAggregator.AggregatedMetrics["metrics"],
        periodStart: number,
        periodEnd: number,
    ): PlatformDataEntry[] {
        const recordDate = new Date(periodEnd).toISOString().split("T")[0]
        const entries: PlatformDataEntry[] = []

        // 1. Token consumption (token_usage)
        if (metrics.total_tokens?.total) {
            entries.push({
                indicatorCode: "token_usage",
                value: metrics.total_tokens.total,
                recordDate,
                additionalData: {
                    input: metrics.total_tokens.input,
                    output: metrics.total_tokens.output,
                    reasoning: metrics.total_tokens.reasoning,
                    cache_read: metrics.total_tokens.cache_read,
                    cache_write: metrics.total_tokens.cache_write,
                },
            })
        }

        // 2. API call count (api_call_count)
        if (metrics.api_call_count) {
            entries.push({
                indicatorCode: "api_call_count",
                value: metrics.api_call_count,
                recordDate,
            })
        }

        // 3. Average call cost USD → RMB (avg_call_cost)
        if (metrics.avg_cost_per_call !== undefined && metrics.avg_cost_per_call > 0) {
            entries.push({
                indicatorCode: "avg_call_cost",
                value: Number((metrics.avg_cost_per_call * USD_TO_RMB).toFixed(4)),
                recordDate,
                additionalData: {
                    original_usd: metrics.avg_cost_per_call,
                    exchange_rate: USD_TO_RMB,
                },
            })
        }

        // 4. Average generation time ms → seconds (avg_generation_time)
        if (metrics.avg_generation_time_ms) {
            entries.push({
                indicatorCode: "avg_generation_time",
                value: Number((metrics.avg_generation_time_ms / 1000).toFixed(2)),
                recordDate,
            })
        }

        // 5. AI lines of code (ai_loc)
        if (metrics.total_additions) {
            entries.push({
                indicatorCode: "ai_loc",
                value: metrics.total_additions,
                recordDate,
                additionalData: {
                    deletions: metrics.total_deletions,
                    files_modified: metrics.total_files_modified,
                },
            })
        }

        // 6. Language distribution (language_mix)
        if (metrics.language_distribution && Object.keys(metrics.language_distribution).length > 0) {
            const total = Object.values(metrics.language_distribution).reduce((a, b) => a + b, 0)
            const percentages: Record<string, number> = {}
            for (const [lang, count] of Object.entries(metrics.language_distribution)) {
                percentages[lang] = Number(((count / total) * 100).toFixed(1))
            }
            entries.push({
                indicatorCode: "language_mix",
                value: Object.keys(metrics.language_distribution).length,
                recordDate,
                additionalData: {
                    distribution: percentages,
                    raw_counts: metrics.language_distribution,
                },
            })
        }

        // 7. Work mode distribution / tool distribution (work_mode_distribution)
        if (metrics.tool_distribution && Object.keys(metrics.tool_distribution).length > 0) {
            const total = Object.values(metrics.tool_distribution).reduce((a, b) => a + b, 0)
            const percentages: Record<string, number> = {}
            for (const [tool, count] of Object.entries(metrics.tool_distribution)) {
                percentages[tool] = Number(((count / total) * 100).toFixed(1))
            }
            entries.push({
                indicatorCode: "work_mode_distribution",
                value: total,
                recordDate,
                additionalData: {
                    distribution: percentages,
                    raw_counts: metrics.tool_distribution,
                },
            })
        }

        // 8. AI bug/error rate (ai_bug_rate)
        if (metrics.message_count > 0) {
            entries.push({
                indicatorCode: "ai_bug_rate",
                value: Number(((metrics.error_count / metrics.message_count) * 100).toFixed(2)),
                recordDate,
                additionalData: {
                    error_count: metrics.error_count,
                    total_calls: metrics.message_count,
                    error_types: metrics.error_types,
                },
            })
        }

        // 9. AI cost trend — daily total cost in RMB (ai_cost_trend)
        if (metrics.total_cost !== undefined && metrics.total_cost > 0) {
            entries.push({
                indicatorCode: "ai_cost_trend",
                value: Number((metrics.total_cost * USD_TO_RMB).toFixed(2)),
                recordDate,
                additionalData: {
                    original_usd: metrics.total_cost,
                    session_count: metrics.session_count,
                },
            })
        }

        log.info("transformed aggregated metrics", { entryCount: entries.length })
        return entries
    }
}
