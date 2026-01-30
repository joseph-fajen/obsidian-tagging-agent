# Proactive Agent with Claude Agent SDK

A simple, scheduled AI agent that runs autonomously using the Claude Agent SDK and Bun runtime.

This example demonstrates how to build a **proactive agent** - an AI that works on your behalf on a schedule, without manual triggering.

## Prerequisites

- [Bun](https://bun.sh) (installed automatically with Claude Code, or `curl -fsSL https://bun.sh/install | bash`)
- Anthropic API key or Claude Code authentication
- Claude Code CLI installed (`curl -fsSL https://claude.ai/install.sh | bash`)

## Quick Start

```bash
# 1. Clone or copy this folder
cd claude-agent-sdk-proactive-agent

# 2. Install dependencies
bun install

# 3. Configure your research topic
cp .env.example .env
# Edit .env to set AGENT_TOPIC to what you want to research

# 4. Run the proactive agent to do research on your behalf
bun run agent.ts
```

> **Note:** To make this agent truly proactive, set it up as a scheduled job so it runs automatically without you calling it. See the [Scheduled Execution](#setting-up-scheduled-execution) section below.

## Setting Up Scheduled Execution

<details>
<summary><strong>Linux / macOS (Cron)</strong></summary>

1. Open terminal and edit crontab:
   ```bash
   crontab -e
   ```

2. Add a scheduled task (examples):
   ```bash
   # Run daily at 9:00 AM
   0 9 * * * cd /path/to/claude-agent-sdk-proactive-agent && /home/user/.bun/bin/bun run agent.ts >> /var/log/agent.log 2>&1

   # Run every 6 hours
   0 */6 * * * cd /path/to/claude-agent-sdk-proactive-agent && /home/user/.bun/bin/bun run agent.ts

   # Run every Monday at 8:00 AM
   0 8 * * 1 cd /path/to/claude-agent-sdk-proactive-agent && /home/user/.bun/bin/bun run agent.ts
   ```

3. Save and exit. Verify with:
   ```bash
   crontab -l
   ```

**Cron format:** `minute hour day month weekday command`
- `*` = every
- `*/N` = every N units
- `0 9 * * *` = 9:00 AM daily

</details>

<details>
<summary><strong>Windows (Task Scheduler - GUI)</strong></summary>

1. Open **Task Scheduler** (search in Start menu)

2. Click **Create Basic Task**

3. Name: `Proactive Research Agent`

4. Trigger: Choose your schedule
   - Daily, Weekly, or specific times

5. Action: **Start a program**
   - Program/script: `C:\Users\<username>\.bun\bin\bun.exe`
   - Add arguments: `run C:\path\to\claude-agent-sdk-proactive-agent\agent.ts`
   - Start in: `C:\path\to\claude-agent-sdk-proactive-agent`

6. Finish and optionally run immediately to test

**To view your task:** Click **Task Scheduler Library** in the left pane. Your task will appear in the list. Right-click to Run, Disable, or Delete it.

**To verify it's running:**
- The **Status** column shows "Running" while active
- Check **Last Run Time** and **Last Run Result** (0x0 = success)
- Look in your `reports/` folder for the generated output file

**To enable logging:** Edit your task's Action to capture output:
- Program/script: `powershell`
- Add arguments: `-Command "bun run agent.ts > agent.log 2>&1"`
- Start in: `C:\path\to\claude-agent-sdk-proactive-agent`

Then check `agent.log` in the project folder after running.

</details>

<details>
<summary><strong>Windows (Task Scheduler - PowerShell)</strong></summary>

```powershell
# Create the scheduled task
$action = New-ScheduledTaskAction `
    -Execute "C:\Users\$env:USERNAME\.bun\bin\bun.exe" `
    -Argument "run agent.ts" `
    -WorkingDirectory "C:\path\to\claude-agent-sdk-proactive-agent"

# Run daily at 9 AM
$trigger = New-ScheduledTaskTrigger -Daily -At 9am

# Register the task
Register-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -TaskName "ProactiveResearchAgent" `
    -Description "Daily AI research report generation"

# To remove later:
# Unregister-ScheduledTask -TaskName "ProactiveResearchAgent" -Confirm:$false
```

</details>

<details>
<summary><strong>Windows (Task Scheduler - schtasks.exe)</strong></summary>

```cmd
schtasks /create /tn "ProactiveResearchAgent" /tr "bun run C:\path\to\agent.ts" /sc daily /st 09:00 /f
```

</details>

## Configuration

### Environment Variables

Create a `.env` file:

```bash
# Optional: Anthropic API key, can use subscription if you signed into Claude Code on your machine
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Optional: Override defaults
AGENT_TOPIC="AI and machine learning trends"
OUTPUT_DIR="./reports"
MAX_BUDGET_USD=1.00
```

### Customizing the Agent

Edit `agent.ts` to change:
- The research topic or task
- Output format and location
- Tools available to the agent
- System prompt and behavior

## Feature Demonstrations

This project includes demo scripts for each major Claude Agent SDK feature. Perfect for workshops and learning.

### Run Individual Feature Demos

```bash
# Subagents - Spawn specialized child agents
bun run demo:subagents

# MCP Servers - Custom tools with Model Context Protocol
bun run demo:mcp

# Hooks - Lifecycle events (PreToolUse, PostToolUse, Stop)
bun run demo:hooks

# Sessions - Resume and fork conversations
bun run demo:sessions

# Permissions - Control agent autonomy levels
bun run demo:permissions

# Run all demos sequentially
bun run demo:all
```

### What Each Demo Shows

| Demo | Key Concepts | Duration |
|------|-------------|----------|
| **demo/subagents.ts** | Agent orchestration, model selection, isolated context | ~90s |
| **demo/mcp-servers.ts** | Custom tools with Zod schemas, streaming input mode | ~15s |
| **demo/hooks.ts** | PreToolUse/PostToolUse logging, hook-based blocking | ~15s |
| **demo/sessions.ts** | Session capture, resume, fork (3-phase workflow) | ~25s |
| **demo/permissions.ts** | bypassPermissions, acceptEdits, plan mode, blocking | ~180s |

### Other Scripts

```bash
# Run the main proactive research agent
bun run start
# Or with a custom topic:
bun run agent.ts "Your research topic here"

# Run the advanced agent with subagents + MCP + hooks
bun run advanced

# Run tests
bun run test
```

## How It Works

1. **Scheduled Trigger:** Cron/Task Scheduler runs `bun run agent.ts`
2. **Agent Initialization:** SDK connects to Claude with your configuration
3. **Autonomous Execution:** Claude researches the topic using web search
4. **Output Generation:** Results saved to markdown file with timestamp
5. **Clean Exit:** Process completes, ready for next scheduled run

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Scheduled Trigger                        │
│              (Cron / Windows Task Scheduler)                │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                     agent.ts                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  query({                                            │    │
│  │    prompt: "Research AI trends...",                 │    │
│  │    options: {                                       │    │
│  │      allowedTools: ["WebSearch", "WebFetch", ...],  │    │
│  │      permissionMode: "bypassPermissions",           │    │
│  │      maxBudgetUsd: 1.00                             │    │
│  │    }                                                │    │
│  │  })                                                 │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                Claude Agent SDK                             │
│  - Manages agent loop                                       │
│  - Executes tools autonomously                              │
│  - Handles context and memory                               │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   Output                                    │
│  reports/2026-01-28-research.md                             │
└─────────────────────────────────────────────────────────────┘
```

## Related Resources

- [Claude Agent SDK Docs](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
