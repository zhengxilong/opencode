import { mkdir } from "node:fs/promises"
import { createFileStore } from "./file-store"

export async function createStateStore(root: string) {
  await mkdir(root, { recursive: true })
  return createFileStore(root)
}
