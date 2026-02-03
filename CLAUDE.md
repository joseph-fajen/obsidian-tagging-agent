# CLAUDE.md — Project Rules

This document defines the global rules for the Obsidian Vault Tagging Agent project. Any AI agent (Claude Code, custom agents, etc.) working on this codebase must follow these rules.

---

## Quick Orientation

**What is this?** An autonomous CLI agent that migrates ~884 Obsidian vault notes from inconsistent tagging to a clean hierarchical scheme. Built with Claude Agent SDK + Bun.

**Key insight:** This project contains an AI agent (`tagging-agent.ts`) that runs independently via Bun. Claude Code is used for *development* of the agent, not for *running* it. The tagging agent has its own system prompts, budget controls, and autonomous execution.

**Current state:** Check `PROJECT_STATUS.md` for implementation status, known issues, and next actions.

**Entry point:** `tagging-agent.ts` — run with mode argument: `bun run tagging-agent.ts <mode>`

**Modes:** `audit` → `plan` → `generate-worklist` → `execute` → `verify`

---

## Inviolable Rules

These rules must NEVER be violated:

### Safety Boundaries
- **NEVER** write outside the configured `VAULT_PATH`
- **NEVER** modify vault notes except through MCP tools (for writes)
- **NEVER** skip git commits when making batch changes
- **NEVER** run execute mode without a migration plan note existing
- **NEVER** commit secrets or credentials

### Architectural Invariants
- All vault *writes* go through MCP tools — this is the audit boundary
- Phased execution with separate budgets per invocation
- Reports are vault-native markdown notes prefixed with `_`
- Tag changes are atomic per-note via `apply_tag_changes`

### Code Invariants
- Use `gray-matter` for ALL frontmatter parsing — never hand-roll YAML
- Use Zod for ALL tool input validation
- No default exports
- Kebab-case filenames

---

## Project Navigation

### Directory Structure

```
tagging-agent.ts          # ENTRY POINT — system prompts, agent runner, recovery loop
tag-scheme.ts             # Tag mappings, validation, noise patterns

lib/
  config.ts               # Environment loading, mode validation
  frontmatter.ts          # gray-matter wrapper
  tag-parser.ts           # Inline tag extraction, noise detection
  worklist-generator.ts   # Deterministic worklist (no LLM)

tools/
  vault-tools.ts          # MCP: list_notes, read_note, search_notes, write_note
  tag-tools.ts            # MCP: apply_tag_changes
  git-tools.ts            # MCP: git_commit

tests/                    # bun test files (test-*.ts pattern)

.agents/
  plans/                  # Implementation plans — CHECK STATUS HEADER before implementing!
  retrospectives/         # Post-session analysis documents
```

### Key Documents

| Document | Purpose | When to Check |
|----------|---------|---------------|
| `PROJECT_STATUS.md` | Current implementation state, known issues | Before starting any work |
| `CHANGELOG.md` | Development history with architectural context | After completing significant changes |
| `PRD.md` | Requirements, tool specs, success criteria | When uncertain about requirements |
| `README.md` | User-facing usage guide | When updating user-facing behavior |
| `.agents/plans/*.md` | Implementation plans with status headers | Before implementing any feature |

### Plan Status Headers

Every plan file in `.agents/plans/` has a YAML frontmatter status:

```yaml
---
status: IMPLEMENTED | PENDING | IN_PROGRESS
implemented_date: YYYY-MM-DD
commit: <hash>
---
```

**Always check this before implementing a plan.** If status is `IMPLEMENTED`, the plan is done.

---

## Technical Standards

### Runtime & Language
- **Runtime:** Bun — use `bun run`, `bun test`, `bun install` (never Node/npm)
- **Language:** TypeScript, strict mode, ESNext target
- **No build step:** Bun runs .ts files directly

### Dependencies
| Package | Purpose | Notes |
|---------|---------|-------|
| `@anthropic-ai/claude-agent-sdk` | Agent framework, MCP server | Core dependency |
| `zod` | Schema validation | Required for all tool inputs |
| `gray-matter` | YAML frontmatter parsing | Only YAML library allowed |

### Code Conventions
- No default exports — use named exports
- Kebab-case filenames: `vault-tools.ts`, `tag-parser.ts`
- Tag format: lowercase kebab-case
- Valid tag prefixes: `area/`, `project/`, `skill/`, `status/`, `tool/`, `topic/`, `type/`
- Flat topic tags (no prefix) are also valid: `ai-tools`, `blockchain`

### MCP Tool Standards
- Follow `reference/adding_tools_guide.md` for docstrings
- Every tool must include: "Use this when", "Do NOT use this for", performance notes, examples
- Prefer consolidated tools over fragmented ones
- Tool definitions go in `tools/`, one file per domain

---

## Decision Framework

### Before Making Changes

1. **Check PROJECT_STATUS.md** — Is there already work in progress?
2. **Check .agents/plans/** — Is there an existing plan? What's its status?
3. **Read before editing** — Always read a file before modifying it
4. **Prefer editing over creating** — Modify existing files rather than creating new ones

### When Uncertain

- **Requirements unclear?** → Check `PRD.md`
- **Architecture question?** → Check `CHANGELOG.md` for prior decisions
- **Current state unknown?** → Check `PROJECT_STATUS.md`
- **Still uncertain?** → Ask the user rather than guessing

### Tool Boundary

MCP tools are the *preferred* interface for vault access, but agents may use built-in SDK tools (Bash, Read) when pragmatically beneficial. This is a documented SDK limitation: `allowedTools` restrictions are not enforced with `permissionMode: bypassPermissions`.

**Rule:** All vault *writes* must go through MCP tools. Reads can use whatever is efficient.

---

## Change Protocol

### After Completing Work

1. **Update PROJECT_STATUS.md** if implementation status changed
2. **Update CHANGELOG.md** for significant changes (new features, bug fixes, architectural decisions)
3. **Update plan status header** if you implemented a plan from `.agents/plans/`
4. **Run tests:** `bun test` — ensure no regressions
5. **Type check:** `bunx tsc --noEmit` (note: pre-existing errors in `reference/workshop/` are expected)

### Commit Messages

Use conventional commit format:
- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code change that neither fixes bug nor adds feature
- `test:` — adding or updating tests

### CHANGELOG Format

Each entry in CHANGELOG.md should include:
- **Session Context** — What prompted the work
- **Solutions Implemented** — What was done and why
- **Files Changed** — Table of affected files
- **Commits** — Git commit hashes

---

## Testing & Validation

### Running Tests
```bash
bun test                    # Run all tests
bun test tests/specific.ts  # Run specific test file
```

### Test Location
- Tests live in `tests/`, named `*.test.ts`
- Test frontmatter parsing and tag extraction with representative samples
- Test edge cases: no frontmatter, complex YAML, Templater syntax

### Validation Checklist
Before considering work complete:
- [ ] `bun test` passes (all tests green)
- [ ] Type check passes (ignoring pre-existing workshop errors)
- [ ] Changes documented in CHANGELOG.md (if significant)
- [ ] PROJECT_STATUS.md updated (if status changed)
- [ ] Plan status header updated (if implementing a plan)

---

## Quick Reference

### Commands
```bash
# Agent modes
bun run tagging-agent.ts audit
bun run tagging-agent.ts plan
bun run tagging-agent.ts generate-worklist
bun run tagging-agent.ts execute
bun run tagging-agent.ts verify

# Development
bun test                     # Run tests
bunx tsc --noEmit           # Type check
bun install                 # Install dependencies
```

### Environment Variables
```bash
VAULT_PATH="/path/to/vault"           # Required
MAX_BUDGET_USD=1.00                   # Budget per invocation
BATCH_SIZE=50                         # Notes per execute batch
AGENT_MODEL="claude-sonnet-4-20250514" # Model to use
```

### Key Files to Know
- `tagging-agent.ts:15-403` — System prompts for each mode
- `tag-scheme.ts:42-93` — Hardcoded tag mappings
- `lib/worklist-generator.ts` — Deterministic worklist (no LLM)
- `lib/tag-parser.ts:1` — VALID_PREFIXES array
