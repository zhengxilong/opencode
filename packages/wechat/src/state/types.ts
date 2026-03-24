import type { WechatAccount } from "../model/wechat"
import type { ApprovalRecord, DedupeRecord, MetricsSnapshot, RuntimeState, SessionBinding, SyncState } from "../model/runtime"

export type StateShape = {
  account: WechatAccount | null
  sync: SyncState
  bindings: SessionBinding[]
  dedupe: DedupeRecord[]
  approvals: ApprovalRecord[]
  runtime: RuntimeState
  metrics: MetricsSnapshot
  contextTokens: Record<string, string>
  projectBindings: Record<string, string>
}

export type StateStore = {
  root: string
  getAccount(): Promise<WechatAccount | null>
  setAccount(value: WechatAccount | null): Promise<void>
  getSync(): Promise<SyncState>
  setSync(value: SyncState): Promise<void>
  getBindings(): Promise<SessionBinding[]>
  setBindings(value: SessionBinding[]): Promise<void>
  getDedupe(): Promise<DedupeRecord[]>
  setDedupe(value: DedupeRecord[]): Promise<void>
  getApprovals(): Promise<ApprovalRecord[]>
  setApprovals(value: ApprovalRecord[]): Promise<void>
  getRuntime(): Promise<RuntimeState>
  setRuntime(value: RuntimeState): Promise<void>
  getMetrics(): Promise<MetricsSnapshot>
  setMetrics(value: MetricsSnapshot): Promise<void>
  getContextTokens(): Promise<Record<string, string>>
  setContextTokens(value: Record<string, string>): Promise<void>
  getProjectBindings(): Promise<Record<string, string>>
  setProjectBindings(value: Record<string, string>): Promise<void>
}
