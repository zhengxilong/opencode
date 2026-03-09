import fs from "fs/promises"
import path from "path"
import { Log } from "@/util/log"

export namespace MetricsQueue {
    const log = Log.create({ service: "metrics.queue" })
    const MAX_FILE_SIZE = 5_000_000 // 5MB

    let queueDirPath: string | null = null

    /**
     * Set the queue directory path. Must be called before using the queue.
     */
    export function setQueueDir(dir: string) {
        queueDirPath = dir
    }

    function queueDir(): string {
        if (!queueDirPath) {
            throw new Error("MetricsQueue directory not set. Call setQueueDir() first.")
        }
        return queueDirPath
    }

    /**
     * Enqueue a record to the local JSONL file queue.
     */
    export async function enqueue(category: string, record: any): Promise<void> {
        const dir = queueDir()
        await fs.mkdir(dir, { recursive: true })
        const file = path.join(dir, `${category}.jsonl`)

        // Check file size, rotate if too large
        try {
            const stat = await fs.stat(file)
            if (stat.size >= MAX_FILE_SIZE) {
                const rotated = `${file}.${Date.now()}`
                await fs.rename(file, rotated)
            }
        } catch {
            // File doesn't exist yet, that's fine
        }

        const line = JSON.stringify(record) + "\n"
        await fs.appendFile(file, line, "utf-8")
    }

    /**
     * Dequeue all records for a given category. Reads and deletes the queue files.
     */
    export async function dequeue(category: string): Promise<any[]> {
        const dir = queueDir()
        const files = await findQueueFiles(dir, category)
        const records: any[] = []

        for (const file of files) {
            try {
                const content = await fs.readFile(file, "utf-8")
                const lines = content.trim().split("\n").filter(Boolean)
                for (const line of lines) {
                    try {
                        records.push(JSON.parse(line))
                    } catch {
                        log.warn("invalid queue record", { file, line: line.substring(0, 100) })
                    }
                }
                await fs.unlink(file) // Delete after reading
            } catch (e) {
                log.error("failed to read queue file", { file, error: e })
            }
        }
        return records
    }

    /**
     * Re-enqueue records when upload fails (for retry).
     */
    export async function requeue(category: string, records: any[]): Promise<void> {
        for (const record of records) {
            await enqueue(category, record)
        }
    }

    /**
     * Get total pending record count across all categories.
     */
    export async function pendingCount(): Promise<number> {
        const dir = queueDir()
        let count = 0
        try {
            const entries = await fs.readdir(dir)
            for (const entry of entries) {
                if (!entry.endsWith(".jsonl")) continue
                const file = path.join(dir, entry)
                try {
                    const content = await fs.readFile(file, "utf-8")
                    count += content.trim().split("\n").filter(Boolean).length
                } catch {
                    // skip files we can't read
                }
            }
        } catch {
            // queue dir doesn't exist yet
        }
        return count
    }

    /**
     * Get pending record count for a specific category.
     */
    export async function pendingCount(category: string): Promise<number> {
        const dir = queueDir()
        const files = await findQueueFiles(dir, category)
        let count = 0

        for (const file of files) {
            try {
                const content = await fs.readFile(file, "utf-8")
                count += content.trim().split("\n").filter(Boolean).length
            } catch {
                // skip files we can't read
            }
        }
        return count
    }

    /**
     * Read all records for a given category without dequeuing.
     * Used for aggregation purposes where we need to see all pending data.
     */
    export async function readWithoutDequeue(category: string): Promise<any[]> {
        const dir = queueDir()
        const files = await findQueueFiles(dir, category)
        const records: any[] = []

        for (const file of files) {
            try {
                const content = await fs.readFile(file, "utf-8")
                const lines = content.trim().split("\n").filter(Boolean)
                for (const line of lines) {
                    try {
                        records.push(JSON.parse(line))
                    } catch {
                        log.warn("invalid queue record", { file, line: line.substring(0, 100) })
                    }
                }
            } catch (e) {
                log.error("failed to read queue file", { file, error: e })
            }
        }
        return records
    }

    /**
     * Clear all queue files.
     */
    export async function clear(): Promise<void> {
        const dir = queueDir()
        try {
            const entries = await fs.readdir(dir)
            for (const entry of entries) {
                if (entry.endsWith(".jsonl")) {
                    await fs.unlink(path.join(dir, entry))
                }
            }
        } catch {
            // dir doesn't exist
        }
    }

    async function findQueueFiles(dir: string, category: string): Promise<string[]> {
        try {
            const entries = await fs.readdir(dir)
            return entries
                .filter((f) => f.startsWith(`${category}.jsonl`))
                .map((f) => path.join(dir, f))
                .sort()
        } catch {
            return []
        }
    }
}