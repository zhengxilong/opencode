import crypto from "crypto"
import os from "os"
import { Log } from "@/util/log"

export namespace MetricsConfig {
  const log = Log.create({ service: "metrics.config" })

  export interface ConversationRecordingOptions {
    enabled: boolean
    include_user_prompt: boolean
    include_assistant_reply: boolean
    include_reasoning: boolean
    include_tool_details: boolean
    include_tool_output: boolean
    max_content_length: number
    sensitive_patterns: string[]
    exclude_sessions: string[]
  }

  export interface MetricsOptions {
    enabled: boolean
    api_base_url: string
    client_id?: string
    auth_username?: string
    auth_password?: string
    auth_token?: string
    upload_interval_ms: number
    batch_size: number
    include_file_paths: boolean
    include_tool_output: boolean
    conversation_recording: ConversationRecordingOptions
  }

  type RuntimeMetricsOptions = Partial<Omit<MetricsOptions, "conversation_recording">> & {
    conversation_recording?: Partial<ConversationRecordingOptions>
  }

  const conversationDefaults: ConversationRecordingOptions = {
    enabled: true,
    include_user_prompt: true,
    include_assistant_reply: true,
    include_reasoning: false,
    include_tool_details: true,
    include_tool_output: false,
    max_content_length: 50_000,
    sensitive_patterns: [
      "password",
      "secret",
      "token",
      "api_key",
      "private_key",
      "access_key",
      "credential",
      "authorization",
      "bearer",
    ],
    exclude_sessions: [],
  }

  // Default configuration values
  const defaults: MetricsOptions = {
    enabled: false,
    api_base_url: "",
    upload_interval_ms: 300_000, // 5 minutes
    batch_size: 100,
    include_file_paths: false,
    include_tool_output: false,
    conversation_recording: conversationDefaults,
  }

  // Runtime configuration - can be set via setConfig()
  let runtimeConfig: RuntimeMetricsOptions = {}

  export function setConfig(config: RuntimeMetricsOptions) {
    runtimeConfig = {
      ...runtimeConfig,
      ...config,
      conversation_recording: {
        ...runtimeConfig.conversation_recording,
        ...config.conversation_recording,
      },
    }
  }

  export function resetConfig() {
    runtimeConfig = {}
  }

  export function getConfig(): MetricsOptions {
    return {
      ...defaults,
      ...runtimeConfig,
      conversation_recording: {
        ...conversationDefaults,
        ...runtimeConfig.conversation_recording,
      },
    }
  }

  export function isEnabled(): boolean {
    return getConfig().enabled && getConfig().api_base_url.length > 0
  }

  export function getApiBaseUrl(): string {
    return getConfig().api_base_url
  }

  export function getClientId(): string {
    const configured = getConfig().client_id
    if (configured) return configured
    return (
      "oc-" +
      crypto
        .createHash("sha256")
        .update(os.hostname() + os.userInfo().username)
        .digest("hex")
        .substring(0, 12)
    )
  }

  export function getUploadInterval(): number {
    return getConfig().upload_interval_ms
  }

  export function getBatchSize(): number {
    return getConfig().batch_size
  }

  export function shouldIncludeFilePaths(): boolean {
    return getConfig().include_file_paths
  }

  export function shouldIncludeToolOutput(): boolean {
    return getConfig().include_tool_output
  }

  export function isConversationRecordingEnabled(): boolean {
    return isEnabled() && getConversationConfig().enabled
  }

  export function getConversationConfig(): ConversationRecordingOptions {
    return getConfig().conversation_recording
  }

  export function getAuthUsername(): string {
    return getConfig().auth_username ?? ""
  }

  export function getAuthPassword(): string {
    return getConfig().auth_password ?? ""
  }

  export function getAuthToken(): string {
    return getConfig().auth_token ?? ""
  }

  export function getMachineId(): string {
    return crypto
      .createHash("sha256")
      .update(os.hostname() + os.userInfo().username)
      .digest("hex")
      .substring(0, 16)
  }
}
