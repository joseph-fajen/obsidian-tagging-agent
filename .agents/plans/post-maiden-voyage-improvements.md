# Feature: Tagging Agent Post-Maiden-Voyage Improvements

The following plan implements bug fixes, architectural improvements, and project cleanup identified in the maiden voyage retrospective. Pay special attention to the inline tag case-sensitivity fix (Bug 3) which has a second defect not covered in the original `BUG_FIXES.md`.

## Feature Description

After the maiden voyage ($10.34, 18 batches, 4 manual fixes), three categories of improvements are needed: (1) three bug fixes that caused manual intervention, (2) architectural changes to eliminate redundant scanning in execute phase, and (3) project cleanup for test infrastructure and stale config.

## User Story

As the vault owner running the tagging agent,
I want bugs fixed and the plan→execute data flow made efficient,
So that the next migration costs ~50% less, requires zero manual fixes, and has a working test suite.

## Feature Metadata

**Feature Type**: Bug Fix + Enhancement + Refactor
**Estimated Complexity**: Medium
**Primary Systems Affected**: `lib/tag-parser.ts`, `lib/frontmatter.ts`, `tagging-agent.ts`, `tools/tag-tools.ts`, test files, `package.json`, `.env.example`
**Dependencies**: None (all changes are internal)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `lib/tag-parser.ts` (all) — Bug 1 (numeric noise), Bug 3 (case-insensitive removal + extraction normalization)
- `lib/frontmatter.ts` (all) — Bug 2 (strip `#` prefix from frontmatter tags)
- `tools/tag-tools.ts` (lines 62-85) — Bug 3 cascading fix: `inlineTags.includes(oldTag)` is case-sensitive
- `tagging-agent.ts` (lines 12-173) — System prompt functions to replace (plan, execute, verify)
- `tests/test-tag-parser.ts` (all) — Existing tests to extend for bug fixes
- `tests/test-frontmatter.ts` (all) — Existing tests to extend for Bug 2
- `tests/test-agent-prompts.ts` (all) — Tests that assert on prompt content; must be updated after prompt changes
- `package.json` (lines 10-16) — Stale scripts and broken test runner
- `.env.example` (lines 6-9) — Legacy fields to remove
- `docs/improvements/BUG_FIXES.md` — Detailed bug descriptions and proposed fixes
- `docs/improvements/ARCHITECTURE_CHANGES.md` — Worklist and progress tracking schemas
- `docs/improvements/SYSTEM_PROMPT_UPDATES.md` — Complete replacement prompts
- `docs/improvements/CLAUDE_CODE_PROMPT.md` — Orchestration context and success metrics

### New Files to Create

- None. All changes are modifications to existing files.

### Patterns to Follow

**Test naming**: Tests use `describe`/`test` from `bun:test`. Assertions use `expect().toBe()`, `expect().toEqual()`, `expect().toContain()`.

**Function exports**: Named exports only (no default exports). Example: `export function isNoiseTag(tag: string): boolean`.

**Tag format convention**: Tags are always stored/compared without `#` prefix, lowercase kebab-case.

---

## IMPLEMENTATION PLAN

### Phase 1: Test Infrastructure Fix
Fix `bun test` discovery so we have a working test suite before making code changes.

### Phase 2: Bug Fixes (3 bugs + 1 cascading fix)
Fix data correctness issues that caused manual intervention.

### Phase 3: System Prompt Updates
Replace plan, execute, and verify prompts with worklist-aware versions.

### Phase 4: Project Cleanup
Remove stale config and scripts.

### Phase 5: Test Updates & Validation
Update prompt tests, run full suite, verify everything passes.

---

## STEP-BY-STEP TASKS

### Task 1: RENAME test files for bun test discovery

Bun's default test runner discovers files matching `**{.test,.spec,_test_,_spec_}.{js,ts,jsx,tsx}`. Current files are named `test-*.ts` which doesn't match.

Rename all 10 test files:

| Old name | New name |
|----------|----------|
| `tests/test-basic.ts` | `tests/basic.test.ts` |
| `tests/test-frontmatter.ts` | `tests/frontmatter.test.ts` |
| `tests/test-tag-parser.ts` | `tests/tag-parser.test.ts` |
| `tests/test-tag-scheme.ts` | `tests/tag-scheme.test.ts` |
| `tests/test-tools-smoke.ts` | `tests/tools-smoke.test.ts` |
| `tests/test-agent-prompts.ts` | `tests/agent-prompts.test.ts` |
| `tests/test-configurations.ts` | `tests/configurations.test.ts` |
| `tests/test-hooks.ts` | `tests/hooks.test.ts` |
| `tests/test-mcp.ts` | `tests/mcp.test.ts` |
| `tests/test-subagents.ts` | `tests/subagents.test.ts` |

- **VALIDATE**: `bun test --dry-run 2>&1 | head -20` should list all 10 files (note: if `--dry-run` isn't supported, just run `bun test` and verify 10 files are discovered; some tests like `basic.test.ts` make API calls so they may fail but should be *found*)

### Task 2: UPDATE `package.json` — fix test script and remove stale scripts

**File:** `package.json`

Replace the `scripts` section. Remove stale scripts (`start`, `advanced`, `dev`, all `demo:*`). Fix test runner.

New scripts section:
```json
{
  "scripts": {
    "test": "bun test",
    "tagging:audit": "bun run tagging-agent.ts audit",
    "tagging:plan": "bun run tagging-agent.ts plan",
    "tagging:execute": "bun run tagging-agent.ts execute",
    "tagging:verify": "bun run tagging-agent.ts verify"
  }
}
```

- **VALIDATE**: `bun test tests/tag-parser.test.ts` should find and run the tag parser tests

### Task 3: UPDATE `lib/frontmatter.ts` — Bug 2: strip `#` prefix from frontmatter tags

**File:** `lib/frontmatter.ts` → `getFrontmatterTags()` function

Current code (lines 26-32):
```typescript
export function getFrontmatterTags(data: Record<string, unknown>): string[] {
  const tags = data.tags;
  if (tags == null) return [];
  if (typeof tags === "string") return [tags];
  if (Array.isArray(tags)) return tags.filter((t): t is string => typeof t === "string");
  return [];
}
```

Change to strip leading `#` from each tag:
```typescript
export function getFrontmatterTags(data: Record<string, unknown>): string[] {
  const tags = data.tags;
  if (tags == null) return [];
  if (typeof tags === "string") return [tags.replace(/^#/, "")];
  if (Array.isArray(tags))
    return tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.replace(/^#/, ""));
  return [];
}
```

- **GOTCHA**: Must strip `#` AFTER the type filter, not before
- **VALIDATE**: `bun test tests/frontmatter.test.ts` — existing tests should still pass (no current tests use `#` prefix)

### Task 4: ADD tests for Bug 2 fix

**File:** `tests/frontmatter.test.ts` → add to the `getFrontmatterTags` describe block

Add these test cases after the existing ones:

```typescript
test("strips # prefix from array tags", () => {
  expect(getFrontmatterTags({ tags: ["#project-catalyst", "blockfrost", "#api"] })).toEqual([
    "project-catalyst",
    "blockfrost",
    "api",
  ]);
});

test("strips # prefix from single string tag", () => {
  expect(getFrontmatterTags({ tags: "#single-tag" })).toEqual(["single-tag"]);
});
```

- **VALIDATE**: `bun test tests/frontmatter.test.ts` — all tests pass including new ones

### Task 5: UPDATE `lib/tag-parser.ts` — Bug 1: numeric tags as noise

**File:** `lib/tag-parser.ts` → `isNoiseTag()` function

Current code (lines 26-31):
```typescript
export function isNoiseTag(tag: string): boolean {
  if (tag === "heading") return true;
  if (tag.includes("=")) return true;
  if (/^follow-up-required-/.test(tag)) return true;
  return false;
}
```

Add numeric check as the first condition:
```typescript
export function isNoiseTag(tag: string): boolean {
  if (/^\d+$/.test(tag)) return true;
  if (tag === "heading") return true;
  if (tag.includes("=")) return true;
  if (/^follow-up-required-/.test(tag)) return true;
  return false;
}
```

- **VALIDATE**: `bun test tests/tag-parser.test.ts` — existing tests still pass

### Task 6: ADD tests for Bug 1 fix

**File:** `tests/tag-parser.test.ts` → add to the `isNoiseTag` describe block

Add after the existing "does not flag normal tags as noise" test:

```typescript
test("identifies purely numeric tags as noise", () => {
  expect(isNoiseTag("1")).toBe(true);
  expect(isNoiseTag("123")).toBe(true);
  expect(isNoiseTag("2025")).toBe(true);
});

test("does not flag alphanumeric tags as noise", () => {
  expect(isNoiseTag("tag1")).toBe(false);
  expect(isNoiseTag("v2")).toBe(false);
  expect(isNoiseTag("2025-01-15")).toBe(false);
});
```

- **VALIDATE**: `bun test tests/tag-parser.test.ts` — all pass

### Task 7: UPDATE `lib/tag-parser.ts` — Bug 3a: normalize `extractInlineTags` to lowercase

**File:** `lib/tag-parser.ts` → `extractInlineTags()` function

This is the fix MISSING from `BUG_FIXES.md`. Without this, the case-sensitive `includes()` check in `apply_tag_changes` prevents `removeInlineTag` from ever being called on mixed-case tags.

Current code (lines 16-24):
```typescript
export function extractInlineTags(content: string): string[] {
  const cleaned = stripCodeAndLinks(content);
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = INLINE_TAG_RE.exec(cleaned)) !== null) {
    tags.push(match[1]);
  }
  return tags;
}
```

Change to normalize extracted tags to lowercase:
```typescript
export function extractInlineTags(content: string): string[] {
  const cleaned = stripCodeAndLinks(content);
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = INLINE_TAG_RE.exec(cleaned)) !== null) {
    tags.push(match[1].toLowerCase());
  }
  return tags;
}
```

- **PATTERN**: Matches the normalization approach used in Bug 2 (normalize at the read boundary)
- **GOTCHA**: This changes the return value of `extractInlineTags` for mixed-case tags. Verify no downstream code depends on preserving original case. Looking at callers: `vault-tools.ts:108` uses it for reporting (now lowercase — acceptable), `tag-tools.ts:62` uses it for matching against `oldTag` (now matches correctly).
- **VALIDATE**: `bun test tests/tag-parser.test.ts` — existing tests still pass (all test tags are already lowercase)

### Task 8: UPDATE `lib/tag-parser.ts` — Bug 3b: case-insensitive `removeInlineTag`

**File:** `lib/tag-parser.ts` → `removeInlineTag()` function

Current code (line 98):
```typescript
const tagRemoveRe = new RegExp(`(^|\\s)#${escapedTag}(?=\\s|$|[.,;:!?)])`, "g");
```

Change `"g"` to `"gi"`:
```typescript
const tagRemoveRe = new RegExp(`(^|\\s)#${escapedTag}(?=\\s|$|[.,;:!?)])`, "gi");
```

- **VALIDATE**: `bun test tests/tag-parser.test.ts`

### Task 9: ADD tests for Bug 3 fixes

**File:** `tests/tag-parser.test.ts`

Add to the `extractInlineTags` describe block:

```typescript
test("normalizes extracted tags to lowercase", () => {
  const tags = extractInlineTags("Text #Plutus-docs-design and #AI-TOOLS here");
  expect(tags).toContain("plutus-docs-design");
  expect(tags).toContain("ai-tools");
  expect(tags).not.toContain("Plutus-docs-design");
  expect(tags).not.toContain("AI-TOOLS");
});
```

Add to the `removeInlineTag` describe block:

```typescript
test("removes tag regardless of case", () => {
  const result = removeInlineTag("Some text #Plutus-docs-design more text", "plutus-docs-design");
  expect(result).not.toContain("#Plutus-docs-design");
  expect(result).toContain("Some text");
  expect(result).toContain("more text");
});

test("removes multiple case variations", () => {
  const result = removeInlineTag("#Tag1 and #TAG1 and #tag1", "tag1");
  expect(result).not.toContain("#Tag1");
  expect(result).not.toContain("#TAG1");
  expect(result).not.toContain("#tag1");
});
```

- **VALIDATE**: `bun test tests/tag-parser.test.ts` — all pass including new tests

### Task 10: RUN full test suite checkpoint

Before making prompt changes, verify all bug fixes pass together.

- **VALIDATE**: `bun test tests/frontmatter.test.ts tests/tag-parser.test.ts tests/tag-scheme.test.ts`

### Task 11: UPDATE `tagging-agent.ts` — replace `buildPlanSystemPrompt`

**File:** `tagging-agent.ts` → `buildPlanSystemPrompt()` function (lines 51-87)

Replace the ENTIRE function with this exact code:

```typescript
export function buildPlanSystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are a tag migration planning agent for an Obsidian vault. Today's date is ${today}.

Your task is to create a complete, machine-executable migration plan. This phase is REVIEW-ONLY — do NOT apply any changes to notes, only write the plan note.

## Available Tools

- \`list_notes\`: List all notes in the vault
- \`read_note\`: Read a note's content and tags
- \`write_note\`: Write the migration plan to the vault
- \`search_notes\`: Find notes with specific tags (use sparingly)
- \`git_commit\`: Commit the plan note after writing

## Phase 1: Read Inputs

1. Call \`read_note({ path: "_Tag Audit Report.md", detail: "full" })\` to get the audit data.
   - If not found, stop and report an error. The audit phase must run first.
2. Call \`read_note({ path: "${SCHEME_NOTE_PATH}", detail: "full" })\` to get the target scheme.

## Phase 2: Create Tag Mapping Table

Based on the audit and scheme, create a mapping for EVERY tag found in the audit:

| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`daily-reflection\` | \`type/daily-note\` | MAP | Move to type hierarchy |
| \`heading\` | (remove) | REMOVE | Noise tag |
| \`technical-writing\` | \`technical-writing\` | CLEAN | Already valid topic tag |
| \`ai-tools\` | \`ai-tools\` | KEEP | Already valid, no change needed |
| \`code_review\` | ? | UNMAPPED | Needs user decision |

Action types:
- **MAP**: Transform to new hierarchical tag
- **REMOVE**: Delete entirely (noise/obsolete)
- **CLEAN**: Remove # prefix only, keep tag name
- **KEEP**: No change needed (already valid)
- **UNMAPPED**: Cannot determine mapping, needs user input

## Phase 3: Generate Per-Note Worklist (CRITICAL)

This is the most important step. You MUST generate a complete worklist of every note that needs changes.

### Algorithm

1. Call \`list_notes({ recursive: true })\` to get all notes
2. For each note where \`tagCount > 0\`:
   - Call \`read_note({ path: note.path, detail: "minimal" })\`
   - For each tag in the note's \`allTags\` and \`noiseTags\`:
     - Look up the tag in your mapping table
     - If action is MAP or REMOVE: add to this note's changes array
     - If action is CLEAN: add change with oldTag → cleaned version
     - If action is KEEP: skip (no change needed)
     - If action is UNMAPPED: add to unmappedTags list
   - If note has any changes, add to worklist
3. Build the JSON worklist structure

### Worklist JSON Schema

\`\`\`json
{
  "generatedAt": "ISO-8601 timestamp",
  "schemeVersion": "1.0",
  "generatedBy": "plan-phase-agent",
  "totalNotes": 597,
  "totalChanges": 1847,
  "worklist": [
    {
      "path": "relative/path/to/note.md",
      "changes": [
        {
          "oldTag": "tag-without-hash",
          "newTag": "new-tag-or-null"
        }
      ]
    }
  ],
  "unmappedTags": [
    {
      "tag": "unmapped-tag-name",
      "occurrences": 3,
      "notePaths": ["note1.md", "note2.md", "note3.md"],
      "suggestedMapping": "optional-suggestion"
    }
  ]
}
\`\`\`

### Important Rules for Worklist

- Include ALL notes that need ANY changes
- For each note, include ALL tag changes (not just one)
- \`oldTag\` should NOT include the # prefix
- \`newTag\` should be the final form (no # prefix)
- \`newTag: null\` means remove the tag entirely
- Do NOT include notes where all tags have action KEEP

## Phase 4: Write the Plan Note

Write the complete plan to \`_Tag Migration Plan.md\` using:
\`\`\`
write_note({
  path: "_Tag Migration Plan.md",
  content: <plan markdown>,
  frontmatter: { tags: ["type/report"], date: "${today}" }
})
\`\`\`

The plan note must include these sections in order:
1. Executive Summary
2. Tag Mapping Table (human-readable)
3. Unmapped Tags Requiring Decisions
4. Migration Statistics (total notes, changes, unmapped count)
5. **Machine-Parseable Worklist** — a section containing the complete JSON worklist in a fenced code block

Then call \`git_commit({ message: "Plan complete: _Tag Migration Plan.md" })\`.

## Budget Guidance

- Reading all ~600 tagged notes at "minimal" detail: ~30K tokens
- This is expected and necessary
- Do NOT skip the worklist generation to save budget
- The worklist enables 50% cost savings in execute phase

## Constraints

- New tags must conform to lowercase kebab-case with valid prefixes: status/, type/, area/, project/ (or flat topic tags without prefix).
- The migration plan is the input for the execute phase — it must be comprehensive and machine-parseable.
- Execution batch size will be ${config.batchSize} notes per invocation.
- Vault path: ${config.vaultPath}`;
}
```

**Existing test assertions satisfied:**
- `"_Tag Audit Report.md"` ✅ (Phase 1)
- `"Proposed Tagging System.md"` ✅ (via `${SCHEME_NOTE_PATH}`)
- `"_Tag Migration Plan.md"` ✅ (Phase 4)
- `"write_note"` ✅ (Available Tools + Phase 4)
- `"git_commit"` ✅ (Available Tools + Phase 4)
- `"50"` ✅ (via `${config.batchSize}`)
- `"REVIEW-ONLY"` ✅ (first paragraph)

- **VALIDATE**: `bun test tests/agent-prompts.test.ts`

### Task 12: UPDATE `tagging-agent.ts` — replace `buildExecuteSystemPrompt`

**File:** `tagging-agent.ts` → `buildExecuteSystemPrompt()` function (lines 89-121)

Replace the ENTIRE function with this exact code:

```typescript
export function buildExecuteSystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are a tag migration execution agent. Today's date is ${today}.

Your task is to apply pre-computed tag changes from the migration plan. You are executing a DETERMINISTIC plan — apply ONLY the changes specified in the worklist. Do NOT improvise or add extra tag changes.

## Critical Constraints

- Do NOT use search_notes — the worklist tells you exactly what to process
- Do NOT use Bash or shell commands — all vault access goes through MCP tools
- Do NOT skip notes or change the processing order
- Do NOT modify anything beyond what the worklist specifies

## Available Tools

- \`read_note\`: Read notes (for progress file and plan)
- \`write_note\`: Write progress file
- \`apply_tag_changes\`: Apply tag changes to a note
- \`git_commit\`: Create checkpoint commits

## Execution Algorithm

Follow these steps EXACTLY:

### Step 1: Read Progress File

\`\`\`
read_note({ path: "_Migration_Progress.json", detail: "full" })
\`\`\`

- If file exists: Parse JSON, extract \`processedPaths\` array and determine batch number from \`batchHistory.length + 1\`
- If file doesn't exist (first batch): Initialize empty progress — processedPaths = [], batchNumber = 1

### Step 2: Read Migration Plan

\`\`\`
read_note({ path: "_Tag Migration Plan.md", detail: "full" })
\`\`\`

Find the JSON code block in the "Machine-Parseable Worklist" section. Parse it to get:
- \`worklist\`: Array of { path, changes } objects
- \`totalNotes\`: Total notes to process

### Step 3: Compute This Batch

Filter to unprocessed notes and take the next batch:
- remaining = worklist entries where path is NOT in processedPaths
- batch = first ${config.batchSize} entries from remaining
- If batch is empty: report "Migration complete! All notes processed." and skip to Step 8

### Step 4: Pre-Batch Commit

\`\`\`
git_commit({ message: "Pre-batch <N> checkpoint" })
\`\`\`

### Step 5: Process Each Note

For each item in the batch, in order:

\`\`\`
apply_tag_changes({
  path: item.path,
  changes: item.changes
})
\`\`\`

Log the result (path + success/warnings). If there are warnings, note them but continue.
If apply_tag_changes fails for a note, log the error and skip that note — continue with the rest of the batch.

### Step 6: Update Progress File

Create or update the progress JSON and write it:

\`\`\`
write_note({
  path: "_Migration_Progress.json",
  content: JSON.stringify({
    migrationId: "<descriptive-id>",
    worklistSource: "_Tag Migration Plan.md",
    startedAt: "<timestamp from batch 1 or existing>",
    lastUpdatedAt: "<now>",
    totalInWorklist: <total>,
    processedCount: <previous + this batch>,
    remainingCount: <total - processedCount>,
    processedPaths: [...previousPaths, ...batchPaths],
    batchHistory: [...previousBatches, {
      batchNumber: <N>,
      startedAt: "<batch start>",
      completedAt: "<now>",
      notesProcessed: <count>,
      commitHash: "<from step 7>",
      warnings: [<any warnings>]
    }],
    errors: [<any errors>]
  }, null, 2)
})
\`\`\`

### Step 7: Post-Batch Commit

\`\`\`
git_commit({ message: "Tag migration batch <N>: <count> notes processed" })
\`\`\`

### Step 8: Report Results

Output a summary:
- Batch number
- Notes processed this batch
- Total processed so far
- Notes remaining
- Any warnings encountered
- Whether more invocations are needed

## Error Handling

- If apply_tag_changes returns warnings: Log them, continue processing
- If apply_tag_changes fails completely for a note: Log error, skip that note, continue batch
- If progress file is corrupted: Report error, stop (don't risk losing progress data)

## Forbidden Actions

These actions will cause problems — DO NOT DO THEM:
- search_notes — The worklist already has everything needed
- Bash/shell commands — Violates MCP boundary
- Skipping notes — Process in worklist order
- Re-ordering notes — Process in worklist order
- Modifying note content beyond tags — Only change tags
- Processing notes not in worklist — Only process listed notes

## Vault path: ${config.vaultPath}`;
}
```

**Existing test assertions satisfied:**
- `"_Tag Migration Plan.md"` ✅ (Steps 2, 6)
- `"apply_tag_changes"` ✅ (Available Tools + Step 5)
- `"git_commit"` ✅ (Available Tools + Steps 4, 7)
- `"read_note"` ✅ (Available Tools + Steps 1, 2)
- `"50"` ✅ (via `${config.batchSize}` in Step 3)
- `"skip"` ✅ ("skip that note" in Step 5, "skip to Step 8" in Step 3)
- today's date ✅ (via `${today}`)
- `"ONLY the changes specified"` ✅ (first paragraph, verbatim)

- **VALIDATE**: `bun test tests/agent-prompts.test.ts`

### Task 13: UPDATE `tagging-agent.ts` — replace `buildVerifySystemPrompt`

**File:** `tagging-agent.ts` → `buildVerifySystemPrompt()` function (lines 123-157)

Replace the ENTIRE function with this exact code:

```typescript
export function buildVerifySystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are a tag migration verification agent. Today's date is ${today}.

Your task is to perform a READ-ONLY verification scan of the entire vault, checking for full tag compliance and writing a verification report.

## Available Tools

- \`list_notes\`: List all notes in the vault
- \`read_note\`: Read a note's content and tags
- \`write_note\`: Write the verification report
- \`git_commit\`: Commit the verification report

## Verification Algorithm

1. Call \`list_notes({ recursive: true })\` to get the full vault inventory.
2. Read the proposed tagging scheme for reference: \`read_note({ path: "${SCHEME_NOTE_PATH}", detail: "full" })\`.
3. For each note (excluding those prefixed with _ — agent artifacts like reports):
   - Call \`read_note({ path, detail: "minimal" })\` to get tag data.
   - Use "minimal" detail to stay within budget (~50 tokens per note).
   - Process notes in batches of 100 if needed to manage context window.
4. For each note, run all verification checks (see below).
5. Compile results and write the verification report.

## Verification Checks

For each note, verify:

### 1. No Inline Tags Remaining

All tags should be in YAML frontmatter, not inline in the body.
- Pass: Note has tags only in frontmatter (\`inlineTags\` array is empty)
- Fail: Note has \`#tag\` in body text (outside code blocks)

### 2. No Hash Prefixes in Frontmatter

Frontmatter tags should not have \`#\` prefix.
- Pass: \`tags: [daily-note, ai-tools]\`
- Fail: \`tags: [#daily-note, #ai-tools]\`

### 3. Valid Tag Formats

Tags must be lowercase kebab-case. Two formats are BOTH valid:

**Prefixed tags** (hierarchical):
- \`status/pending\`, \`status/completed\`, \`status/archived\`
- \`type/daily-note\`, \`type/meeting\`, \`type/research\`
- \`area/career\`, \`area/learning\`, \`area/health\`
- \`project/isee\`, \`project/blockfrost\`

**Flat topic tags** (no prefix):
- \`ai-tools\`, \`technical-writing\`, \`meditation\`
- \`blockchain\`, \`prompting\`, \`spirituality\`
- Any lowercase kebab-case string without a prefix

BOTH formats are VALID. Flat topic tags are NOT violations.

Only flag tags that:
- Contain uppercase letters: \`Daily-Note\` — invalid
- Contain underscores: \`ai_tools\` — invalid
- Contain \`#\` prefix: \`#topic\` — invalid
- Are purely numeric: \`123\` — invalid (noise)
- Are known noise patterns: \`heading\`, \`follow-up-required-*\`

### 4. No Duplicate Tags

A note should not have the same tag twice (even with different casing).

## Write Verification Report

Write the report using:
\`\`\`
write_note({
  path: "_Tag Migration Verification.md",
  content: <report>,
  frontmatter: { tags: ["type/report"], date: "${today}", "generated-by": "verify-phase-agent" }
})
\`\`\`

Report structure:
1. Executive Summary — overall pass/fail verdict and compliance percentage
2. Compliance Statistics — notes scanned, fully compliant, with violations
3. Violations Found — grouped by type (inline tags, invalid formats, hash prefixes, duplicates)
4. Tag Usage Summary — breakdown by prefix category
5. Recommendations — any suggested follow-up actions

Then call \`git_commit({ message: "Verification complete: _Tag Migration Verification.md" })\`.

## Important Notes

- Flat topic tags (no prefix, lowercase kebab-case) are VALID — do not flag them
- Code blocks may contain \`#\` that looks like tags — ignore these
- Agent artifact notes (prefixed with _) should be excluded from the scan
- Focus on actionable violations, not stylistic preferences
- This is a READ-ONLY verification — do NOT modify any notes except writing the report
- Vault path: ${config.vaultPath}`;
}
```

**Existing test assertions satisfied:**
- `"_Tag Migration Verification.md"` ✅ (Write Verification Report section)
- `"list_notes"` ✅ (Available Tools + Algorithm step 1)
- `"read_note"` ✅ (Available Tools + Algorithm step 2-3)
- `"write_note"` ✅ (Available Tools + Write section)
- `"git_commit"` ✅ (Available Tools + after write)
- `"minimal"` in quotes ✅ (`detail: "minimal"` in Algorithm step 3)
- `"READ-ONLY"` ✅ (first paragraph + Important Notes)
- today's date ✅ (via `${today}`)
- `"prefixed with _"` ✅ (Important Notes: "prefixed with _")

- **VALIDATE**: `bun test tests/agent-prompts.test.ts`

### Task 14: ADD new tests to `tests/agent-prompts.test.ts` (no existing tests modified)

**File:** `tests/agent-prompts.test.ts`

Because the new prompts were carefully written to contain all substrings the existing tests check for, NO existing tests need modification. Only ADD new tests.

Add to the `buildPlanSystemPrompt` describe block (after existing tests):

```typescript
  test("contains worklist generation instructions", () => {
    expect(prompt).toContain("Machine-Parseable Worklist");
  });

  test("specifies worklist JSON schema", () => {
    expect(prompt).toContain('"worklist"');
    expect(prompt).toContain('"unmappedTags"');
  });

  test("instructs scanning all tagged notes", () => {
    expect(prompt).toContain("list_notes");
    expect(prompt).toContain("read_note");
  });
```

Add to the `buildExecuteSystemPrompt` describe block (after existing tests):

```typescript
  test("references progress file", () => {
    expect(prompt).toContain("_Migration_Progress.json");
  });

  test("references Machine-Parseable Worklist section", () => {
    expect(prompt).toContain("Machine-Parseable Worklist");
  });

  test("forbids search_notes usage", () => {
    expect(prompt).toContain("search_notes");
  });

  test("forbids Bash usage", () => {
    expect(prompt).toContain("Bash");
  });
```

Add to the `buildVerifySystemPrompt` describe block (after existing tests):

```typescript
  test("recognizes flat topic tags as valid", () => {
    expect(prompt).toContain("Flat topic tags");
  });

  test("flags purely numeric tags as invalid", () => {
    expect(prompt).toContain("numeric");
  });

  test("lists both valid tag formats", () => {
    expect(prompt).toContain("Prefixed tags");
    expect(prompt).toContain("Flat topic tags");
  });
```

- **VALIDATE**: `bun test tests/agent-prompts.test.ts` — all existing + new tests pass

### Task 15: UPDATE `.env.example` — remove legacy fields

**File:** `.env.example`

Remove lines 6-9 (the `AGENT_TOPIC` and `OUTPUT_DIR` fields). These are from the original workshop project and are not used by the tagging agent.

New `.env.example` content:
```bash
# Anthropic API Key (required if not using Claude Code OAuth, but OAuth is recommended to use your subscription!)
# To use your subscription, just log into Claude Code as you normally would and don't set this
# ANTHROPIC_API_KEY=sk-ant-xxxxx

# Maximum budget per run (USD, more for if you use the Anthropic API Key)
MAX_BUDGET_USD=1.00

# Model to use (optional)
# AGENT_MODEL=claude-sonnet-4-20250514

# --- Tagging Agent Configuration ---

# Path to Obsidian vault (required for tagging agent)
VAULT_PATH="/Users/you/path/to/obsidian-vault"

# Agent execution mode: audit | plan | execute | verify
AGENT_MODE="audit"

# Batch size for execute mode
BATCH_SIZE=50
```

- **VALIDATE**: Visual inspection — no `AGENT_TOPIC` or `OUTPUT_DIR`

### Task 16: REMOVE stale duplicate file

Delete `maiden-voyage-2026-01-31.md` from the repo root (the canonical copy is at `.agents/retrospectives/maiden-voyage-2026-01-31.md`).

- **VALIDATE**: `ls maiden-voyage-2026-01-31.md` should fail (file not found)

### Task 17: RUN full validation

Run the complete test suite and type checker:

- **VALIDATE**: `bun test` — discovers all 10 test files, unit tests pass (note: `basic.test.ts`, `configurations.test.ts`, `hooks.test.ts`, `mcp.test.ts`, `subagents.test.ts` make API calls and may fail if no API key; the critical tests are `frontmatter.test.ts`, `tag-parser.test.ts`, `tag-scheme.test.ts`, `agent-prompts.test.ts`, `tools-smoke.test.ts`)
- **VALIDATE**: `bunx tsc --noEmit` — zero type errors

---

## TESTING STRATEGY

### Unit Tests (modified)

| Test file | What's tested | Changes |
|-----------|---------------|---------|
| `tests/frontmatter.test.ts` | `getFrontmatterTags` `#` stripping | Add 2 tests (Task 4) |
| `tests/tag-parser.test.ts` | Numeric noise, case normalization, case-insensitive removal | Add 5 tests (Tasks 6, 9) |
| `tests/agent-prompts.test.ts` | Prompt content assertions | Update ~3 assertions, add ~4 new tests (Task 14) |

### Edge Cases

- Frontmatter tag `"##double-hash"` → should become `"#double-hash"` (only strip one `#`). Current `.replace(/^#/, "")` handles this correctly.
- Frontmatter tag `""` (empty string) → passes type filter but is empty. Current code returns it; acceptable.
- Tag `"0"` → purely numeric, should be noise. The `/^\d+$/` regex matches this.
- Mixed `extractInlineTags` with code block containing `#UpperCase` → code block tag should not appear in output at all (existing test covers this).

---

## VALIDATION COMMANDS

### Level 1: Type Checking
```bash
bunx tsc --noEmit
```

### Level 2: Unit Tests (critical — pure functions, no API)
```bash
bun test tests/frontmatter.test.ts tests/tag-parser.test.ts tests/tag-scheme.test.ts tests/agent-prompts.test.ts tests/tools-smoke.test.ts
```

### Level 3: Full Test Suite
```bash
bun test
```

### Level 4: Manual Verification of Bug Fixes
```bash
bun -e "
import { isNoiseTag, extractInlineTags, removeInlineTag } from './lib/tag-parser.js';
import { getFrontmatterTags } from './lib/frontmatter.js';

console.log('Bug 1 - numeric noise:');
console.log('  isNoiseTag(\"1\"):', isNoiseTag('1'));  // true
console.log('  isNoiseTag(\"tag1\"):', isNoiseTag('tag1'));  // false

console.log('Bug 2 - frontmatter # strip:');
console.log('  getFrontmatterTags({ tags: [\"#foo\", \"bar\"] }):', getFrontmatterTags({ tags: ['#foo', 'bar'] }));  // ['foo', 'bar']

console.log('Bug 3a - extractInlineTags lowercase:');
console.log('  extractInlineTags(\"#Plutus-docs-design\"):', extractInlineTags('#Plutus-docs-design'));  // ['plutus-docs-design']

console.log('Bug 3b - case-insensitive removal:');
console.log('  removeInlineTag(\"text #Foo here\", \"foo\"):', removeInlineTag('text #Foo here', 'foo'));  // 'text here'
"
```

---

## ACCEPTANCE CRITERIA

- [ ] `bun test` discovers all 10 test files (renamed to `*.test.ts`)
- [ ] `isNoiseTag("1")` returns `true`, `isNoiseTag("tag1")` returns `false`
- [ ] `getFrontmatterTags({ tags: ["#foo", "bar"] })` returns `["foo", "bar"]`
- [ ] `extractInlineTags("#MixedCase")` returns `["mixedcase"]`
- [ ] `removeInlineTag("text #MixedCase end", "mixedcase")` removes the tag
- [ ] Plan system prompt contains "Machine-Parseable Worklist" and JSON schema
- [ ] Execute system prompt references `_Migration_Progress.json` and forbids `search_notes`
- [ ] Verify system prompt recognizes flat topic tags as valid
- [ ] All unit tests pass (frontmatter, tag-parser, tag-scheme, agent-prompts, tools-smoke)
- [ ] `bunx tsc --noEmit` passes with zero errors
- [ ] `package.json` has no stale scripts
- [ ] `.env.example` has no legacy `AGENT_TOPIC`/`OUTPUT_DIR` fields
- [ ] Root `maiden-voyage-2026-01-31.md` removed

---

## COMPLETION CHECKLIST

- [ ] All 17 tasks completed in order
- [ ] Each task validation passed immediately after completion
- [ ] All validation commands executed successfully (Levels 1-4)
- [ ] Full test suite passes
- [ ] No type errors
- [ ] Acceptance criteria all met

---

## NOTES

### Key Insight: Bug 3 Has Two Defects
The `BUG_FIXES.md` document only addresses the regex flag in `removeInlineTag`. But the actual execution path in `apply_tag_changes` (tag-tools.ts:69) uses `inlineTags.includes(oldTag)` which is case-sensitive. If `extractInlineTags` returns `"Plutus-docs-design"` and `oldTag` is `"plutus-docs-design"`, the `includes` check fails and `removeInlineTag` is never called. Task 7 fixes this by normalizing `extractInlineTags` output to lowercase.

### Prompt Test Strategy
The new prompts were carefully written to contain every substring the existing tests check for (verified per-assertion in Tasks 11-13). This means NO existing test assertions need modification — Task 14 only ADDS new tests. This is the key de-risking insight: by preserving key phrases like "REVIEW-ONLY", "ONLY the changes specified", "prefixed with _", and `"minimal"` in the new prompts, we avoid the fragile step of updating test expectations.

### What This Plan Does NOT Cover
- `allowedTools` enforcement verification (P3 from retrospective — needs SDK testing, deferred)
- `list_notes` pagination (P3 — not needed for 884-note vault)
- `search_notes` tag metadata enrichment (P3 — eliminated by worklist approach)
- These are intentionally deferred as lower priority.

### Risk: Prompt Length
The new prompts are 2-3x longer than originals. This is acceptable — prompt tokens are cheap (~$0.01 total) compared to the $4.50+ savings from efficient execution.

### Success Metrics (from maiden voyage baseline)

| Metric | Maiden Voyage | Target |
|--------|---------------|--------|
| Execute cost per note | $0.018 | < $0.010 |
| Execute batches for 597 notes | 18 | < 12 |
| Manual fixes required | 4 | 0 |
| Bash tool usage in execute | Multiple | 0 |
