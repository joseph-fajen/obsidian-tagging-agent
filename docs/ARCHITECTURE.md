# Architecture: Obsidian Vault Tagging Agent

This document explains the architectural decisions, patterns, and lessons learned in building this autonomous tagging agent. It's intended both as technical documentation and as a portfolio piece demonstrating thoughtful software engineering.

## System Overview

The Obsidian Vault Tagging Agent migrates notes from inconsistent tagging (mixed inline `#tags` and YAML frontmatter, flat naming, noise from imports) to a clean hierarchical scheme with prefixes like `status/`, `type/`, `area/`, `project/`.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Tagging Agent (CLI)                          │
│  Built with Claude Agent SDK + Bun                              │
├─────────────────────────────────────────────────────────────────┤
│  Phases: audit → plan → generate-worklist → execute → verify    │
├─────────────────────────────────────────────────────────────────┤
│                    MCP Tool Server                              │
│  vault-tools, tag-tools, git-tools, data-tools                  │
├─────────────────────────────────────────────────────────────────┤
│                 Obsidian Vault (filesystem)                     │
│  ~884 markdown notes, git-tracked                               │
└─────────────────────────────────────────────────────────────────┘
```

## Core Design Principles

### 1. Safety First

Every batch of changes is wrapped in git commits. The vault must be a git repository. This enables:
- Instant rollback with `git revert`
- Clear audit trail of what changed when
- Confidence to run the agent on production vaults

### 2. Human-in-the-Loop

The agent produces plans and reports for review before executing destructive changes:
- Audit report shows what exists
- Migration plan shows what will change
- User approves before execution begins

### 3. Phased Execution with Budget Control

Each phase is a separate CLI invocation with its own budget cap:
```bash
bun run tagging-agent.ts audit      # ~$0.30-0.50
bun run tagging-agent.ts plan       # ~$0.15-0.25
bun run tagging-agent.ts generate-worklist  # $0.00 (no LLM)
bun run tagging-agent.ts execute    # ~$0.06/batch
bun run tagging-agent.ts verify     # ~$0.30-0.50
```

### 4. Vault-Native Artifacts

All reports are written as markdown notes in the vault (prefixed with `_`), so users can review them in their normal Obsidian workflow.

---

## The Supervisor/Worker Pattern

### The Problem

Early versions used the LLM to process each note individually:
```
for each note:
  LLM reads note → LLM decides changes → LLM applies changes
```

This was:
- **Expensive**: ~$1.50 per batch of 50 notes
- **Unpredictable**: LLM might skip notes or apply different logic
- **Slow**: Sequential API calls with thinking time

### The Solution

Separate "thinking" from "doing":

| Component | Responsibility |
|-----------|---------------|
| **LLM (Supervisor)** | Conversation, intent parsing, scope selection, exception handling |
| **Code (Worker)** | Batch execution, progress tracking, git commits |

The worklist is generated deterministically by code:
```
Code reads all notes → Code looks up each tag in mapping table → Code writes worklist JSON
```

Then execution is also code-driven:
```
Code reads worklist → Code applies changes per-note → Code commits to git
```

The LLM only supervises: "Process this batch" → code does the work → LLM reports results.

### Results

| Metric | Before | After |
|--------|--------|-------|
| Cost per batch | ~$1.50 | **$0.06** |
| Behavior | Unpredictable | Deterministic |
| Progress tracking | Often wrong | Accurate |

---

## The Prompt Injection Lesson

### The Problem

Even with the Supervisor/Worker architecture, the execute phase LLM kept ignoring instructions. Despite explicit constraints:

```
⛔ STOP — READ THIS FIRST ⛔
The batch has ALREADY been computed. Do NOT search for notes.

PROHIBITED TOOLS:
- search_notes
- list_notes
- preview_changes
```

The agent still called `search_notes` to discover notes autonomously. It ignored the pre-computed `next-batch.json` file.

### The Insight

**Prompt engineering has limits.** When a model persistently ignores instructions, the solution is to **remove the opportunity for deviation** rather than add more constraints.

### The Solution: Data Injection

Instead of asking the LLM to read a file, inject the data directly into the prompt:

```typescript
userPrompt = `Execute this batch. Call execute_batch with EXACTLY these parameters:

\`\`\`json
{
  "entries": ${JSON.stringify(batchData.entries)},
  "batchNumber": ${batchData.batchNumber}
}
\`\`\`

DO NOT search for notes. Just call execute_batch with the JSON above.`;
```

Now the agent has no reason to search — the data is right there.

### Takeaway

When an LLM can choose between following instructions and doing something else, it might choose wrong. Design systems where the correct path is the only path.

---

## Phase Separation

Each phase has a single, clear responsibility:

| Phase | Input | Output | Responsibility |
|-------|-------|--------|---------------|
| **Audit** | Vault notes | `audit-data.json`, report | Discover what exists |
| **Plan** | Audit data, scheme note | Mapping table in markdown | Decide what changes |
| **Generate Worklist** | Plan markdown | `plan-mappings.json`, `migration-worklist.json` | Compute exact changes |
| **Execute** | Worklist | Modified notes, git commits | Apply changes |
| **Verify** | Vault notes | Verification report | Confirm compliance |

### Why Separate Generate-Worklist?

The plan phase produces a human-readable mapping table in markdown. But we need machine-readable JSON for execution.

Options considered:
1. **LLM writes JSON** — Unreliable; LLM might format it wrong or skip it
2. **Code parses markdown** — Deterministic; code extracts table → writes JSON

We chose option 2. The `generate-worklist` phase:
1. Parses the mapping table from `_Tag Migration Plan.md`
2. Writes `plan-mappings.json`
3. Generates `migration-worklist.json` with per-note changes

This is instant ($0.00) and deterministic.

### The Code-Driven Extraction Pattern

When the plan phase LLM wasn't reliably writing `plan-mappings.json` despite explicit instructions, we applied the same lesson from execute phase: **if it must happen reliably, do it in code**.

The `lib/plan-extractor.ts` module:
- Reads `_Tag Migration Plan.md`
- Parses the markdown mapping table with regex
- Writes `plan-mappings.json` deterministically

This ensures the JSON always gets written, even if the LLM forgets to do it.

---

## Cost Optimization

### Phase-Specific Models

Different phases have different complexity needs:

| Phase | Default Model | Reasoning |
|-------|---------------|-----------|
| Audit | Sonnet | Needs to classify many tags intelligently |
| Plan | Sonnet | Needs to make mapping decisions |
| Execute | Haiku | Just calling `execute_batch` once |
| Verify | Sonnet | Needs to identify violations |

Configure via environment variables:
```bash
EXECUTE_MODEL="claude-haiku-4-5-20251001"
```

### Batch Processing

Execute phase processes notes in batches (default 50). Each batch:
- Creates a pre-batch commit
- Applies all changes
- Creates a post-batch commit

This limits blast radius and enables granular rollback.

---

## MCP Tool Boundary

All vault access goes through MCP tools defined in `tools/`:

| Tool | Purpose |
|------|---------|
| `list_notes` | Enumerate vault contents |
| `read_note` | Read note with parsed frontmatter |
| `write_note` | Write reports and artifacts |
| `apply_tag_changes` | Atomic per-note tag migration |
| `execute_batch` | Batch execution with progress tracking |
| `git_commit` | Create checkpoint commits |

**Why MCP tools?**
- Structured interface between LLM and filesystem
- Audit boundary — all writes go through known tools
- Predictable behavior with Zod-validated inputs

**Pragmatic compromise:** Due to SDK limitations, the agent can also use built-in tools (Read, Bash) for reads. All *writes* must go through MCP tools — that's the audit boundary.

---

## Key Files

| File | Purpose |
|------|---------|
| `tagging-agent.ts` | Entry point, system prompts, agent runner |
| `tag-scheme.ts` | Universal noise patterns, `lookupTagMapping()` |
| `lib/worklist-generator.ts` | Deterministic worklist generation |
| `lib/plan-extractor.ts` | Code-driven extraction of mappings from markdown |
| `lib/batch-executor.ts` | Code-driven batch execution |
| `lib/types.ts` | Shared types: `WorkScope`, `BatchResult`, `MigrationProgress` |

---

## Lessons Learned

1. **LLMs are unreliable executors** — Use them for reasoning, not for deterministic tasks
2. **Prompt engineering has limits** — When instructions fail, change the architecture
3. **Code > prompts for reliability** — If it must happen every time, do it in code
4. **Phase separation enables debugging** — Each phase has clear inputs/outputs to inspect
5. **Git is your safety net** — Commit early, commit often, make rollback trivial
6. **Cost awareness matters** — Phase-specific models and batch processing control spend

---

## Future Considerations

- **Multi-vault support** — Namespace data files by vault hash
- **Schema validation** — Parse and validate user's scheme note before starting
- **Incremental audits** — Only scan notes modified since last audit
- **Tag health dashboard** — Periodic reports on tag usage trends
