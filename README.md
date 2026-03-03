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

# Optional: Phase-specific models for cost optimization
# EXECUTE_MODEL="claude-haiku-4-5-20251001"  # Cheaper for execute supervision
```

## Getting Started with Your Vault

### 1. Create Your Tagging Schema Note

Before running the agent, create a note in your vault that describes your desired tagging system. For example, create `Proposed Tagging System.md`:

```markdown
# My Tagging Schema

## Categories

- **status/** - Task status: `status/pending`, `status/completed`, `status/archived`
- **type/** - Note type: `type/meeting`, `type/daily-note`, `type/research`
- **area/** - Life areas: `area/career`, `area/health`, `area/learning`
- **project/** - Active projects: `project/my-app`, `project/home-reno`

## Topic Tags

Flat tags for topics: `ai-tools`, `productivity`, `cooking`

## Tags to Remove

- `heading` - Noise from Google Docs imports
- Any tag starting with `follow-up-required-`
```

The agent will read this note during audit and plan phases to understand your desired tag structure.

### 2. Configure the Agent

If your schema note has a different name, set the path in `.env`:

```bash
# Optional: if your schema note has a different name
SCHEME_NOTE_PATH="My Tagging Schema.md"
```

Default is `Proposed Tagging System.md`.

### 3. Run the Migration

```bash
bun run tagging-agent.ts  # Interactive mode guides you through
```

The plan phase will create `data/plan-mappings.json` with all tag mappings derived from your schema. The deterministic worklist generator uses these mappings to compute what changes need to be made.

## Usage

### Interactive Mode (Recommended)

Launch the agent without arguments for a guided interactive experience:

```bash
bun run tagging-agent.ts
```

The agent will:
1. Introduce itself and explain the migration workflow
2. Guide you through each phase (audit → plan → generate-worklist → execute → verify)
3. Pause after each phase for you to review results
4. Allow you to exit at any checkpoint and resume later

#### Resuming a Session

If you exit mid-migration, the agent saves your progress. Simply run the command again:

```bash
bun run tagging-agent.ts
```

The agent will detect your saved session and offer to resume where you left off.

### CLI Mode (Advanced)

For scripted or non-interactive use, you can run individual phases directly.

The agent runs in five phases: only Plan and Execute use the LLM. The rest are deterministic code (instant and free). Each is a separate CLI invocation. **Run them in order** and review the output between each step.

```
audit (CODE) → plan (LLM) → generate-worklist (CODE) → execute (LLM) → verify (CODE)
```

### Phase 1: Audit

Scans the entire vault deterministically and catalogs all tags with accurate frequencies. This is code-driven (no LLM), instant, and free.

```bash
bun run tagging-agent.ts audit
```

**Outputs:**
- `data/audit-data.json` — Machine-readable tag data for the plan phase
- `_Tag Audit Report.md` — Human-readable report in your vault

**Review:** Check the report for:
- Format issues (underscores, uppercase) that need correction
- Noise tags that will be removed
- Tag frequency distribution

This step is instant and free (no API calls).

### Phase 2: Plan

Reads the audit data (`data/audit-data.json`) and proposed tagging scheme, then generates a migration plan with a tag mapping table. Uses the structured audit data directly instead of re-scanning notes.

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
- `_Tag Migration Plan.md` — Human-readable summary in the vault
- `data/migration-worklist.json` — Complete worklist in project directory (not vault)

```bash
bun run tagging-agent.ts generate-worklist
```

**Review:** Check the output — it reports how many notes need changes and any unmapped tags. If there are unmapped tags, resolve them in the mapping table (`tag-scheme.ts`) or `data/audit-data.json` before executing.

This step is instant and free (no API calls).

**Note:** Templater template files (with `<% %>` syntax in the YAML frontmatter) are automatically skipped — their YAML is unparseable until expanded. Daily notes with Templater cursor placeholders in the body are processed normally.

### Phase 3: Execute

Applies the migration plan in batches. Each invocation processes up to `BATCH_SIZE` notes (default 50), with git commits before and after each batch.

```bash
bun run tagging-agent.ts execute
```

**How it works:** Before the agent starts, a pre-flight check computes the next batch and writes it to `data/next-batch.json`. The agent reads this file directly (1 tool call) and begins processing immediately — no time wasted extracting JSON from markdown.

**Run this command repeatedly** until all notes are migrated. The agent skips already-processed notes, so re-running is safe. Each run reports how many notes remain.

**After each run:** Check `git log` in your vault to see the batch commits.

### Phase 4: Verify

Performs a deterministic full-vault scan checking for compliance: no inline tags, valid tag formats, no duplicates, no noise tags remaining. This is code-driven (no LLM), instant, and free.

```bash
bun run tagging-agent.ts verify
```

**Outputs:**
- `_Tag Migration Verification.md` — Compliance report with any violations listed

**Review:** Check the compliance percentage. Any violations are listed with specific notes and issues to fix.

This step is instant and free (no API calls).

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
| Audit | $0.00 (deterministic code) |
| Plan | ~$0.15-0.25 (reads audit-data.json + scheme, writes plan) |
| Generate Worklist | $0.00 (deterministic code) |
| Execute (per batch of 50) | ~$0.06 (prompt injection: batch data embedded directly) |
| Verify | $0.00 (deterministic code) |

**Total migration cost: ~$0.25** (only Plan uses the LLM).

**Cost optimization:** Execute phase uses Haiku by default for supervision since execution is code-driven. Configure with `EXECUTE_MODEL` env var.

Start conservative. You can always increase `MAX_BUDGET_USD` if the agent runs out of budget mid-phase. Override per-invocation without editing `.env`:

```bash
MAX_BUDGET_USD=2.50 bun run tagging-agent.ts audit
```

## Project Structure

```
tagging-agent.ts          # Entry point — system prompts + agent runner
tag-scheme.ts             # Tag scheme schemas + noise patterns + mappings
lib/
  config.ts               # Environment variable loading, phase-specific models
  frontmatter.ts          # gray-matter wrapper
  tag-parser.ts           # Inline tag extraction + validation
  audit-generator.ts      # Deterministic audit generation (no LLM)
  verify-generator.ts     # Deterministic verification (no LLM)
  plan-extractor.ts       # Code-driven extraction of mappings from plan markdown
  worklist-generator.ts   # Deterministic worklist generation (no LLM)
  types.ts                # Shared types: WorkScope, BatchResult, MigrationProgress
  scope-filter.ts         # Scope filtering: full, folder, files, recent, tag
  preview-generator.ts    # Preview generation without applying changes
  batch-executor.ts       # Code-driven batch execution
  session-state.ts        # Session state persistence for interactive mode
  agent-personality.ts    # Base personality and phase instructions
  interactive-agent.ts    # Interactive REPL loop
tools/
  vault-tools.ts          # list_notes, read_note, search_notes, write_note
  tag-tools.ts            # apply_tag_changes, preview_changes, execute_batch, get_progress
  git-tools.ts            # git_commit
  data-tools.ts           # read_data_file, write_data_file
tests/                    # bun test files (290 tests)
scripts/
  generate-complex-vault.ts  # Generate test-vault-complex for testing
data/                     # Runtime data (git-ignored, see below)
.agents/
  plans/                  # Implementation plans (all marked IMPLEMENTED)
  retrospectives/         # Session analysis docs
reference/workshop/       # Original Claude Agent SDK workshop examples
```

## Data Directory

The `data/` directory (git-ignored) contains machine-readable JSON files used during migration:

| File | Purpose |
|------|---------|
| `audit-data.json` | Tag frequencies and auto-discovered mappings from audit phase |
| `plan-mappings.json` | User-approved tag mappings from plan phase |
| `migration-worklist.json` | Full worklist of notes and tag changes |
| `migration-progress.json` | Tracks which notes have been processed |
| `next-batch.json` | Pre-computed batch for current execute run |

These files are stored outside the vault to:
1. Prevent Obsidian from indexing large JSON files (which can cause crashes)
2. Keep machine data separate from human knowledge
3. Allow the vault to remain clean for normal Obsidian use

Human-readable reports (`_Tag Audit Report.md`, `_Tag Migration Plan.md`, `_Tag Migration Verification.md`) remain in the vault.

## Starting Over

To reset and run a fresh migration:

1. **Clear data files:**
   ```bash
   rm -f data/*.json
   ```

2. **Optionally reset vault** (if you want to undo applied changes):
   ```bash
   cd /path/to/vault
   git log --oneline        # Find commit before migration
   git reset --hard <hash>  # Reset to that commit
   ```

The agent auto-detects some stale state (e.g., worklist regenerated after migration started), but clearing `data/` is the safest way to ensure a clean start.

**When to clear `data/`:**
- Starting fresh on a new vault
- Vault was modified externally (git reset, manual tag edits)
- Something went wrong and you want to retry

**When to keep `data/`:**
- Resuming an interrupted migration
- Re-running just the execute phase after reviewing the plan

## Tests

```bash
bun test
```

## Development

### Test Vaults

Two test vaults are available for development:

- **test-vault/** — Small, manually curated vault (~50 notes) checked into git
- **test-vault-complex/** — Larger generated vault (~85 notes) with systematic edge case coverage

To regenerate the complex test vault:

```bash
bun run scripts/generate-complex-vault.ts
```

The complex vault is git-ignored and can be regenerated at any time. Manual edge cases in `test-vault-complex/Manual/` are preserved during regeneration.

### Running Against a Test Vault

```bash
# Update .env
VAULT_PATH="/path/to/obsidian-tagging-agent/test-vault-complex"

# Clear any previous run data
rm -f data/*.json

# Run the agent
bun run tagging-agent.ts generate-audit
```

## References

- `PRD.md` — Full requirements, tool specs, architecture, success criteria
- `CLAUDE.md` — Coding conventions and project rules
- `PROJECT_STATUS.md` — Current implementation state and known issues
- `CHANGELOG.md` — Development history with architectural context
- `.agents/plans/` — Implementation plans (each has status header showing if implemented)
