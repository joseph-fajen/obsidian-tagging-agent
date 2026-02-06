# Changelog

This document captures significant changes, the concerns that motivated them, and the architectural reasoning. It complements git commit history by providing narrative context.

---

## 2026-02-05: Execute Phase Prompt Injection Fix

### Session Context

Despite implementing the Supervisor/Worker architecture and adding increasingly prescriptive execute phase instructions (WRONG vs RIGHT examples, PROHIBITED TOOLS list, "⛔ STOP — READ THIS FIRST ⛔"), the LLM agent persistently ignored the pre-computed `next-batch.json` file and used `search_notes` to discover its own notes.

### Problem Statement

The execute phase was experiencing:
1. **Agent autonomy override** — Model ignored explicit "DO NOT search" constraints
2. **Progress divergence** — Agent processed 278 different notes than what was in the worklist
3. **Cost overrun** — $0.24-$0.48 per batch instead of target ~$0.10

Root cause: The agent had the *option* to read `next-batch.json` or search for notes. It chose to search, even when told not to.

### Key Insight

**Prompt engineering has limits.** When a model persistently ignores instructions, the solution is to **remove the opportunity for deviation** rather than add more constraints. Inject the data directly instead of asking the model to fetch it.

### Solution Implemented

Modified `runLLMPhase()` in `lib/interactive-agent.ts` to include batch data directly in the user prompt:

```typescript
case "EXECUTE":
  if (batchData && batchData.entries.length > 0) {
    userPrompt = `Execute this batch of tag changes. Call execute_batch with EXACTLY these parameters:

\`\`\`json
{
  "entries": ${JSON.stringify(batchData.entries, null, 2)},
  "batchNumber": ${batchData.batchNumber}
}
\`\`\`

DO NOT search for notes. DO NOT read any files. Just call execute_batch with the JSON above.`;
  }
  break;
```

The agent now receives the exact `execute_batch` parameters in the prompt, eliminating the need (and ability) to search for notes.

### Files Changed

| File | Change |
|------|--------|
| `lib/interactive-agent.ts` | Modified `runLLMPhase()` to accept `batchData` parameter; inject batch JSON directly into EXECUTE prompt |
| `lib/agent-personality.ts` | Strengthened execute instructions with WRONG vs RIGHT examples, PROHIBITED TOOLS list |
| `tests/agent-personality.test.ts` | Updated tests for new instruction format |

### Results

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Tool calls per batch | 6-20+ | **1** | 95% reduction |
| Cost per batch | $0.24-$0.48 | **$0.06** | **75% cheaper** |
| Behavior | Autonomous discovery | **Deterministic** | Predictable |
| Progress tracking | Diverged from worklist | **Accurate** | Aligned |

### Commits

- `9ee4f01` fix: strengthen execute phase instructions to prevent autonomous discovery
- `3c2559d` fix: strengthen execute instructions with WRONG vs RIGHT examples
- `f165e87` fix: pass batch data directly in execute prompt to prevent autonomous discovery

---

## 2026-02-05: Audit Data Format Flexibility & Test Isolation Fixes

### Session Context

While running the interactive mode for the first time after implementing the Supervisor/Worker architecture, two bugs were discovered:
1. The plan phase failed because `audit-data.json` was in an unexpected format
2. Source code changes were being bundled into "Tag migration batch" commits during test runs

### Problem 1: Audit Data Format Mismatch

The interactive mode's `buildAuditInstructions()` didn't specify the exact JSON schema for `audit-data.json`, so the audit agent created its own rich format:

| Component | Expected | Agent Wrote |
|-----------|----------|-------------|
| Tag frequencies | `{ tagFrequencies: { "tag": count } }` | `{ frequencyAnalysis: { topTags: [...] } }` |
| Mappings | `{ mappings: { "old": "new" } }` | `{ consolidationOpportunities: { migrationMap: {...} } }` |

This caused `checkPlanPrerequisites()` to reject the audit output with "missing tagFrequencies" error.

### Problem 2: Test Git Pollution

The batch-executor tests used `tests/__batch_test_vault__` as the test directory — inside the project repo. When `executeBatch()` ran `git add -A`, it staged ALL changes in the entire repo (including source code), causing them to be committed with "Tag migration batch" messages.

This resulted in 19 messy commits that bundled unrelated source code changes.

### Solutions Implemented

**For Problem 1:**
- Made `checkPlanPrerequisites()` flexible to accept alternative formats (`tagInventory`, `completeTagList`, `frequencyAnalysis`)
- Made `loadAuditMappings()` extract mappings from `consolidationOpportunities` format
- Updated `buildAuditInstructions()` to specify exact JSON schema for future runs

**For Problem 2:**
- Changed test to use `mkdtemp()` for temp directories outside any git repo
- Added `tests/__*__/` to `.gitignore` as safety measure
- Interactive rebased to clean up the 19 messy commits into 2 proper commits

### Files Changed

| File | Change |
|------|--------|
| `tagging-agent.ts` | Added `extractTagCountFromAuditData()`, `hasUsableTagData()`, flexible `checkPlanPrerequisites()` |
| `lib/worklist-generator.ts` | Added `extractMappingsFromAuditData()`, flexible `loadAuditMappings()` |
| `lib/agent-personality.ts` | Updated `buildAuditInstructions()` with exact JSON schema |
| `tests/preflight.test.ts` | Added 4 tests for alternative format handling |
| `tests/worklist-generator.test.ts` | Added 3 tests for mapping extraction from alternative formats |
| `tests/batch-executor.test.ts` | Changed to use `mkdtemp()` for isolated temp directories |
| `.gitignore` | Added `tests/__*__/` pattern |

### Commits

- `1dcaf49` fix: accept alternative audit-data.json formats from interactive mode
- `4561457` fix: prevent batch-executor tests from polluting git history

---

## 2026-02-05: Plan Phase Optimization — Use Audit Data Instead of Re-scanning

### Session Context

After implementing the Supervisor/Worker architecture for execute phase, analysis revealed the plan phase was also inefficient — re-scanning all vault notes (100+ `read_note` calls) instead of using the `audit-data.json` file that the audit phase already created.

### Problem Statement

The `buildPlanSystemPrompt()` function:
1. Listed `list_notes`, `read_note`, `search_notes` as available tools (implying they should be used)
2. Never mentioned `read_data_file` or `audit-data.json`
3. Only told the agent to read the markdown report, not the structured JSON data
4. Had no constraint preventing re-scanning notes

As a result, the LLM agent made 100+ unnecessary tool calls to gather data that already existed, costing ~$0.85 and taking ~60 seconds instead of ~$0.15-0.25 and ~15 seconds.

### Solution Implemented

1. **Updated `buildPlanSystemPrompt()`** to prioritize `read_data_file` for `audit-data.json`
2. **Added "Critical Constraint"** section explicitly forbidding re-scanning notes
3. **De-prioritized tools** — `list_notes` and `search_notes` marked as "not needed"
4. **Created `checkPlanPrerequisites()`** pre-flight function to validate audit outputs exist
5. **Integrated pre-flight** in both CLI and interactive modes

### Files Changed

| File | Change |
|------|--------|
| `tagging-agent.ts` | Updated `buildPlanSystemPrompt()`, added `checkPlanPrerequisites()`, CLI pre-flight |
| `lib/interactive-agent.ts` | Added pre-flight check before PLAN phase |
| `tests/preflight.test.ts` | Added 4 tests for `checkPlanPrerequisites` |
| `tests/agent-prompts.test.ts` | Added 6 tests for new prompt content |

### Tests Added

- `checkPlanPrerequisites > returns true when all audit outputs exist`
- `checkPlanPrerequisites > returns false when audit-data.json missing`
- `checkPlanPrerequisites > returns false when _Tag Audit Report.md missing`
- `checkPlanPrerequisites > returns false when audit-data.json missing tagFrequencies`
- `buildPlanSystemPrompt > prioritizes read_data_file for audit-data.json`
- `buildPlanSystemPrompt > contains Critical Constraint section forbidding re-scan`
- Plus 4 more prompt content tests

### Estimated Impact

| Metric | Before | After |
|--------|--------|-------|
| Plan phase tool calls | 100+ | ~5-10 |
| Plan phase cost | ~$0.85 | ~$0.15-0.25 |
| Plan phase duration | ~60s | ~15-20s |

### Commits

- `8f9e7e7` fix: optimize plan phase to use audit-data.json instead of re-scanning notes

---

## 2026-02-05: Supervisor/Worker Architecture Implementation

### Session Context

The interactive mode validation (2026-02-04) revealed that Opus 4.5 ignores the pre-computed batch file and does autonomous discovery instead. While work quality was high, costs were 10x target ($1.50 vs $0.15 per batch). This prompted a refactor to a Supervisor/Worker architecture.

### Problem Statement

The execute phase was LLM-driven per-note, causing:
1. 10x cost overrun ($1.50 vs $0.15 per batch)
2. Progress counter stuck (agent writes progress in different format)
3. Batch number always shows "1" (processedCount stays at 0)
4. Unpredictable execution (LLM "thinks it knows better")

### Solution Implemented

Implemented Path C from the supervisor-worker architecture design:
- **LLM (Supervisor)** handles: conversation, intent parsing, scope selection, exception handling
- **Code (Worker)** handles: deterministic execution, progress tracking, git commits

#### Stage 1: Foundation — Types and Scope Filtering
- Created `lib/types.ts` with shared types: `WorkScope`, `NotePreview`, `PreviewResult`, `BatchResult`, `MigrationProgress`
- Created `lib/scope-filter.ts` with `scopeToNotes()` for filtering by: full vault, folder, files, recent, tag
- Updated `lib/worklist-generator.ts` to accept optional `scope` parameter

#### Stage 2: Preview Mode
- Created `lib/preview-generator.ts` with `generatePreview()` and `formatPreviewForDisplay()`
- Added `preview_changes` MCP tool to show what will change without applying

#### Stage 3: Code-Driven Execution
- Created `lib/batch-executor.ts` with `executeBatch()`, `getProgress()`, `clearProgress()`
- Added `execute_batch` MCP tool for deterministic batch processing
- Added `get_progress` MCP tool for accurate progress tracking

#### Stage 4: Model Optimization
- Added `ModelsByPhase` type to `lib/config.ts`
- Updated `lib/interactive-agent.ts` to use phase-specific models (Haiku for execute)
- Updated `.env.example` with phase-specific model configuration

### Files Changed

| File | Change |
|------|--------|
| `lib/types.ts` | Created — shared types for Supervisor/Worker |
| `lib/scope-filter.ts` | Created — scope filtering logic |
| `lib/preview-generator.ts` | Created — preview generation |
| `lib/batch-executor.ts` | Created — code-driven batch execution |
| `tools/tag-tools.ts` | Added 3 new tools: preview_changes, execute_batch, get_progress |
| `lib/config.ts` | Added ModelsByPhase for phase-specific models |
| `lib/session-state.ts` | Added selectedScope field |
| `lib/agent-personality.ts` | Updated execute instructions and added scope selection |
| `lib/interactive-agent.ts` | Added phase-specific model selection |
| `lib/worklist-generator.ts` | Added scope parameter |
| `tagging-agent.ts` | Updated tool registration |
| `.env.example` | Added phase-specific model vars |
| `tests/scope-filter.test.ts` | Created — 26 tests |
| `tests/batch-executor.test.ts` | Created — 26 tests |
| `tests/agent-personality.test.ts` | Updated for new instructions |
| `tests/agent-prompts.test.ts` | Updated mock config |
| `tests/tools-smoke.test.ts` | Updated tool count |

### Tests Added

- 26 tests for scope filtering (all scope types, edge cases)
- 26 tests for batch execution (success, failures, progress tracking)
- Updated existing tests for new Config shape

### Estimated Impact

| Metric | Before | After |
|--------|--------|-------|
| Cost per batch | ~$1.50 | ~$0.15 |
| Progress tracking | Broken | Accurate |
| Execution | Unpredictable | Deterministic |
| Resume capability | Partial | Full |

### Commits

- `a2d3a0c` feat: implement supervisor/worker architecture for execute phase

---

## 2026-02-04: Interactive Agent Experience

### Session Context

Users requested a more "agentic" experience instead of manually running 5 separate CLI commands in the correct order. The goal was to transform the CLI tool into a conversational agent that guides users through the entire migration workflow.

### Problem Statement

The current agent requires users to:
1. Manually invoke 5 separate CLI commands in the correct order
2. Know when to run each command and what to review between them
3. Lose conversational context between invocations
4. Remember where they left off if they exit mid-migration

This creates a "CLI tool experience" rather than an "agentic experience."

### Solution Implemented

Implemented an interactive REPL loop with:
1. **State machine** controlling conversation flow through phases
2. **Session persistence** via disk-based state file (`data/interactive-session.json`)
3. **User input handling** via `readline/promises` for prompts between agent turns
4. **Hybrid prompt architecture**: stable personality + dynamic phase instructions
5. **Graceful interrupts**: Ctrl+C saves state before exit

**New files:**
- `lib/session-state.ts` — Session state types and persistence
- `lib/agent-personality.ts` — Base personality and phase instructions
- `lib/interactive-agent.ts` — Main interactive loop and state machine

**Key features:**
- Run `bun run tagging-agent.ts` (no args) to launch interactive mode
- Agent introduces itself and guides through all phases
- User can exit at any checkpoint and resume later
- All existing CLI modes still work with explicit mode argument

### Files Changed

| File | Change |
|------|--------|
| `lib/session-state.ts` | Created — state types and persistence |
| `lib/agent-personality.ts` | Created — personality and phase instructions |
| `lib/interactive-agent.ts` | Created — interactive loop with state machine |
| `lib/config.ts` | Added `interactive` mode and `sessionStatePath` |
| `tagging-agent.ts` | Added interactive mode entry point |
| `tests/session-state.test.ts` | Created — 13 tests for state persistence |
| `tests/agent-personality.test.ts` | Created — 38 tests for prompts |
| `tests/interactive-agent.test.ts` | Created — 18 tests for state transitions |
| `tests/config.test.ts` | Created — 12 tests for config |
| `README.md` | Documented interactive mode usage |
| `PROJECT_STATUS.md` | Updated implementation status |
| `.agents/plans/interactive-agent-experience.md` | Marked IMPLEMENTED |

### Tests Added

- 13 tests for session state (create, save, load, clear, round-trip)
- 38 tests for personality and instruction builders
- 18 tests for state machine transitions
- 12 tests for config with interactive mode

### Commits

- `<pending>` feat: implement interactive agent experience

---

## 2026-02-04: Move JSON Data Files to Project Directory

### Session Context

After implementing deterministic batch extraction, large JSON files in the Obsidian vault were causing the app to crash on launch. The files (`_Migration_Worklist.json`, `_Migration_Progress.json`, `_Tag Audit Data.json`) were being indexed by Obsidian, overloading it with machine data meant for the agent.

### Problem Statement

The vault should contain human knowledge, not machine data. Large JSON files (~25KB+) cause:
1. Obsidian to crash or hang during indexing
2. Clutter in the vault file browser
3. Confusion between agent artifacts and user notes

### Solution Implemented

Created a dedicated `data/` directory in the project root for all machine-readable JSON files:

| Old Location (vault) | New Location (data/) |
|---------------------|---------------------|
| `_Migration_Worklist.json` | `migration-worklist.json` |
| `_Next_Batch.json` | `next-batch.json` |
| `_Migration_Progress.json` | `migration-progress.json` |
| `_Tag Audit Data.json` | `audit-data.json` |

**New MCP tools:**
- `read_data_file` — Read JSON from data/ directory
- `write_data_file` — Write JSON to data/ directory

**Key changes:**
- `lib/config.ts` — Added `dataPath` to Config interface
- `tools/data-tools.ts` — New MCP tools for data/ access
- `tagging-agent.ts` — Updated prompts, pre-flight, MCP registration
- `lib/worklist-generator.ts` — Updated to write to data/

**Backward compatibility:** Pre-flight functions check data/ first, then fall back to vault for old installations.

### Files Changed

| File | Change |
|------|--------|
| `tools/data-tools.ts` | Created — new MCP tools |
| `lib/config.ts` | Added `dataPath` to Config |
| `lib/worklist-generator.ts` | Updated function signatures, removed embedded JSON |
| `tagging-agent.ts` | Updated prompts, pre-flight, MCP registration |
| `tests/data-tools.test.ts` | Created — tests for new tools |
| `tests/agent-prompts.test.ts` | Updated for new filenames |
| `tests/worklist-generator.test.ts` | Updated for new function signatures |
| `tests/preflight.test.ts` | Updated for new paths |
| `.gitignore` | Added `data/` |
| `README.md` | Documented data directory |

### Tests Added

- `createDataTools > returns 2 tools`
- `createDataTools > tools have correct names`
- `validateFilename - indirect testing via file operations`
- `integration with MCP server > data tools can be combined with vault tools`
- Updated 23 existing tests for new function signatures

### Commits

- `8dc57f2` feat: move JSON data files from vault to project data/ directory

---

## 2026-02-04: Deterministic Batch Extraction

### Session Context

Execute mode was spending 15-40 tool calls and 30-90 seconds at the start of each batch trying to extract and parse the worklist JSON from the large `_Tag Migration Plan.md` file. This was inefficient, costly, and error-prone.

### Problem Statement

The execute agent wasted significant time, tokens, and money:
- Reading large `_Tag Migration Plan.md` file (often failed, retried with different strategies)
- Trying to extract JSON from markdown code block (Grep, Bash with jq, Read chunks)
- Computing which entries were unprocessed
- Taking 15-40 tool calls before actual tag processing began

### Solution Implemented

Moved the "figure out what to process" logic from the LLM to TypeScript code:

1. **New file: `_Migration_Worklist.json`** — `generate-worklist` now writes a separate pure JSON file alongside the markdown plan
2. **New file: `_Next_Batch.json`** — Pre-flight check computes next batch and writes it before agent starts
3. **Simplified execute prompt** — From ~150 lines to ~50 lines; agent reads `_Next_Batch.json` directly (1 tool call instead of 15-40)
4. **Backward compatibility** — Falls back to markdown if JSON file missing

### Files Changed

| File | Change |
|------|--------|
| `lib/worklist-generator.ts` | Added `NextBatch` interface, `writeWorklistJson()` function |
| `tagging-agent.ts` | Added `loadWorklistJson()`, `writeNextBatch()`, `deleteNextBatch()` helpers; rewrote `checkExecutePrerequisites()` to compute batches; simplified `buildExecuteSystemPrompt()` |
| `tests/worklist-generator.test.ts` | Added 3 tests for `writeWorklistJson()` |
| `tests/preflight.test.ts` | New file with 5 integration tests |
| `tests/agent-prompts.test.ts` | Updated execute prompt tests for new simplified prompt |

### Tests Added

- `writeWorklistJson > writes valid JSON file`
- `writeWorklistJson > JSON file contains all required fields`
- `writeWorklistJson > worklist entries have correct structure`
- `checkExecutePrerequisites > worklist file structure is correct`
- `checkExecutePrerequisites > worklist entries have correct NoteChanges structure`
- `checkExecutePrerequisites > MigrationWorklist has all required fields`
- `NextBatch structure > NextBatch interface shape is correct`
- `NextBatch structure > NextBatch entries match NoteChanges structure`

### Estimated Impact

| Metric | Before | After |
|--------|--------|-------|
| Tool calls to find batch | 15-40 | 1 |
| Time to start processing | 30-90s | <5s |
| Token cost per batch | ~$0.10-0.20 | ~$0.01 |
| System prompt size | ~150 lines | ~50 lines |

### Commits

- `1580dcb` feat: implement deterministic batch extraction for execute mode

---

## 2026-02-03: Fix Inline Tag Migration in Worklist Generator

### Session Context

Post-migration verification revealed 86.8% compliance with ~83 notes still containing inline tags. Investigation found the worklist generator only captured 129 notes despite 627 having tags.

### Root Cause

The worklist generator skipped tags with `action: "keep"` (valid format) entirely, not accounting for tag **location**. Inline tags with valid format (e.g., `#ai-tools`, `#blockchain`) were never added to the worklist for migration to frontmatter.

**Bug location:** `lib/worklist-generator.ts` lines 138-140

### Solution Implemented

1. **Preserve location info** — Check if tag exists inline before skipping
2. **Generate changes for inline tags** — Even when format is valid, create `{ oldTag, newTag: oldTag, reason: "inline-migration" }`
3. **Track inline migrations** — Added `inlineMigrations` stat for reporting
4. **Verbose output** — Added console section showing inline migration count

### Files Changed

| File | Change |
|------|--------|
| `lib/worklist-generator.ts` | Added `reason` field to `TagChange`, inline tag detection, `inlineMigrations` stat |
| `tagging-agent.ts` | Added verbose output for inline migrations |
| `tests/worklist-generator.test.ts` | Added 4 test cases for inline tag scenarios |

### Tests Added

- `generates change for inline-only valid tag`
- `does NOT generate change for frontmatter-only valid tag`
- `generates change for tag in both locations (cleans up inline)`
- `tracks inline migrations separately from format changes`

### Commits

- `<hash>` fix: include inline tags in worklist even when format is valid

---

## 2026-02-03: Post-Verification Improvements

### Session Context

Following the successful tag migration (99.7% compliance, $1.97 total cost), the verification phase identified three improvement opportunities:

1. **Overly aggressive Templater skip** — ~280 daily notes were being skipped because they contained Templater cursor placeholders in the body, even though their frontmatter was valid YAML
2. **Missing tag prefixes** — The audit discovered additional hierarchical prefixes (`topic/`, `tool/`, `skill/`) that the validator didn't recognize
3. **Undocumented tool boundary** — The verify agent used Bash/Read despite the MCP-only design intent, revealing an SDK limitation

### Solutions Implemented

#### 1. Refined Templater Detection

**Problem:** The Templater skip logic checked the entire file for `<%` and `%>`, causing valid daily notes with cursor placeholders (e.g., `<% tp.file.cursor() %>`) in the body to be skipped.

**Solution:** Changed detection to only check the frontmatter region:
```typescript
const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
const frontmatterContent = frontmatterMatch?.[1] || "";
if (frontmatterContent.includes("<%") && frontmatterContent.includes("%>")) {
  // Skip only if Templater syntax is in frontmatter
}
```

**Result:** Only 7 actual template files are now skipped (down from ~280).

#### 2. Extended Tag Prefixes

**Problem:** Tags like `topic/ai`, `tool/obsidian`, `skill/writing` were flagged as invalid format.

**Solution:** Added `skill/`, `tool/`, `topic/` to `VALID_PREFIXES` in `lib/tag-parser.ts`:
```typescript
const VALID_PREFIXES = ["area/", "project/", "skill/", "status/", "tool/", "topic/", "type/"];
```

#### 3. Documented Tool Boundary Decision

**Problem:** The SDK's `allowedTools` restriction doesn't work with `permissionMode: bypassPermissions`, meaning agents can call Bash/Read even when not listed.

**Solution:** Documented this as an accepted architectural decision rather than a bug to fix:
- Updated `CLAUDE.md` with tool boundary note
- Updated `PRD.md` with SDK limitation reference
- Updated `PROJECT_STATUS.md` to move from "Open Issues" to "Documented Decisions"

**Rationale:** Enforcing via hooks adds complexity without clear benefit; all vault *writes* still go through auditable MCP tools.

### Files Changed

| File | Change |
|------|--------|
| `lib/worklist-generator.ts` | Refined Templater detection to frontmatter-only |
| `lib/tag-parser.ts` | Added `skill/`, `tool/`, `topic/` to VALID_PREFIXES |
| `tools/tag-tools.ts` | Same Templater refinement |
| `tests/worklist-generator.test.ts` | Added 2 tests for Templater handling |
| `CLAUDE.md` | Added tool boundary documentation |
| `PRD.md` | Added SDK limitation note |
| `PROJECT_STATUS.md` | Moved open issue to documented decisions |

### Tests Added

- `processes files with Templater in body but valid frontmatter`
- `skips files with Templater in frontmatter`

### Commits

- `e641424` feat: implement post-verification improvements and restructure project docs

---

## 2026-02-03: Error Recovery & Templater Fix

### Session Context

After running `audit` and `plan` modes successfully, the `generate-worklist` command crashed with a YAML parsing error. This revealed two issues:

1. **Immediate bug:** Templater template files contain nested quotes that break YAML parsing
2. **Architectural concern:** The agent behaves like a CLI that stops on errors rather than self-reflecting

### Concerns Raised

> "I have the perception that the Obsidian Vault Tagging Agent is behaving like a hybrid agent/CLI program... my vision for its behavior is to behave like an agent, so that if its tagging migration task does not get completed, it can self-reflect, evaluate, and propose a way forward instead of simply stopping and I'm sitting here looking at a terminal prompt instead of interacting with the custom agent."

> "I also want to assess if the way this repo is organized provides for a good enough way to track the current state of development in order to prevent Claude Code to unnecessarily re-read plans that have already been implemented."

### Solutions Implemented

#### 1. Templater File Handling

**Problem:** Files containing Templater syntax like `<% tp.date.now("YYYY-MM-DD-dddd") %>` have nested quotes that cause `gray-matter`'s YAML parser to throw.

**Solution:** Added detection in two locations:
- `lib/worklist-generator.ts` — Skip files containing Templater syntax during worklist generation
- `tools/tag-tools.ts` — Return error for template files in `apply_tag_changes`

**Trade-off:** Template files are skipped entirely rather than partially processed. This is acceptable because templates are meant to be expanded by Templater before use.

#### 2. Error Recovery Loop

**Problem:** On any error, the agent called `process.exit(1)` without analysis or recovery attempt.

**Solution:** Implemented `runWithRecovery()` wrapper in `tagging-agent.ts`:

```
Error occurs → Recovery agent analyzes → Recommends strategy → Act on recommendation
```

Recovery strategies:
- `retry` — Transient error, retry up to 3 times
- `skip` — One item failed, user should skip and continue
- `ask_user` — Need human judgment, presents a question
- `abort` — Fundamental error, cannot recover

**Design choice:** Used a lightweight LLM call (~$0.05) for error analysis rather than hardcoded error matching. This allows the recovery agent to handle novel errors intelligently.

**Alternative considered:** Making `generate-worklist` an MCP tool so the main agent LLM controls it. Rejected because `generate-worklist` is intentionally LLM-free (deterministic, zero cost).

#### 3. Project State Tracking

**Problem:** No clear document showing what's implemented vs. pending, causing potential confusion for Claude Code.

**Solution:** Created `PROJECT_STATUS.md` as a single source of truth for:
- Implementation status of all components
- Completed vs. pending plans
- Known issues and recent fixes
- Quick reference commands

**Design choice:** Separate from `CHANGELOG.md` because status is point-in-time (current state) while changelog is historical (evolution over time).

### Files Changed

| File | Change |
|------|--------|
| `lib/worklist-generator.ts` | Skip Templater files, add try/catch for YAML parsing |
| `tools/tag-tools.ts` | Skip Templater files in `apply_tag_changes` |
| `tagging-agent.ts` | Added recovery loop with LLM error analysis |
| `PROJECT_STATUS.md` | New file for development state tracking |
| `CHANGELOG.md` | New file for documenting changes with context |

### Results

- `generate-worklist` now completes successfully
- Templater files skipped with clear warnings
- Errors trigger self-reflection instead of immediate exit
- Project state is documented for future sessions

### Commits

- `876b729` feat: add error recovery loop and fix Templater YAML parsing

---

## 2026-01-31: Deterministic Worklist Generator

### Session Context

After the maiden voyage ($10.34 total cost, 18 execute batches), analysis revealed the LLM-generated worklist was truncated — the plan phase sampled ~15 notes instead of iterating all 620.

### Concern Raised

The fundamental issue: asking an LLM to do mechanical file iteration at scale is unreliable.

### Solution Implemented

Moved worklist generation from LLM to deterministic TypeScript code:

```
audit (LLM) → plan (LLM) → generate-worklist (CODE) → execute (LLM) → verify (LLM)
```

New `generate-worklist` mode:
- Pure TypeScript, no LLM call
- Reads every note via `fs.readdir`
- Looks up each tag in `TAG_MAPPINGS` + audit-discovered mappings
- Produces complete worklist JSON deterministically
- Cost: $0.00

### Files Created/Changed

- `lib/worklist-generator.ts` — New deterministic generator
- `tag-scheme.ts` — Added `TAG_MAPPINGS` and `lookupTagMapping()`
- `tagging-agent.ts` — Added `generate-worklist` mode
- `lib/config.ts` — Added new mode to `AgentMode` type

### Commits

- `f2a710b` feat: implement deterministic worklist generator to replace LLM-driven worklist
- `2795f10` docs: add deterministic worklist generator implementation plan

---

## 2026-01-31: Maiden Voyage Retrospective

### Session Context

First complete run of the tagging agent on the production vault (~884 notes).

### Results

- **Total cost:** $10.34
- **Duration:** ~45 minutes (18 execute batches)
- **Compliance:** 99.7% (3 violations found, all edge cases)
- **Notes processed:** 620 (260 had no tags to migrate)

### Issues Discovered

1. **Worklist truncation** — Plan phase only sampled ~15 notes instead of all 620
2. **Numeric tags not classified as noise** — Tags like `#1`, `#123` weren't removed
3. **Hash prefix in frontmatter** — Some tags had `#` prefix that wasn't stripped
4. **Case-sensitive tag removal** — `#Meeting-Notes` wasn't removed when searching for `meeting-notes`

### Commits

- `98c65f0` docs: add maiden voyage retrospective from first full vault migration

---

## 2026-01-31: Post-Maiden-Voyage Bug Fixes

### Session Context

Maiden voyage revealed three bugs that caused manual intervention.

### Solutions Implemented

1. Added `/^\d+$/` check to `isNoiseTag()` in `lib/tag-parser.ts`
2. Added `.replace(/^#/, "")` to `getFrontmatterTags()` in `lib/frontmatter.ts`
3. Changed regex flag from `"g"` to `"gi"` in `removeInlineTag()`
4. Normalized `extractInlineTags()` output to lowercase

### Commits

- `3ba8400` fix: post-maiden-voyage bug fixes, prompt upgrades, and test infrastructure
- `90edf32` docs: add post-maiden-voyage improvement plan and supporting analysis

---

## 2026-01-30: Phase 3 — Execute & Verify Modes

### Session Context

Implementation of the execution and verification phases to complete the agent lifecycle.

### Features Implemented

- **Execute mode:** Applies migration plan in batches with git commits
- **Verify mode:** Full-vault compliance scan with report generation
- **Progress tracking:** `_Migration_Progress.json` tracks processed notes across invocations
- **Worklist validation:** Checks for empty/truncated worklists before processing

### Commits

- `4480214` feat: implement phase 3 — execute & verify agent modes
- `f19d551` feat: add phase 3 execute & verify implementation plan

---

## 2026-01-30: Phase 2 — Audit & Plan Agent

### Session Context

Implementation of the core agent entry point with system prompts for audit and plan modes.

### Features Implemented

- **`tagging-agent.ts`:** Main entry point with mode-specific system prompts
- **`tag-scheme.ts`:** Tag scheme schemas and validation with Zod
- **Audit mode:** Catalogs all tags, frequencies, and classifications
- **Plan mode:** Generates migration plan with tag mapping table
- **Budget controls:** `maxBudgetUsd` per invocation

### Commits

- `2d98af2` feat: implement phase 2 — tag scheme module, system prompts, and agent entry point
- `daefa10` feat: add phase 2 audit & plan agent implementation plan

---

## 2026-01-29: Phase 1 — Foundation

### Session Context

Initial implementation of the core infrastructure: MCP tools and utility libraries.

### Features Implemented

#### MCP Tools (`tools/`)
- `list_notes` — Vault inventory with metadata
- `read_note` — Note reading with detail levels (minimal/standard/full)
- `search_notes` — Tag and text search
- `write_note` — Report/artifact writing
- `apply_tag_changes` — Atomic tag migration per note
- `git_commit` — Checkpoint commits

#### Libraries (`lib/`)
- `config.ts` — Environment variable loading
- `frontmatter.ts` — gray-matter wrapper for YAML parsing
- `tag-parser.ts` — Inline tag extraction, noise detection, validation

### Commits

- `25ae891` feat: implement phase 1 foundation — lib utilities, MCP tools, and unit tests
- `8cef1d7` feat: add phase 1 foundation plan and gray-matter dependency

---

## 2026-01-29: Project Setup

### Session Context

Initial project setup and documentation.

### Features Implemented

- **`PRD.md`:** Full requirements document with tool specifications
- **`CLAUDE.md`:** Project rules and conventions for Claude Code
- **`.env.example`:** Environment variable reference
- Reorganized from workshop template to tagging agent structure

### Commits

- `af6a406` docs: add CLAUDE.md and align PRD tool specs with adding_tools_guide
- `2ae3ff4` feat: add PRD and reorganize project for Obsidian tagging agent
- `9aba0ef` Initial commit from dynamous-community/workshops

---

## Reference Documents

### Implementation Plans (`.agents/plans/`)
- `phase-1-foundation.md` — MCP tools and libraries
- `phase-2-audit-plan-agent.md` — Agent entry point and prompts
- `phase-3-execute-verify.md` — Execution and verification
- `deterministic-worklist-generator.md` — Code-based worklist
- `post-maiden-voyage-improvements.md` — Bug fixes
- `post-verification-improvements.md` — Templater and prefix fixes

### Retrospectives (`.agents/retrospectives/`)
- `maiden-voyage-2026-01-31.md` — First full run analysis
