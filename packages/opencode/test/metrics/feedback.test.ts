import { beforeEach, describe, expect, test } from "bun:test"
import { MetricsConfig } from "../../src/metrics/config"
import { FeedbackManager } from "../../src/metrics/feedback-manager"

beforeEach(() => {
  MetricsConfig.resetConfig()
  MetricsConfig.setConfig({
    enabled: true,
    api_base_url: "http://localhost:3001",
  })
  FeedbackManager.resetSession()
})

describe("MetricsConfig feedback settings", () => {
  test("defaults feedback to enabled when metrics are enabled", () => {
    expect(MetricsConfig.getFeedbackConfig().enabled).toBe(true)
    expect(MetricsConfig.isFeedbackEnabled()).toBe(true)
  })

  test("merges custom feedback reasons", () => {
    MetricsConfig.setConfig({
      feedback: {
        custom_reasons: ["不符合团队规范"],
      },
    })

    expect(FeedbackManager.getAllReasons().map((item) => item.key)).toContain("不符合团队规范")
  })
})

describe("FeedbackManager session summary", () => {
  test("tracks skipped replies", () => {
    FeedbackManager.setPendingMessage("msg_1", "session_1", 1700000000000)
    FeedbackManager.clearPending(true)

    const summary = FeedbackManager.getSessionSummary()
    expect(summary.total_replies).toBe(1)
    expect(summary.skipped_count).toBe(1)
    expect(summary.rated_count).toBe(0)
  })
})
