# Project Status — Obsidian Vault Tagging Agent

This file tracks the current development state for Claude Code context. It's the single source of truth for what's been implemented, what's pending, and known issues.

**Last Updated:** 2026-03-02

---

## Current Phase

**Status:** Production-ready — Deterministic audit and verify phases

The agent architecture has been refined for maximum reliability and minimal cost:
- **Deterministic audit and verify:** Both phases now use code-only implementation (no LLM)
- **LLM only where it adds value:** Only Plan phase uses LLM (interpreting user's scheme note)
- **Total migration cost: ~$0.25** — down from ~$1.50 with LLM audit/verify

**Key Changes (2026-03-02):**
- `lib/verify-generator.ts` — New deterministic verification (no LLM)
- `audit` mode now runs code-driven (same as `generate-audit`)
- `verify` mode now runs code-driven (same as `generate-verify`)
- Interactive mode uses code for audit/verify phases
- LLM audit/verify removed (unreliable, expensive)

**Key Changes (2026-02-26):**
- `lib/plan-extractor.ts` — New module for markdown table parsing
- `loadMappings()` — Simplified to ONLY load from `plan-mappings.json` (no audit fallback)
- Audit instructions — No longer request mappings derivation (phase separation)
- `docs/ARCHITECTURE.md` — Comprehensive design documentation for portfolio

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
| `lib/plan-extractor.ts` | ✅ Complete | Code-driven extraction of mappings from plan markdown |
| `lib/audit-generator.ts` | ✅ Complete | Deterministic audit generation (no LLM) |
| `lib/verify-generator.ts` | ✅ Complete | Deterministic verification (no LLM) |
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
| `audit` | ✅ Complete | Deterministic code (no LLM), instant, free |
| `plan` | ✅ Complete | LLM-driven, creates mapping table |
| `generate-worklist` | ✅ Complete | Deterministic code (no LLM) |
| `execute` | ✅ Complete | Supervisor/Worker: LLM supervises, code executes |
| `verify` | ✅ Complete | Deterministic code (no LLM), instant, free |

### Tests ✅

- 367+ tests passing across 22+ test files
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
| Plan Phase Audit Data Usage | `.agents/plans/fix-plan-phase-audit-data-usage.md` | ✅ Yes |
| Architecture Cleanup | `.agents/plans/architecture-cleanup-and-documentation.md` | ✅ Yes |
| Deterministic Audit Generator | `.agents/plans/deterministic-audit-generator.md` | ✅ Yes |
| Deterministic Audit/Verify | `.agents/plans/deterministic-audit-verify.md` | ✅ Yes |

---

## Known Issues

### Recently Fixed (2026-02-26)

1. **Interactive mode skipped plan extraction** — Fixed by syncing code paths
   - Root cause: `runGenerateWorklistPhase()` in interactive-agent.ts was missing the extraction step
   - Solution: Added `extractMappingsFromPlanFile()` and `writePlanMappingsJson()` calls to match CLI mode
   - Result: Interactive mode now correctly applies LLM-generated mappings (todo → status/pending, etc.)

2. **Plan phase didn't reliably write `plan-mappings.json`** — Fixed with code-driven extraction
   - Root cause: LLM ignored JSON writing instructions despite explicit prompts
   - Solution: `lib/plan-extractor.ts` parses markdown mapping table and writes JSON deterministically
   - Result: Reliable mappings extraction, clear phase separation

### Recently Fixed (2026-02-05 evening)

1. **Execute phase still used search_notes despite constraints** — Fixed with prompt injection
   - Root cause: LLM ignored "DO NOT search" instructions, even with WRONG vs RIGHT examples
   - Solution: Inject batch data directly into the user prompt as JSON
   - Result: Single `execute_batch` call per batch, $0.06/batch (75% cost reduction)

### Recently Fixed (2026-02-05)

1. **Plan phase re-scans notes instead of using audit data** — Fixed
   - Plan now uses `read_data_file` to read `audit-data.json` first
   - Added `checkPlanPrerequisites()` pre-flight check
   - Reduced plan phase from ~$0.85/60s to ~$0.15-0.25/15-20s

2. **Execute phase ignores pre-computed batch file** — Fixed by Supervisor/Worker + prompt injection
   - Execute now uses `execute_batch` tool for code-driven execution
   - Batch data injected directly into prompt — no file reading needed
   - LLM supervises, code executes — no more autonomous discovery

3. **Progress counter stuck at "615 remaining"** — Fixed
   - `get_progress` tool provides accurate progress tracking
   - Progress file updated automatically by `execute_batch`

4. **Batch number always shows "1"** — Fixed
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

3. **Code-driven extraction pattern (2026-02-26)**
   - When LLMs unreliably follow instructions, move critical work to code
   - Plan phase writes human-readable markdown; code extracts to JSON
   - **Rationale:** Reliable mappings, clear audit trail, deterministic behavior

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
- Execute cost reduced from ~$1.50 to **~$0.06 per batch** (with prompt injection fix)
- Progress tracking now accurate
- Execution is predictable and resumable
- Single tool call per batch (no autonomous discovery)

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

1. ✅ ~~Run full migration cycle with new Supervisor/Worker architecture~~ — In progress
2. ✅ ~~Measure actual cost reduction~~ — Achieved: $0.06/batch (25x improvement over LLM-per-note)
3. Complete current migration run (~480 notes remaining at ~$0.60 total)
4. Run verification phase to confirm compliance

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
