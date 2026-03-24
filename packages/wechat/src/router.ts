import path from "node:path"
import type { WechatConfig } from "./config"
import type { SessionBinding } from "./model/runtime"
import type { StateStore } from "./state/types"

export async function resolveProject(store: StateStore, config: WechatConfig, wechatUserId: string) {
  const projectBindings = await store.getProjectBindings()
  const selected = projectBindings[wechatUserId] ?? config.default_project_dir
  if (!config.allowed_projects.includes(selected)) {
    throw new Error(`project not allowed: ${selected}`)
  }
  return {
    dir: selected,
    name: path.basename(selected),
  }
}

export async function setProject(store: StateStore, wechatUserId: string, projectDir: string) {
  const all = await store.getProjectBindings()
  await store.setProjectBindings({
    ...all,
    [wechatUserId]: projectDir,
  })
}

export async function resetBindings(store: StateStore, wechatUserId: string) {
  const next = (await store.getBindings()).filter((x) => x.wechatUserId !== wechatUserId)
  await store.setBindings(next)
}

export async function findBinding(store: StateStore, wechatUserId: string, projectDir: string, timeoutMinutes: number) {
  const all = await store.getBindings()
  const current = all.find((x) => x.wechatUserId === wechatUserId && x.projectDir === projectDir && x.status === "active")
  if (!current) return null
  if (Date.now() - current.lastActiveAt > timeoutMinutes * 60_000) {
    const next = all.map((item) => (item.bindingKey === current.bindingKey ? { ...item, status: "expired" as const } : item))
    await store.setBindings(next)
    return null
  }
  return current
}

export async function saveBinding(store: StateStore, binding: SessionBinding) {
  const all = await store.getBindings()
  const next = all.filter((x) => x.bindingKey !== binding.bindingKey)
  next.push(binding)
  await store.setBindings(next)
}
