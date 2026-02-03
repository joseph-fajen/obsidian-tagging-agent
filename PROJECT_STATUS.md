# Project Status — Obsidian Vault Tagging Agent

This file tracks the current development state for Claude Code context. It's the single source of truth for what's been implemented, what's pending, and known issues.

**Last Updated:** 2026-02-03

---

## Current Phase

**Active Work:** Bug fixes and architectural improvements

---

## Implementation Status

### Core Infrastructure ✅

| Component | Status | Notes |
|-----------|--------|-------|
| `lib/config.ts` | ✅ Complete | Config loading, mode validation, all 5 modes supported |
| `lib/frontmatter.ts` | ✅ Complete | gray-matter wrapper, `#` prefix stripping |
| `lib/tag-parser.ts` | ✅ Complete | Inline extraction, noise detection, case-insensitive removal |
| `lib/worklist-generator.ts` | ✅ Complete | Deterministic worklist generation (no LLM) |
| `tag-scheme.ts` | ✅ Complete | TAG_MAPPINGS, lookupTagMapping(), noise patterns |

### MCP Tools ✅

| Tool | Status | Notes |
|------|--------|-------|
| `list_notes` | ✅ Complete | Recursive vault listing |
| `read_note` | ✅ Complete | Minimal/full detail modes |
| `search_notes` | ✅ Complete | Tag-based search |
| `write_note` | ✅ Complete | Creates parent dirs |
| `apply_tag_changes` | ✅ Complete | Per-note tag migration |
| `git_commit` | ✅ Complete | Checkpoint commits |

### Agent Modes ✅

| Mode | Status | Notes |
|------|--------|-------|
| `audit` | ✅ Complete | LLM-driven, writes report + JSON |
| `plan` | ✅ Complete | LLM-driven, creates mapping table |
| `generate-worklist` | ✅ Complete | Deterministic code (no LLM) |
| `execute` | ✅ Complete | LLM-driven, applies worklist |
| `verify` | ✅ Complete | LLM-driven, compliance scan |

### Tests ✅

- 119 tests passing across 11 test files
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

---

## Known Issues

### Recently Fixed (2026-02-03)

1. **YAML parsing fails on Templater files** — Fixed in `lib/worklist-generator.ts` and `tools/tag-tools.ts`
   - Templater templates contain `<% tp.date.now("YYYY-MM-DD-dddd") %>` with nested quotes
   - Now: Files containing `<%` and `%>` are skipped with warnings

2. **Agent exits on error instead of self-reflecting** — Fixed in `tagging-agent.ts`
   - Added `runWithRecovery()` wrapper that invokes recovery agent on errors
   - Recovery agent analyzes errors and proposes: retry, skip, ask_user, or abort

### Open Issues

1. **No technical enforcement of MCP-only tool access**
   - `allowedTools` is set but SDK's `bypassPermissions` may override it
   - Agent can still call Bash/Read if it chooses to ignore system prompt

---

## Architecture Improvements (Implemented)

### Error Recovery Loop ✅

**Implemented:** 2026-02-03

The agent now self-reflects on errors instead of immediately exiting:

1. **Recovery wrapper** (`runWithRecovery()`) wraps the main `runAgent()` function
2. **On error**, invokes a lightweight LLM "recovery agent" that analyzes the error
3. **Recovery strategies:**
   - `retry` — Transient error, retry the operation (up to 3 attempts)
   - `skip` — One item failed, user should skip and continue
   - `ask_user` — Need human judgment, presents a question
   - `abort` — Fundamental error, cannot recover

**Cost:** ~$0.05 per error analysis (small budget, fast model)

---

## Retrospectives

| Session | File | Key Findings |
|---------|------|--------------|
| Maiden Voyage 2026-01-31 | `.agents/retrospectives/maiden-voyage-2026-01-31.md` | $10.34 total, 3 bugs found, worklist truncation issue |

---

## Next Actions

1. ~~Fix Templater YAML parsing bug~~ ✅ Done
2. Decide on approach for agent self-reflection (requires user input)
3. Re-run `generate-worklist` to test fix
4. Continue with execute phase if worklist generates successfully

---

## Quick Reference

```bash
# Run modes
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
