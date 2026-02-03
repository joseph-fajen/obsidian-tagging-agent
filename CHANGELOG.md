# Changelog

This document captures significant changes, the concerns that motivated them, and the architectural reasoning. It complements git commit history by providing narrative context.

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
- `lib/worklist-generator.ts:87-92` — Skip files containing `<%` and `%>` during worklist generation
- `tools/tag-tools.ts:58-62` — Return error for template files in `apply_tag_changes`

**Trade-off:** Template files are skipped entirely rather than partially processed. This is acceptable because templates are meant to be expanded by Templater before use.

#### 2. Error Recovery Loop

**Problem:** On any error, the agent called `process.exit(1)` without analysis or recovery attempt.

**Solution:** Implemented `runWithRecovery()` wrapper in `tagging-agent.ts:593-710`:

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

- `generate-worklist` now completes successfully (129 notes, 181 changes, 0.1s)
- Templater files skipped with clear warnings
- Errors trigger self-reflection instead of immediate exit
- Project state is documented for future sessions

### Commits

- `[pending]` — These changes should be committed with message describing the fixes

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

---

## 2026-01-31: Post-Maiden-Voyage Bug Fixes

### Session Context

Maiden voyage revealed three bugs that caused manual intervention:

1. Numeric inline tags (`#1`, `#123`) not classified as noise
2. Frontmatter tags with `#` prefix not normalized
3. Inline tag removal was case-sensitive

### Solutions Implemented

1. Added `/^\d+$/` check to `isNoiseTag()` in `lib/tag-parser.ts`
2. Added `.replace(/^#/, "")` to `getFrontmatterTags()` in `lib/frontmatter.ts`
3. Changed regex flag from `"g"` to `"gi"` in `removeInlineTag()`
4. Normalized `extractInlineTags()` output to lowercase

### Commits

- `3ba8400` fix: post-maiden-voyage bug fixes, prompt upgrades, and test infrastructure

---

## Earlier History

See `.agents/plans/` for detailed implementation plans:
- `phase-1-foundation.md` — MCP tools
- `phase-2-audit-plan-agent.md` — Agent entry point
- `phase-3-execute-verify.md` — Execution loop
- `deterministic-worklist-generator.md` — Code-based worklist
- `post-maiden-voyage-improvements.md` — Bug fixes and improvements

See `.agents/retrospectives/` for session analysis:
- `maiden-voyage-2026-01-31.md` — First full run analysis
