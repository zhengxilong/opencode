import type { ToolPart } from "@opencode-ai/sdk"
import type { WechatConfig } from "./config"
import type { InboundMessage } from "./model/wechat"
import type { StateStore } from "./state/types"
import { createOpencode } from "@opencode-ai/sdk"
import { incrementMetric, recordMetric } from "./metrics"
import { findBinding, resolveProject, saveBinding } from "./router"
import { randomId } from "./util/hash"
import { normalizeWechatText, trimReply } from "./util/text"

export async function createRuntime(config: WechatConfig) {
  const opencode = await createOpencode({
    port: 0,
  })
  return {
    ...opencode,
  }
}

export async function ensureSession(input: {
  runtime: Awaited<ReturnType<typeof createRuntime>>
  config: WechatConfig
  store: StateStore
  wechatUserId: string
}) {
  const project = await resolveProject(input.store, input.config, input.wechatUserId)
  const existing = await findBinding(input.store, input.wechatUserId, project.dir, input.config.session_timeout_minutes)
  if (existing) {
    await incrementMetric(input.store, "sessionReuseCount")
    return {
      binding: { ...existing, lastActiveAt: Date.now() },
      project,
      created: false,
    }
  }
  const created = await input.runtime.client.session.create({
    query: {
      directory: project.dir,
    },
    body: {
      title: `WeChat ${input.wechatUserId} ${project.name} ${new Date().toISOString().slice(0, 10)}`,
    },
  })
  if (created.error) throw new Error(JSON.stringify(created.error))
  const binding = {
    bindingKey: randomId("binding"),
    wechatUserId: input.wechatUserId,
    sessionId: created.data.id,
    projectDir: project.dir,
    projectName: project.name,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    status: "active" as const,
  }
  await saveBinding(input.store, binding)
  await incrementMetric(input.store, "sessionCreateCount")
  return {
    binding,
    project,
    created: true,
  }
}

export async function executePrompt(input: {
  runtime: Awaited<ReturnType<typeof createRuntime>>
  config: WechatConfig
  store: StateStore
  message: InboundMessage
}) {
  const start = Date.now()
  const { binding } = await ensureSession({
    runtime: input.runtime,
    config: input.config,
    store: input.store,
    wechatUserId: input.message.wechatUserId,
  })
  const project = await resolveProject(input.store, input.config, input.message.wechatUserId)
  await saveBinding(input.store, {
    ...binding,
    lastActiveAt: Date.now(),
  })

  const result = await input.runtime.client.session.prompt({
    path: { id: binding.sessionId },
    query: {
      directory: project.dir,
    },
    body: {
      parts: [{ type: "text", text: input.message.text }],
    },
  })
  const latency = Date.now() - start
  await recordMetric(input.store, {
    totalPromptLatencyMs: (await input.store.getMetrics()).totalPromptLatencyMs + latency,
    totalPrompts: (await input.store.getMetrics()).totalPrompts + 1,
  })
  if (result.error) throw new Error(JSON.stringify(result.error))
  const text =
    result.data.info?.summary === true
      ? result.data.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
      : result.data.info?.path?.cwd
        ? result.data.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
        : result.data.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")

  return {
    binding,
    text: trimReply(normalizeWechatText(text || result.data.info.id || "已收到请求，但没有可返回的文本结果。"), input.config.max_reply_length),
    latency,
  }
}

export async function collectToolEvents(input: {
  runtime: Awaited<ReturnType<typeof createRuntime>>
  onTool: (part: ToolPart) => Promise<void>
}) {
  const events = await input.runtime.client.event.subscribe()
  ;(async () => {
    for await (const event of events.stream) {
      if (event.type !== "message.part.updated") continue
      const part = event.properties.part
      if (part.type !== "tool") continue
      await input.onTool(part)
    }
  })()
}
