export async function retry<T>(
  task: () => Promise<T>,
  options?: {
    retries?: number
    delayMs?: number
  },
) {
  const retries = options?.retries ?? 2
  const delayMs = options?.delayMs ?? 1_000
  let last: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      return await task()
    } catch (error) {
      last = error
      if (i === retries) break
      await sleep(delayMs)
    }
  }
  throw last
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
