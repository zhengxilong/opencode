export function log(scope: string, message: string, data?: unknown) {
  const line = data === undefined ? message : `${message} ${safe(data)}`
  console.error(`[wechat:${scope}] ${line}`)
}

export function logError(scope: string, message: string, error?: unknown) {
  const line = error === undefined ? message : `${message} ${safe(error)}`
  console.error(`[wechat:${scope}] ERROR ${line}`)
}

function safe(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
