import { beforeEach, describe, expect, test } from "bun:test"
import { ContentSanitizer } from "../../src/metrics/content-sanitizer"
import { ConversationExtractor } from "../../src/metrics/conversation-extractor"
import { MetricsConfig } from "../../src/metrics/config"

function makeUserMessage(overrides: Record<string, any> = {}) {
  return {
    id: "msg_user_001",
    sessionID: "session_001",
    role: "user",
    time: {
      created: 1700000000000,
    },
    agent: "build",
    model: {
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    },
    ...overrides,
  } as any
}

function makeAssistantMessage(overrides: Record<string, any> = {}) {
  return {
    id: "msg_assistant_001",
    sessionID: "session_001",
    role: "assistant",
    modelID: "claude-sonnet-4",
    providerID: "anthropic",
    agent: "build",
    parentID: "msg_user_001",
    mode: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0.123,
    tokens: {
      input: 120,
      output: 240,
      reasoning: 50,
      cache: { read: 80, write: 10 },
    },
    time: {
      created: 1700000001000,
      completed: 1700000004000,
    },
    finish: "end_turn",
    ...overrides,
  } as any
}

beforeEach(() => {
  MetricsConfig.resetConfig()
  MetricsConfig.setConfig({
    enabled: true,
    api_base_url: "http://localhost:3001",
    include_file_paths: true,
    conversation_recording: {
      enabled: true,
      include_user_prompt: true,
      include_assistant_reply: true,
      include_reasoning: false,
      include_tool_details: true,
      include_tool_output: false,
      max_content_length: 200,
      sensitive_patterns: ["password", "token", "authorization"],
      exclude_sessions: [],
    },
  })
})

describe("ContentSanitizer", () => {
  test("redacts sensitive key value pairs", () => {
    const text = 'password=12345\nauthorization: Bearer abcdef\n{"token":"secret"}'
    const result = ContentSanitizer.sanitize(text)

    expect(result).toContain("password=[REDACTED]")
    expect(result).toContain("authorization: [REDACTED]")
    expect(result).toContain('"token":"[REDACTED]"')
  })

  test("truncates oversized content", () => {
    const result = ContentSanitizer.truncate("a".repeat(210), 50)
    expect(result).toStartWith("a".repeat(50))
    expect(result).toContain("[truncated")
  })
})

describe("ConversationExtractor.extractUserPrompt", () => {
  test("extracts text and attachments", () => {
    const result = ConversationExtractor.extractUserPrompt(makeUserMessage(), [
      {
        id: "part_text_1",
        sessionID: "session_001",
        messageID: "msg_user_001",
        type: "text",
        text: "请读取 password=abc 并排序",
      },
      {
        id: "part_file_1",
        sessionID: "session_001",
        messageID: "msg_user_001",
        type: "file",
        mime: "text/plain",
        filename: "notes.txt",
        url: "file:///notes.txt",
        source: {
          type: "file",
          path: "/tmp/notes.txt",
          text: {
            value: "notes",
            start: 0,
            end: 5,
          },
        },
      },
    ] as any)

    expect(result).not.toBeNull()
    expect(result?.data.text_content).toContain("[REDACTED]")
    expect(result?.data.attachments[0]?.path).toBe("/tmp/notes.txt")
  })

  test("respects session exclusion and config toggle", () => {
    MetricsConfig.setConfig({
      conversation_recording: {
        exclude_sessions: ["session_001"],
      },
    })
    expect(ConversationExtractor.extractUserPrompt(makeUserMessage(), [])).toBeNull()

    MetricsConfig.setConfig({
      conversation_recording: {
        exclude_sessions: [],
        include_user_prompt: false,
      },
    })
    expect(ConversationExtractor.extractUserPrompt(makeUserMessage(), [])).toBeNull()
  })
})

describe("ConversationExtractor.extractAssistantReply", () => {
  test("extracts assistant text, reasoning, and tool details", () => {
    MetricsConfig.setConfig({
      conversation_recording: {
        include_reasoning: true,
        include_tool_output: true,
      },
    })

    const result = ConversationExtractor.extractAssistantReply(makeAssistantMessage(), [
      {
        id: "part_text_1",
        sessionID: "session_001",
        messageID: "msg_assistant_001",
        type: "text",
        text: "这里是排序实现。",
      },
      {
        id: "part_reasoning_1",
        sessionID: "session_001",
        messageID: "msg_assistant_001",
        type: "reasoning",
        text: "优先使用快速排序。",
        time: { start: 1, end: 2 },
      },
      {
        id: "part_tool_1",
        sessionID: "session_001",
        messageID: "msg_assistant_001",
        type: "tool",
        callID: "call_001",
        tool: "write",
        state: {
          status: "completed",
          input: { file_path: "src/sort.ts", token: "abc" },
          output: "token=abcdef",
          title: "write file",
          metadata: {},
          time: { start: 10, end: 50 },
        },
      },
    ] as any)

    expect(result).not.toBeNull()
    expect(result?.data.reasoning_content).toContain("快速排序")
    expect(result?.data.tool_calls[0]?.duration_ms).toBe(40)
    expect(result?.data.tool_calls[0]?.input_summary).toContain("[REDACTED]")
    expect(result?.data.tool_calls[0]?.output_summary).toContain("[REDACTED]")
  })

  test("can skip reasoning and tool output", () => {
    const result = ConversationExtractor.extractAssistantReply(makeAssistantMessage(), [
      {
        id: "part_text_1",
        sessionID: "session_001",
        messageID: "msg_assistant_001",
        type: "text",
        text: "done",
      },
      {
        id: "part_reasoning_1",
        sessionID: "session_001",
        messageID: "msg_assistant_001",
        type: "reasoning",
        text: "hidden",
        time: { start: 1, end: 2 },
      },
    ] as any)

    expect(result?.data.reasoning_content).toBeUndefined()
  })
})

describe("MetricsConfig conversation settings", () => {
  test("defaults conversation recording to enabled when metrics is enabled", () => {
    MetricsConfig.resetConfig()
    MetricsConfig.setConfig({
      enabled: true,
      api_base_url: "http://localhost:3001",
    })

    expect(MetricsConfig.getConversationConfig().enabled).toBe(true)
    expect(MetricsConfig.isConversationRecordingEnabled()).toBe(true)
  })

  test("reports conversation recording state", () => {
    expect(MetricsConfig.isConversationRecordingEnabled()).toBe(true)
    MetricsConfig.setConfig({
      conversation_recording: {
        enabled: false,
      },
    })
    expect(MetricsConfig.isConversationRecordingEnabled()).toBe(false)
  })
})
