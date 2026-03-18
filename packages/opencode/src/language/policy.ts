import { Config } from "@/config/config"

export namespace LanguagePolicyResolver {
  export interface BuiltinLanguage {
    code: string
    name: string
    nativeName: string
    instruction: string
  }

  export interface Policy {
    userLanguage: string
    fallbackLanguage: string
    responseLanguage: "localized" | "english" | "bilingual"
    documentationLanguage: "localized" | "english" | "bilingual"
    documentFileNamePolicy: "localized" | "english" | "source"
    documentPathPolicy: "english" | "localized" | "project-default"
    commentLanguage: "localized" | "english" | "none" | "project-default"
    uiLanguage: "localized" | "english" | "bilingual" | "project-default"
    errorLanguage: "localized-summary" | "english" | "bilingual"
    diffSummaryLanguage: "localized" | "english" | "bilingual"
    testDescriptionLanguage: "localized" | "english" | "project-default"
    termsPolicy: "english-only" | "localized-only" | "bilingual" | "project-default"
    strictness: "strict" | "balanced" | "flexible"
    pathCase: "kebab-case" | "snake_case" | "camelCase" | "pascal-case" | "project-default"
    autoDetectProjectConvention: boolean
    instruction: string
    displayName: string
    nativeName: string
  }

  export const BUILTIN: BuiltinLanguage[] = [
    {
      code: "zh-CN",
      name: "Simplified Chinese",
      nativeName: "简体中文",
      instruction: "All user-facing natural language responses must be written in Simplified Chinese (简体中文).",
    },
    {
      code: "zh-TW",
      name: "Traditional Chinese",
      nativeName: "繁體中文",
      instruction: "All user-facing natural language responses must be written in Traditional Chinese (繁體中文).",
    },
    {
      code: "en",
      name: "English",
      nativeName: "English",
      instruction: "All user-facing natural language responses must be written in English.",
    },
    {
      code: "ja",
      name: "Japanese",
      nativeName: "日本語",
      instruction: "All user-facing natural language responses must be written in Japanese (日本語).",
    },
    {
      code: "ko",
      name: "Korean",
      nativeName: "한국어",
      instruction: "All user-facing natural language responses must be written in Korean (한국어).",
    },
    {
      code: "es",
      name: "Spanish",
      nativeName: "Español",
      instruction: "All user-facing natural language responses must be written in Spanish (Español).",
    },
    {
      code: "fr",
      name: "French",
      nativeName: "Français",
      instruction: "All user-facing natural language responses must be written in French (Français).",
    },
    {
      code: "de",
      name: "German",
      nativeName: "Deutsch",
      instruction: "All user-facing natural language responses must be written in German (Deutsch).",
    },
    {
      code: "pt",
      name: "Portuguese",
      nativeName: "Português",
      instruction: "All user-facing natural language responses must be written in Portuguese (Português).",
    },
    {
      code: "ru",
      name: "Russian",
      nativeName: "Русский",
      instruction: "All user-facing natural language responses must be written in Russian (Русский).",
    },
    {
      code: "ar",
      name: "Arabic",
      nativeName: "العربية",
      instruction: "All user-facing natural language responses must be written in Arabic (العربية).",
    },
    {
      code: "auto",
      name: "Auto",
      nativeName: "Auto",
      instruction: "All user-facing natural language responses should follow the user's input language, with fallback to the configured fallback language.",
    },
  ]

  const DEFAULT_LANGUAGE = "zh-CN"

  function builtin(code: string) {
    return BUILTIN.find((item) => item.code === code)
  }

  export function resolve(input: Config.Language | undefined): Policy {
    const raw = typeof input === "string" ? { user: input } : input ?? {}
    const userLanguage = raw.user ?? DEFAULT_LANGUAGE
    const language = builtin(userLanguage) ?? {
      code: userLanguage,
      name: userLanguage,
      nativeName: userLanguage,
      instruction: `All user-facing natural language responses must be written in ${userLanguage}.`,
    }

    const policy: Policy = {
      userLanguage,
      fallbackLanguage: raw.fallback ?? "en",
      responseLanguage: raw.response ?? "localized",
      documentationLanguage: raw.documentation ?? "localized",
      documentFileNamePolicy: raw.document_file_name ?? "localized",
      documentPathPolicy: raw.document_path ?? "english",
      commentLanguage: raw.comments ?? "localized",
      uiLanguage: raw.ui ?? "localized",
      errorLanguage: raw.errors ?? "localized-summary",
      diffSummaryLanguage: raw.diff_summary ?? "localized",
      testDescriptionLanguage: raw.tests ?? "localized",
      termsPolicy: raw.terms ?? "english-only",
      strictness: raw.strictness ?? "balanced",
      pathCase: raw.path_case ?? "kebab-case",
      autoDetectProjectConvention: raw.auto_detect_project_convention ?? true,
      instruction: "",
      displayName: language.name,
      nativeName: language.nativeName,
    }

    policy.instruction = buildInstruction(policy, language, raw?.builtin_instruction_override)
    return policy
  }

  export function buildInstruction(policy: Policy, language: BuiltinLanguage, override?: string) {
    if (override) return override

    const lines = [
      language.instruction,
      "All generated code must remain in English.",
      "All variable names, function names, class names, interface names, type names, config keys, API paths, shell commands, environment variable names, and database field names must remain in English.",
      `Documentation body content must follow the "${policy.documentationLanguage}" policy.`,
      `Documentation file names must follow the "${policy.documentFileNamePolicy}" policy.`,
      `Documentation directory paths must follow the "${policy.documentPathPolicy}" policy.`,
      `Code comments must follow the "${policy.commentLanguage}" policy.`,
      `Generated UI text shown to end users must follow the "${policy.uiLanguage}" policy.`,
      `Error explanations must follow the "${policy.errorLanguage}" policy.`,
      `Diff summaries and change explanations must follow the "${policy.diffSummaryLanguage}" policy.`,
      `Test descriptions must follow the "${policy.testDescriptionLanguage}" policy.`,
      `Technical terminology must follow the "${policy.termsPolicy}" policy.`,
      `Language strictness mode is "${policy.strictness}".`,
      `Path naming style is "${policy.pathCase}".`,
      "Treat user-facing language and engineering-language requirements as separate rules.",
      "Do not translate source code, identifiers, commands, or file-system conventions unless the active policy explicitly allows it.",
    ]

    if (policy.userLanguage === "auto") {
      lines.push(
        `When the user's language is unclear, use the fallback language "${policy.fallbackLanguage}" for user-facing text.`,
      )
    }

    if (policy.autoDetectProjectConvention) {
      lines.push("When possible, you may reference the project's existing naming and comment conventions, but explicit configuration always wins.")
    }

    return lines.join("\n")
  }
}
