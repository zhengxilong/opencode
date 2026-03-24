import path from "node:path"
import { rm } from "node:fs/promises"
import type { MetricsSnapshot, RuntimeState, SyncState } from "../model/runtime"
import type { StateShape, StateStore } from "./types"

const FILES = {
  account: "account.json",
  sync: "sync_state.json",
  bindings: "session_bindings.json",
  dedupe: "dedupe.json",
  approvals: "approvals.json",
  runtime: "runtime.json",
  metrics: "metrics.json",
  contextTokens: "context_tokens.json",
  projectBindings: "project_bindings.json",
} as const

export async function createFileStore(root: string): Promise<StateStore> {
  await Bun.write(path.join(root, ".keep"), "")
  const ensure = async <T>(file: string, value: T) => {
    const target = path.join(root, file)
    if (await Bun.file(target).exists()) return
    await writeJson(target, value)
  }

  await ensure(FILES.account, null)
  await ensure(FILES.sync, defaultSync())
  await ensure(FILES.bindings, [])
  await ensure(FILES.dedupe, [])
  await ensure(FILES.approvals, [])
  await ensure(FILES.runtime, defaultRuntime())
  await ensure(FILES.metrics, defaultMetrics())
  await ensure(FILES.contextTokens, {})
  await ensure(FILES.projectBindings, {})

  return {
    root,
    getAccount: () => readJson(path.join(root, FILES.account)),
    setAccount: (value) => writeJson(path.join(root, FILES.account), value),
    getSync: () => readJson(path.join(root, FILES.sync)),
    setSync: (value) => writeJson(path.join(root, FILES.sync), value),
    getBindings: () => readJson(path.join(root, FILES.bindings)),
    setBindings: (value) => writeJson(path.join(root, FILES.bindings), value),
    getDedupe: () => readJson(path.join(root, FILES.dedupe)),
    setDedupe: (value) => writeJson(path.join(root, FILES.dedupe), value),
    getApprovals: () => readJson(path.join(root, FILES.approvals)),
    setApprovals: (value) => writeJson(path.join(root, FILES.approvals), value),
    getRuntime: () => readJson(path.join(root, FILES.runtime)),
    setRuntime: (value) => writeJson(path.join(root, FILES.runtime), value),
    getMetrics: () => readJson(path.join(root, FILES.metrics)),
    setMetrics: (value) => writeJson(path.join(root, FILES.metrics), value),
    getContextTokens: () => readJson(path.join(root, FILES.contextTokens)),
    setContextTokens: (value) => writeJson(path.join(root, FILES.contextTokens), value),
    getProjectBindings: () => readJson(path.join(root, FILES.projectBindings)),
    setProjectBindings: (value) => writeJson(path.join(root, FILES.projectBindings), value),
  }
}

async function readJson<T>(file: string): Promise<T> {
  const text = await Bun.file(file).text()
  return JSON.parse(text) as T
}

async function writeJson(file: string, value: unknown) {
  const target = `${file}.tmp`
  await Bun.write(target, JSON.stringify(value, null, 2) + "\n")
  await Bun.write(file, await Bun.file(target))
  await rm(target, { force: true }).catch(() => {})
}

function defaultSync(): SyncState {
  return {
    cursor: "",
    updatedAt: Date.now(),
  }
}

function defaultRuntime(): RuntimeState {
  return {
    status: "starting",
    startedAt: Date.now(),
  }
}

function defaultMetrics(): MetricsSnapshot {
  return {
    inboundMessageCount: 0,
    outboundMessageCount: 0,
    activeUserCount: 0,
    sessionCreateCount: 0,
    sessionReuseCount: 0,
    errorCount: 0,
    pollingErrorCount: 0,
    sendErrorCount: 0,
    approvalPendingCount: 0,
    totalPromptLatencyMs: 0,
    totalReplyLatencyMs: 0,
    totalPrompts: 0,
    totalReplies: 0,
    updatedAt: Date.now(),
  }
}
