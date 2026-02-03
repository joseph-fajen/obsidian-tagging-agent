# Changelog

This document captures significant changes, the concerns that motivated them, and the architectural reasoning. It complements git commit history by providing narrative context.

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
