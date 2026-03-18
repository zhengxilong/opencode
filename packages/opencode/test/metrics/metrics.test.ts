import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"

import { MetricsConfig } from "../../src/metrics/config"
import { MetricsQueue } from "../../src/metrics/queue"
import { DataExtractor } from "../../src/metrics/extractor"
import { MetricsAggregator } from "../../src/metrics/aggregator"
import { MetricsCollector } from "../../src/metrics/collector"
import { MetricsUploader } from "../../src/metrics/uploader"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { Session } from "../../src/session"

// ─── Test Helpers ───────────────────────────────────────────────────────────

let tmpDir: string

beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `metrics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(tmpDir, { recursive: true })
    MetricsQueue.setQueueDir(tmpDir)
    MetricsConfig.setConfig({
        enabled: true,
        api_base_url: "http://localhost:9999",
        client_id: "test-client",
        upload_interval_ms: 5000,
        batch_size: 50,
        include_file_paths: true,
        include_tool_output: false,
    })
})

afterEach(async () => {
    MetricsCollector.dispose()
    MetricsUploader.stop()
    MetricsUploader.resetAuthState()
    await Instance.disposeAll().catch(() => {})
    MetricsConfig.setConfig({
        enabled: false,
        api_base_url: "",
        client_id: undefined,
    })
    try {
        await fs.rm(tmpDir, { recursive: true, force: true })
    } catch { /* ok if already gone */ }
})

// ─── Mock Data ──────────────────────────────────────────────────────────────

function makeSessionInfo(overrides: Record<string, any> = {}) {
    return {
        id: "session_test001",
        slug: "test-slug",
        projectID: "proj_abc",
        workspaceID: "ws_001",
        directory: "/Users/dev/myproject",
        title: "Test Session",
        version: "1.2.0",
        summary: {
            additions: 100,
            deletions: 20,
            files: 5,
            diffs: [
                { file: "src/index.ts", additions: 50, deletions: 10, status: "modified" },
                { file: "src/new.ts", additions: 50, deletions: 10, status: "added" },
            ],
        },
        time: {
            created: 1700000000000,
            updated: 1700001000000,
        },
        ...overrides,
    } as any
}

function makeAssistantMessage(overrides: Record<string, any> = {}) {
    return {
        id: "msg_test001",
        sessionID: "session_test001",
        role: "assistant",
        modelID: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        agent: "build",
        mode: "build",
        parentID: "msg_user001",
        path: { cwd: "/Users/dev", root: "/Users/dev" },
        cost: 0.025,
        tokens: {
            total: 15000,
            input: 12000,
            output: 2500,
            reasoning: 500,
            cache: { read: 8000, write: 1000 },
        },
        time: {
            created: 1700000000000,
            completed: 1700000004500,
        },
        finish: "end_turn",
        ...overrides,
    } as any
}

function makeToolPart(overrides: Record<string, any> = {}) {
    return {
        id: "part_tool001",
        sessionID: "session_test001",
        messageID: "msg_test001",
        type: "tool",
        callID: "call_001",
        tool: "edit",
        state: {
            status: "completed",
            input: { file_path: "src/auth/login.ts", content: "..." },
            output: "File edited successfully",
            time: { start: 1700000001000, end: 1700000001200 },
        },
        ...overrides,
    } as any
}

function makeStepFinishPart(overrides: Record<string, any> = {}) {
    return {
        id: "part_step001",
        sessionID: "session_test001",
        messageID: "msg_test001",
        type: "step-finish",
        reason: "end_turn",
        cost: 0.012,
        tokens: {
            total: 7000,
            input: 5000,
            output: 1500,
            reasoning: 500,
            cache: { read: 3000, write: 500 },
        },
        ...overrides,
    } as any
}

// ─── Config Tests ───────────────────────────────────────────────────────────

describe("MetricsConfig", () => {
    test("returns defaults when no config set", () => {
        MetricsConfig.setConfig({ enabled: false, api_base_url: "" })
        expect(MetricsConfig.isEnabled()).toBe(false)
        expect(MetricsConfig.getApiBaseUrl()).toBe("")
    })

    test("isEnabled requires both enabled=true and api_base_url", () => {
        MetricsConfig.setConfig({ enabled: true, api_base_url: "" })
        expect(MetricsConfig.isEnabled()).toBe(false)

        MetricsConfig.setConfig({ enabled: false, api_base_url: "http://localhost:9999" })
        expect(MetricsConfig.isEnabled()).toBe(false)

        MetricsConfig.setConfig({ enabled: true, api_base_url: "http://localhost:9999" })
        expect(MetricsConfig.isEnabled()).toBe(true)
    })

    test("getClientId returns configured id", () => {
        MetricsConfig.setConfig({ client_id: "my-custom-id" })
        expect(MetricsConfig.getClientId()).toBe("my-custom-id")
    })

    test("getClientId generates default when not configured", () => {
        MetricsConfig.setConfig({ client_id: undefined })
        const id = MetricsConfig.getClientId()
        expect(id).toStartWith("oc-")
        expect(id.length).toBeGreaterThan(3)
    })

    test("getMachineId returns a hash string", () => {
        const machineId = MetricsConfig.getMachineId()
        expect(typeof machineId).toBe("string")
        expect(machineId.length).toBe(16)
    })

    test("getUploadInterval returns configured value", () => {
        MetricsConfig.setConfig({ upload_interval_ms: 60000 })
        expect(MetricsConfig.getUploadInterval()).toBe(60000)
    })

    test("getBatchSize returns configured value", () => {
        MetricsConfig.setConfig({ batch_size: 200 })
        expect(MetricsConfig.getBatchSize()).toBe(200)
    })
})

// ─── Queue Tests ────────────────────────────────────────────────────────────

describe("MetricsQueue", () => {
    test("enqueue and dequeue basic flow", async () => {
        const record1 = { event_type: "test", data: { id: 1 } }
        const record2 = { event_type: "test", data: { id: 2 } }

        await MetricsQueue.enqueue("test", record1)
        await MetricsQueue.enqueue("test", record2)

        const results = await MetricsQueue.dequeue("test")
        expect(results).toHaveLength(2)
        expect(results[0].data.id).toBe(1)
        expect(results[1].data.id).toBe(2)
    })

    test("dequeue removes the file", async () => {
        await MetricsQueue.enqueue("test", { id: 1 })
        await MetricsQueue.dequeue("test")

        const second = await MetricsQueue.dequeue("test")
        expect(second).toHaveLength(0)
    })

    test("requeue puts data back", async () => {
        const records = [{ id: 1 }, { id: 2 }]
        await MetricsQueue.requeue("retry", records)

        const result = await MetricsQueue.dequeue("retry")
        expect(result).toHaveLength(2)
        expect(result[0].id).toBe(1)
    })

    test("pendingCount returns correct count", async () => {
        await MetricsQueue.enqueue("a", { x: 1 })
        await MetricsQueue.enqueue("a", { x: 2 })
        await MetricsQueue.enqueue("b", { x: 3 })

        const count = await MetricsQueue.pendingCount()
        expect(count).toBe(3)
    })

    test("clear removes all queue files", async () => {
        await MetricsQueue.enqueue("a", { x: 1 })
        await MetricsQueue.enqueue("b", { x: 2 })

        await MetricsQueue.clear()

        const countA = (await MetricsQueue.dequeue("a")).length
        const countB = (await MetricsQueue.dequeue("b")).length
        expect(countA + countB).toBe(0)
    })

    test("dequeue returns empty for nonexistent category", async () => {
        const result = await MetricsQueue.dequeue("nonexistent")
        expect(result).toHaveLength(0)
    })

    test("handles multiple categories independently", async () => {
        await MetricsQueue.enqueue("session", { type: "session", id: 1 })
        await MetricsQueue.enqueue("message", { type: "message", id: 2 })
        await MetricsQueue.enqueue("tool", { type: "tool", id: 3 })

        const sessions = await MetricsQueue.dequeue("session")
        const messages = await MetricsQueue.dequeue("message")
        const tools = await MetricsQueue.dequeue("tool")

        expect(sessions).toHaveLength(1)
        expect(messages).toHaveLength(1)
        expect(tools).toHaveLength(1)
        expect(sessions[0].type).toBe("session")
        expect(messages[0].type).toBe("message")
        expect(tools[0].type).toBe("tool")
    })
})

describe("MetricsCollector", () => {
    test("continues collecting after instance disposal and recreation", async () => {
        const projectDir = path.join(tmpDir, "project")
        await fs.mkdir(projectDir, { recursive: true })

        expect(
            MetricsCollector.init({
                directory: projectDir,
            }),
        ).toBe(true)

        await Instance.provide({
            directory: projectDir,
            fn: async () => {
                await Bus.publish(Session.Event.Created, {
                    info: makeSessionInfo({ id: "session_before_reload" }),
                })
            },
        })
        await Bun.sleep(10)

        await Instance.disposeAll()

        await Instance.provide({
            directory: projectDir,
            fn: async () => {
                await Bus.publish(Session.Event.Created, {
                    info: makeSessionInfo({ id: "session_after_reload" }),
                })
            },
        })
        await Bun.sleep(10)

        const results = await MetricsQueue.dequeue("session")
        expect(results).toHaveLength(2)
        expect(results.map((item) => item.data.session_id)).toEqual([
            "session_before_reload",
            "session_after_reload",
        ])
    })
})

// ─── Extractor Tests ────────────────────────────────────────────────────────

describe("DataExtractor", () => {
    describe("extractSession", () => {
        test("extracts session created event", () => {
            const info = makeSessionInfo()
            const result = DataExtractor.extractSession(info, "created")

            expect(result.event_type).toBe("session")
            expect(result.event_action).toBe("created")
            expect(typeof result.timestamp).toBe("number")
            expect(result.data.session_id).toBe("session_test001")
            expect(result.data.project_id).toBe("proj_abc")
            expect(result.data.workspace_id).toBe("ws_001")
            expect(result.data.title).toBe("Test Session")
            expect(result.data.version).toBe("1.2.0")
        })

        test("includes summary data", () => {
            const info = makeSessionInfo()
            const result = DataExtractor.extractSession(info, "updated")

            expect(result.data.summary.additions).toBe(100)
            expect(result.data.summary.deletions).toBe(20)
            expect(result.data.summary.files).toBe(5)
            expect(result.data.summary.file_list).toHaveLength(2)
            expect(result.data.summary.file_list[0].file).toBe("src/index.ts")
        })

        test("handles session without summary", () => {
            const info = makeSessionInfo({ summary: undefined })
            const result = DataExtractor.extractSession(info, "created")
            expect(result.data.summary).toBeUndefined()
        })

        test("respects include_file_paths=false", () => {
            MetricsConfig.setConfig({ include_file_paths: false })
            const info = makeSessionInfo()
            const result = DataExtractor.extractSession(info, "updated")

            expect(result.data.directory).toBeUndefined()
            expect(result.data.summary.file_list).toBeUndefined()
        })

        test("includes time data", () => {
            const info = makeSessionInfo()
            const result = DataExtractor.extractSession(info, "created")

            expect(result.data.time.created).toBe(1700000000000)
            expect(result.data.time.updated).toBe(1700001000000)
        })
    })

    describe("extractAssistantMessage", () => {
        test("extracts all message fields", () => {
            const msg = makeAssistantMessage()
            const result = DataExtractor.extractAssistantMessage(msg)

            expect(result.event_type).toBe("assistant_message")
            expect(result.data.message_id).toBe("msg_test001")
            expect(result.data.session_id).toBe("session_test001")
            expect(result.data.model_id).toBe("claude-sonnet-4-20250514")
            expect(result.data.provider_id).toBe("anthropic")
            expect(result.data.agent).toBe("build")
            expect(result.data.cost).toBe(0.025)
        })

        test("extracts token breakdown", () => {
            const msg = makeAssistantMessage()
            const result = DataExtractor.extractAssistantMessage(msg)

            expect(result.data.tokens.total).toBe(15000)
            expect(result.data.tokens.input).toBe(12000)
            expect(result.data.tokens.output).toBe(2500)
            expect(result.data.tokens.reasoning).toBe(500)
            expect(result.data.tokens.cache_read).toBe(8000)
            expect(result.data.tokens.cache_write).toBe(1000)
        })

        test("calculates duration in ms", () => {
            const msg = makeAssistantMessage()
            const result = DataExtractor.extractAssistantMessage(msg)
            expect(result.data.duration_ms).toBe(4500)
        })

        test("handles message without completed time", () => {
            const msg = makeAssistantMessage({ time: { created: 1700000000000 } })
            const result = DataExtractor.extractAssistantMessage(msg)
            expect(result.data.duration_ms).toBeUndefined()
        })

        test("detects error presence", () => {
            const msg = makeAssistantMessage({
                error: { name: "APIError", message: "rate limit" },
            })
            const result = DataExtractor.extractAssistantMessage(msg)
            expect(result.data.has_error).toBe(true)
            expect(result.data.error_type).toBe("APIError")
        })

        test("no error when message succeeds", () => {
            const msg = makeAssistantMessage()
            const result = DataExtractor.extractAssistantMessage(msg)
            expect(result.data.has_error).toBe(false)
            expect(result.data.error_type).toBeUndefined()
        })
    })

    describe("extractToolCall", () => {
        test("extracts completed tool call", () => {
            const part = makeToolPart()
            const result = DataExtractor.extractToolCall(part)

            expect(result.event_type).toBe("tool_call")
            expect(result.data.tool_name).toBe("edit")
            expect(result.data.status).toBe("completed")
            expect(result.data.is_file_modification).toBe(true)
            expect(result.data.duration_ms).toBe(200)
        })

        test("detects language from file extension", () => {
            const part = makeToolPart()
            const result = DataExtractor.extractToolCall(part)
            expect(result.data.language).toBe("TypeScript")
        })

        test("includes target file when configured", () => {
            MetricsConfig.setConfig({ include_file_paths: true })
            const part = makeToolPart()
            const result = DataExtractor.extractToolCall(part)
            expect(result.data.target_file).toBe("src/auth/login.ts")
        })

        test("excludes target file when not configured", () => {
            MetricsConfig.setConfig({ include_file_paths: false })
            const part = makeToolPart()
            const result = DataExtractor.extractToolCall(part)
            expect(result.data.target_file).toBeUndefined()
        })

        test("identifies non-file-modification tool", () => {
            const part = makeToolPart({ tool: "bash" })
            const result = DataExtractor.extractToolCall(part)
            expect(result.data.is_file_modification).toBe(false)
        })

        test("handles error status tool", () => {
            const part = makeToolPart({
                state: {
                    status: "error",
                    input: { file_path: "src/test.ts" },
                    error: "File not found",
                    time: { start: 1700000001000, end: 1700000001500 },
                },
            })
            const result = DataExtractor.extractToolCall(part)
            expect(result.data.status).toBe("error")
            expect(result.data.duration_ms).toBe(500)
        })

        test("supports write, multiedit, apply_patch as file modification tools", () => {
            for (const tool of ["write", "multiedit", "apply_patch"]) {
                const part = makeToolPart({ tool })
                const result = DataExtractor.extractToolCall(part)
                expect(result.data.is_file_modification).toBe(true)
            }
        })
    })

    describe("extractStepFinish", () => {
        test("extracts step finish data", () => {
            const part = makeStepFinishPart()
            const result = DataExtractor.extractStepFinish(part)

            expect(result.event_type).toBe("step_finish")
            expect(result.data.cost).toBe(0.012)
            expect(result.data.reason).toBe("end_turn")
            expect(result.data.tokens.total).toBe(7000)
            expect(result.data.tokens.input).toBe(5000)
            expect(result.data.tokens.output).toBe(1500)
            expect(result.data.tokens.reasoning).toBe(500)
            expect(result.data.tokens.cache_read).toBe(3000)
            expect(result.data.tokens.cache_write).toBe(500)
        })
    })

    describe("detectLanguage", () => {
        test("detects common languages", () => {
            const cases: [Record<string, any>, string | undefined][] = [
                [{ file_path: "test.ts" }, "TypeScript"],
                [{ file_path: "test.tsx" }, "TypeScript"],
                [{ file_path: "test.js" }, "JavaScript"],
                [{ file_path: "test.py" }, "Python"],
                [{ file_path: "test.go" }, "Go"],
                [{ file_path: "test.rs" }, "Rust"],
                [{ file_path: "test.java" }, "Java"],
                [{ file_path: "test.vue" }, "Vue"],
                [{ file_path: "test.sql" }, "SQL"],
                [{ file_path: "test.sh" }, "Shell"],
                [{ file_path: "test.css" }, "CSS"],
                [{ file_path: "test.html" }, "HTML"],
            ]
            for (const [input, expected] of cases) {
                expect(DataExtractor.detectLanguage(input)).toBe(expected)
            }
        })

        test("returns undefined for unknown extension", () => {
            expect(DataExtractor.detectLanguage({ file_path: "test.xyz" })).toBeUndefined()
        })

        test("returns undefined for empty input", () => {
            expect(DataExtractor.detectLanguage({})).toBeUndefined()
        })

        test("supports filePath variants", () => {
            expect(DataExtractor.detectLanguage({ filePath: "foo.py" })).toBe("Python")
            expect(DataExtractor.detectLanguage({ path: "bar.go" })).toBe("Go")
        })
    })
})

// ─── Aggregator Tests ───────────────────────────────────────────────────────

describe("MetricsAggregator", () => {
    test("returns null when no data", () => {
        const result = MetricsAggregator.computeFromRecords({
            sessionRecords: [],
            messageRecords: [],
            toolRecords: [],
            stepRecords: [],
            periodStart: 1700000000000,
            periodEnd: 1700003600000,
        })
        expect(result).toBeNull()
    })

    test("aggregates message data correctly", () => {
        const msg1 = DataExtractor.extractAssistantMessage(
            makeAssistantMessage({ cost: 0.01, tokens: { total: 1000, input: 800, output: 200, reasoning: 0, cache: { read: 100, write: 50 } }, time: { created: 1700000000000, completed: 1700000002000 } }),
        )
        const msg2 = DataExtractor.extractAssistantMessage(
            makeAssistantMessage({
                id: "msg_002",
                cost: 0.02,
                modelID: "gpt-4o",
                providerID: "openai",
                tokens: { total: 2000, input: 1500, output: 500, reasoning: 100, cache: { read: 200, write: 100 } },
                time: { created: 1700000005000, completed: 1700000008000 },
            }),
        )

        const result = MetricsAggregator.computeFromRecords({
            sessionRecords: [],
            messageRecords: [msg1, msg2],
            toolRecords: [],
            stepRecords: [],
            periodStart: 1700000000000,
            periodEnd: 1700003600000,
        })!

        expect(result.metrics.message_count).toBe(2)
        expect(result.metrics.total_cost).toBe(0.03)
        expect(result.metrics.total_tokens.input).toBe(2300)
        expect(result.metrics.total_tokens.output).toBe(700)
        expect(result.metrics.total_tokens.reasoning).toBe(100)
        expect(result.metrics.total_tokens.cache_read).toBe(300)
        expect(result.metrics.total_tokens.cache_write).toBe(150)
        expect(result.metrics.avg_generation_time_ms).toBe(2500) // (2000+3000)/2
        expect(result.metrics.model_distribution["anthropic/claude-sonnet-4-20250514"]).toBe(1)
        expect(result.metrics.model_distribution["openai/gpt-4o"]).toBe(1)
    })

    test("aggregates session summary data", () => {
        const s1 = DataExtractor.extractSession(
            makeSessionInfo({ id: "s1", summary: { additions: 100, deletions: 20, files: 3, diffs: [] } }),
            "updated",
        )
        const s2 = DataExtractor.extractSession(
            makeSessionInfo({ id: "s2", summary: { additions: 50, deletions: 10, files: 2, diffs: [] } }),
            "updated",
        )

        const result = MetricsAggregator.computeFromRecords({
            sessionRecords: [s1, s2],
            messageRecords: [],
            toolRecords: [],
            stepRecords: [],
            periodStart: 1700000000000,
            periodEnd: 1700003600000,
        })!

        expect(result.metrics.session_count).toBe(2)
        expect(result.metrics.total_additions).toBe(150)
        expect(result.metrics.total_deletions).toBe(30)
        expect(result.metrics.total_files_modified).toBe(5)
    })

    test("deduplicates sessions by id", () => {
        const s1 = DataExtractor.extractSession(
            makeSessionInfo({ id: "s1", summary: { additions: 100, deletions: 20, files: 3, diffs: [] } }),
            "updated",
        )
        const s1again = DataExtractor.extractSession(
            makeSessionInfo({ id: "s1", summary: { additions: 200, deletions: 30, files: 5, diffs: [] } }),
            "updated",
        )

        const result = MetricsAggregator.computeFromRecords({
            sessionRecords: [s1, s1again],
            messageRecords: [],
            toolRecords: [],
            stepRecords: [],
            periodStart: 1700000000000,
            periodEnd: 1700003600000,
        })!

        expect(result.metrics.session_count).toBe(1) // deduplicated
        // Note: additions are summed from all records, even duplicates
        expect(result.metrics.total_additions).toBe(300)
    })

    test("aggregates tool distribution", () => {
        const t1 = DataExtractor.extractToolCall(makeToolPart({ tool: "edit" }))
        const t2 = DataExtractor.extractToolCall(makeToolPart({ tool: "edit" }))
        const t3 = DataExtractor.extractToolCall(makeToolPart({ tool: "bash" }))
        const t4 = DataExtractor.extractToolCall(
            makeToolPart({ tool: "write", state: { status: "completed", input: { file_path: "x.py" }, output: "", time: { start: 1, end: 2 } } }),
        )

        const result = MetricsAggregator.computeFromRecords({
            sessionRecords: [],
            messageRecords: [],
            toolRecords: [t1, t2, t3, t4],
            stepRecords: [],
            periodStart: 1700000000000,
            periodEnd: 1700003600000,
        })!

        expect(result.metrics.tool_distribution["edit"]).toBe(2)
        expect(result.metrics.tool_distribution["bash"]).toBe(1)
        expect(result.metrics.tool_distribution["write"]).toBe(1)
    })

    test("aggregates language distribution", () => {
        const t1 = DataExtractor.extractToolCall(makeToolPart({ state: { status: "completed", input: { file_path: "a.ts" }, output: "", time: { start: 1, end: 2 } } }))
        const t2 = DataExtractor.extractToolCall(makeToolPart({ state: { status: "completed", input: { file_path: "b.ts" }, output: "", time: { start: 1, end: 2 } } }))
        const t3 = DataExtractor.extractToolCall(makeToolPart({ state: { status: "completed", input: { file_path: "c.py" }, output: "", time: { start: 1, end: 2 } } }))

        const result = MetricsAggregator.computeFromRecords({
            sessionRecords: [],
            messageRecords: [],
            toolRecords: [t1, t2, t3],
            stepRecords: [],
            periodStart: 1700000000000,
            periodEnd: 1700003600000,
        })!

        expect(result.metrics.language_distribution["TypeScript"]).toBe(2)
        expect(result.metrics.language_distribution["Python"]).toBe(1)
    })

    test("aggregates error counts", () => {
        const msg1 = DataExtractor.extractAssistantMessage(
            makeAssistantMessage({ error: { name: "APIError", message: "rate limit" } }),
        )
        const msg2 = DataExtractor.extractAssistantMessage(
            makeAssistantMessage({ error: { name: "APIError", message: "timeout" } }),
        )
        const msg3 = DataExtractor.extractAssistantMessage(makeAssistantMessage()) // no error

        const result = MetricsAggregator.computeFromRecords({
            sessionRecords: [],
            messageRecords: [msg1, msg2, msg3],
            toolRecords: [],
            stepRecords: [],
            periodStart: 1700000000000,
            periodEnd: 1700003600000,
        })!

        expect(result.metrics.error_count).toBe(2)
        expect(result.metrics.error_types["APIError"]).toBe(2)
        expect(result.metrics.message_count).toBe(3)
    })

    test("period info is included", () => {
        const msg = DataExtractor.extractAssistantMessage(makeAssistantMessage())
        const result = MetricsAggregator.computeFromRecords({
            sessionRecords: [],
            messageRecords: [msg],
            toolRecords: [],
            stepRecords: [],
            periodStart: 1700000000000,
            periodEnd: 1700003600000,
        })!

        expect(result.period.start).toBe(1700000000000)
        expect(result.period.end).toBe(1700003600000)
        expect(result.period.type).toBe("hourly")
    })
})

// ─── End-to-End Queue + Extractor + Aggregator Flow ─────────────────────────

describe("End-to-end: Queue → Extractor → Aggregator", () => {
    test("simulate full data pipeline", async () => {
        // 1. Extract records from raw data
        const sessionRecord = DataExtractor.extractSession(makeSessionInfo(), "updated")
        const msgRecord = DataExtractor.extractAssistantMessage(makeAssistantMessage())
        const toolRecord = DataExtractor.extractToolCall(makeToolPart())
        const stepRecord = DataExtractor.extractStepFinish(makeStepFinishPart())

        // 2. Enqueue to local file queue
        await MetricsQueue.enqueue("session", sessionRecord)
        await MetricsQueue.enqueue("message", msgRecord)
        await MetricsQueue.enqueue("tool", toolRecord)
        await MetricsQueue.enqueue("step", stepRecord)

        // 3. Verify pending count
        expect(await MetricsQueue.pendingCount()).toBe(4)

        // 4. Dequeue all categories
        const sessions = await MetricsQueue.dequeue("session")
        const messages = await MetricsQueue.dequeue("message")
        const tools = await MetricsQueue.dequeue("tool")
        const steps = await MetricsQueue.dequeue("step")

        expect(sessions).toHaveLength(1)
        expect(messages).toHaveLength(1)
        expect(tools).toHaveLength(1)
        expect(steps).toHaveLength(1)

        // 5. Aggregate
        const result = MetricsAggregator.computeFromRecords({
            sessionRecords: sessions,
            messageRecords: messages,
            toolRecords: tools,
            stepRecords: steps,
            periodStart: 1700000000000,
            periodEnd: 1700004000000,
        })!

        expect(result).not.toBeNull()
        expect(result.metrics.session_count).toBe(1)
        expect(result.metrics.message_count).toBe(1)
        expect(result.metrics.total_cost).toBe(0.025)
        expect(result.metrics.total_tokens.total).toBe(15000)
        expect(result.metrics.total_additions).toBe(100)
        expect(result.metrics.total_deletions).toBe(20)
        expect(result.metrics.tool_distribution["edit"]).toBe(1)
        expect(result.metrics.language_distribution["TypeScript"]).toBe(1)
        expect(result.metrics.model_distribution["anthropic/claude-sonnet-4-20250514"]).toBe(1)
        expect(result.metrics.avg_generation_time_ms).toBe(4500)
        expect(result.metrics.error_count).toBe(0)

        // 6. Queue should be empty now
        expect(await MetricsQueue.pendingCount()).toBe(0)
    })
})
