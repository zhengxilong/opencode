import { createHash, randomBytes } from "node:crypto"
import type { WechatAccount } from "./model/wechat"
import type { StateStore } from "./state/types"
import { logError } from "./util/log"
import { sleep } from "./util/retry"

const LONG_POLL_TIMEOUT_MS = 35_000

export async function getUpdates(account: WechatAccount, cursor: string) {
  const raw = await apiFetch({
    baseUrl: account.baseUrl,
    endpoint: "ilink/bot/getupdates",
    body: JSON.stringify({
      get_updates_buf: cursor,
      base_info: { channel_version: "0.1.0" },
    }),
    token: account.token,
    timeoutMs: LONG_POLL_TIMEOUT_MS,
  })
  return JSON.parse(raw) as {
    ret?: number
    errcode?: number
    errmsg?: string
    msgs?: unknown[]
    get_updates_buf?: string
  }
}

export async function pollLoop(input: {
  account: WechatAccount
  store: StateStore
  onMessages: (messages: unknown[]) => Promise<void>
}) {
  let failures = 0
  while (true) {
    try {
      const sync = await input.store.getSync()
      const result = await getUpdates(input.account, sync.cursor)
      const isError = (result.ret !== undefined && result.ret !== 0) || (result.errcode !== undefined && result.errcode !== 0)
      if (isError) {
        failures++
        throw new Error(`poll failed: ret=${result.ret} errcode=${result.errcode} errmsg=${result.errmsg}`)
      }
      failures = 0
      await input.store.setSync({
        cursor: result.get_updates_buf ?? sync.cursor,
        updatedAt: Date.now(),
      })
      await input.onMessages((result.msgs ?? []) as unknown[])
      await input.store.setRuntime({
        ...(await input.store.getRuntime()),
        status: "running",
        lastPollAt: Date.now(),
        lastSuccessAt: Date.now(),
      })
    } catch (error) {
      failures++
      logError("poller", "poll loop failed", error)
      const runtime = await input.store.getRuntime()
      await input.store.setRuntime({
        ...runtime,
        status: "degraded",
        lastError: error instanceof Error ? error.message : String(error),
        lastPollAt: Date.now(),
      })
      await sleep(failures >= 3 ? 30_000 : 2_000)
    }
  }
}

type ApiFetchInput = {
  baseUrl: string
  endpoint: string
  body: string
  token?: string
  timeoutMs: number
}

export async function apiFetch(input: ApiFetchInput) {
  const url = new URL(input.endpoint, input.baseUrl.endsWith("/") ? input.baseUrl : `${input.baseUrl}/`).toString()
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(input.token, input.body),
      body: input.body,
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`http ${response.status}: ${text}`)
    return text
  } finally {
    clearTimeout(id)
  }
}

function buildHeaders(token?: string, body?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf-8").toString("base64"),
  }
  if (body) headers["Content-Length"] = String(Buffer.byteLength(body, "utf-8"))
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`
  return headers
}

export function dedupeKey(wechatUserId: string, createTimeMs: number, text: string) {
  return createHash("sha1").update(`${wechatUserId}:${createTimeMs}:${text}`).digest("hex")
}
