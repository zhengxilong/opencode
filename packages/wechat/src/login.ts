import { chmod } from "node:fs/promises"
import type { WechatConfig } from "./config"
import type { WechatAccount, QrCodeInfo, QrStatus } from "./model/wechat"
import type { StateStore } from "./state/types"
import { log, logError } from "./util/log"
import { sleep } from "./util/retry"

const BOT_TYPE = "3"

export async function ensureLogin(config: WechatConfig, store: StateStore, force = false) {
  const existing = force ? null : await store.getAccount()
  if (existing) return existing
  return login(config, store)
}

export async function login(config: WechatConfig, store: StateStore) {
  const qr = await fetchQrCode(config.ilink_base_url)
  log("login", "scan this qr with WeChat")
  console.error(qr.qrcode_img_content)
  const deadline = Date.now() + 8 * 60 * 1000
  while (Date.now() < deadline) {
    const status = await pollQrStatus(config.ilink_base_url, qr.qrcode)
    if (status.status === "confirmed" && status.bot_token && status.ilink_bot_id) {
      const account: WechatAccount = {
        accountId: status.ilink_bot_id,
        token: status.bot_token,
        baseUrl: status.baseurl || config.ilink_base_url,
        userId: status.ilink_user_id,
        savedAt: new Date().toISOString(),
      }
      await store.setAccount(account)
      await chmod(`${store.root}/account.json`, 0o600).catch(() => {})
      log("login", "wechat login success", { accountId: account.accountId })
      return account
    }
    if (status.status === "expired") break
    await sleep(1_000)
  }
  throw new Error("wechat login timeout")
}

export async function logout(store: StateStore) {
  await store.setAccount(null)
  log("login", "logged out")
}

async function fetchQrCode(baseUrl: string): Promise<QrCodeInfo> {
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(BOT_TYPE)}`, withSlash(baseUrl))
  const response = await fetch(url)
  if (!response.ok) throw new Error(`fetch qr failed: ${response.status}`)
  return (await response.json()) as QrCodeInfo
}

async function pollQrStatus(baseUrl: string, qrcode: string): Promise<QrStatus> {
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, withSlash(baseUrl))
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), 35_000)
  try {
    const response = await fetch(url, {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`fetch qr status failed: ${response.status}`)
    return (await response.json()) as QrStatus
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { status: "wait" }
    logError("login", "poll qr status failed", error)
    throw error
  } finally {
    clearTimeout(id)
  }
}

function withSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`
}
