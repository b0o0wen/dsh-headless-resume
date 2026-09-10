# dsh-headless-resume

Give dsh headless `--resume` support — one-shot session continuation for non-interactive agent workflows.

给 dsh headless 加上 `--resume` 续聊能力，适用于 CI、MCP adapter、脚本等非交互场景。

## Problem

dsh 的 headless profile 是 one-shot：每次调用都创建新会话，没有 `--resume` 参数。tui profile 有 `--resume` 但为交互式 TUI，不适合非交互场景。

The dsh headless profile is one-shot: each invocation creates a new session with no `--resume` flag. The tui profile has `--resume` but is an interactive TUI, unsuitable for CI, scripts, or MCP adapters.

## Solution

This package is a drop-in replacement for `@deepseek-ai/dsh-headless` that adds:

- `--resume <uuid>` — load a persisted session and continue the conversation
- Session UUID printed to stderr as `dsh: session: <uuid>` after completion — for the next resume

Under the hood it calls dsh's internal `agents.resume({ resumeSessionId })` API (source-verified at `dsh-agent-loop/lib/index.js:1876`), the same code path as tui's resume mechanism.

## Install

```bash
# 1. Create a headless-resume profile (one-time)
dsh --profile headless-resume --from-default-profile headless

# 2. Install this plugin
dsh plugin --profile headless-resume add @b0o0wen/dsh-headless-resume
# or from source:
dsh plugin --profile headless-resume add github:b0o0wen/dsh-headless-resume
```

## Usage

```bash
# New session (same as original headless)
dsh --profile headless-resume "analyze this design"
# stderr: dsh: session: 40248dc0-321b-4ae5-872b-9e841dea2857

# Resume (new capability!)
dsh --profile headless-resume --resume 40248dc0-321b-4ae5-872b-9e841dea2857 "I fixed the issue you flagged, please re-review"
```

## PolyReview integration

After installing this plugin, configure PolyReview's dsh reviewer in `reviewers.toml`:

```toml
[[reviewer]]
name = "dsh"
new_cmd = ["dsh", "--profile", "headless-resume", "{prompt}"]
resume_cmd = ["dsh", "--profile", "headless-resume", "--resume", "{session}", "{prompt}"]
session_regex = 'dsh: session:\s*([0-9a-f-]{36})'
```

## Notes

- Requires dsh ≥ 0.1.5-rc.1 (where `agents.resume()` API is stable)
- The `headless-resume` profile auto-initializes on first use
- Sessions persist at `~/.dsh/sessions/<workspace>/<uuid>/` — same storage as tui, fully interoperable

## License

MIT
