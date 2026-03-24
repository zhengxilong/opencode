import { createWechatBridge } from "./bridge"
import { runCli } from "./cli"
import { loadConfig } from "./config"
import { createStateStore } from "./state/store"

const config = await loadConfig()
const store = await createStateStore(config.state_dir)

await runCli({
  command: process.argv[2] ?? "start",
  config,
  store,
  start: async () => {
    const bridge = await createWechatBridge({ config, store })
    await bridge.start()
  },
  status: async () => ({
    runtime: await store.getRuntime(),
    metrics: await store.getMetrics(),
    bindings: await store.getBindings(),
    approvals: await store.getApprovals(),
    account: await store.getAccount(),
  }),
})
