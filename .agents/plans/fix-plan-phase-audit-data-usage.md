---
status: IMPLEMENTED
implemented_date: 2026-02-05
commit: 8f9e7e7
---

# Feature: Fix Plan Phase to Use Audit Data Instead of Re-scanning

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

The plan phase currently re-scans all vault notes (100+ `read_note` calls) instead of using the `audit-data.json` file that the audit phase already created. This causes the plan phase to cost ~$0.85 and take ~60 seconds when it should cost ~$0.20 and take ~15 seconds.

The fix updates the plan system prompt to use `read_data_file` for audit data and adds a pre-flight check to ensure audit outputs exist before running the plan phase.

## User Story

As the tagging agent supervisor
I want the plan phase to use the audit data file instead of re-scanning notes
So that the plan phase runs faster (~15s vs ~60s) and costs less (~$0.20 vs ~$0.85)

## Problem Statement

The `buildPlanSystemPrompt()` function:
1. Lists `list_notes`, `read_note`, `search_notes` as available tools (implying they should be used)
2. Never mentions `read_data_file` or `audit-data.json`
3. Only tells agent to read the markdown report, not the structured JSON data
4. Has no constraint preventing re-scanning notes

As a result, the LLM agent makes 100+ unnecessary tool calls to gather data that already exists.

## Solution Statement

1. Update `buildPlanSystemPrompt()` to prioritize `read_data_file` and `audit-data.json`
2. Add explicit constraint forbidding re-scanning notes
3. Add `checkPlanPrerequisites()` pre-flight function
4. Integrate pre-flight into both CLI and interactive flows
5. Add tests for the new pre-flight function

## Feature Metadata

**Feature Type**: Bug Fix / Enhancement
**Estimated Complexity**: Low
**Primary Systems Affected**: `tagging-agent.ts`, `lib/interactive-agent.ts`
**Dependencies**: None (uses existing `read_data_file` tool)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING!

- `tagging-agent.ts` (lines 75-144) - **Current `buildPlanSystemPrompt()` function to modify**
- `tagging-agent.ts` (lines 480-578) - **`checkExecutePrerequisites()` pattern to follow**
- `tagging-agent.ts` (lines 687-698) - **CLI pre-flight integration pattern**
- `lib/interactive-agent.ts` (lines 571-575) - **Interactive mode integration point for PLAN phase**
- `tests/preflight.test.ts` - **Test pattern to follow for new pre-flight tests**

### New Files to Create

- None (all changes are to existing files)

### Files to Modify

| File | Change |
|------|--------|
| `tagging-agent.ts` | Update `buildPlanSystemPrompt()`, add `checkPlanPrerequisites()`, integrate in CLI flow |
| `lib/interactive-agent.ts` | Add pre-flight check before PLAN phase |
| `tests/preflight.test.ts` | Add tests for `checkPlanPrerequisites()` |

### Relevant Documentation — READ THESE BEFORE IMPLEMENTING!

- `CLAUDE.md` - Project conventions (kebab-case, no default exports, etc.)
- `PRD.md` (Section 7) - Tool specifications including `read_data_file`

### Patterns to Follow

**Pre-flight Function Pattern** (from `tagging-agent.ts:490-578`):
```typescript
async function checkExecutePrerequisites(
  dataPath: string,
  vaultPath: string,
  batchSize: number
): Promise<boolean> {
  // 1. Check required files exist
  // 2. Log helpful error if missing
  // 3. Return false to skip LLM invocation
  // 4. Return true if all prerequisites met
}
```

**Error Message Style** (from `tagging-agent.ts:500-501`):
```typescript
console.error("Could not find worklist. Run 'bun run tagging-agent.ts generate-worklist' first.\n");
return false;
```

**CLI Integration Pattern** (from `tagging-agent.ts:687-698`):
```typescript
if (mode === "execute") {
  const canProceed = await checkExecutePrerequisites(...);
  if (!canProceed) {
    // Log summary and return without LLM invocation
    return;
  }
}
```

**Test Pattern** (from `tests/preflight.test.ts`):
```typescript
describe("checkPlanPrerequisites", () => {
  let testVaultPath: string;
  let testDataPath: string;

  beforeAll(async () => {
    testVaultPath = await mkdtemp(join(tmpdir(), "preflight-test-"));
    testDataPath = await mkdtemp(join(tmpdir(), "preflight-data-"));
    // Create test files
  });

  afterAll(async () => {
    await rm(testVaultPath, { recursive: true, force: true });
    await rm(testDataPath, { recursive: true, force: true });
  });

  test("returns true when audit outputs exist", async () => { ... });
  test("returns false when audit-data.json missing", async () => { ... });
});
```

---

## IMPLEMENTATION PLAN

### Phase 1: Update Plan System Prompt

Modify `buildPlanSystemPrompt()` to:
- Add `read_data_file` as the primary tool for getting tag data
- Instruct agent to read `audit-data.json` FIRST
- Add explicit constraint against re-scanning notes
- De-prioritize `list_notes`, `read_note`, `search_notes`

### Phase 2: Add Pre-flight Check Function

Create `checkPlanPrerequisites()` following the `checkExecutePrerequisites` pattern:
- Check `audit-data.json` exists in `data/`
- Check `_Tag Audit Report.md` exists in vault
- Validate `audit-data.json` has required fields
- Return helpful error messages if prerequisites missing

### Phase 3: Integrate Pre-flight Checks

Add pre-flight integration in both:
- CLI mode (`tagging-agent.ts` in `runAgent()`)
- Interactive mode (`lib/interactive-agent.ts` before `runLLMPhase("PLAN", ...)`)

### Phase 4: Add Tests

Add tests for `checkPlanPrerequisites()` in `tests/preflight.test.ts`:
- Test returns true when all prerequisites exist
- Test returns false when `audit-data.json` missing
- Test returns false when `_Tag Audit Report.md` missing
- Test validates `audit-data.json` structure

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task 1: UPDATE `buildPlanSystemPrompt()` in `tagging-agent.ts`

**Location:** `tagging-agent.ts` lines 75-144

**IMPLEMENT:** Replace the "Available Tools" section with:

```typescript
## Available Tools

- \`read_data_file\`: Read structured data from data/ directory — **USE THIS FIRST** for audit-data.json
- \`read_note\`: Read a note's content — USE ONLY for the audit report and scheme note
- \`write_note\`: Write the migration plan to the vault
- \`git_commit\`: Commit the plan note after writing

Tools NOT needed for this phase (audit already collected this data):
- \`list_notes\` — vault inventory is in audit-data.json
- \`search_notes\` — tag frequencies are in audit-data.json
```

**IMPLEMENT:** Replace "Phase 1: Read Inputs" section with:

```typescript
## Phase 1: Read Inputs

1. Call \`read_data_file({ filename: "audit-data.json" })\` to get the COMPLETE tag data.
   - This file contains ALL unique tags with frequencies in \`tagFrequencies\`
   - It also contains audit-discovered mappings in \`mappings\`
   - You do NOT need to scan notes — this data is already collected.
   - If not found, stop and report an error. The audit phase must run first.
2. Call \`read_note({ path: "_Tag Audit Report.md", detail: "full" })\` for human-readable context.
3. Call \`read_note({ path: "${SCHEME_NOTE_PATH}", detail: "full" })\` to get the target scheme.
```

**IMPLEMENT:** Add after "Phase 1: Read Inputs":

```typescript
## Critical Constraint

DO NOT re-scan notes during the plan phase. The audit phase already collected:
- All unique tags with frequencies (in audit-data.json \`tagFrequencies\`)
- Audit-discovered mappings (in audit-data.json \`mappings\`)
- Notes with/without frontmatter counts

Your job is to CREATE MAPPINGS from the audit data, not to re-collect tag data.
If you find yourself calling \`list_notes\`, \`search_notes\`, or making many \`read_note\` calls,
STOP — you are duplicating audit work. Use the audit-data.json file instead.
```

**PATTERN:** Follow existing prompt section style in `buildAuditSystemPrompt()`
**VALIDATE:** `bun test tests/agent-prompts.test.ts`

---

### Task 2: CREATE `checkPlanPrerequisites()` function in `tagging-agent.ts`

**Location:** Add after `checkExecutePrerequisites()` function (around line 580)

**IMPLEMENT:**

```typescript
/**
 * Pre-flight check for plan mode:
 * 1. Verify audit-data.json exists in data/
 * 2. Verify _Tag Audit Report.md exists in vault
 * 3. Validate audit-data.json has required fields
 *
 * Returns true if plan phase should proceed, false if blocking issue.
 */
async function checkPlanPrerequisites(dataPath: string, vaultPath: string): Promise<boolean> {
  // Check audit-data.json exists
  const auditDataPath = join(dataPath, "audit-data.json");
  let auditData: { tagFrequencies?: Record<string, number>; mappings?: Record<string, string | null> } | null = null;

  try {
    const auditDataRaw = await readFile(auditDataPath, "utf-8");
    auditData = JSON.parse(auditDataRaw);
  } catch {
    console.error("Could not find audit-data.json. Run 'bun run tagging-agent.ts audit' first.\n");
    return false;
  }

  // Validate audit-data.json has required fields
  if (!auditData || !auditData.tagFrequencies) {
    console.error("audit-data.json is missing required 'tagFrequencies' field. Re-run audit phase.\n");
    return false;
  }

  // Check _Tag Audit Report.md exists
  const auditReportPath = join(vaultPath, "_Tag Audit Report.md");
  try {
    await readFile(auditReportPath, "utf-8");
  } catch {
    console.error("Could not find _Tag Audit Report.md. Run 'bun run tagging-agent.ts audit' first.\n");
    return false;
  }

  // Report what we found
  const tagCount = Object.keys(auditData.tagFrequencies).length;
  const mappingCount = auditData.mappings ? Object.keys(auditData.mappings).length : 0;
  console.log(`Found audit data: ${tagCount} unique tags, ${mappingCount} audit-discovered mappings.\n`);

  return true;
}
```

**PATTERN:** Mirror `checkExecutePrerequisites()` at lines 480-578
**IMPORTS:** Uses existing `join` from "path" and `readFile` from "fs/promises" (already imported)
**VALIDATE:** `bunx tsc --noEmit`

---

### Task 3: INTEGRATE pre-flight in CLI mode (`tagging-agent.ts`)

**Location:** `tagging-agent.ts` in `runAgent()` function, after the execute pre-flight check (around line 698)

**IMPLEMENT:** Add this block after the execute pre-flight check:

```typescript
  // Pre-flight check for plan mode
  if (mode === "plan") {
    const canProceed = await checkPlanPrerequisites(config.dataPath, config.vaultPath);
    if (!canProceed) {
      console.log("=".repeat(60));
      console.log(`Mode: ${mode} — prerequisites not met`);
      console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      console.log(`Cost: $0.0000 (pre-flight check only)`);
      console.log("=".repeat(60));
      return;
    }
  }
```

**PATTERN:** Mirror lines 687-698 for execute mode
**VALIDATE:** `bunx tsc --noEmit`

---

### Task 4: INTEGRATE pre-flight in interactive mode (`lib/interactive-agent.ts`)

**Location:** `lib/interactive-agent.ts` around line 571, modify the PLAN case

**IMPLEMENT:** Update the phase handling block. Change from:

```typescript
      if (phase === "AUDIT" || phase === "PLAN" || phase === "VERIFY") {
        // LLM phases
        const result = await runLLMPhase(phase, state.sessionId, config);
```

To:

```typescript
      if (phase === "AUDIT" || phase === "VERIFY") {
        // LLM phases (no pre-flight needed)
        const result = await runLLMPhase(phase, state.sessionId, config);
        state.sessionId = result.sessionId;
        phaseSuccess = result.success;
      } else if (phase === "PLAN") {
        // Plan phase with pre-flight check
        const prerequisitesMet = await checkPlanPrerequisites(config.dataPath, config.vaultPath);
        if (!prerequisitesMet) {
          console.log("\nPlease run the audit phase first to generate the required data.");
          phaseSuccess = false;
        } else {
          const result = await runLLMPhase(phase, state.sessionId, config);
          state.sessionId = result.sessionId;
          phaseSuccess = result.success;
        }
```

**IMPORTS:** Add import for `checkPlanPrerequisites` from `tagging-agent.ts`:
```typescript
import { checkPlanPrerequisites } from "../tagging-agent.js";
```

**GOTCHA:** Need to export `checkPlanPrerequisites` from `tagging-agent.ts`
**VALIDATE:** `bunx tsc --noEmit`

---

### Task 5: EXPORT `checkPlanPrerequisites` from `tagging-agent.ts`

**Location:** `tagging-agent.ts` — the function definition created in Task 2

**IMPLEMENT:** Change `async function checkPlanPrerequisites` to `export async function checkPlanPrerequisites`

**VALIDATE:** `bunx tsc --noEmit`

---

### Task 6: ADD tests for `checkPlanPrerequisites` in `tests/preflight.test.ts`

**Location:** `tests/preflight.test.ts` — add new describe block after existing tests

**IMPLEMENT:**

```typescript
describe("checkPlanPrerequisites", () => {
  let testVaultPath: string;
  let testDataPath: string;

  beforeAll(async () => {
    testVaultPath = await mkdtemp(join(tmpdir(), "plan-preflight-test-"));
    testDataPath = await mkdtemp(join(tmpdir(), "plan-preflight-data-"));
  });

  afterAll(async () => {
    await rm(testVaultPath, { recursive: true, force: true });
    await rm(testDataPath, { recursive: true, force: true });
  });

  test("returns true when all audit outputs exist", async () => {
    // Create audit-data.json
    const auditData = {
      generatedAt: new Date().toISOString(),
      generatedBy: "audit-phase-agent",
      totalNotes: 100,
      totalTaggedNotes: 80,
      uniqueTags: 50,
      mappings: { "daily-notes": "type/daily-note" },
      tagFrequencies: { "daily-notes": 25, "todo": 10 },
    };
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify(auditData, null, 2)
    );

    // Create _Tag Audit Report.md
    await writeFile(
      join(testVaultPath, "_Tag Audit Report.md"),
      "# Tag Audit Report\n\nTest content"
    );

    // Import and test
    const { checkPlanPrerequisites } = await import("../tagging-agent.js");
    const result = await checkPlanPrerequisites(testDataPath, testVaultPath);
    expect(result).toBe(true);
  });

  test("returns false when audit-data.json missing", async () => {
    // Ensure audit-data.json doesn't exist
    try {
      await rm(join(testDataPath, "audit-data.json"));
    } catch { /* ignore */ }

    // Create _Tag Audit Report.md
    await writeFile(
      join(testVaultPath, "_Tag Audit Report.md"),
      "# Tag Audit Report\n\nTest content"
    );

    const { checkPlanPrerequisites } = await import("../tagging-agent.js");
    const result = await checkPlanPrerequisites(testDataPath, testVaultPath);
    expect(result).toBe(false);
  });

  test("returns false when _Tag Audit Report.md missing", async () => {
    // Create audit-data.json
    const auditData = {
      generatedAt: new Date().toISOString(),
      tagFrequencies: { "test": 1 },
    };
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify(auditData, null, 2)
    );

    // Ensure report doesn't exist
    try {
      await rm(join(testVaultPath, "_Tag Audit Report.md"));
    } catch { /* ignore */ }

    const { checkPlanPrerequisites } = await import("../tagging-agent.js");
    const result = await checkPlanPrerequisites(testDataPath, testVaultPath);
    expect(result).toBe(false);
  });

  test("returns false when audit-data.json missing tagFrequencies", async () => {
    // Create audit-data.json WITHOUT tagFrequencies
    const auditData = {
      generatedAt: new Date().toISOString(),
      mappings: {},
      // missing tagFrequencies
    };
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify(auditData, null, 2)
    );

    // Create report
    await writeFile(
      join(testVaultPath, "_Tag Audit Report.md"),
      "# Tag Audit Report"
    );

    const { checkPlanPrerequisites } = await import("../tagging-agent.js");
    const result = await checkPlanPrerequisites(testDataPath, testVaultPath);
    expect(result).toBe(false);
  });
});
```

**PATTERN:** Follow existing test structure in `tests/preflight.test.ts`
**VALIDATE:** `bun test tests/preflight.test.ts`

---

### Task 7: UPDATE `tests/agent-prompts.test.ts` for new prompt content

**Location:** `tests/agent-prompts.test.ts`

**IMPLEMENT:** Update any existing tests for `buildPlanSystemPrompt()` to check for:
- `read_data_file` mentioned in Available Tools
- `audit-data.json` mentioned in Phase 1
- "Critical Constraint" section exists
- "DO NOT re-scan notes" phrase exists

**VALIDATE:** `bun test tests/agent-prompts.test.ts`

---

## TESTING STRATEGY

### Unit Tests

- `tests/preflight.test.ts` — Test `checkPlanPrerequisites()` function
- `tests/agent-prompts.test.ts` — Test updated prompt content

### Integration Tests

Manual integration test:
1. Run audit phase: `bun run tagging-agent.ts audit`
2. Verify `data/audit-data.json` created
3. Run plan phase: `bun run tagging-agent.ts plan`
4. Verify plan completes with ~5-10 tool calls (not 100+)
5. Verify cost is ~$0.20 (not ~$0.85)

### Edge Cases

- `audit-data.json` exists but is empty/malformed
- `_Tag Audit Report.md` exists but `audit-data.json` doesn't
- Running plan phase without running audit first
- Interactive mode with missing prerequisites

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Type Checking

```bash
bunx tsc --noEmit
```

### Level 2: Unit Tests

```bash
bun test tests/preflight.test.ts
bun test tests/agent-prompts.test.ts
```

### Level 3: Full Test Suite

```bash
bun test
```

### Level 4: Manual Validation

```bash
# Test CLI pre-flight (should fail without audit)
rm -rf data/audit-data.json
bun run tagging-agent.ts plan
# Expected: "Could not find audit-data.json. Run 'bun run tagging-agent.ts audit' first."

# Run audit, then plan
bun run tagging-agent.ts audit
bun run tagging-agent.ts plan
# Expected: Plan phase completes with ~5-10 tool calls, cost ~$0.20
```

---

## ACCEPTANCE CRITERIA

- [ ] Plan phase reads `audit-data.json` first (not re-scanning notes)
- [ ] Plan phase makes ~5-10 tool calls (not 100+)
- [ ] Plan phase costs ~$0.20 (not ~$0.85)
- [ ] Plan phase fails gracefully if audit not run first
- [ ] CLI mode shows helpful error when prerequisites missing
- [ ] Interactive mode shows helpful error when prerequisites missing
- [ ] All tests pass (`bun test`)
- [ ] Type check passes (`bunx tsc --noEmit`)

---

## COMPLETION CHECKLIST

- [ ] Task 1: Updated `buildPlanSystemPrompt()` with new tools and constraint
- [ ] Task 2: Created `checkPlanPrerequisites()` function
- [ ] Task 3: Integrated pre-flight in CLI mode
- [ ] Task 4: Integrated pre-flight in interactive mode
- [ ] Task 5: Exported `checkPlanPrerequisites`
- [ ] Task 6: Added tests for `checkPlanPrerequisites`
- [ ] Task 7: Updated prompt tests
- [ ] All validation commands pass
- [ ] Manual testing confirms reduced tool calls and cost

---

## NOTES

### Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Plan phase tool calls | 100+ | ~5-10 |
| Plan phase cost | ~$0.85 | ~$0.15-0.25 |
| Plan phase duration | ~60s | ~15-20s |

### Design Decisions

1. **Pre-flight validates structure, not content:** We check that `tagFrequencies` exists but don't validate every tag. The audit agent is trusted to produce correct data.

2. **Fail fast, fail helpfully:** Pre-flight checks run BEFORE any LLM invocation, saving cost when prerequisites are missing.

3. **Explicit constraint in prompt:** The "DO NOT re-scan notes" constraint is explicit because LLMs tend to be thorough and may re-scan "just to be sure" without this guidance.

### Risks

- **Low:** If the audit agent doesn't write `audit-data.json` correctly, the plan phase will fail. Mitigation: Pre-flight validates required fields.
- **Low:** Changing the prompt may cause different plan output format. Mitigation: The plan output format is specified elsewhere in the prompt and unchanged.
