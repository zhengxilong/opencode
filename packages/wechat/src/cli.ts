import type { WechatConfig } from "./config"
import { ensureLogin, logout } from "./login"
import type { StateStore } from "./state/types"

export async function runCli(input: {
  command: string
  config: WechatConfig
  store: StateStore
  start: () => Promise<void>
  status: () => Promise<unknown>
}) {
  if (input.command === "start") {
    await ensureLogin(input.config, input.store)
    await input.start()
    return
  }
  if (input.command === "login") {
    await ensureLogin(input.config, input.store, true)
    return
  }
  if (input.command === "logout") {
    await logout(input.store)
    return
  }
  if (input.command === "status") {
    console.log(JSON.stringify(await input.status(), null, 2))
    return
  }
  console.log("Usage: bun run src/index.ts <start|login|logout|status>")
}
