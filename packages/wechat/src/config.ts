import path from "node:path"

export type WechatConfig = {
  enabled: boolean
  default_project_dir: string
  allowed_projects: string[]
  session_timeout_minutes: number
  max_reply_length: number
  status_update_threshold_seconds: number
  metrics_enabled: boolean
  require_confirmation_for: string[]
  management_api_base_url?: string
  state_dir: string
  ilink_base_url: string
}

export async function loadConfig() {
  const file = await loadConfigFile()
  const env = loadEnv()
  const merged = {
    ...file,
    ...env,
  }
  const config: WechatConfig = {
    enabled: typeof merged.enabled === "boolean" ? merged.enabled : false,
    default_project_dir: typeof merged.default_project_dir === "string" ? merged.default_project_dir : process.cwd(),
    allowed_projects: Array.isArray(merged.allowed_projects) ? merged.allowed_projects.filter(isString) : [],
    session_timeout_minutes: positive(merged.session_timeout_minutes, 120),
    max_reply_length: positive(merged.max_reply_length, 2_000),
    status_update_threshold_seconds: positive(merged.status_update_threshold_seconds, 10),
    metrics_enabled: typeof merged.metrics_enabled === "boolean" ? merged.metrics_enabled : true,
    require_confirmation_for: Array.isArray(merged.require_confirmation_for)
      ? merged.require_confirmation_for.filter(isString)
      : ["git_push", "rm", "bulk_edit", "exec_dangerous_command"],
    management_api_base_url: typeof merged.management_api_base_url === "string" ? merged.management_api_base_url : undefined,
    state_dir: typeof merged.state_dir === "string" ? merged.state_dir : path.join(process.cwd(), ".runtime"),
    ilink_base_url: typeof merged.ilink_base_url === "string" ? merged.ilink_base_url : "https://ilinkai.weixin.qq.com",
  }
  return {
    ...config,
    allowed_projects:
      config.allowed_projects.length > 0 ? config.allowed_projects : config.default_project_dir ? [config.default_project_dir] : [],
  }
}

async function loadConfigFile() {
  const custom = process.env.OPENCODE_WECHAT_CONFIG_PATH
  const candidates = [
    custom,
    path.join(process.cwd(), "wechat-channel.json"),
    path.join(process.cwd(), ".wechat-channel.json"),
    path.join(process.cwd(), ".opencode", "wechat-channel.json"),
  ].filter(isString)
  for (const file of candidates) {
    if (!(await exists(file))) continue
    try {
      const text = await Bun.file(file).text()
      const json = JSON.parse(stripComments(text)) as Record<string, unknown>
      if ("wechat_channel" in json && typeof json.wechat_channel === "object" && json.wechat_channel) {
        return json.wechat_channel as Record<string, unknown>
      }
      return json
    } catch {}
  }
  return {}
}

function loadEnv() {
  const allowed = process.env.OPENCODE_WECHAT_ALLOWED_PROJECTS?.split(",").map((x) => x.trim()).filter(Boolean)
  const requireConfirmationFor = process.env.OPENCODE_WECHAT_REQUIRE_CONFIRMATION_FOR?.split(",")
    .map((x: string) => x.trim())
    .filter(Boolean)

  return {
    enabled: parseBoolean(process.env.OPENCODE_WECHAT_ENABLED),
    default_project_dir: process.env.OPENCODE_WECHAT_DEFAULT_PROJECT_DIR,
    allowed_projects: allowed,
    session_timeout_minutes: parseNumber(process.env.OPENCODE_WECHAT_SESSION_TIMEOUT_MINUTES),
    max_reply_length: parseNumber(process.env.OPENCODE_WECHAT_MAX_REPLY_LENGTH),
    status_update_threshold_seconds: parseNumber(process.env.OPENCODE_WECHAT_STATUS_UPDATE_THRESHOLD_SECONDS),
    metrics_enabled: parseBoolean(process.env.OPENCODE_WECHAT_METRICS_ENABLED),
    require_confirmation_for: requireConfirmationFor,
    management_api_base_url: process.env.OPENCODE_WECHAT_MANAGEMENT_API_BASE_URL,
    state_dir: process.env.OPENCODE_WECHAT_STATE_DIR,
    ilink_base_url: process.env.OPENCODE_WECHAT_ILINK_BASE_URL,
  }
}

function parseBoolean(value?: string) {
  if (value === undefined) return undefined
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

function parseNumber(value?: string) {
  if (!value) return undefined
  const num = Number(value)
  if (Number.isNaN(num)) return undefined
  return num
}

function positive(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

async function exists(file: string) {
  return !!(await Bun.file(file).exists())
}

function stripComments(text: string) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}
