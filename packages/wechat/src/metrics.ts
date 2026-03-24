import type { MetricsSnapshot } from "./model/runtime"
import type { StateStore } from "./state/types"
import { retry } from "./util/retry"

export async function recordMetric(store: StateStore, patch: Partial<MetricsSnapshot>) {
  const current = await store.getMetrics()
  const next: MetricsSnapshot = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  }
  await store.setMetrics(next)
  return next
}

export async function incrementMetric(store: StateStore, key: keyof MetricsSnapshot, amount = 1) {
  const current = await store.getMetrics()
  const value = current[key]
  if (typeof value !== "number") return current
  const next = {
    ...current,
    [key]: value + amount,
    updatedAt: Date.now(),
  }
  await store.setMetrics(next)
  return next
}

export async function syncMetrics(store: StateStore, baseUrl?: string) {
  if (!baseUrl) return
  const metrics = await store.getMetrics()
  await retry(async () => {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/metrics/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "wechat",
        entrypoint: "wechat_channel",
        metrics,
      }),
    })
    if (!response.ok) {
      throw new Error(`management report failed: ${response.status}`)
    }
  })
}
