import { Config } from "@/config/config"
import { LanguagePolicyResolver } from "./policy"

export namespace LanguageManager {
  export const BUILTIN = LanguagePolicyResolver.BUILTIN
  export type Policy = LanguagePolicyResolver.Policy

  export async function getPolicy() {
    const cfg = await Config.get()
    return LanguagePolicyResolver.resolve(cfg.language)
  }

  export async function getCurrentLanguage() {
    return getPolicy().then((policy) => policy.userLanguage)
  }

  export async function getCurrentLanguageLabel() {
    const policy = await getPolicy()
    return {
      code: policy.userLanguage,
      name: policy.nativeName,
      description: policy.displayName,
    }
  }

  export function listLanguages() {
    return [...BUILTIN]
  }

  export async function setLanguage(code: string) {
    const found = BUILTIN.find((item) => item.code === code)
    if (!found) return false

    const cfg = await Config.get()
    const next =
      typeof cfg.language === "string" || !cfg.language
        ? code
        : {
            ...cfg.language,
            user: code,
          }

    await Config.update({
      language: next,
    })
    return true
  }
}
