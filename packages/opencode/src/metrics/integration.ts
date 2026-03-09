import path from "path"
import { mkdir } from "fs/promises"
import { MetricsConfig } from "./config"
import { MetricsQueue } from "./queue"
import { MetricsCollector } from "./collector"
import { MetricsUploader } from "./uploader"
import { Log } from "@/util/log"
import { Global } from "@/global"
import type { Config } from "@/config/config"

/**
 * Metrics 集成模块
 *
 * 负责封装指标采集系统的初始化、启动、清理等逻辑
 */
export namespace MetricsIntegration {
  const log = Log.create({ service: "metrics.integration" })

  /**
   * 初始化选项
   */
  export interface InitOptions {
    /** 配置对象 */
    config?: Config.Info
    /** 强制启用（忽略配置） */
    force?: boolean
    /** 静默模式（不输出日志） */
    silent?: boolean
    /** 自定义队列目录 */
    queueDir?: string
  }

  /**
   * 初始化结果
   */
  export interface InitResult {
    /** 是否成功初始化 */
    success: boolean
    /** 是否启用 */
    enabled: boolean
    /** 错误信息（如果失败） */
    error?: string
    /** 配置摘要（脱敏） */
    config?: ConfigSummary
  }

  /**
   * 关闭结果
   */
  export interface ShutdownResult {
    /** 是否成功关闭 */
    success: boolean
    /** 上传的数据量 */
    uploaded?: {
      session: number
      message: number
      tool: number
      step: number
    }
    /** 错误信息（如果失败） */
    error?: string
  }

  /**
   * 系统状态
   */
  export interface Status {
    /** 是否已初始化 */
    initialized: boolean
    /** 是否启用 */
    enabled: boolean
    /** 采集器状态 */
    collector: {
      initialized: boolean
      disposed: boolean
    }
    /** 上传器状态 */
    uploader: {
      started: boolean
      stopped: boolean
    }
    /** 队列状态 */
    queue: {
      pending: {
        session: number
        message: number
        tool: number
        step: number
      }
      directory: string
    }
    /** 配置摘要 */
    config?: ConfigSummary
  }

  /**
   * 配置摘要（脱敏）
   */
  export interface ConfigSummary {
    enabled: boolean
    apiBaseUrl: string
    clientId: string
    machineId: string
    uploadInterval: number
    batchSize: number
    hasAuth: boolean
  }

  /**
   * 错误类型
   */
  export enum MetricsIntegrationErrorType {
    /** 配置错误 */
    CONFIG_ERROR = "CONFIG_ERROR",
    /** 初始化错误 */
    INIT_ERROR = "INIT_ERROR",
    /** 网络错误 */
    NETWORK_ERROR = "NETWORK_ERROR",
    /** 认证错误 */
    AUTH_ERROR = "AUTH_ERROR",
    /** 队列错误 */
    QUEUE_ERROR = "QUEUE_ERROR"
  }

  /**
   * 集成错误
   */
  export class MetricsIntegrationError extends Error {
    constructor(
      public type: MetricsIntegrationErrorType,
      message: string,
      public details?: Record<string, any>
    ) {
      super(message)
      this.name = "MetricsIntegrationError"
    }
  }

  /**
   * 初始化指标采集系统
   *
   * @param options - 初始化选项
   * @returns 初始化结果
   */
  export async function init(
    options: InitOptions = {}
  ): Promise<InitResult> {
    try {
      // 1. 加载配置
      const config = options.config ?? (await loadConfig())
      const metricsConfig = config.metrics

      // 2. 检查是否启用
      const enabled = options.force || (
        metricsConfig?.enabled === true &&
        !!metricsConfig.api_base_url
      )

      if (!enabled) {
        if (!options.silent) {
          log.info("metrics collection disabled")
        }
        return {
          success: true,
          enabled: false
        }
      }

      // 3. 验证配置
      if (!metricsConfig?.api_base_url) {
        throw new MetricsIntegrationError(
          MetricsIntegrationErrorType.CONFIG_ERROR,
          "api_base_url is required when metrics is enabled"
        )
      }

      // 4. 应用配置
      MetricsConfig.setConfig(metricsConfig)

      // 5. 设置队列目录
      const queueDir = options.queueDir ?? path.join(
        Global.Path.data,
        "metrics",
        "queue"
      )
      await mkdir(queueDir, { recursive: true })
      MetricsQueue.setQueueDir(queueDir)

      // 6. 初始化采集器
      const collectorInitialized = MetricsCollector.init()
      if (!collectorInitialized) {
        throw new MetricsIntegrationError(
          MetricsIntegrationErrorType.INIT_ERROR,
          "failed to initialize metrics collector"
        )
      }

      // 7. 启动上传器
      MetricsUploader.start()

      // 8. 记录启动日志
      if (!options.silent) {
        log.info("metrics collection initialized", {
          api_base_url: metricsConfig.api_base_url,
          client_id: MetricsConfig.getClientId(),
          machine_id: MetricsConfig.getMachineId(),
          upload_interval: metricsConfig.upload_interval_ms,
          batch_size: metricsConfig.batch_size
        })
      }

      // 9. 返回成功结果
      return {
        success: true,
        enabled: true,
        config: getConfigSummary()
      }

    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error)

      log.error("metrics initialization failed", {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      })

      return {
        success: false,
        enabled: false,
        error: errorMessage
      }
    }
  }

  /**
   * 优雅关闭指标采集系统
   *
   * @param signal - 退出信号（可选）
   * @returns 关闭结果
   */
  export async function shutdown(
    signal?: NodeJS.Signals
  ): Promise<ShutdownResult> {
    try {
      // 检查是否已初始化
      if (!isEnabled()) {
        return {
          success: true
        }
      }

      if (signal) {
        log.info("shutting down metrics", { signal })
      }

      // 记录上传前的队列状态
      const before = await getQueueCounts()

      // 1. 尝试上传所有待上传数据（包括聚合）
      try {
        await MetricsUploader.uploadAll()
      } catch (error) {
        log.warn("failed to upload pending metrics", {
          error: error instanceof Error ? error.message : String(error)
        })
      }

      // 2. 再次尝试聚合和上传（确保所有数据都被聚合）
      try {
        await MetricsUploader.aggregateAndUpload()
      } catch (error) {
        log.warn("failed to aggregate metrics on shutdown", {
          error: error instanceof Error ? error.message : String(error)
        })
      }

      // 3. 记录上传后的队列状态
      const after = await getQueueCounts()

      // 3. 停止上传器
      MetricsUploader.stop()

      // 4. 释放采集器
      MetricsCollector.dispose()

      // 5. 记录关闭日志
      log.info("metrics collection shutdown", {
        uploaded: {
          session: before.session - after.session,
          message: before.message - after.message,
          tool: before.tool - after.tool,
          step: before.step - after.step
        },
        remaining: after
      })

      // 6. 返回成功结果
      return {
        success: true,
        uploaded: {
          session: before.session - after.session,
          message: before.message - after.message,
          tool: before.tool - after.tool,
          step: before.step - after.step
        }
      }

    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error)

      log.error("metrics shutdown failed", {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      })

      return {
        success: false,
        error: errorMessage
      }
    }
  }

  /**
   * 获取指标采集系统状态
   *
   * @returns 当前状态
   */
  export function getStatus(): Status {
    const initialized = MetricsCollector.isInitialized()
    const enabled = MetricsConfig.isEnabled()

    return {
      initialized,
      enabled,
      collector: {
        initialized,
        disposed: !initialized
      },
      uploader: {
        started: enabled,
        stopped: !enabled
      },
      queue: {
        pending: {
          // 注意：这是同步方法，实际应该异步获取
          session: 0,
          message: 0,
          tool: 0,
          step: 0
        },
        directory: path.join(Global.Path.data, "metrics", "queue")
      },
      config: enabled ? getConfigSummary() : undefined
    }
  }

  /**
   * 检查指标采集是否启用
   *
   * @returns 是否启用
   */
  export function isEnabled(): boolean {
    return MetricsCollector.isInitialized() && MetricsConfig.isEnabled()
  }

  /**
   * 获取配置摘要（脱敏）
   */
  function getConfigSummary(): ConfigSummary {
    return {
      enabled: MetricsConfig.isEnabled(),
      apiBaseUrl: MetricsConfig.getApiBaseUrl(),
      clientId: MetricsConfig.getClientId(),
      machineId: MetricsConfig.getMachineId(),
      uploadInterval: MetricsConfig.getUploadInterval(),
      batchSize: MetricsConfig.getBatchSize(),
      hasAuth: !!(
        MetricsConfig.getAuthToken() ||
        (MetricsConfig.getAuthUsername() && MetricsConfig.getAuthPassword())
      )
    }
  }

  /**
   * 获取队列计数（异步）
   */
  async function getQueueCounts(): Promise<Record<string, number>> {
    return {
      session: await MetricsQueue.pendingCount("session"),
      message: await MetricsQueue.pendingCount("message"),
      tool: await MetricsQueue.pendingCount("tool"),
      step: await MetricsQueue.pendingCount("step")
    }
  }

  /**
   * 加载配置
   */
  async function loadConfig(): Promise<Config.Info> {
    // 动态导入 Config 模块避免循环依赖
    const { Config } = await import("@/config/config")
    return await Config.load()
  }
}