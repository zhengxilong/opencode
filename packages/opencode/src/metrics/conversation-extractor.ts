import type { MessageV2 } from "@/session/message-v2"
import { MetricsConfig } from "./config"
import { ContentSanitizer } from "./content-sanitizer"

export namespace ConversationExtractor {
  export interface UserPromptRecord {
    event_type: "user_prompt"
    timestamp: number
    data: {
      message_id: string
      session_id: string
      text_content: string
      attachments: Array<{
        type: string
        mime: string
        filename?: string
        path?: string
      }>
      agent: string
      model: {
        provider_id: string
        model_id: string
      }
      time_created: number
    }
  }

  export interface AssistantReplyRecord {
    event_type: "assistant_reply"
    timestamp: number
    data: {
      message_id: string
      session_id: string
      parent_message_id: string
      text_content: string
      reasoning_content?: string
      tool_calls: Array<{
        tool_name: string
        call_id: string
        status: string
        input_summary?: string
        output_summary?: string
        duration_ms?: number
      }>
      model_id: string
      provider_id: string
      agent: string
      cost: number
      tokens: {
        input: number
        output: number
        reasoning: number
        cache_read: number
        cache_write: number
      }
      time_created: number
      time_completed: number
      duration_ms: number
      has_error: boolean
      error_type?: string
      finish_reason?: string
    }
  }

  export type ConversationRecord = UserPromptRecord | AssistantReplyRecord

  export function extractUserPrompt(
    msg: MessageV2.User,
    parts: MessageV2.Part[],
  ): UserPromptRecord | null {
    const config = MetricsConfig.getConversationConfig()
    if (!config.include_user_prompt) return null
    if (config.exclude_sessions.includes(msg.sessionID)) return null

    const textContent = ContentSanitizer.truncate(
      ContentSanitizer.sanitize(
        parts
          .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic && !part.ignored)
          .map((part) => part.text)
          .join("\n"),
      ),
    )

    const attachments = parts
      .filter((part): part is MessageV2.FilePart => part.type === "file")
      .map((part) => ({
        type: part.source?.type ?? "file",
        mime: part.mime,
        filename: part.filename,
        path:
          MetricsConfig.shouldIncludeFilePaths() && part.source?.type === "file"
            ? part.source.path
            : undefined,
      }))

    return {
      event_type: "user_prompt",
      timestamp: msg.time.created,
      data: {
        message_id: msg.id,
        session_id: msg.sessionID,
        text_content: textContent,
        attachments,
        agent: msg.agent,
        model: {
          provider_id: msg.model.providerID,
          model_id: msg.model.modelID,
        },
        time_created: msg.time.created,
      },
    }
  }

  export function extractAssistantReply(
    msg: MessageV2.Assistant,
    parts: MessageV2.Part[],
  ): AssistantReplyRecord | null {
    const config = MetricsConfig.getConversationConfig()
    if (!config.include_assistant_reply) return null
    if (config.exclude_sessions.includes(msg.sessionID)) return null

    const textContent = ContentSanitizer.truncate(
      ContentSanitizer.sanitize(
        parts
          .filter((part): part is MessageV2.TextPart => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      ),
    )

    const reasoningParts = config.include_reasoning
      ? parts
          .filter((part): part is MessageV2.ReasoningPart => part.type === "reasoning")
          .map((part) => part.text)
      : []
    const reasoningContent =
      reasoningParts.length > 0
        ? ContentSanitizer.truncate(ContentSanitizer.sanitize(reasoningParts.join("\n")))
        : undefined

    const toolCalls = config.include_tool_details
      ? parts
          .filter((part): part is MessageV2.ToolPart => part.type === "tool")
          .map((part) => {
            const state = part.state
            const durationMs =
              "time" in state && state.time && "end" in state.time ? state.time.end - state.time.start : undefined
            const inputSummary = "input" in state ? ContentSanitizer.summarizeInput(state.input) : undefined
            const outputSummary =
              config.include_tool_output && state.status === "completed" && "output" in state
                ? ContentSanitizer.truncate(ContentSanitizer.sanitize(state.output), 2000)
                : undefined

            return {
              tool_name: part.tool,
              call_id: part.callID,
              status: state.status,
              input_summary: inputSummary,
              output_summary: outputSummary,
              duration_ms: durationMs,
            }
          })
      : []

    const timeCompleted = msg.time.completed ?? Date.now()

    return {
      event_type: "assistant_reply",
      timestamp: timeCompleted,
      data: {
        message_id: msg.id,
        session_id: msg.sessionID,
        parent_message_id: msg.parentID,
        text_content: textContent,
        reasoning_content: reasoningContent,
        tool_calls: toolCalls,
        model_id: msg.modelID,
        provider_id: msg.providerID,
        agent: msg.agent,
        cost: msg.cost,
        tokens: {
          input: msg.tokens.input,
          output: msg.tokens.output,
          reasoning: msg.tokens.reasoning,
          cache_read: msg.tokens.cache.read,
          cache_write: msg.tokens.cache.write,
        },
        time_created: msg.time.created,
        time_completed: timeCompleted,
        duration_ms: timeCompleted - msg.time.created,
        has_error: Boolean(msg.error),
        error_type: msg.error ? msg.error.name : undefined,
        finish_reason: msg.finish,
      },
    }
  }
}
