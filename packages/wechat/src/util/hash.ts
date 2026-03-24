import { createHash, randomBytes } from "node:crypto"

export function sha1(value: string) {
  return createHash("sha1").update(value).digest("hex")
}

export function randomId(prefix: string) {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}`
}
