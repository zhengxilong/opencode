import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { LanguageManager } from "../../src/language/language"

describe("language policy", () => {
  test("uses defaults when language config is missing", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const policy = await LanguageManager.getPolicy()
        expect(policy.userLanguage).toBe("zh-CN")
        expect(policy.documentPathPolicy).toBe("english")
        expect(policy.commentLanguage).toBe("localized")
        expect(policy.uiLanguage).toBe("localized")
      },
    })
  })

  test("expands string language config into a full policy", async () => {
    await using tmp = await tmpdir({
      config: {
        language: "ja",
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const policy = await LanguageManager.getPolicy()
        expect(policy.userLanguage).toBe("ja")
        expect(policy.documentationLanguage).toBe("localized")
        expect(policy.documentFileNamePolicy).toBe("localized")
        expect(policy.termsPolicy).toBe("english-only")
      },
    })
  })

  test("keeps advanced language settings from object config", async () => {
    await using tmp = await tmpdir({
      config: {
        language: {
          user: "zh-CN",
          comments: "english",
          document_path: "localized",
          document_file_name: "english",
          ui: "bilingual",
          strictness: "strict",
          terms: "bilingual",
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const policy = await LanguageManager.getPolicy()
        expect(policy.commentLanguage).toBe("english")
        expect(policy.documentPathPolicy).toBe("localized")
        expect(policy.documentFileNamePolicy).toBe("english")
        expect(policy.uiLanguage).toBe("bilingual")
        expect(policy.strictness).toBe("strict")
        expect(policy.termsPolicy).toBe("bilingual")
      },
    })
  })

  test("persists language changes without dropping other language settings", async () => {
    await using tmp = await tmpdir({
      config: {
        language: {
          user: "en",
          comments: "english",
          document_path: "localized",
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ok = await LanguageManager.setLanguage("zh-CN")
        expect(ok).toBe(true)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const policy = await LanguageManager.getPolicy()
        expect(policy.userLanguage).toBe("zh-CN")
        expect(policy.commentLanguage).toBe("english")
        expect(policy.documentPathPolicy).toBe("localized")
      },
    })
  })
})
