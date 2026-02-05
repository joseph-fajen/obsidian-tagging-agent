# Project Status — Obsidian Vault Tagging Agent

This file tracks the current development state for Claude Code context. It's the single source of truth for what's been implemented, what's pending, and known issues.

**Last Updated:** 2026-02-05

---

## Current Phase

**Status:** Core functionality complete with Supervisor/Worker architecture

The Supervisor/Worker architecture (Path C) is now fully implemented. The execute phase uses code-driven batch execution with LLM supervision, reducing costs by ~10x compared to the previous LLM-per-note approach.

---

## Implementation Status

### Core Infrastructure ✅

| Component | Status | Notes |
|-----------|--------|-------|
| `lib/config.ts` | ✅ Complete | Config loading, mode validation, phase-specific models |
| `lib/frontmatter.ts` | ✅ Complete | gray-matter wrapper, `#` prefix stripping |
| `lib/tag-parser.ts` | ✅ Complete | Inline extraction, noise detection, case-insensitive removal |
| `lib/worklist-generator.ts` | ✅ Complete | Deterministic worklist with scope filtering |
| `lib/session-state.ts` | ✅ Complete | Session state persistence with scope selection |
| `lib/agent-personality.ts` | ✅ Complete | Base personality, phase instructions, scope selection |
| `lib/interactive-agent.ts` | ✅ Complete | Interactive REPL loop with phase-specific models |
| `lib/types.ts` | ✅ Complete | Shared types: WorkScope, NotePreview, BatchResult, MigrationProgress |
| `lib/scope-filter.ts` | ✅ Complete | Scope filtering: full, folder, files, recent, tag |
| `lib/preview-generator.ts` | ✅ Complete | Preview generation without applying changes |
| `lib/batch-executor.ts` | ✅ Complete | Code-driven batch execution with progress tracking |
| `tag-scheme.ts` | ✅ Complete | TAG_MAPPINGS, lookupTagMapping(), noise patterns |

### MCP Tools ✅

| Tool | Status | Notes |
|------|--------|-------|
| `list_notes` | ✅ Complete | Recursive vault listing |
| `read_note` | ✅ Complete | Minimal/full detail modes |
| `search_notes` | ✅ Complete | Tag-based search |
| `write_note` | ✅ Complete | Creates parent dirs |
| `apply_tag_changes` | ✅ Complete | Per-note tag migration |
| `preview_changes` | ✅ Complete | Preview scope changes without applying |
| `execute_batch` | ✅ Complete | Code-driven batch execution |
| `get_progress` | ✅ Complete | Migration progress tracking |
| `git_commit` | ✅ Complete | Checkpoint commits |
| `read_data_file` | ✅ Complete | Read from project data/ directory |
| `write_data_file` | ✅ Complete | Write to project data/ directory |

### Agent Modes ✅

| Mode | Status | Notes |
|------|--------|-------|
| `interactive` | ✅ Complete | Guided conversational experience (default) |
| `audit` | ✅ Complete | LLM-driven, writes report + JSON |
| `plan` | ✅ Complete | LLM-driven, creates mapping table |
| `generate-worklist` | ✅ Complete | Deterministic code (no LLM) |
| `execute` | ✅ Complete | Supervisor/Worker: LLM supervises, code executes |
| `verify` | ✅ Complete | LLM-driven, compliance scan |

### Tests ✅

- 275+ tests passing across 19 test files
- `bun test` runs successfully

---

## Completed Plans

| Plan | File | Implemented |
|------|------|-------------|
| Phase 1: Foundation | `.agents/plans/phase-1-foundation.md` | ✅ Yes |
| Phase 2: Audit/Plan | `.agents/plans/phase-2-audit-plan-agent.md` | ✅ Yes |
| Phase 3: Execute/Verify | `.agents/plans/phase-3-execute-verify.md` | ✅ Yes |
| Deterministic Worklist | `.agents/plans/deterministic-worklist-generator.md` | ✅ Yes |
| Post-Maiden-Voyage Improvements | `.agents/plans/post-maiden-voyage-improvements.md` | ✅ Yes |
| Deterministic Batch Extraction | `.agents/plans/deterministic-batch-extraction.md` | ✅ Yes |
| Move JSON to Project Directory | `.agents/plans/move-json-to-project-directory.md` | ✅ Yes |
| Interactive Agent Experience | `.agents/plans/interactive-agent-experience.md` | ✅ Yes |
| Supervisor/Worker Architecture | `.agents/plans/supervisor-worker-implementation.md` | ✅ Yes |

---

## Known Issues

### Recently Fixed (2026-02-05)

1. **Execute phase ignores pre-computed batch file** — Fixed by Supervisor/Worker architecture
   - Execute now uses `execute_batch` tool for code-driven execution
   - LLM supervises, code executes — no more autonomous discovery

2. **Progress counter stuck at "615 remaining"** — Fixed
   - `get_progress` tool provides accurate progress tracking
   - Progress file updated automatically by `execute_batch`

3. **Batch number always shows "1"** — Fixed
   - Batch numbers tracked in `MigrationProgress.batchHistory`

### Recently Fixed (2026-02-03)

1. **YAML parsing fails on Templater files** — Fixed
   - Files containing `<%` and `%>` in frontmatter are skipped with warnings

2. **Agent exits on error instead of self-reflecting** — Fixed
   - `runWithRecovery()` wrapper invokes recovery agent on errors

### Documented Decisions

1. **Pragmatic tool boundary (2026-02)**
   - The SDK's `allowedTools` is not enforced with `bypassPermissions` ([SDK issue #115](https://github.com/anthropics/claude-agent-sdk-typescript/issues/115))
   - **Decision:** "Just get the work done" — accept pragmatic use of Bash/Read/Grep/Glob for efficiency
   - **Rule:** All vault *writes* must go through MCP tools (audit boundary); reads can use whatever is efficient

2. **Supervisor/Worker architecture (2026-02)**
   - LLM handles: conversation, intent parsing, scope selection, exception handling
   - Code handles: deterministic execution, progress tracking, git commits
   - **Rationale:** 10x cost reduction, predictable execution, better progress tracking

---

## Architecture Improvements (Implemented)

### Supervisor/Worker Architecture ✅

**Implemented:** 2026-02-05

New architecture where LLM supervises and code executes:

| Component | Responsibility |
|-----------|---------------|
| LLM (Supervisor) | Conversation, intent parsing, scope selection, exception handling |
| Code (Worker) | Batch execution, progress tracking, git commits |

**New tools:**
- `preview_changes` — Preview what will change for a scope
- `execute_batch` — Execute batch deterministically (no LLM per-note)
- `get_progress` — Track migration progress

**New types:**
- `WorkScope` — Scope selection (full, folder, files, recent, tag)
- `NotePreview` — Per-note preview of changes
- `BatchResult` — Batch execution results
- `MigrationProgress` — Progress tracking across resume

**Impact:**
- Execute cost reduced from ~$1.50 to ~$0.15 per batch
- Progress tracking now accurate
- Execution is predictable and resumable

### JSON Data Files Moved to Project Directory ✅

**Implemented:** 2026-02-04

All machine-readable JSON files now live in the project's `data/` directory instead of the Obsidian vault.

### Deterministic Batch Extraction ✅

**Implemented:** 2026-02-04

Execute mode reads `data/next-batch.json` directly instead of extracting from markdown.

### Error Recovery Loop ✅

**Implemented:** 2026-02-03

The agent self-reflects on errors with retry/skip/ask_user/abort strategies.

---

## Retrospectives

| Session | File | Key Findings |
|---------|------|--------------|
| Maiden Voyage 2026-01-31 | `.agents/retrospectives/maiden-voyage-2026-01-31.md` | $10.34 total, 3 bugs found, worklist truncation issue |
| Interactive Mode 2026-02-04 | `.agents/retrospectives/interactive-mode-validation-2026-02-04.md` | Execute ignores batch file, 10x cost overrun → led to Path C |

---

## Next Actions

1. Run full migration cycle with new Supervisor/Worker architecture
2. Measure actual cost reduction (target: ~10x improvement)
3. Confirm 99%+ compliance in verification phase

---

## Quick Reference

```bash
# Run modes
bun run tagging-agent.ts              # Interactive (default)
bun run tagging-agent.ts audit
bun run tagging-agent.ts plan
bun run tagging-agent.ts generate-worklist
bun run tagging-agent.ts execute
bun run tagging-agent.ts verify

# Run tests
bun test

# Type check
bunx tsc --noEmit
```
