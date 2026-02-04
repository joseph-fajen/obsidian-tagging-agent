# Obsidian Vault Tagging Agent

An AI agent that audits, plans, and executes a comprehensive tag migration across an Obsidian vault. Built with the Claude Agent SDK and Bun.

The agent migrates ~884 markdown notes from inconsistent, flat tagging (mixed inline `#tags` and YAML frontmatter, duplicate names, noise from Google Docs) to a clean hierarchical scheme with `status/`, `type/`, `area/`, `project/`, `topic/`, `tool/`, `skill/` prefixes — all in YAML frontmatter.

## Running the Agent

This agent is designed to run directly via Bun, not through Claude Code or another orchestration layer. It has its own system prompts, budget controls, and autonomous execution — running it directly gives you cleaner output and direct cost control.

## Prerequisites

- [Bun](https://bun.sh) installed
- Anthropic API key or Claude Code authentication
- Your Obsidian vault must be a git repository (for rollback safety)

## Setup

```bash
bun install
cp .env.example .env
```

Edit `.env`:

```bash
VAULT_PATH="/path/to/your/obsidian-vault"
MAX_BUDGET_USD=1.00
BATCH_SIZE=50
AGENT_MODEL="claude-opus-4-5-20251101"  # Or claude-sonnet-4-20250514 for lower cost
```

## Usage

The agent runs in five steps: four LLM-powered phases plus one deterministic code step. Each is a separate CLI invocation. **Run them in order** and review the output between each step.

```
audit (LLM) → plan (LLM) → generate-worklist (CODE) → execute (LLM) → verify (LLM)
```

### Phase 1: Audit

Scans every note, catalogs all tags with frequencies, classifies them against the proposed scheme, and identifies noise tags.

```bash
bun run tagging-agent.ts audit
```

**Review:** Open `_Tag Audit Report.md` in your vault. Check that tag counts look right and noise tags are correctly identified. This phase is read-only (no notes are modified).

### Phase 2: Plan

Reads the audit report and proposed tagging scheme, then generates a per-note migration plan mapping every old tag to a new tag (or removal).

```bash
bun run tagging-agent.ts plan
```

**Review:** Open `_Tag Migration Plan.md` in your vault. Check:
- The tag mapping table — are old tags mapped to the right new tags?
- The unmapped tags section — decide where these should go or if they should be removed
- The per-note change list — spot-check a few notes

This phase is read-only. Edit the plan note directly in Obsidian if you want to change any mappings before executing.

### Phase 2.5: Generate Worklist

Produces the machine-parseable per-note worklist deterministically from code (no LLM call, no API cost). Reads every note, applies the tag mapping table, and writes:
- `_Tag Migration Plan.md` — Human-readable plan with embedded JSON
- `_Migration_Worklist.json` — Pure JSON for fast machine access

```bash
bun run tagging-agent.ts generate-worklist
```

**Review:** Check the output — it reports how many notes need changes and any unmapped tags. If there are unmapped tags, resolve them in the mapping table (`tag-scheme.ts`) or `_Tag Audit Data.json` before executing.

This step is instant and free (no API calls).

**Note:** Templater template files (with `<% %>` syntax in the YAML frontmatter) are automatically skipped — their YAML is unparseable until expanded. Daily notes with Templater cursor placeholders in the body are processed normally.

### Phase 3: Execute

Applies the migration plan in batches. Each invocation processes up to `BATCH_SIZE` notes (default 50), with git commits before and after each batch.

```bash
bun run tagging-agent.ts execute
```

**How it works:** Before the agent starts, a pre-flight check computes the next batch and writes it to `_Next_Batch.json`. The agent reads this file directly (1 tool call) and begins processing immediately — no time wasted extracting JSON from markdown.

**Run this command repeatedly** until all notes are migrated. The agent skips already-processed notes, so re-running is safe. Each run reports how many notes remain.

**After each run:** Check `git log` in your vault to see the batch commits.

### Phase 4: Verify

Performs a fresh full-vault scan checking for zero inline tags, scheme compliance, and orphan tags. Writes a verification report.

```bash
bun run tagging-agent.ts verify
```

**Review:** Open `_Tag Migration Verification.md` in your vault. Look for the compliance percentage and any violations listed.

## Rolling Back

Every batch of changes is wrapped in git commits. To undo a batch:

```bash
cd /path/to/your/obsidian-vault
git log --oneline    # find the commit to revert
git revert <hash>    # undo a specific batch
```

## Error Recovery

The agent includes an error recovery system. When an error occurs, instead of immediately exiting, a lightweight recovery agent analyzes the error and recommends a strategy:

- **retry** — Transient error, will retry automatically (up to 3 times)
- **skip** — One item failed, suggests skipping and continuing
- **ask_user** — Needs human judgment, presents a question
- **abort** — Fundamental error, cannot recover

This costs ~$0.05 per error analysis.

## Budget

Each invocation respects `MAX_BUDGET_USD`. Typical costs:

| Phase | Estimate |
|-------|----------|
| Audit | ~$0.30-0.50 (reads all 884 notes at minimal detail) |
| Generate Worklist | $0.00 (no LLM) |
| Plan | ~$0.30-0.50 (reads audit report + scheme, writes plan) |
| Execute (per batch of 50) | ~$0.10-0.20 (batch pre-computed, just applies changes) |
| Verify | ~$0.30-0.50 (reads all notes at minimal detail) |

Start conservative. You can always increase `MAX_BUDGET_USD` if the agent runs out of budget mid-phase. Override per-invocation without editing `.env`:

```bash
MAX_BUDGET_USD=2.50 bun run tagging-agent.ts audit
```

## Project Structure

```
tagging-agent.ts          # Entry point — system prompts + agent runner
tag-scheme.ts             # Tag scheme schemas + noise patterns + mappings
lib/
  config.ts               # Environment variable loading
  frontmatter.ts          # gray-matter wrapper
  tag-parser.ts           # Inline tag extraction + validation
  worklist-generator.ts   # Deterministic worklist generation (no LLM)
tools/
  vault-tools.ts          # list_notes, read_note, search_notes, write_note
  tag-tools.ts            # apply_tag_changes
  git-tools.ts            # git_commit
tests/                    # bun test files
.agents/
  plans/                  # Implementation plans (all marked IMPLEMENTED)
  retrospectives/         # Session analysis docs
reference/workshop/       # Original Claude Agent SDK workshop examples
```

## Tests

```bash
bun test
```

## References

- `PRD.md` — Full requirements, tool specs, architecture, success criteria
- `CLAUDE.md` — Coding conventions and project rules
- `PROJECT_STATUS.md` — Current implementation state and known issues
- `CHANGELOG.md` — Development history with architectural context
- `.agents/plans/` — Implementation plans (each has status header showing if implemented)
