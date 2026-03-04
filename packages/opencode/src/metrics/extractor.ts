import type { Session } from "@/session"
import type { MessageV2 } from "@/session/message-v2"
import { MetricsConfig } from "./config"

export namespace DataExtractor {
    /**
     * Standard event record envelope
     */
    export interface EventRecord {
        event_type: string
        event_action?: string
        timestamp: number
        data: Record<string, any>
    }

    /**
     * Extract session lifecycle data for reporting.
     */
    export function extractSession(info: Session.Info, action: string): EventRecord {
        const includeFilePaths = MetricsConfig.shouldIncludeFilePaths()

        return {
            event_type: "session",
            event_action: action,
            timestamp: Date.now(),
            data: {
                session_id: info.id,
                project_id: info.projectID,
                workspace_id: info.workspaceID,
                title: info.title,
                directory: includeFilePaths ? info.directory : undefined,
                version: info.version,
                summary: info.summary
                    ? {
                        additions: info.summary.additions,
                        deletions: info.summary.deletions,
                        files: info.summary.files,
                        file_list: includeFilePaths
                            ? info.summary.diffs?.map((d) => ({
                                file: d.file,
                                additions: d.additions,
                                deletions: d.deletions,
                                status: d.status,
                            }))
                            : undefined,
                    }
                    : undefined,
                time: {
                    created: info.time.created,
                    updated: info.time.updated,
                    archived: info.time.archived,
                },
            },
        }
    }

    /**
     * Extract AI assistant response data for reporting.
     */
    export function extractAssistantMessage(msg: MessageV2.Assistant): EventRecord {
        return {
            event_type: "assistant_message",
            timestamp: msg.time.completed ?? Date.now(),
            data: {
                message_id: msg.id,
                session_id: msg.sessionID,
                model_id: msg.modelID,
                provider_id: msg.providerID,
                agent: msg.agent,
                cost: msg.cost,
                tokens: {
                    total: msg.tokens.total,
                    input: msg.tokens.input,
                    output: msg.tokens.output,
                    reasoning: msg.tokens.reasoning,
                    cache_read: msg.tokens.cache.read,
                    cache_write: msg.tokens.cache.write,
                },
                duration_ms:
                    msg.time.completed != null ? msg.time.completed - msg.time.created : undefined,
                has_error: !!msg.error,
                error_type: msg.error ? (msg.error as any).name : undefined,
                finish_reason: msg.finish,
            },
        }
    }

    /**
     * Extract tool call data for reporting.
     */
    export function extractToolCall(part: MessageV2.ToolPart): EventRecord {
        const isFileModification = FILE_MODIFICATION_TOOLS.includes(part.tool)
        const state = part.state

        let durationMs: number | undefined
        if (
            (state.status === "completed" || state.status === "error") &&
            "time" in state &&
            state.time
        ) {
            durationMs = state.time.end - state.time.start
        }

        let language: string | undefined
        let targetFile: string | undefined
        if (isFileModification && state.status === "completed") {
            const input = state.input ?? {}
            targetFile = MetricsConfig.shouldIncludeFilePaths()
                ? (input.file_path ?? input.filePath ?? input.path)
                : undefined
            language = detectLanguage(input)
        }

        return {
            event_type: "tool_call",
            timestamp: Date.now(),
            data: {
                part_id: part.id,
                session_id: part.sessionID,
                message_id: part.messageID,
                tool_name: part.tool,
                status: state.status,
                duration_ms: durationMs,
                is_file_modification: isFileModification,
                language,
                target_file: targetFile,
            },
        }
    }

    /**
     * Extract step finish data for reporting.
     */
    export function extractStepFinish(part: MessageV2.StepFinishPart): EventRecord {
        return {
            event_type: "step_finish",
            timestamp: Date.now(),
            data: {
                part_id: part.id,
                session_id: part.sessionID,
                message_id: part.messageID,
                cost: part.cost,
                tokens: {
                    total: part.tokens.total,
                    input: part.tokens.input,
                    output: part.tokens.output,
                    reasoning: part.tokens.reasoning,
                    cache_read: part.tokens.cache.read,
                    cache_write: part.tokens.cache.write,
                },
                reason: part.reason,
            },
        }
    }

    // Tools that modify files
    const FILE_MODIFICATION_TOOLS = ["write", "edit", "multiedit", "apply_patch"]

    const LANG_MAP: Record<string, string> = {
        ts: "TypeScript",
        tsx: "TypeScript",
        js: "JavaScript",
        jsx: "JavaScript",
        py: "Python",
        java: "Java",
        go: "Go",
        rs: "Rust",
        rb: "Ruby",
        php: "PHP",
        cs: "C#",
        cpp: "C++",
        c: "C",
        swift: "Swift",
        kt: "Kotlin",
        md: "Markdown",
        json: "JSON",
        yaml: "YAML",
        yml: "YAML",
        html: "HTML",
        css: "CSS",
        scss: "SCSS",
        sql: "SQL",
        sh: "Shell",
        bash: "Shell",
        vue: "Vue",
        svelte: "Svelte",
    }

    /**
     * Detect programming language from tool input (file path).
     */
    export function detectLanguage(input: Record<string, any>): string | undefined {
        const filePath: string = input?.file_path ?? input?.filePath ?? input?.path ?? ""
        if (!filePath) return undefined
        const ext = filePath.split(".").pop()?.toLowerCase()
        return ext ? LANG_MAP[ext] : undefined
    }
}
