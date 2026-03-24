export function trimReply(text: string, max: number) {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 32))}\n\n[内容过长，已截断]`
}

export function splitReply(text: string, max: number) {
  if (text.length <= max) return [text]
  const result: string[] = []
  let rest = text
  while (rest.length > max) {
    result.push(rest.slice(0, max))
    rest = rest.slice(max)
  }
  if (rest.length > 0) result.push(rest)
  return result
}

export function normalizeWechatText(text: string) {
  return text.replace(/```[\s\S]*?```/g, "[代码块已省略，请查看会话详情]").replace(/\r\n/g, "\n").trim()
}
