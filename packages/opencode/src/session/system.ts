import { Ripgrep } from "../file/ripgrep"

import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"

import PROMPT_CODEX from "./prompt/codex_header.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import { LanguageManager } from "@/language/language"

export namespace SystemPrompt {
  export function instructions() {
    return PROMPT_CODEX.trim()
  }

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    const language = await LanguageManager.getPolicy()
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `  Preferred user language: ${language.nativeName} (${language.userLanguage})`,
        `  Fallback language: ${language.fallbackLanguage}`,
        `  Response language policy: ${language.responseLanguage}`,
        `  Documentation language policy: ${language.documentationLanguage}`,
        `  Documentation file name policy: ${language.documentFileNamePolicy}`,
        `  Documentation path policy: ${language.documentPathPolicy}`,
        `  Comment language policy: ${language.commentLanguage}`,
        `  UI language policy: ${language.uiLanguage}`,
        `  Error language policy: ${language.errorLanguage}`,
        `  Diff summary language policy: ${language.diffSummaryLanguage}`,
        `  Test description language policy: ${language.testDescriptionLanguage}`,
        `  Terminology policy: ${language.termsPolicy}`,
        `  Language strictness: ${language.strictness}`,
        `  Path naming style: ${language.pathCase}`,
        `</env>`,
        ``,
        `<language_policy>`,
        language.instruction,
        `</language_policy>`,
        `<directories>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 50,
              })
            : ""
        }`,
        `</directories>`,
      ].join("\n"),
    ]
  }
}
