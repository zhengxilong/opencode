import type { ToolPart } from "@opencode-ai/sdk"
import type { WechatConfig } from "./config"
import { createApproval, detectRisk, expireApprovals, resolveApproval } from "./approval"
import type { Command } from "./model/command"
import type { InboundMessage, WechatAccount } from "./model/wechat"
import { syncMetrics, incrementMetric, recordMetric } from "./metrics"
import { parseCommand, parseMessage } from "./parser"
import { pollLoop, dedupeKey } from "./poller"
import { resetBindings, resolveProject, setProject } from "./router"
import { sendReplyChunks } from "./sender"
import { collectToolEvents, createRuntime, executePrompt } from "./session"
import type { StateStore } from "./state/types"
import { log, logError } from "./util/log"

export async function createWechatBridge(input: { config: WechatConfig; store: StateStore }) {
  const runtime = await createRuntime(input.config)
  const pendingStatus = new Map<string, number>()

  await collectToolEvents({
    runtime,
    onTool: async (part: ToolPart) => {
      if (part.state.status !== "completed") return
      const last = pendingStatus.get(part.sessionID) ?? 0
      if (Date.now() - last < input.config.status_update_threshold_seconds * 1_000) return
      pendingStatus.set(part.sessionID, Date.now())
      const bindings = await input.store.getBindings()
      const binding = bindings.find((item) => item.sessionId === part.sessionID)
      if (!binding) return
      const account = await input.store.getAccount()
      const tokens = await input.store.getContextTokens()
      const contextToken = tokens[binding.wechatUserId]
      if (!account || !contextToken) return
      await sendReplyChunks(account, {
        to: binding.wechatUserId,
        text: `处理中：${part.tool} - ${part.state.title ?? "已完成一步"}`,
        contextToken,
        max: input.config.max_reply_length,
      }).catch(() => {})
    },
  })

  return {
    runtime,
    async start() {
      const account = await input.store.getAccount()
      if (!account) throw new Error("not logged in")
      await recordMetric(input.store, {
        activeUserCount: Object.keys(await input.store.getContextTokens()).length,
      })
      await pollLoop({
        account,
        store: input.store,
        onMessages: async (messages) => {
          await expireApprovals(input.store)
          for (const item of messages) {
            const parsed = parseMessage(item as never)
            if (!parsed) continue
            const dedupe = dedupeKey(parsed.wechatUserId, parsed.createTimeMs, parsed.text)
            const cached = await input.store.getDedupe()
            if (cached.some((x) => x.key === dedupe)) continue
            await input.store.setDedupe([...cached.slice(-499), { key: dedupe, createdAt: Date.now() }])

            if (parsed.contextToken) {
              const tokens = await input.store.getContextTokens()
              await input.store.setContextTokens({
                ...tokens,
                [parsed.wechatUserId]: parsed.contextToken,
              })
            }

            await incrementMetric(input.store, "inboundMessageCount")
            await handleMessage({ config: input.config, store: input.store, runtime, account, message: parsed })
          }
        },
      })
    },
    async status() {
      return {
        runtime: await input.store.getRuntime(),
        metrics: await input.store.getMetrics(),
        bindings: await input.store.getBindings(),
        approvals: await input.store.getApprovals(),
      }
    },
    async syncMetrics() {
      await syncMetrics(input.store, input.config.management_api_base_url)
    },
  }
}

async function handleMessage(input: {
  config: WechatConfig
  store: StateStore
  runtime: Awaited<ReturnType<typeof createRuntime>>
  account: WechatAccount
  message: InboundMessage
}) {
  const command = parseCommand(input.message.text)
  const maybeApproval = await resolveApproval(input.store, input.message.wechatUserId, command)
  if (maybeApproval?.status === "approved") {
    await reply(input, `已确认，开始执行：${maybeApproval.requestText}`)
    await runPrompt(input, maybeApproval.requestText)
    return
  }
  if (maybeApproval?.status === "rejected") {
    await reply(input, "已取消本次高风险请求。")
    return
  }
  if (command.type !== "unknown") {
    await handleCommand(input, command)
    return
  }
  const project = await resolveProject(input.store, input.config, input.message.wechatUserId)
  const risk = detectRisk(input.message.text, input.config.require_confirmation_for)
  if (risk) {
    const approval = await createApproval(input.store, {
      wechatUserId: input.message.wechatUserId,
      projectDir: project.dir,
      requestText: input.message.text,
      riskType: risk,
    })
    await recordMetric(input.store, {
      approvalPendingCount: (await input.store.getApprovals()).filter((x) => x.status === "pending").length,
    })
    await reply(input, `该请求包含高风险操作（${approval.riskType}）。回复“确认”继续，回复“取消”终止。`)
    return
  }
  await runPrompt(input, input.message.text)
}

async function handleCommand(
  input: {
    config: WechatConfig
    store: StateStore
    runtime: Awaited<ReturnType<typeof createRuntime>>
    account: WechatAccount
    message: InboundMessage
  },
  command: Command,
) {
  if (command.type === "help") {
    await reply(input, ["可用命令：", "#help", "#status", "#reset", "#project list", "#project use <name>", "确认", "取消"].join("\n"))
    return
  }
  if (command.type === "status") {
    const project = await resolveProject(input.store, input.config, input.message.wechatUserId)
    const bindings = await input.store.getBindings()
    const binding = bindings.find((x) => x.wechatUserId === input.message.wechatUserId && x.projectDir === project.dir && x.status === "active")
    await reply(
      input,
      [
        `当前项目：${project.name}`,
        `目录：${project.dir}`,
        `会话：${binding?.sessionId ?? "无"}`,
        `最近活跃：${binding?.lastActiveAt ? new Date(binding.lastActiveAt).toLocaleString() : "无"}`,
      ].join("\n"),
    )
    return
  }
  if (command.type === "reset") {
    await resetBindings(input.store, input.message.wechatUserId)
    await reply(input, "当前微信会话已重置，下次消息会创建新 Session。")
    return
  }
  if (command.type === "project.list") {
    await reply(input, `可用项目：\n${input.config.allowed_projects.join("\n")}`)
    return
  }
  if (command.type === "project.use") {
    const match = input.config.allowed_projects.find((item) => item === command.project || item.endsWith(`/${command.project}`))
    if (!match) {
      await reply(input, `未找到可用项目：${command.project}`)
      return
    }
    await setProject(input.store, input.message.wechatUserId, match)
    await reply(input, `已切换项目：${match}`)
    return
  }
  if (command.type === "confirm" || command.type === "cancel") {
    await reply(input, "当前没有待确认的高风险请求。")
  }
}

async function runPrompt(input: {
  config: WechatConfig
  store: StateStore
  runtime: Awaited<ReturnType<typeof createRuntime>>
  account: WechatAccount
  message: InboundMessage
}, text: string) {
  try {
    await reply(input, "已接收，正在处理...")
    const result = await executePrompt({
      runtime: input.runtime,
      config: input.config,
      store: input.store,
      message: {
        ...input.message,
        text,
      },
    })
    await reply(input, result.text)
    await syncMetrics(input.store, input.config.management_api_base_url).catch((error) => {
      logError("bridge", "sync metrics failed", error)
    })
  } catch (error) {
    await incrementMetric(input.store, "errorCount")
    logError("bridge", "run prompt failed", error)
    await reply(input, `处理失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function reply(
  input: {
    config: WechatConfig
    store: StateStore
    runtime: Awaited<ReturnType<typeof createRuntime>>
    account: WechatAccount
    message: InboundMessage
  },
  text: string,
) {
  const tokens = await input.store.getContextTokens()
  const contextToken = tokens[input.message.wechatUserId] ?? input.message.contextToken
  if (!contextToken) {
    log("bridge", "skip reply, missing context token", { wechatUserId: input.message.wechatUserId })
    return
  }
  const start = Date.now()
  await sendReplyChunks(input.account, {
    to: input.message.wechatUserId,
    text,
    contextToken,
    max: input.config.max_reply_length,
  })
  await incrementMetric(input.store, "outboundMessageCount")
  const metrics = await input.store.getMetrics()
  await recordMetric(input.store, {
    totalReplyLatencyMs: metrics.totalReplyLatencyMs + (Date.now() - start),
    totalReplies: metrics.totalReplies + 1,
    activeUserCount: Object.keys(await input.store.getContextTokens()).length,
  })
}
