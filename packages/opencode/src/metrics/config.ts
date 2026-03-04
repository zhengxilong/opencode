import crypto from "crypto"
import os from "os"
import { Log } from "@/util/log"

export namespace MetricsConfig {
  const log = Log.create({ service: "metrics.config" })

  export interface MetricsOptions {
    enabled: boolean
    api_base_url: string
    client_id?: string
    upload_interval_ms: number
    batch_size: number
    include_file_paths: boolean
    include_tool_output: boolean
  }

  // Default configuration values
  const defaults: MetricsOptions = {
    enabled: false,
    api_base_url: "",
    upload_interval_ms: 300_000, // 5 minutes
    batch_size: 100,
    include_file_paths: false,
    include_tool_output: false,
  }

  // Runtime configuration - can be set via setConfig()
  let runtimeConfig: Partial<MetricsOptions> = {}

  export function setConfig(config: Partial<MetricsOptions>) {
    runtimeConfig = { ...runtimeConfig, ...config }
  }

  export function getConfig(): MetricsOptions {
    return { ...defaults, ...runtimeConfig }
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

  export function getMachineId(): string {
    return crypto
      .createHash("sha256")
      .update(os.hostname() + os.userInfo().username)
      .digest("hex")
      .substring(0, 16)
  }
}
