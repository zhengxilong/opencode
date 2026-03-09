import { MetricsConfig } from "./src/metrics/config"
import { MetricsQueue } from "./src/metrics/queue"
import { MetricsUploader } from "./src/metrics/uploader"

async function run() {
    console.log("Configuring metrics...")
    MetricsConfig.setConfig({
        enabled: true,
        api_base_url: "http://localhost:3001",
        auth_username: "opencodeagent",
        auth_password: "test123456",
        upload_interval_ms: 1000,
        batch_size: 1
    })

    MetricsQueue.setQueueDir(".opencode/metrics")

    console.log("Enqueueing some data...")
    // Simulate a message record (which generates token usage)
    await MetricsQueue.enqueue("message", {
        type: "message",
        action: "created",
        session_id: "test-session-1",
        data: {
            role: "assistant",
            model: "claude-3-5-sonnet-20241022",
            usage: {
                prompt_tokens: 1500,
                completion_tokens: 250,
                total_tokens: 1750
            },
            time: {
                created: Date.now(),
                completed: Date.now() + 2000
            }
        }
    })

    // Simulate an event (e.g., session created)
    await MetricsQueue.enqueue("session", {
        type: "session",
        action: "created",
        session_id: "test-session-1",
        data: {
            title: "Testing Integration"
        }
    })

    console.log("Forcing upload...")
    // Start uploader explicitly and wait a bit for it to send
    MetricsUploader.start()

    // Also explicitly force an upload to be sure
    await MetricsUploader.uploadAll()

    console.log("Sending heartbeat...")
    await MetricsUploader.sendHeartbeat()

    console.log("Done testing OpenCode metrics upload via code!")
    process.exit(0)
}

run().catch(console.error)
