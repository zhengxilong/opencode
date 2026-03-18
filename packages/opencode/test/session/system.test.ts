import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"

describe("system prompt language policy", () => {
  test("injects language policy into environment prompt", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        language: {
          user: "zh-CN",
          comments: "english",
          document_path: "english",
          ui: "bilingual",
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parts = await SystemPrompt.environment({
          providerID: "anthropic",
          api: { id: "claude-sonnet-4-20250514" },
        } as any)
        const text = parts.join("\n")

        expect(text).toContain("Preferred user language: 简体中文 (zh-CN)")
        expect(text).toContain("Comment language policy: english")
        expect(text).toContain("Documentation path policy: english")
        expect(text).toContain("Generated UI text shown to end users must follow the \"bilingual\" policy.")
        expect(text).toContain("All generated code must remain in English.")
      },
    })
  })
})
