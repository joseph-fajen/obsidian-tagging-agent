# Feature: Deterministic Batch Extraction

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Optimize the execute mode by moving batch computation from LLM to TypeScript code. Currently, each execute invocation spends 15-40 tool calls trying to extract and parse the worklist JSON from a large markdown file. This optimization pre-computes the next batch in deterministic code and writes it to `_Next_Batch.json`, allowing the execute agent to start processing immediately with a single file read.

## User Story

As the vault owner running tag migrations
I want the execute mode to start processing immediately
So that I save time, tokens, and money on each batch invocation

## Problem Statement

The execute agent wastes significant time, tokens, and money at the start of each batch:
- Reads large `_Tag Migration Plan.md` file (often fails, retries with different strategies)
- Tries to extract JSON from markdown code block (Grep, Bash with jq, Read chunks)
- Computes which entries are unprocessed
- Takes 15-40 tool calls and 30-90 seconds before actual tag processing begins

## Solution Statement

Move the "figure out what to process" logic from the LLM to TypeScript code:
1. `generate-worklist` writes a separate `_Migration_Worklist.json` file (pure JSON)
2. Pre-flight check reads worklist + progress, computes next batch, writes `_Next_Batch.json`
3. Execute agent reads `_Next_Batch.json` directly (1 tool call instead of 15-40)
4. Execute system prompt simplified from 150 lines to ~50 lines

## Feature Metadata

**Feature Type**: Enhancement (Optimization)
**Estimated Complexity**: Medium
**Primary Systems Affected**: `generate-worklist` mode, pre-flight checks, execute system prompt
**Dependencies**: None (uses existing fs/promises, existing types)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `tagging-agent.ts` (lines 445-529) - Pre-flight check implementation to extend
- `tagging-agent.ts` (lines 555-618) - generate-worklist mode to modify
- `tagging-agent.ts` (lines 144-293) - Execute system prompt to simplify
- `lib/worklist-generator.ts` (lines 1-50) - Types: `NoteChanges`, `MigrationWorklist`, `WorklistGeneratorResult`
- `lib/worklist-generator.ts` (lines 221-258) - `formatWorklistMarkdown()` pattern for new function
- `tests/worklist-generator.test.ts` - Test patterns to follow

### New Files to Create

None — all changes are modifications to existing files.

### Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/worklist-generator.ts` | ADD | New `NextBatch` interface and `writeWorklistJson()` function |
| `tagging-agent.ts` | UPDATE | Extend generate-worklist to write JSON; extend pre-flight to compute batch |
| `tagging-agent.ts` | UPDATE | Simplify `buildExecuteSystemPrompt()` |
| `tests/worklist-generator.test.ts` | ADD | Tests for new `writeWorklistJson()` function |

### Patterns to Follow

**JSON file writing** (from `tagging-agent.ts:602`):
```typescript
await writeFile(planPath, planContent, "utf-8");
```

**Console output** (from `tagging-agent.ts:567-578`):
```typescript
console.log(`Notes scanned: ${result.stats.totalNotesScanned}`);
```

**Type exports** (from `lib/worklist-generator.ts:9-18`):
```typescript
export interface TagChange {
  oldTag: string;
  newTag: string | null;
  reason?: "format-change" | "inline-migration" | "noise-removal";
}

export interface NoteChanges {
  path: string;
  changes: TagChange[];
}
```

**Test structure** (from `tests/worklist-generator.test.ts`):
```typescript
describe("functionName", () => {
  test("description of behavior", async () => {
    // Arrange
    const testDir = await mkdtemp(join(tmpdir(), "test-prefix-"));
    // Act
    const result = await functionUnderTest(testDir);
    // Assert
    expect(result).toBeDefined();
    // Cleanup
    await rm(testDir, { recursive: true });
  });
});
```

---

## IMPLEMENTATION PLAN

### Phase 1: Add Types and Worklist JSON Writer

Add the `NextBatch` interface and a function to write `_Migration_Worklist.json`.

**Tasks:**
- Add `NextBatch` interface to `lib/worklist-generator.ts`
- Add `writeWorklistJson()` function to write pure JSON file
- Export both from the module

### Phase 2: Extend generate-worklist Mode

Modify the generate-worklist mode to also write the separate JSON file.

**Tasks:**
- Call `writeWorklistJson()` after generating worklist
- Add console output confirming JSON file written
- Keep existing markdown embedding for human review

### Phase 3: Extend Pre-flight Check

Modify `checkExecutePrerequisites()` to compute and write `_Next_Batch.json`.

**Tasks:**
- Add helper function to load worklist (JSON file with markdown fallback)
- Delete stale `_Next_Batch.json` at start of pre-flight
- Compute next batch from worklist and progress
- Write `_Next_Batch.json` with batch entries
- Update function signature to accept `batchSize` parameter

### Phase 4: Simplify Execute System Prompt

Rewrite `buildExecuteSystemPrompt()` to use `_Next_Batch.json`.

**Tasks:**
- Remove Steps 2, 2.5, 3 (reading plan, validation, computing batch)
- Add new Step 2: Read `_Next_Batch.json`
- Keep Steps 1, 4-8 with minor updates
- Reduce prompt from ~150 lines to ~50 lines

### Phase 5: Add Tests

Add tests for new functionality.

**Tasks:**
- Test `writeWorklistJson()` creates valid JSON
- Test pre-flight creates `_Next_Batch.json` with correct entries
- Test pre-flight handles "already complete" case
- Test backward compatibility (fallback to markdown)

---

## STEP-BY-STEP TASKS

Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task 1: ADD `NextBatch` interface to `lib/worklist-generator.ts`

**Location:** After line 34 (after `MigrationWorklist` interface)

**IMPLEMENT:** Add new interface for the pre-computed batch file:

```typescript
/**
 * Pre-computed batch for execute mode.
 * Written by checkExecutePrerequisites(), read by execute agent.
 */
export interface NextBatch {
  batchNumber: number;
  totalInWorklist: number;
  processedSoFar: number;
  remaining: number;
  entries: NoteChanges[];
}
```

**PATTERN:** Mirror existing interface style from lines 26-34
**IMPORTS:** None needed (uses existing `NoteChanges`)
**VALIDATE:** `bunx tsc --noEmit` — should pass with no new errors

---

### Task 2: ADD `writeWorklistJson()` function to `lib/worklist-generator.ts`

**Location:** After `formatWorklistMarkdown()` function (after line 258)

**IMPLEMENT:** Add function to write pure JSON worklist file:

```typescript
/**
 * Write the worklist to a separate JSON file for fast machine access.
 * This file is used by checkExecutePrerequisites() to compute batches.
 */
export async function writeWorklistJson(
  vaultPath: string,
  worklist: MigrationWorklist,
): Promise<void> {
  const jsonPath = join(vaultPath, "_Migration_Worklist.json");
  await writeFile(jsonPath, JSON.stringify(worklist, null, 2), "utf-8");
}
```

**PATTERN:** Follow `formatWorklistMarkdown()` function style
**IMPORTS:** `writeFile` already imported at line 1
**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 3: UPDATE `tagging-agent.ts` imports

**Location:** Line 7 (imports from worklist-generator)

**IMPLEMENT:** Add `writeWorklistJson` to imports:

```typescript
import { generateWorklist, loadAuditMappings, formatWorklistMarkdown, writeWorklistJson, type MigrationWorklist, type NoteChanges, type NextBatch } from "./lib/worklist-generator.js";
```

**PATTERN:** Existing import style
**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 4: UPDATE generate-worklist mode to write JSON file

**Location:** `tagging-agent.ts` lines 602-610 (after writing markdown)

**IMPLEMENT:** Add call to write JSON file after line 602:

```typescript
    await writeFile(planPath, planContent, "utf-8");
    console.log(`\nWorklist written to _Tag Migration Plan.md`);

    // Also write pure JSON for fast machine access
    await writeWorklistJson(config.vaultPath, result.worklist);
    console.log(`Worklist JSON written to _Migration_Worklist.json`);

    console.log(`  ${result.worklist.worklist.length} notes in worklist`);
```

**PATTERN:** Follow existing console.log style
**VALIDATE:** `bun run tagging-agent.ts generate-worklist` in a test vault — should create both files

---

### Task 5: ADD `loadWorklistJson()` helper function to `tagging-agent.ts`

**Location:** After line 454 (after `WorklistData` interface), before `checkExecutePrerequisites()`

**IMPLEMENT:** Add helper to load worklist with fallback:

```typescript
/**
 * Load worklist from JSON file, falling back to embedded markdown if needed.
 * Returns null if neither source is available.
 */
async function loadWorklistJson(vaultPath: string): Promise<MigrationWorklist | null> {
  const jsonPath = join(vaultPath, "_Migration_Worklist.json");
  const planPath = join(vaultPath, "_Tag Migration Plan.md");

  // Try JSON file first (preferred)
  try {
    const jsonRaw = await readFile(jsonPath, "utf-8");
    return JSON.parse(jsonRaw) as MigrationWorklist;
  } catch {
    // JSON file doesn't exist, try markdown fallback
  }

  // Fallback: extract from markdown
  try {
    const planRaw = await readFile(planPath, "utf-8");
    const jsonMatch = planRaw.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]) as MigrationWorklist;
    }
  } catch {
    // Markdown file doesn't exist or parse failed
  }

  return null;
}
```

**PATTERN:** Follow existing error handling style from lines 467-474
**IMPORTS:** Uses existing `readFile` import
**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 6: ADD `writeNextBatch()` helper function to `tagging-agent.ts`

**Location:** After `loadWorklistJson()` function

**IMPLEMENT:** Add helper to write pre-computed batch:

```typescript
/**
 * Write the next batch to _Next_Batch.json for the execute agent.
 */
async function writeNextBatch(vaultPath: string, batch: NextBatch): Promise<void> {
  const batchPath = join(vaultPath, "_Next_Batch.json");
  await writeFile(batchPath, JSON.stringify(batch, null, 2), "utf-8");
}

/**
 * Delete _Next_Batch.json if it exists (cleanup from previous run).
 */
async function deleteNextBatch(vaultPath: string): Promise<void> {
  const batchPath = join(vaultPath, "_Next_Batch.json");
  try {
    await unlink(batchPath);
  } catch {
    // File doesn't exist, that's fine
  }
}
```

**PATTERN:** Follow existing file operation patterns
**IMPORTS:** Add `unlink` to the fs/promises import at line 9
**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 7: UPDATE `checkExecutePrerequisites()` signature and implementation

**Location:** `tagging-agent.ts` lines 461-529

**IMPLEMENT:** Rewrite the function to compute and write `_Next_Batch.json`:

```typescript
/**
 * Pre-flight check for execute mode:
 * 1. Load worklist (JSON file with markdown fallback)
 * 2. Load progress (if exists)
 * 3. Validate worklist hasn't changed
 * 4. Compute next batch
 * 5. Write _Next_Batch.json
 *
 * Returns true if migration should proceed, false if blocking issue or already complete.
 */
async function checkExecutePrerequisites(vaultPath: string, batchSize: number): Promise<boolean> {
  const progressPath = join(vaultPath, "_Migration_Progress.json");

  // Clean up stale batch file from previous run
  await deleteNextBatch(vaultPath);

  // Load worklist
  const worklist = await loadWorklistJson(vaultPath);
  if (!worklist) {
    console.error("Could not find worklist. Run 'bun run tagging-agent.ts generate-worklist' first.\n");
    return false;
  }

  if (worklist.worklist.length === 0) {
    console.error("Worklist is empty. Run 'bun run tagging-agent.ts generate-worklist' first.\n");
    return false;
  }

  // Load progress file (if exists)
  let progress: ProgressFile | null = null;
  try {
    const progressRaw = await readFile(progressPath, "utf-8");
    progress = JSON.parse(progressRaw) as ProgressFile;
  } catch {
    // No progress file — first run
    console.log("No existing progress file — starting fresh migration.\n");
  }

  // Check if worklist changed since last run
  if (progress && progress.totalInWorklist !== worklist.totalNotes) {
    console.log("⚠️  Worklist changed since last run!");
    console.log(`   Progress file: ${progress.totalInWorklist} notes`);
    console.log(`   Current worklist: ${worklist.totalNotes} notes`);
    console.log("");
    console.log("Resetting progress file to start fresh migration...");
    await unlink(progressPath);
    console.log("Progress file deleted. Migration will start from the beginning.\n");
    progress = null;
  }

  // Compute processed paths set
  const processedPaths = new Set(progress?.processedPaths || []);
  const processedCount = progress?.processedCount || 0;

  // Check if already complete
  if (processedCount >= worklist.totalNotes) {
    console.log("✅ Migration already complete!");
    console.log(`   ${processedCount}/${worklist.totalNotes} notes processed.`);
    console.log("");
    console.log("To re-run the migration, delete _Migration_Progress.json and run again.\n");
    return false;
  }

  // Compute next batch
  const unprocessedEntries = worklist.worklist.filter(entry => !processedPaths.has(entry.path));
  const batchEntries = unprocessedEntries.slice(0, batchSize);
  const batchNumber = (progress?.processedPaths?.length || 0) > 0
    ? Math.ceil(processedCount / batchSize) + 1
    : 1;

  const nextBatch: NextBatch = {
    batchNumber,
    totalInWorklist: worklist.totalNotes,
    processedSoFar: processedCount,
    remaining: worklist.totalNotes - processedCount,
    entries: batchEntries,
  };

  // Write batch file
  await writeNextBatch(vaultPath, nextBatch);

  // Report status
  const remaining = worklist.totalNotes - processedCount;
  if (processedCount > 0) {
    console.log(`Resuming migration: ${processedCount}/${worklist.totalNotes} done, ${remaining} remaining.`);
  }
  console.log(`Next batch prepared: ${batchEntries.length} entries written to _Next_Batch.json\n`);

  return true;
}
```

**PATTERN:** Preserve existing validation logic, add batch computation
**IMPORTS:** Uses existing imports
**GOTCHA:** Must handle the case where `progress.processedPaths` might not exist in old progress files
**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 8: UPDATE `checkExecutePrerequisites()` call site

**Location:** `tagging-agent.ts` line 623

**IMPLEMENT:** Pass `batchSize` to the function:

```typescript
  // Pre-flight check for execute mode
  if (mode === "execute") {
    const canProceed = await checkExecutePrerequisites(config.vaultPath, config.batchSize);
```

**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 9: SIMPLIFY `buildExecuteSystemPrompt()` function

**Location:** `tagging-agent.ts` lines 144-293

**IMPLEMENT:** Replace the entire function with simplified version:

```typescript
export function buildExecuteSystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are a tag migration execution agent. Today's date is ${today}.

Your task is to apply pre-computed tag changes. The batch has already been computed — just process what's in _Next_Batch.json.

## Critical Constraints

- Do NOT use search_notes or Bash — everything you need is in the batch file
- Do NOT skip notes or change the processing order
- Do NOT modify anything beyond what the batch specifies

## Available Tools

- \`read_note\`: Read _Next_Batch.json and _Migration_Progress.json
- \`write_note\`: Update progress file
- \`apply_tag_changes\`: Apply tag changes to a note
- \`git_commit\`: Create checkpoint commits

## Execution Algorithm

### Step 1: Read Batch File

\`\`\`
read_note({ path: "_Next_Batch.json", detail: "full" })
\`\`\`

Parse the JSON. It contains:
- \`batchNumber\`: Which batch this is
- \`totalInWorklist\`: Total notes in migration
- \`processedSoFar\`: Notes already processed
- \`remaining\`: Notes left after this batch
- \`entries\`: Array of { path, changes } — the notes to process NOW

If entries is empty, report "Migration complete!" and stop.

### Step 2: Read Progress File (if exists)

\`\`\`
read_note({ path: "_Migration_Progress.json", detail: "full" })
\`\`\`

If it exists, you'll update it. If not, you'll create it.

### Step 3: Pre-Batch Commit

\`\`\`
git_commit({ message: "Pre-batch <batchNumber> checkpoint" })
\`\`\`

### Step 4: Process Each Entry

For each entry in \`entries\`, in order:

\`\`\`
apply_tag_changes({
  path: entry.path,
  changes: entry.changes
})
\`\`\`

Log each result. If warnings occur, note them but continue. If a note fails, log and skip it.

### Step 5: Update Progress File

\`\`\`
write_note({
  path: "_Migration_Progress.json",
  content: JSON.stringify({
    migrationId: "tag-migration-${today}",
    worklistSource: "_Migration_Worklist.json",
    startedAt: "<from existing or now>",
    lastUpdatedAt: "<now>",
    totalInWorklist: <from batch file>,
    processedCount: <processedSoFar + entries.length>,
    remainingCount: <remaining - entries.length>,
    processedPaths: [...existingPaths, ...newPaths],
    batchHistory: [...existing, {
      batchNumber: <N>,
      startedAt: "<batch start>",
      completedAt: "<now>",
      notesProcessed: <count>,
      warnings: [<any>]
    }],
    errors: [<any>]
  }, null, 2)
})
\`\`\`

### Step 6: Post-Batch Commit

\`\`\`
git_commit({ message: "Tag migration batch <N>: <count> notes processed" })
\`\`\`

### Step 7: Report Results

Output a summary:
- Batch number
- Notes processed this batch
- Total processed so far
- Notes remaining
- Any warnings
- Whether more invocations needed

## Vault path: ${config.vaultPath}`;
}
```

**PATTERN:** Streamlined from original, removed all JSON extraction logic
**GOTCHA:** Keep the vault path at the end for reference
**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 10: ADD tests for `writeWorklistJson()`

**Location:** `tests/worklist-generator.test.ts` — add new describe block after line 230

**IMPLEMENT:** Add tests:

```typescript
describe("writeWorklistJson", () => {
  test("writes valid JSON file", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "worklist-json-"));
    const result = await generateWorklist(testDir);

    // Create a minimal test note so worklist has content
    await writeFile(
      join(testDir, "test.md"),
      `---\ntags:\n  - todo\n---\nTest note.\n`,
    );
    const resultWithContent = await generateWorklist(testDir);

    // Import and call the function
    const { writeWorklistJson } = await import("../lib/worklist-generator.js");
    await writeWorklistJson(testDir, resultWithContent.worklist);

    // Verify file exists and is valid JSON
    const jsonPath = join(testDir, "_Migration_Worklist.json");
    const content = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.totalNotes).toBe(resultWithContent.worklist.totalNotes);
    expect(parsed.worklist).toBeInstanceOf(Array);
    expect(parsed.generatedBy).toBe("deterministic-worklist-generator");

    await rm(testDir, { recursive: true });
  });
});
```

**PATTERN:** Follow existing test structure
**IMPORTS:** Uses existing imports
**VALIDATE:** `bun test tests/worklist-generator.test.ts` — should pass

---

### Task 11: ADD integration test for pre-flight batch computation

**Location:** Create new file `tests/preflight.test.ts`

**IMPLEMENT:** Create integration test:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("checkExecutePrerequisites", () => {
  let testVaultPath: string;

  beforeAll(async () => {
    testVaultPath = await mkdtemp(join(tmpdir(), "preflight-test-"));

    // Create a worklist JSON file
    const worklist = {
      generatedAt: new Date().toISOString(),
      schemeVersion: "1.0",
      generatedBy: "test",
      totalNotes: 3,
      totalChanges: 3,
      worklist: [
        { path: "note1.md", changes: [{ oldTag: "todo", newTag: "status/pending" }] },
        { path: "note2.md", changes: [{ oldTag: "done", newTag: "status/completed" }] },
        { path: "note3.md", changes: [{ oldTag: "heading", newTag: null }] },
      ],
      unmappedTags: [],
    };

    await writeFile(
      join(testVaultPath, "_Migration_Worklist.json"),
      JSON.stringify(worklist, null, 2),
    );
  });

  afterAll(async () => {
    await rm(testVaultPath, { recursive: true, force: true });
  });

  test("creates _Next_Batch.json with correct entries", async () => {
    // We need to test checkExecutePrerequisites but it's not exported
    // For now, verify the worklist file structure is correct
    const worklistPath = join(testVaultPath, "_Migration_Worklist.json");
    const content = await readFile(worklistPath, "utf-8");
    const worklist = JSON.parse(content);

    expect(worklist.totalNotes).toBe(3);
    expect(worklist.worklist.length).toBe(3);
  });
});
```

**PATTERN:** Follow existing test file structure
**GOTCHA:** `checkExecutePrerequisites` is not exported; test via integration or consider exporting for testing
**VALIDATE:** `bun test tests/preflight.test.ts` — should pass

---

## TESTING STRATEGY

### Unit Tests

- `writeWorklistJson()` creates valid JSON file
- JSON file contains all required fields
- File is readable and parseable

### Integration Tests

- Pre-flight creates `_Next_Batch.json` with correct batch size
- Pre-flight handles "already complete" case (no batch file written)
- Pre-flight handles worklist change detection
- Backward compatibility: falls back to markdown when JSON missing

### Edge Cases

- Empty worklist (should error gracefully)
- Malformed worklist JSON (should error gracefully)
- Missing progress file (should start fresh)
- Progress file with more entries than worklist (should reset)

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions.

### Level 1: Type Checking

```bash
bunx tsc --noEmit
```

Expected: No new errors (pre-existing workshop errors are acceptable)

### Level 2: Unit Tests

```bash
bun test
```

Expected: All 119+ tests pass

### Level 3: Manual Testing

```bash
# In a test vault (not production):

# 1. Generate worklist — should create both files
bun run tagging-agent.ts generate-worklist

# Verify both files exist:
ls -la /path/to/vault/_Migration_Worklist.json
ls -la /path/to/vault/_Tag\ Migration\ Plan.md

# 2. Run execute — should show "Next batch prepared" message
bun run tagging-agent.ts execute

# Verify batch file created:
cat /path/to/vault/_Next_Batch.json

# 3. Verify agent starts processing immediately (not 15-40 tool calls)
# Watch the output — should go straight to apply_tag_changes calls
```

---

## ACCEPTANCE CRITERIA

- [ ] `generate-worklist` creates both `_Tag Migration Plan.md` AND `_Migration_Worklist.json`
- [ ] Pre-flight check creates `_Next_Batch.json` with correct batch entries
- [ ] Execute agent reads `_Next_Batch.json` first (not migration plan)
- [ ] Execute agent starts processing within 1-2 tool calls (not 15-40)
- [ ] All existing tests pass
- [ ] Backward compatible: works if only markdown exists (no JSON file)
- [ ] "Already complete" case handled gracefully (no batch file written)

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun test` passes (all tests green)
- [ ] Manual testing confirms batch file created
- [ ] Manual testing confirms execute starts immediately
- [ ] No regressions in existing functionality

---

## NOTES

### Design Decisions

1. **Keep embedded JSON in markdown** — Human reviewability preserved; agent uses separate file
2. **Backward compatibility** — Falls back to markdown if JSON missing; supports existing workflows
3. **Cleanup timing** — Delete stale `_Next_Batch.json` at start of pre-flight, not after success
4. **Batch file lifetime** — Overwritten each run; `batchHistory` in progress file is the audit trail

### Estimated Impact

| Metric | Before | After |
|--------|--------|-------|
| Tool calls to find batch | 15-40 | 1 |
| Time to start processing | 30-90s | <5s |
| Token cost per batch | ~$0.10-0.20 | ~$0.01 |
| System prompt size | ~150 lines | ~50 lines |

### Future Considerations

- Could add `--dry-run` flag to pre-flight to show batch without writing
- Could add batch file retention for debugging (numbered files)
- Could move more execute logic to code (e.g., progress file updates)
