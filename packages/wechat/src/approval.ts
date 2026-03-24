import type { Command } from "./model/command"
import type { ApprovalRecord } from "./model/runtime"
import type { StateStore } from "./state/types"
import { randomId } from "./util/hash"

const TTL_MS = 10 * 60 * 1000

export function detectRisk(text: string, kinds: string[]) {
  const value = text.toLowerCase()
  const found = kinds.find((kind) => {
    if (kind === "git_push") return value.includes("git push") || value.includes("推送")
    if (kind === "rm") return value.includes("rm ") || value.includes("删除")
    if (kind === "bulk_edit") return value.includes("批量修改") || value.includes("批量编辑")
    if (kind === "exec_dangerous_command") return value.includes("sudo ") || value.includes("危险命令")
    if (kind === "dependency_install") return value.includes("npm install") || value.includes("bun install")
    return false
  })
  return found
}

export async function createApproval(store: StateStore, input: { wechatUserId: string; projectDir: string; sessionId?: string; requestText: string; riskType: string }) {
  const all = await store.getApprovals()
  const record: ApprovalRecord = {
    approvalId: randomId("approval"),
    wechatUserId: input.wechatUserId,
    projectDir: input.projectDir,
    sessionId: input.sessionId,
    requestText: input.requestText,
    riskType: input.riskType,
    status: "pending",
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  }
  await store.setApprovals([...all.filter((x) => x.status === "pending" ? x.wechatUserId !== input.wechatUserId : true), record])
  return record
}

export async function resolveApproval(store: StateStore, wechatUserId: string, command: Command) {
  const all = await store.getApprovals()
  const current = all.find((x) => x.wechatUserId === wechatUserId && x.status === "pending")
  if (!current) return null
  const now = Date.now()
  const next = all.map((item) => {
    if (item.approvalId !== current.approvalId) return item
    if (item.expiresAt < now) return { ...item, status: "expired" as const }
    if (command.type === "confirm") return { ...item, status: "approved" as const }
    if (command.type === "cancel") return { ...item, status: "rejected" as const }
    return item
  })
  await store.setApprovals(next)
  return next.find((x) => x.approvalId === current.approvalId) ?? null
}

export async function expireApprovals(store: StateStore) {
  const now = Date.now()
  const all = await store.getApprovals()
  const next = all.map((item) => (item.status === "pending" && item.expiresAt < now ? { ...item, status: "expired" as const } : item))
  await store.setApprovals(next)
}
