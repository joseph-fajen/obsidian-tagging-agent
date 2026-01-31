# Retrospective: Maiden Voyage — 2026-01-31

## Context

First end-to-end run of the Obsidian Vault Tagging Agent against a production vault of 884 markdown notes. Full audit → plan → execute → verify lifecycle completed in a single session.

**Vault:** `/Users/josephfajen/git/obsidian-jpf` (884 notes, ~597 with tags)
**Agent project:** `claude-agent-sdk-proactive-agent`
**Model:** `claude-sonnet-4-20250514`
**Operator:** Claude Code (Opus 4.5) orchestrating the agent runs

---

## Results

| Phase | Batches | Notes Processed | Cost | Duration |
|-------|---------|-----------------|------|----------|
| Audit | 1 | 884 scanned | $0.68 | 6 min |
| Plan | 1 | — | $0.10 | 2 min |
| Execute | 18 | ~500+ migrated | $9.18 | ~5.5 hrs |
| Verify | 1 | 871 scanned | $0.38 | 3.5 min |
| Manual fixes | — | 4 notes | — | — |
| **Total** | | | **~$10.34** | **~6 hrs** |

**Final compliance:** 100% — zero inline tags, zero `#` prefixes, all tags in YAML frontmatter.

---

## What Went Well

1. **The phased model works.** Audit → plan → execute → verify as separate CLI invocations with separate budgets is a sound architecture. Each phase has a clear contract.

2. **Git safety held up.** Every batch was wrapped in commits. At no point was rollback impossible. Commit messages were descriptive enough to identify batch scope.

3. **MCP tool boundary mostly held.** The core tools (`list_notes`, `read_note`, `apply_tag_changes`, `write_note`, `git_commit`) worked correctly and handled edge cases (duplicates, missing tags, frontmatter creation).

4. **gray-matter integration was solid.** Frontmatter parsing and serialization worked reliably across 500+ writes with no corruption of existing fields (aliases, cssclasses, etc.).

5. **Tag parser correctly skipped code blocks.** Inline tag extraction and removal handled fenced code, inline code, and markdown links without false positives.

6. **Budget controls worked.** No run exceeded its budget cap. The `maxBudgetUsd` mechanism functioned as designed.

---

## Problems Identified

### P1: Plan phase did not generate per-note worklist

**Severity:** High — root cause of most execute-phase inefficiency.

The plan phase produced a tag mapping table (old tag → new tag) but not the machine-parseable per-note change list described in the PRD and system prompt. The plan note stated: "The exact per-note changes require scanning all 597 tagged notes." This meant every execute batch had to:

1. Read the plan
2. Search for notes with old tags
3. Read each note to check current state
4. Apply changes

Steps 2-3 consumed ~40% of each batch's budget on rediscovery work that should have been done once in the plan phase.

**Impact:** Roughly doubled the total execute cost and time.

### P2: No cross-invocation progress tracking

Each execute batch started with zero knowledge of what previous batches processed. The system prompt instructs the agent to check each note's current tags to determine if it was already processed, but this requires reading every candidate note — expensive at scale.

**Impact:** Later batches (11-17) spent most of their budget re-scanning already-migrated notes before finding the remaining work.

### P3: Unmapped tags blocked progress repeatedly

The 5 unmapped tags (`complex-query`, `complex-queries`, `#complex-query`, `code_review`, `#complex-queries`) caused:
- Batch 3 to stall completely ($0.09 wasted)
- Multiple other batches to spend time deliberating about them
- Even after the user decided on mappings, the plan note was never updated, so the agent kept encountering them as "unmapped"

**Impact:** ~$0.50+ in wasted budget, plus user friction.

### P4: Agent used Bash tool to bypass MCP boundary

Several execute batches used `Bash` to run shell commands directly against the vault filesystem (e.g., `jq` on the list_notes output, direct file reads). This violates the MCP-only vault access rule in CLAUDE.md and the PRD.

**Root cause:** The `allowedTools` list restricts tool names but the underlying Claude Agent SDK model still has access to general tools. The `permissionMode: "bypassPermissions"` setting compounds this.

### P5: Verify agent over-flagged valid topic tags

The verification report flagged flat topic tags (`ai-tools`, `claude-code`, `meditation`, `wim-hof-breathing`) as "invalid" because they lack hierarchical prefixes. But the proposed scheme explicitly allows flat topic tags without prefixes. The verify system prompt's compliance check is too strict.

### P6: Diminishing returns in later execute batches

| Batch range | Avg notes/batch | Avg cost/batch |
|-------------|-----------------|----------------|
| 1-5 | 49 | $0.39 |
| 6-10 | 41 | $0.53 |
| 11-15 | 28 | $0.57 |
| 16-18 | 24 | $0.54 |

Cost per note increased ~3x from early to late batches due to search overhead.

---

## Bugs Found

### Bug 1: Numeric inline tags not classified as noise

**File:** `lib/tag-parser.ts` → `isNoiseTag()`
**Symptom:** The inline tag `#1` in `Partner Chains Links Reference.md` was not detected as a noise tag and was never removed by the agent.
**Root cause:** `isNoiseTag()` checks for `"heading"`, `"="` chars, and `"follow-up-required-"` prefix. Purely numeric tags like `"1"` don't match any pattern.
**Fix:** Add a check for purely numeric tags: `/^\d+$/.test(tag)`.

### Bug 2: Frontmatter tags with `#` prefix not normalized

**File:** `lib/frontmatter.ts` → `getFrontmatterTags()`
**Symptom:** `Erlang SDK for Blockfrost API.md` had `#project-catalyst` in its YAML frontmatter `tags` array. The `getFrontmatterTags()` function returns it as-is (`"#project-catalyst"`), and `apply_tag_changes` looking for `oldTag: "project-catalyst"` couldn't match it.
**Root cause:** gray-matter parses `- #project-catalyst` as the string `"#project-catalyst"`. No normalization strips the `#`.
**Fix:** Strip leading `#` in `getFrontmatterTags()`: `tags.map(t => t.replace(/^#/, ''))`.

### Bug 3: Inline tag removal is case-sensitive

**File:** `lib/tag-parser.ts` → `removeInlineTag()`
**Symptom:** `Prompt for Plutus Onboarding Outline.md` had inline `#Plutus-docs-design` (mixed case). If the migration plan mapped `plutus-docs-design` (lowercase), the case-sensitive match in `removeInlineTag` wouldn't find it.
**Root cause:** The regex built from `escapedTag` uses the exact case of the input.
**Fix:** Use case-insensitive flag on the removal regex, or normalize the tag before building the regex.

---

## Improvement Opportunities

### Architecture Changes

#### 1. Plan phase must generate a complete per-note worklist

The plan phase should:
- Scan every tagged note (using `read_note` minimal)
- For each note, compute the exact `{ path, changes: [{oldTag, newTag}] }` array
- Write this as a machine-parseable JSON section in the migration plan
- The execute phase consumes this directly — no re-scanning

**Expected impact:** Cut execute cost by ~40%, eliminate redundant search overhead.

#### 2. Add persistent progress tracking

Create a `_Migration Progress.json` (or `.md` with JSON block) in the vault:
```json
{
  "totalNotes": 597,
  "processed": ["path/to/note1.md", "path/to/note2.md", ...],
  "lastBatch": 3,
  "lastCommit": "abc123"
}
```

Each execute batch:
1. Reads the progress file
2. Takes the next N unprocessed notes from the worklist
3. Applies changes
4. Updates the progress file
5. Commits

**Expected impact:** Eliminate all re-scanning. Each batch starts exactly where the last one stopped.

#### 3. Update migration plan with user decisions

When the user resolves unmapped tags, either:
- The plan phase should be re-run with the decisions as input
- Or the execute agent should update the plan note's mapping table before proceeding

This prevents repeated stalls on the same unmapped tags.

#### 4. Make execute phase more deterministic

The execute agent currently uses LLM judgment to decide which notes to process and in what order. This is unnecessary — the plan already defines the changes. The execute prompt should instruct the agent to:
1. Read the worklist
2. Read the progress file
3. Take the next `batchSize` entries
4. Apply each one sequentially
5. No searching, no improvising

#### 5. Fix verify prompt compliance logic

Update `buildVerifySystemPrompt` to recognize flat topic tags (lowercase kebab-case, no prefix) as valid. The current prompt only describes prefixed tags as valid, causing false positives.

### Tool Improvements

#### 6. Paginate `list_notes` output

The 884-entry JSON array is too large for comfortable context window use. Options:
- Add `limit` and `offset` parameters
- Return a summary by directory with counts
- Stream results

#### 7. Add tag metadata to `search_notes` results

Currently returns `{ path, matchContext }`. If it also returned `{ frontmatterTags, inlineTags }`, the execute agent wouldn't need a separate `read_note` call per note.

#### 8. Enforce MCP-only vault access

The agent should not have access to `Bash`, `Read`, or other tools that could bypass the MCP boundary. Options:
- Remove general tools from `allowedTools`
- Verify that `allowedTools` actually restricts tool access (test this)
- Add a hook that rejects non-MCP tool calls during execute/verify modes

### Project Cleanup

#### 9. Fix test runner

`package.json` line 10: `"test": "bun run tests/test-basic.ts"` only runs one test file. Should be `"test": "bun test"` to discover all 10 test files.

#### 10. Remove stale package.json scripts

Lines 7-16 reference files that no longer exist:
- `"start": "bun run agent.ts"` — `agent.ts` doesn't exist
- `"advanced": "bun run advanced-agent.ts"` — doesn't exist
- `"dev": "bun --watch run agent.ts"` — doesn't exist
- All `demo:*` scripts — `demo/` directory doesn't exist (files are in `reference/workshop/demo/`)

#### 11. Clean up .env.example

Remove legacy fields: `AGENT_TOPIC`, `OUTPUT_DIR`. These are from the original workshop project.

---

## Metrics for Future Runs

Baseline metrics from this maiden voyage for comparison:

| Metric | Value |
|--------|-------|
| Total notes in vault | 884 |
| Notes with tags | 597 (67.5%) |
| Unique tags (pre-migration) | 53 |
| Audit cost | $0.68 |
| Plan cost | $0.10 |
| Execute cost (total) | $9.18 |
| Execute cost per note | ~$0.018 |
| Verify cost | $0.38 |
| Total cost | ~$10.34 |
| Execute batches needed | 18 |
| Final compliance | 100% |
| Manual fixes required | 4 notes |

**Target for next run (after improvements):**
- Execute cost per note: < $0.01 (50% reduction via worklist)
- Execute batches: < 12 (eliminate redundant scanning)
- Manual fixes: 0 (fix the 3 bugs above)

---

## Action Items

| Priority | Item | Type | Effort |
|----------|------|------|--------|
| P1 | Plan phase generates per-note worklist | Architecture | Medium |
| P1 | Add persistent progress tracking | Architecture | Medium |
| P1 | Fix `getFrontmatterTags` to strip `#` prefix | Bug fix | Small |
| P1 | Fix `isNoiseTag` to catch numeric tags | Bug fix | Small |
| P1 | Fix `removeInlineTag` case sensitivity | Bug fix | Small |
| P2 | Fix verify prompt to allow flat topic tags | Prompt fix | Small |
| P2 | Update migration plan with user decisions flow | Architecture | Medium |
| P2 | Make execute phase deterministic | Architecture | Medium |
| P3 | Paginate `list_notes` output | Tool improvement | Small |
| P3 | Add tag metadata to `search_notes` | Tool improvement | Small |
| P3 | Enforce MCP-only vault access | Safety | Medium |
| P3 | Fix test runner in package.json | Cleanup | Trivial |
| P3 | Remove stale package.json scripts | Cleanup | Trivial |
| P3 | Clean up .env.example | Cleanup | Trivial |
