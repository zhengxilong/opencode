export type SessionBinding = {
  bindingKey: string
  wechatUserId: string
  sessionId: string
  projectDir: string
  projectName: string
  createdAt: number
  lastActiveAt: number
  status: "active" | "expired" | "blocked"
}

export type RuntimeStatus = "starting" | "running" | "degraded" | "stopped"

export type RuntimeState = {
  status: RuntimeStatus
  lastPollAt?: number
  lastSuccessAt?: number
  lastError?: string
  startedAt: number
}

export type SyncState = {
  cursor: string
  updatedAt: number
}

export type ApprovalRecord = {
  approvalId: string
  wechatUserId: string
  projectDir: string
  sessionId?: string
  requestText: string
  riskType: string
  status: "pending" | "approved" | "rejected" | "expired"
  createdAt: number
  expiresAt: number
}

export type DedupeRecord = {
  key: string
  createdAt: number
}

export type MetricsSnapshot = {
  inboundMessageCount: number
  outboundMessageCount: number
  activeUserCount: number
  sessionCreateCount: number
  sessionReuseCount: number
  errorCount: number
  pollingErrorCount: number
  sendErrorCount: number
  approvalPendingCount: number
  totalPromptLatencyMs: number
  totalReplyLatencyMs: number
  totalPrompts: number
  totalReplies: number
  updatedAt: number
}
