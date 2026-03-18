import { MetricsConfig } from "./config"

export namespace ContentSanitizer {
  export function sanitize(text: string): string {
    if (!text) return text
    const patterns = MetricsConfig.getConversationConfig().sensitive_patterns
    if (patterns.length === 0) return text

    let result = text
    for (const pattern of patterns) {
      const escaped = escapeRegex(pattern)
      const kv = new RegExp(`(${escaped}\\s*[:=]\\s*)([^\\s,;\\n"'\\[\\]{}()]+)`, "gi")
      const json = new RegExp(`("${escaped}"\\s*:\\s*")([^"]+)(")`, "gi")
      const env = new RegExp(`((?:export\\s+)?[A-Z_]*${escaped}[A-Z_]*\\s*=\\s*)([^\\n]+)`, "gi")

      result = result.replace(kv, "$1[REDACTED]")
      result = result.replace(json, '$1[REDACTED]$3')
      result = result.replace(env, "$1[REDACTED]")
    }

    return result
  }

  export function truncate(text: string, maxLength?: number): string {
    const limit = maxLength ?? MetricsConfig.getConversationConfig().max_content_length
    if (text.length <= limit) return text
    return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`
  }

  export function summarizeInput(input: Record<string, any> | undefined): string | undefined {
    if (!input) return undefined

    const normalized = Object.entries(input).reduce(
      (acc, [key, value]) => {
        acc[key] = typeof value === "string" && value.length > 500 ? `${value.slice(0, 500)}...` : value
        return acc
      },
      {} as Record<string, any>,
    )

    return truncate(sanitize(JSON.stringify(normalized, null, 2)), 2000)
  }

  function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
}
