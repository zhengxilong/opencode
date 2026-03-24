# @opencode-ai/wechat

WeChat bridge for OpenCode.

## Features

1. QR login against WeChat ClawBot ilink API
2. Long-poll incoming messages
3. Route WeChat users into OpenCode sessions
4. Persist session bindings, sync cursor, approvals, dedupe cache
5. Support `#help`, `#status`, `#reset`, `#project list`, `#project use <name>`
6. Gate risky requests behind WeChat confirmation
7. Emit local metrics and optional management-platform reports

## Setup

1. Ensure `opencode` CLI is installed and available in `PATH`
2. Configure `wechat-channel.json` or environment variables
3. Set a default project directory and allowed projects

Example `wechat-channel.json`:

```json
{
  "wechat_channel": {
    "enabled": true,
    "default_project_dir": "/absolute/path/to/project",
    "allowed_projects": [
      "/absolute/path/to/project"
    ],
    "session_timeout_minutes": 120,
    "max_reply_length": 2000,
    "status_update_threshold_seconds": 10,
    "metrics_enabled": true,
    "management_api_base_url": "http://127.0.0.1:3001",
    "require_confirmation_for": [
      "git_push",
      "rm",
      "bulk_edit",
      "exec_dangerous_command"
    ]
  }
}
```

## Usage

```bash
bun dev
```

Available commands:

```bash
bun run src/index.ts start
bun run src/index.ts login
bun run src/index.ts status
bun run src/index.ts logout
```

## WeChat Commands

1. `#help`
2. `#status`
3. `#reset`
4. `#project list`
5. `#project use <name>`
6. `确认`
7. `取消`
