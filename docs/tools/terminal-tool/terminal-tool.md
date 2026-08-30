# Workspace Terminal Tool (`functions.run_in_terminal`)

The workspace terminal tool lets you execute shell commands like inside your VS Code: workspace in a persistent terminal session (macOS default shell is typically `zsh`). It remembers the working directory and environment across calls (when not running in background).

---

## Tool Description (Behavior)

- Runs a shell command in a persistent terminal
- Supports chaining (`&&`), pipes (`|`), env vars, etc.
- Can run **foreground** (waits for completion) or **background** (returns immediately with a terminal ID)
- If background, you can later fetch output via `functions.get_terminal_output` or wait via `functions.await_terminal`, and stop it via `functions.kill_terminal`

---

## Input Parameters

`functions.run_in_terminal` takes a JSON object with these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | ✅ | The exact shell command to execute |
| `explanation` | string | ✅ | A one-sentence description of what the command does (shown to you before running) |
| `goal` | string | ✅ | Short description of the purpose (e.g., "Install dependencies", "Run tests") |
| `isBackground` | boolean | ✅ | `false`: run in the shared foreground terminal and wait for completion<br>`true`: start a new background terminal process and return immediately |
| `timeout` | number | ✅ | Timeout in milliseconds (`0` means "no timeout") |

### Example Input (Foreground)

```json
{
  "command": "npm test",
  "explanation": "Runs the test suite",
  "goal": "Verify changes",
  "isBackground": false,
  "timeout": 0
}
```

### Example Input (Background)

```json
{
  "command": "npm run dev",
  "explanation": "Starts the Vite dev server",
  "goal": "Local development",
  "isBackground": true,
  "timeout": 0
}
```

---

## Output Parameters

The tool returns a structured result containing:

### For Foreground Runs

- `stdout` / combined terminal output (string)
- `exitCode` (number; `0` usually means success)
- Sometimes timing / metadata depending on the environment

### For Background Runs

- `id` (string) — the terminal/process identifier you use with other terminal tools
- Plus any initial output available immediately

### Related Tools and Their Outputs

| Tool | Description |
|------|-------------|
| `functions.get_terminal_output({ id })` | Returns output collected so far (and sometimes status) |
| `functions.await_terminal({ id, timeout })` | Waits until completion or timeout; returns output + exit code when done |
| `functions.kill_terminal({ id })` | Stops the background process; returns confirmation |

---

## How to Use It (Common Patterns)

### 1) Run a One-off Command (Foreground)

Use when you want the result immediately.

```bash
# (conceptually) run_in_terminal: isBackground=false
npm -v
```

### 2) Long-running Server (Background)

Use when starting something like `npm run dev`. Then poll output:

```bash
# start
npm run dev

# later check logs
(get_terminal_output with returned id)
```

### 3) Use Bash Specifically (on macOS)

The terminal is `zsh` by default, but you can force Bash like:

```bash
bash -lc 'echo $0 && pwd && ls'
```

- `-l` makes it a login shell (more consistent PATH)
- `-c` runs the command string

### 4) Set Env Vars for a Single Command

```bash
NODE_ENV=production npm run build
```

### 5) Change Directories

The tool's foreground session remembers `cd` across subsequent foreground calls.

```bash
cd server && npm install && npm test
```

---

## Quick Notes / Gotchas

- If you set `timeout` too low, you may get truncated output; use `timeout: 0` for installs/builds unless you're sure
- Background jobs don't block; you must use the returned `id` to inspect/stop them
- Avoid commands that prompt for interactive input; if needed, pass flags like `-y`, `--yes`, etc.