import crypto from "crypto"
import { MessageV2 } from "@/session/message-v2"
import { Log } from "@/util/log"
import { MetricsConfig } from "./config"
import { MetricsQueue } from "./queue"

export namespace FeedbackManager {
  const log = Log.create({ service: "metrics.feedback" })

  export const DEFAULT_REASONS = [
    { key: "inaccurate", label: "回答不准确" },
    { key: "code_error", label: "代码有错误" },
    { key: "misunderstand", label: "没有理解需求" },
    { key: "too_verbose", label: "回复太冗长" },
    { key: "too_slow", label: "生成速度太慢" },
    { key: "other", label: "其他" },
  ] as const

  export interface FeedbackRecord {
    event_type: "user_feedback"
    timestamp: number
    data: {
      feedback_id: string
      message_id: string
      session_id: string
      rating: "positive" | "negative"
      reasons?: string[]
      comment?: string
      context: {
        model_id: string
        provider_id: string
        agent: string
        cost: number
        tokens_total: number
        duration_ms: number
        tool_count: number
        has_error: boolean
      }
      feedback_delay_ms: number
      time_created: number
    }
  }

  export interface PendingFeedback {
    message_id: string
    session_id: string
    completed_at: number
  }

  export interface SessionFeedbackSummary {
    total_replies: number
    rated_count: number
    skipped_count: number
    positive_count: number
    negative_count: number
    negative_reasons: Record<string, number>
  }

  let pending: PendingFeedback | null = null
  const skipped = new Set<string>()
  const seen = new Set<string>()
  const feedback = [] as FeedbackRecord[]

  export function setPendingMessage(message_id: string, session_id: string, completed_at: number) {
    if (seen.has(message_id) || skipped.has(message_id)) return
    pending = { message_id, session_id, completed_at }
  }

  export function getPending() {
    return pending
  }

  export function hasPending() {
    return !!pending
  }

  export function clearPending(skippedMessage = false) {
    if (skippedMessage && pending) skipped.add(pending.message_id)
    pending = null
  }

  export function getAllReasons() {
    return [
      ...DEFAULT_REASONS,
      ...MetricsConfig.getFeedbackConfig().custom_reasons.map((item) => ({ key: item, label: item })),
    ]
  }

  export function getSessionSummary(): SessionFeedbackSummary {
    const negative_reasons = feedback.reduce(
      (acc, item) => {
        if (item.data.rating !== "negative") return acc
        item.data.reasons?.forEach((reason) => {
          acc[reason] = (acc[reason] ?? 0) + 1
        })
        return acc
      },
      {} as Record<string, number>,
    )
    const positive_count = feedback.filter((item) => item.data.rating === "positive").length
    const negative_count = feedback.length - positive_count
    return {
      total_replies: seen.size + skipped.size + (pending ? 1 : 0),
      rated_count: feedback.length,
      skipped_count: skipped.size,
      positive_count,
      negative_count,
      negative_reasons,
    }
  }

  export function resetSession() {
    pending = null
    skipped.clear()
    seen.clear()
    feedback.length = 0
  }

  export async function submit(rating: "positive" | "negative", reasons?: string[], comment?: string) {
    if (!pending) return false
    if (!MetricsConfig.isFeedbackEnabled()) {
      clearPending()
      return false
    }

    try {
      const msg = await MessageV2.get({
        sessionID: pending.session_id,
        messageID: pending.message_id,
      })
      if (msg.info.role !== "assistant") {
        clearPending()
        return false
      }
      const now = Date.now()
      const tool_count = msg.parts.filter((part) => part.type === "tool").length
      const record: FeedbackRecord = {
        event_type: "user_feedback",
        timestamp: now,
        data: {
          feedback_id: "fb_" + crypto.randomBytes(12).toString("hex"),
          message_id: pending.message_id,
          session_id: pending.session_id,
          rating,
          reasons: rating === "negative" && reasons?.length ? reasons : undefined,
          comment: rating === "negative" && comment ? comment.slice(0, 200) : undefined,
          context: {
            model_id: msg.info.modelID,
            provider_id: msg.info.providerID,
            agent: msg.info.agent,
            cost: msg.info.cost,
            tokens_total: msg.info.tokens.total ?? msg.info.tokens.input + msg.info.tokens.output + msg.info.tokens.reasoning,
            duration_ms: (msg.info.time.completed ?? now) - msg.info.time.created,
            tool_count,
            has_error: !!msg.info.error,
          },
          feedback_delay_ms: now - pending.completed_at,
          time_created: now,
        },
      }
      await MetricsQueue.enqueue("feedback", record)
      feedback.push(record)
      seen.add(pending.message_id)
      pending = null
      log.info("feedback submitted", {
        rating,
        message_id: record.data.message_id,
      })
      return true
    } catch (error) {
      log.error("failed to submit feedback", { error })
      clearPending()
      return false
    }
  }
}
