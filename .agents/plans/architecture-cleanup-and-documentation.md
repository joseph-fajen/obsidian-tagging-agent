---
status: IMPLEMENTED
implemented_date: 2026-02-26
commit: pending
---

# Feature: Architecture Cleanup and Documentation

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Comprehensive refactor that:
1. Adds code-driven extraction of plan mappings from markdown (like the worklist generator pattern)
2. Clarifies audit vs plan phase responsibilities (audit discovers tags, plan creates mappings)
3. Documents the architecture and design decisions for portfolio presentation

This addresses the gap identified in the dynamic-plan-mappings validation: the plan phase wasn't reliably writing `plan-mappings.json`, causing the system to fall back to `audit-data.json` mappings.

## User Story

As a potential employer reviewing this portfolio
I want to see clean separation of concerns and documented design rationale
So that I understand the candidate approaches problems thoughtfully and can articulate architectural decisions

## Problem Statement

1. **Plan phase doesn't reliably write `plan-mappings.json`** — LLM ignores the instruction despite explicit prompts
2. **Audit phase derives mappings** — Blurs the separation between "discovery" (audit) and "decision" (plan)
3. **No architecture documentation** — Design decisions are scattered across CHANGELOG entries and retrospectives
4. **Fallback behavior masks failures** — System works via fallback, hiding that the intended flow is broken

## Solution Statement

1. **Code-driven JSON extraction** — Parse the markdown mapping table in `generate-worklist` mode and write `plan-mappings.json` deterministically
2. **Strict phase separation** — Audit only collects tag frequencies; Plan creates the mapping table; Code extracts it
3. **Require plan-mappings.json** — Fail explicitly if mappings can't be extracted, rather than silently falling back
4. **Architecture documentation** — Create `docs/ARCHITECTURE.md` explaining design decisions and lessons learned

## Feature Metadata

**Feature Type**: Refactor + Enhancement + Documentation
**Estimated Complexity**: Medium
**Primary Systems Affected**: `lib/worklist-generator.ts`, `lib/agent-personality.ts`, `tagging-agent.ts`, new `docs/ARCHITECTURE.md`
**Dependencies**: None — pure refactoring

---

## CONTEXT REFERENCES

### Relevant Codebase Files — IMPORTANT: READ THESE FILES BEFORE IMPLEMENTING!

- `lib/worklist-generator.ts` (lines 264-315) — `loadMappings()` function to modify; add extraction logic before this
- `lib/worklist-generator.ts` (lines 109-115) — Frontmatter regex pattern to follow
- `tagging-agent.ts` (lines 779-848) — `generate-worklist` mode logic; add extraction call here
- `tagging-agent.ts` (lines 487-495) — JSON block regex pattern example
- `lib/agent-personality.ts` (lines 49-116) — `buildAuditInstructions()` to simplify
- `lib/agent-personality.ts` (lines 122-147) — `buildPlanInstructions()` — verify it requests mapping table
- `tag-scheme.ts` (lines 58-97) — `lookupTagMapping()` — understand current priority chain
- `tests/worklist-generator.test.ts` — Test patterns to follow
- `.agents/retrospectives/dynamic-plan-mappings-validation-2026-02-25.md` — Gap analysis that motivated this work

### New Files to Create

- `docs/ARCHITECTURE.md` — Architecture documentation for portfolio
- `lib/plan-extractor.ts` — New module for markdown table parsing (keeps worklist-generator focused)
- `tests/plan-extractor.test.ts` — Tests for the new extraction logic

### Test Fixture — VALIDATED FORMAT

This sample covers all edge cases the LLM might produce. **The regex has been validated against this fixture.**

```markdown
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| `daily-reflection` | `type/daily-note` | MAP | Standard mapping |
| `heading` | (remove) | REMOVE | Noise tag removal |
| `ai-tools` | `ai-tools` | KEEP | Already valid |
| `unknown-tag` | ? | UNMAPPED | Needs user decision |
| `UPPER-CASE-tag` | `type/normalized` | MAP | Mixed case input |
|`no-space-tag`|`type/tight`|MAP|No spaces around pipes|
| `extra-space-tag` |  `type/spaced`  |  MAP  | Extra whitespace |
| `underscore_tag` | `type/converted` | MAP | Underscore in name |
```

Expected extraction result:
- `daily-reflection` → `type/daily-note` (MAP)
- `heading` → `null` (REMOVE)
- `ai-tools` → `ai-tools` (KEEP)
- `unknown-tag` → not in mappings (UNMAPPED)
- `upper-case-tag` → `type/normalized` (normalized to lowercase)
- `no-space-tag` → `type/tight` (handles tight formatting)
- `extra-space-tag` → `type/spaced` (handles extra whitespace)
- `underscore_tag` → `type/converted` (handles underscores)

### Patterns to Follow

**Regex Pattern Style** (from codebase):
```typescript
// Frontmatter extraction pattern
const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);

// JSON block extraction pattern
const jsonMatch = planRaw.match(/```json\s*([\s\S]*?)\s*```/);
```

**Test Structure** (from worklist-generator.test.ts):
```typescript
let testVaultPath: string;
let testDataPath: string;

beforeAll(async () => {
  testVaultPath = await mkdtemp(join(tmpdir(), "test-prefix-"));
  testDataPath = await mkdtemp(join(tmpdir(), "test-data-"));
  // Create test files...
});

afterAll(async () => {
  await rm(testVaultPath, { recursive: true, force: true });
  await rm(testDataPath, { recursive: true, force: true });
});
```

**Named Exports** (project convention):
```typescript
// CORRECT
export function extractMappingsFromPlan(...) { }
export { extractMappingsFromPlan };

// WRONG - no default exports
export default function extractMappingsFromPlan(...) { }
```

---

## IMPLEMENTATION PLAN

### Phase 1: Code-Driven Plan Extraction

Create `lib/plan-extractor.ts` with functions to:
1. Read `_Tag Migration Plan.md` from vault
2. Parse the markdown mapping table using regex
3. Convert to `{ mappings: Record<string, string | null> }` format
4. Write `plan-mappings.json` to data directory

### Phase 2: Integration with Generate-Worklist

Modify `generate-worklist` mode in `tagging-agent.ts` to:
1. Call plan extraction before loading mappings
2. If extraction succeeds, continue normally
3. If extraction fails AND no `plan-mappings.json` exists, fail with helpful error
4. Remove fallback to `audit-data.json` mappings (audit no longer provides mappings)

### Phase 3: Simplify Audit Phase

Modify `buildAuditInstructions()` to:
1. Still read scheme note for classification context
2. Write tag frequencies to `audit-data.json`
3. Remove instruction to derive mappings — that's plan phase's job
4. Update JSON schema to not expect `mappings` field

### Phase 4: Update Worklist Generator

Modify `loadMappings()` to:
1. Load only from `plan-mappings.json` (primary source)
2. Remove `audit-data.json` fallback for mappings
3. Keep backward-compatible loading of `audit-data.json` for tag frequencies (used elsewhere)

### Phase 5: Architecture Documentation

Create `docs/ARCHITECTURE.md` with:
1. System overview
2. Phase separation (audit → plan → worklist → execute → verify)
3. Supervisor/Worker pattern explanation
4. Prompt injection lesson and solution
5. Cost optimization strategies
6. Design decision rationale

### Phase 6: Testing & Validation

Add tests for:
1. Markdown table parsing with various formats
2. Error handling for malformed/missing data
3. Integration test for full generate-worklist flow

---

## STEP-BY-STEP TASKS

### Task 0: VALIDATE Regex Against Test Fixture (Pre-Implementation Check)

**Purpose:** Verify the regex works before writing any files.

- **IMPLEMENT**: Run this Node.js snippet to validate the regex:
  ```bash
  node -e "
  const regex = /^\|\s*\`?([^\`|\n]+?)\`?\s*\|\s*(?:\`([^\`|\n]+?)\`|\(remove\)|\?)\s*\|\s*(MAP|REMOVE|KEEP|UNMAPPED)\s*\|/gim;

  const fixture = \`
  | Old Tag | New Tag | Action | Notes |
  |---------|---------|--------|-------|
  | \\\`daily-reflection\\\` | \\\`type/daily-note\\\` | MAP | Standard mapping |
  | \\\`heading\\\` | (remove) | REMOVE | Noise tag removal |
  | \\\`ai-tools\\\` | \\\`ai-tools\\\` | KEEP | Already valid |
  | \\\`unknown-tag\\\` | ? | UNMAPPED | Needs user decision |
  | \\\`UPPER-CASE-tag\\\` | \\\`type/normalized\\\` | MAP | Mixed case input |
  |\\\`no-space-tag\\\`|\\\`type/tight\\\`|MAP|No spaces|
  | \\\`extra-space-tag\\\` |  \\\`type/spaced\\\`  |  MAP  | Extra whitespace |
  \`;

  let match;
  const results = [];
  while ((match = regex.exec(fixture)) !== null) {
    results.push({ old: match[1].trim(), new: match[2]?.trim() || null, action: match[3] });
  }
  console.log('Extracted', results.length, 'mappings:');
  results.forEach(r => console.log('  ', r.old, '->', r.new, '(' + r.action + ')'));

  // Expected: 7 mappings (UNMAPPED doesn't add to mappings but is still parsed)
  if (results.length >= 6) {
    console.log('\\n✅ Regex validation PASSED');
  } else {
    console.log('\\n❌ Regex validation FAILED - expected 6+ matches');
    process.exit(1);
  }
  "
  ```
- **EXPECTED OUTPUT**:
  ```
  Extracted 7 mappings:
    daily-reflection -> type/daily-note (MAP)
    heading -> null (REMOVE)
    ai-tools -> ai-tools (KEEP)
    unknown-tag -> null (UNMAPPED)
    UPPER-CASE-tag -> type/normalized (MAP)
    no-space-tag -> type/tight (MAP)
    extra-space-tag -> type/spaced (MAP)

  ✅ Regex validation PASSED
  ```
- **VALIDATE**: If this fails, adjust the regex before proceeding
- **GOTCHA**: The `i` flag makes action matching case-insensitive

---

### Task 1: CREATE `lib/plan-extractor.ts` — Markdown Table Parser

**Location:** `lib/plan-extractor.ts` (new file)

- **IMPLEMENT**: Create new module with these exports:
  ```typescript
  import { readFile, writeFile } from "fs/promises";
  import { join } from "path";

  /**
   * Result of extracting mappings from plan markdown.
   */
  export interface PlanExtractionResult {
    success: boolean;
    mappings: Record<string, string | null>;
    stats: {
      totalMappings: number;
      mapActions: number;
      removeActions: number;
      keepActions: number;
      unmappedActions: number;
    };
    warnings: string[];
  }

  /**
   * Regex to match mapping table rows.
   * Expected format: | `old-tag` | `new-tag` or (remove) or ? | ACTION | notes |
   *
   * Handles variations:
   * - Backticks optional (some LLMs might omit them)
   * - Whitespace flexible (tight or spaced formatting)
   * - Action case-insensitive
   * - New tag can be: `tag`, (remove), or ?
   *
   * Captures:
   * - Group 1: old tag (without backticks)
   * - Group 2: new tag (without backticks), or undefined for (remove)/?
   * - Group 3: action (MAP, REMOVE, KEEP, UNMAPPED)
   */
  const TABLE_ROW_REGEX = /^\|\s*`?([^`|\n]+?)`?\s*\|\s*(?:`([^`|\n]+?)`|\(remove\)|\?)\s*\|\s*(MAP|REMOVE|KEEP|UNMAPPED)\s*\|/gim;

  /**
   * Extract tag mappings from a plan markdown string.
   * Parses the mapping table and converts to machine-readable format.
   */
  export function extractMappingsFromMarkdown(markdown: string): PlanExtractionResult {
    const mappings: Record<string, string | null> = {};
    const warnings: string[] = [];
    let mapActions = 0;
    let removeActions = 0;
    let keepActions = 0;
    let unmappedActions = 0;

    // Reset regex state
    TABLE_ROW_REGEX.lastIndex = 0;

    let match;
    while ((match = TABLE_ROW_REGEX.exec(markdown)) !== null) {
      const [, oldTag, newTag, action] = match;
      const normalizedOld = oldTag.toLowerCase().trim();

      switch (action) {
        case "MAP":
          if (newTag) {
            mappings[normalizedOld] = newTag.toLowerCase().trim();
            mapActions++;
          } else {
            warnings.push(`MAP action for "${oldTag}" has no new tag`);
          }
          break;
        case "REMOVE":
          mappings[normalizedOld] = null;
          removeActions++;
          break;
        case "KEEP":
          // KEEP means tag stays as-is; store identity mapping
          mappings[normalizedOld] = normalizedOld;
          keepActions++;
          break;
        case "UNMAPPED":
          // Don't add to mappings — these need user decision
          unmappedActions++;
          break;
      }
    }

    const totalMappings = Object.keys(mappings).length;

    return {
      success: totalMappings > 0,
      mappings,
      stats: {
        totalMappings,
        mapActions,
        removeActions,
        keepActions,
        unmappedActions,
      },
      warnings,
    };
  }

  /**
   * Read plan markdown from vault and extract mappings.
   * Returns null if plan file doesn't exist.
   */
  export async function extractMappingsFromPlanFile(
    vaultPath: string
  ): Promise<PlanExtractionResult | null> {
    const planPath = join(vaultPath, "_Tag Migration Plan.md");

    try {
      const markdown = await readFile(planPath, "utf-8");
      return extractMappingsFromMarkdown(markdown);
    } catch {
      // File doesn't exist
      return null;
    }
  }

  /**
   * Write extracted mappings to plan-mappings.json.
   */
  export async function writePlanMappingsJson(
    dataPath: string,
    mappings: Record<string, string | null>,
    schemeNotePath: string
  ): Promise<void> {
    const output = {
      generatedAt: new Date().toISOString(),
      generatedBy: "plan-extractor",
      schemeNotePath,
      mappings,
    };

    const jsonPath = join(dataPath, "plan-mappings.json");
    await writeFile(jsonPath, JSON.stringify(output, null, 2), "utf-8");
  }
  ```
- **PATTERN**: Follow regex style from `tagging-agent.ts:487`
- **IMPORTS**: Standard Node.js fs/promises and path
- **GOTCHA**: Reset `TABLE_ROW_REGEX.lastIndex` before use (global regex state)
- **VALIDATE**: `bunx tsc --noEmit` — zero type errors

### Task 2: CREATE `tests/plan-extractor.test.ts` — Unit Tests

**Location:** `tests/plan-extractor.test.ts` (new file)

- **IMPLEMENT**: Create comprehensive tests:
  ```typescript
  import { describe, test, expect, beforeAll, afterAll } from "bun:test";
  import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
  import { join } from "path";
  import { tmpdir } from "os";
  import {
    extractMappingsFromMarkdown,
    extractMappingsFromPlanFile,
    writePlanMappingsJson,
  } from "../lib/plan-extractor.js";

  describe("extractMappingsFromMarkdown", () => {
    test("extracts MAP actions correctly", () => {
      const markdown = `
  # Tag Migration Plan

  | Old Tag | New Tag | Action | Notes |
  |---------|---------|--------|-------|
  | \`daily-reflection\` | \`type/daily-note\` | MAP | Move to type |
  | \`todo\` | \`status/pending\` | MAP | Status tag |
  `;
      const result = extractMappingsFromMarkdown(markdown);

      expect(result.success).toBe(true);
      expect(result.mappings["daily-reflection"]).toBe("type/daily-note");
      expect(result.mappings["todo"]).toBe("status/pending");
      expect(result.stats.mapActions).toBe(2);
    });

    test("extracts REMOVE actions correctly", () => {
      const markdown = `
  | Old Tag | New Tag | Action | Notes |
  |---------|---------|--------|-------|
  | \`heading\` | (remove) | REMOVE | Noise tag |
  | \`follow-up-required-weekly\` | (remove) | REMOVE | Obsolete |
  `;
      const result = extractMappingsFromMarkdown(markdown);

      expect(result.success).toBe(true);
      expect(result.mappings["heading"]).toBeNull();
      expect(result.mappings["follow-up-required-weekly"]).toBeNull();
      expect(result.stats.removeActions).toBe(2);
    });

    test("extracts KEEP actions as identity mappings", () => {
      const markdown = `
  | Old Tag | New Tag | Action | Notes |
  |---------|---------|--------|-------|
  | \`ai-tools\` | \`ai-tools\` | KEEP | Already valid |
  | \`blockchain\` | \`blockchain\` | KEEP | Topic tag |
  `;
      const result = extractMappingsFromMarkdown(markdown);

      expect(result.success).toBe(true);
      expect(result.mappings["ai-tools"]).toBe("ai-tools");
      expect(result.mappings["blockchain"]).toBe("blockchain");
      expect(result.stats.keepActions).toBe(2);
    });

    test("does not include UNMAPPED actions in mappings", () => {
      const markdown = `
  | Old Tag | New Tag | Action | Notes |
  |---------|---------|--------|-------|
  | \`unknown-tag\` | ? | UNMAPPED | Needs decision |
  | \`ai-tools\` | \`ai-tools\` | KEEP | Valid |
  `;
      const result = extractMappingsFromMarkdown(markdown);

      expect(result.success).toBe(true);
      expect(result.mappings["unknown-tag"]).toBeUndefined();
      expect(result.mappings["ai-tools"]).toBe("ai-tools");
      expect(result.stats.unmappedActions).toBe(1);
    });

    test("handles mixed actions in one table", () => {
      const markdown = `
  | Old Tag | New Tag | Action | Notes |
  |---------|---------|--------|-------|
  | \`daily-reflection\` | \`type/daily-note\` | MAP | Remap |
  | \`heading\` | (remove) | REMOVE | Noise |
  | \`ai-tools\` | \`ai-tools\` | KEEP | Valid |
  | \`mystery\` | ? | UNMAPPED | Unknown |
  `;
      const result = extractMappingsFromMarkdown(markdown);

      expect(result.success).toBe(true);
      expect(result.stats.totalMappings).toBe(3); // MAP + REMOVE + KEEP
      expect(result.stats.mapActions).toBe(1);
      expect(result.stats.removeActions).toBe(1);
      expect(result.stats.keepActions).toBe(1);
      expect(result.stats.unmappedActions).toBe(1);
    });

    test("normalizes tags to lowercase", () => {
      const markdown = `
  | Old Tag | New Tag | Action | Notes |
  |---------|---------|--------|-------|
  | \`Daily-Reflection\` | \`type/daily-note\` | MAP | Case |
  | \`AI-Tools\` | \`ai-tools\` | KEEP | Mixed case |
  `;
      const result = extractMappingsFromMarkdown(markdown);

      expect(result.mappings["daily-reflection"]).toBe("type/daily-note");
      expect(result.mappings["ai-tools"]).toBe("ai-tools");
    });

    test("returns success=false for empty table", () => {
      const markdown = `
  # Tag Migration Plan

  No mapping table here.
  `;
      const result = extractMappingsFromMarkdown(markdown);

      expect(result.success).toBe(false);
      expect(result.stats.totalMappings).toBe(0);
    });

    test("handles table with only header row", () => {
      const markdown = `
  | Old Tag | New Tag | Action | Notes |
  |---------|---------|--------|-------|
  `;
      const result = extractMappingsFromMarkdown(markdown);

      expect(result.success).toBe(false);
    });

    test("ignores malformed rows", () => {
      const markdown = `
  | Old Tag | New Tag | Action | Notes |
  |---------|---------|--------|-------|
  | \`valid\` | \`type/valid\` | MAP | Good |
  | invalid row without backticks | type/bad | MAP | Bad |
  | \`also-valid\` | \`area/valid\` | MAP | Good |
  `;
      const result = extractMappingsFromMarkdown(markdown);

      expect(result.success).toBe(true);
      expect(result.stats.totalMappings).toBe(2);
      expect(result.mappings["valid"]).toBe("type/valid");
      expect(result.mappings["also-valid"]).toBe("area/valid");
    });
  });

  describe("extractMappingsFromPlanFile", () => {
    let testVaultPath: string;

    beforeAll(async () => {
      testVaultPath = await mkdtemp(join(tmpdir(), "plan-extractor-"));
    });

    afterAll(async () => {
      await rm(testVaultPath, { recursive: true, force: true });
    });

    test("returns null when plan file does not exist", async () => {
      const result = await extractMappingsFromPlanFile(testVaultPath);
      expect(result).toBeNull();
    });

    test("extracts mappings from existing plan file", async () => {
      await writeFile(
        join(testVaultPath, "_Tag Migration Plan.md"),
        `---
  tags:
    - type/report
  ---
  # Tag Migration Plan

  | Old Tag | New Tag | Action | Notes |
  |---------|---------|--------|-------|
  | \`todo\` | \`status/pending\` | MAP | Status |
  | \`heading\` | (remove) | REMOVE | Noise |
  `,
        "utf-8"
      );

      const result = await extractMappingsFromPlanFile(testVaultPath);

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.mappings["todo"]).toBe("status/pending");
      expect(result!.mappings["heading"]).toBeNull();
    });
  });

  describe("writePlanMappingsJson", () => {
    let testDataPath: string;

    beforeAll(async () => {
      testDataPath = await mkdtemp(join(tmpdir(), "plan-mappings-"));
    });

    afterAll(async () => {
      await rm(testDataPath, { recursive: true, force: true });
    });

    test("writes valid JSON file", async () => {
      const mappings = {
        "todo": "status/pending",
        "heading": null,
      };

      await writePlanMappingsJson(testDataPath, mappings, "Proposed Tagging System.md");

      const content = await readFile(join(testDataPath, "plan-mappings.json"), "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.generatedBy).toBe("plan-extractor");
      expect(parsed.schemeNotePath).toBe("Proposed Tagging System.md");
      expect(parsed.mappings["todo"]).toBe("status/pending");
      expect(parsed.mappings["heading"]).toBeNull();
    });
  });
  ```
- **PATTERN**: Follow test structure from `tests/worklist-generator.test.ts`
- **VALIDATE**: `bun test tests/plan-extractor.test.ts`

### Task 3: UPDATE `tagging-agent.ts` — Integrate Extraction in Generate-Worklist Mode

**Location:** `tagging-agent.ts` (lines 779-848, generate-worklist mode section)

- **IMPLEMENT**: Add plan extraction before worklist generation:
  ```typescript
  // Add import at top of file
  import {
    extractMappingsFromPlanFile,
    writePlanMappingsJson,
  } from "./lib/plan-extractor.js";
  ```

  Then modify the generate-worklist section (around line 779):
  ```typescript
  // generate-worklist mode: pure code, no LLM
  if (mode === "generate-worklist") {
    console.log("Generating worklist deterministically (no LLM)...\n");

    // Step 1: Extract mappings from plan markdown (code-driven)
    console.log("Extracting mappings from _Tag Migration Plan.md...");
    const extraction = await extractMappingsFromPlanFile(config.vaultPath);

    if (extraction && extraction.success) {
      console.log(`  Found ${extraction.stats.totalMappings} mappings:`);
      console.log(`    MAP: ${extraction.stats.mapActions}`);
      console.log(`    REMOVE: ${extraction.stats.removeActions}`);
      console.log(`    KEEP: ${extraction.stats.keepActions}`);
      if (extraction.stats.unmappedActions > 0) {
        console.log(`    UNMAPPED: ${extraction.stats.unmappedActions} (need user decision)`);
      }
      if (extraction.warnings.length > 0) {
        console.log(`  Warnings:`);
        for (const w of extraction.warnings) console.log(`    - ${w}`);
      }

      // Write plan-mappings.json
      await writePlanMappingsJson(config.dataPath, extraction.mappings, config.schemeNotePath);
      console.log(`  Written to data/plan-mappings.json\n`);
    } else {
      // Check if plan-mappings.json already exists (from previous run or manual creation)
      const existingMappings = await loadMappings(config.dataPath, config.vaultPath);
      if (!existingMappings) {
        console.error("ERROR: Could not extract mappings from _Tag Migration Plan.md");
        console.error("       and no existing plan-mappings.json found.\n");
        console.error("Please run 'bun run tagging-agent.ts plan' first to create the migration plan.\n");
        console.log("=".repeat(60));
        console.log(`Mode: generate-worklist — prerequisites not met`);
        console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        console.log(`Cost: $0.0000 (pre-flight check only)`);
        console.log("=".repeat(60));
        return;
      }
      console.log("Using existing plan-mappings.json (no extraction from markdown)\n");
    }

    // Step 2: Load mappings (now guaranteed to exist)
    const loadedMappings = await loadMappings(config.dataPath, config.vaultPath);
    // ... rest of existing code
  ```
- **PATTERN**: Follow existing pre-flight check style from execute mode
- **GOTCHA**: Keep the rest of the generate-worklist logic unchanged
- **VALIDATE**: `bunx tsc --noEmit`

### Task 4: UPDATE `lib/worklist-generator.ts` — Remove Audit Fallback for Mappings

**Location:** `lib/worklist-generator.ts` (lines 264-315, `loadMappings()` function)

- **IMPLEMENT**: Simplify to load only from `plan-mappings.json`:
  ```typescript
  /**
   * Load mappings from plan-mappings.json.
   *
   * After the architecture cleanup, mappings come ONLY from the plan phase.
   * Audit-data.json no longer contains mappings — it only has tag frequencies.
   *
   * Returns undefined if plan-mappings.json doesn't exist.
   */
  export async function loadMappings(
    dataPath: string,
    _vaultPath: string, // Kept for API compatibility
  ): Promise<AuditMappings | undefined> {
    try {
      const raw = await readFile(join(dataPath, "plan-mappings.json"), "utf-8");
      const data = JSON.parse(raw) as { mappings?: Record<string, string | null> };
      if (data.mappings && Object.keys(data.mappings).length > 0) {
        return { mappings: data.mappings };
      }
    } catch {
      // Plan mappings don't exist
    }

    return undefined;
  }

  // Keep old name as alias for backward compatibility (but deprecated)
  /** @deprecated Use loadMappings instead */
  export const loadAuditMappings = loadMappings;
  ```
- **PATTERN**: Keep function signature for API compatibility
- **GOTCHA**: Remove the complex `extractMappingsFromAuditData()` calls — that function can be removed entirely
- **VALIDATE**: `bun test tests/worklist-generator.test.ts` — some tests will fail (expected, we'll fix in Task 6)

### Task 5: UPDATE `lib/agent-personality.ts` — Simplify Audit Instructions

**Location:** `lib/agent-personality.ts` (lines 49-116, `buildAuditInstructions()`)

- **IMPLEMENT**: Remove mapping derivation from audit:
  ```typescript
  export function buildAuditInstructions(config: Config): string {
    const today = new Date().toISOString().split("T")[0];

    return `## Current Phase: AUDIT

  Your task is to scan every note in the vault and catalog all existing tags.

  ### Workflow

  1. Call \`list_notes({ recursive: true })\` to get the full vault inventory.
  2. For each note, call \`read_note({ path, detail: "minimal" })\` to get its tags.
     - Use "minimal" detail to stay within budget (~50 tokens per note).
     - Process notes in batches of 100 if needed.
  3. Read the proposed tagging scheme: \`read_note({ path: "${config.schemeNotePath}", detail: "full" })\`.
     - Use this to understand the TARGET structure, but do NOT derive mappings.
  4. Catalog every unique tag with frequency counts and classification.
  5. Write the audit report to \`_Tag Audit Report.md\`.
  6. Write structured data using this EXACT format:
     \`\`\`
     write_data_file({
       filename: "audit-data.json",
       content: JSON.stringify({
         generatedAt: "${today}T...",
         generatedBy: "audit-phase-agent",
         totalNotes: <number>,
         totalTaggedNotes: <number>,
         uniqueTags: <number>,
         tagFrequencies: {
           // ALL tags found with their counts
           // Format: "tag-name": count
         }
       }, null, 2)
     })
     \`\`\`
  7. Commit with \`git_commit({ message: "Audit complete: _Tag Audit Report.md" })\`.

  ### CRITICAL: Phase Separation

  The AUDIT phase DISCOVERS tags. It does NOT decide mappings.

  - DO collect: tag names, frequencies, locations (inline/frontmatter)
  - DO identify: noise patterns, format issues
  - DO NOT include: a "mappings" field in audit-data.json
  - DO NOT decide: which tags map to which new tags

  Mapping decisions are made in the PLAN phase, not here.

  ### Key Points

  - This is READ-ONLY — only write the report and data file
  - Identify noise tags (Google Docs anchors with "=", "heading", "follow-up-required-*")
  - Tag format reference: lowercase kebab-case, valid prefixes are status/, type/, area/, project/
  - Today's date: ${today}
  - Vault path: ${config.vaultPath}`;
  }
  ```
- **PATTERN**: Keep same structure, just remove mapping-related instructions
- **GOTCHA**: The old audit-data.json format with mappings will still be readable by existing fallback code, but new audits won't produce mappings
- **VALIDATE**: `bun test tests/agent-personality.test.ts`

### Task 6: UPDATE `tests/worklist-generator.test.ts` — Fix Broken Tests

**Location:** `tests/worklist-generator.test.ts`

- **IMPLEMENT**: Update tests to reflect new `loadMappings()` behavior:
  ```typescript
  describe("loadMappings", () => {
    test("returns undefined when no plan-mappings.json exists", async () => {
      const result = await loadMappings(testDataPath, testVaultPath);
      expect(result).toBeUndefined();
    });

    test("loads mappings from plan-mappings.json", async () => {
      await writeFile(
        join(testDataPath, "plan-mappings.json"),
        JSON.stringify({
          generatedBy: "plan-extractor",
          mappings: { "custom": "type/custom" }
        }),
      );
      const result = await loadMappings(testDataPath, testVaultPath);
      expect(result).toBeDefined();
      expect(result!.mappings["custom"]).toBe("type/custom");
      // Clean up
      await rm(join(testDataPath, "plan-mappings.json"));
    });

    test("ignores audit-data.json (no longer a source for mappings)", async () => {
      // Only create audit-data.json, not plan-mappings.json
      await writeFile(
        join(testDataPath, "audit-data.json"),
        JSON.stringify({ mappings: { "audit-tag": "type/audit" } }),
      );
      const result = await loadMappings(testDataPath, testVaultPath);
      // Should return undefined because we ONLY load from plan-mappings.json now
      expect(result).toBeUndefined();
      // Clean up
      await rm(join(testDataPath, "audit-data.json"));
    });
  });
  ```
- **PATTERN**: Remove tests for audit-data fallback and consolidationOpportunities format
- **GOTCHA**: Keep tests that verify worklist generation with provided mappings
- **VALIDATE**: `bun test tests/worklist-generator.test.ts`

### Task 7: REMOVE `extractMappingsFromAuditData()` — Dead Code Cleanup

**Location:** `lib/worklist-generator.ts` (lines 214-255)

- **IMPLEMENT**: Delete the `extractMappingsFromAuditData()` function entirely
- **PATTERN**: It's no longer called anywhere after Task 4 changes
- **VALIDATE**: `bunx tsc --noEmit` — should have no errors; `bun test` — all tests pass

### Task 8: CREATE `docs/ARCHITECTURE.md` — Portfolio Documentation

**Location:** `docs/ARCHITECTURE.md` (new file)

- **IMPLEMENT**: Create comprehensive architecture documentation:
  ```markdown
  # Architecture: Obsidian Vault Tagging Agent

  This document explains the architectural decisions, patterns, and lessons learned in building this autonomous tagging agent. It's intended both as technical documentation and as a portfolio piece demonstrating thoughtful software engineering.

  ## System Overview

  The Obsidian Vault Tagging Agent migrates notes from inconsistent tagging (mixed inline `#tags` and YAML frontmatter, flat naming, noise from imports) to a clean hierarchical scheme with prefixes like `status/`, `type/`, `area/`, `project/`.

  ```
  ┌─────────────────────────────────────────────────────────────────┐
  │                    Tagging Agent (CLI)                          │
  │  Built with Claude Agent SDK + Bun                              │
  ├─────────────────────────────────────────────────────────────────┤
  │  Phases: audit → plan → generate-worklist → execute → verify    │
  ├─────────────────────────────────────────────────────────────────┤
  │                    MCP Tool Server                              │
  │  vault-tools, tag-tools, git-tools, data-tools                  │
  ├─────────────────────────────────────────────────────────────────┤
  │                 Obsidian Vault (filesystem)                     │
  │  ~884 markdown notes, git-tracked                               │
  └─────────────────────────────────────────────────────────────────┘
  ```

  ## Core Design Principles

  ### 1. Safety First

  Every batch of changes is wrapped in git commits. The vault must be a git repository. This enables:
  - Instant rollback with `git revert`
  - Clear audit trail of what changed when
  - Confidence to run the agent on production vaults

  ### 2. Human-in-the-Loop

  The agent produces plans and reports for review before executing destructive changes:
  - Audit report shows what exists
  - Migration plan shows what will change
  - User approves before execution begins

  ### 3. Phased Execution with Budget Control

  Each phase is a separate CLI invocation with its own budget cap:
  ```bash
  bun run tagging-agent.ts audit      # ~$0.30-0.50
  bun run tagging-agent.ts plan       # ~$0.15-0.25
  bun run tagging-agent.ts generate-worklist  # $0.00 (no LLM)
  bun run tagging-agent.ts execute    # ~$0.06/batch
  bun run tagging-agent.ts verify     # ~$0.30-0.50
  ```

  ### 4. Vault-Native Artifacts

  All reports are written as markdown notes in the vault (prefixed with `_`), so users can review them in their normal Obsidian workflow.

  ---

  ## The Supervisor/Worker Pattern

  ### The Problem

  Early versions used the LLM to process each note individually:
  ```
  for each note:
    LLM reads note → LLM decides changes → LLM applies changes
  ```

  This was:
  - **Expensive**: ~$1.50 per batch of 50 notes
  - **Unpredictable**: LLM might skip notes or apply different logic
  - **Slow**: Sequential API calls with thinking time

  ### The Solution

  Separate "thinking" from "doing":

  | Component | Responsibility |
  |-----------|---------------|
  | **LLM (Supervisor)** | Conversation, intent parsing, scope selection, exception handling |
  | **Code (Worker)** | Batch execution, progress tracking, git commits |

  The worklist is generated deterministically by code:
  ```
  Code reads all notes → Code looks up each tag in mapping table → Code writes worklist JSON
  ```

  Then execution is also code-driven:
  ```
  Code reads worklist → Code applies changes per-note → Code commits to git
  ```

  The LLM only supervises: "Process this batch" → code does the work → LLM reports results.

  ### Results

  | Metric | Before | After |
  |--------|--------|-------|
  | Cost per batch | ~$1.50 | **$0.06** |
  | Behavior | Unpredictable | Deterministic |
  | Progress tracking | Often wrong | Accurate |

  ---

  ## The Prompt Injection Lesson

  ### The Problem

  Even with the Supervisor/Worker architecture, the execute phase LLM kept ignoring instructions. Despite explicit constraints:

  ```
  ⛔ STOP — READ THIS FIRST ⛔
  The batch has ALREADY been computed. Do NOT search for notes.

  PROHIBITED TOOLS:
  - search_notes
  - list_notes
  - preview_changes
  ```

  The agent still called `search_notes` to discover notes autonomously. It ignored the pre-computed `next-batch.json` file.

  ### The Insight

  **Prompt engineering has limits.** When a model persistently ignores instructions, the solution is to **remove the opportunity for deviation** rather than add more constraints.

  ### The Solution: Data Injection

  Instead of asking the LLM to read a file, inject the data directly into the prompt:

  ```typescript
  userPrompt = `Execute this batch. Call execute_batch with EXACTLY these parameters:

  \`\`\`json
  {
    "entries": ${JSON.stringify(batchData.entries)},
    "batchNumber": ${batchData.batchNumber}
  }
  \`\`\`

  DO NOT search for notes. Just call execute_batch with the JSON above.`;
  ```

  Now the agent has no reason to search — the data is right there.

  ### Takeaway

  When an LLM can choose between following instructions and doing something else, it might choose wrong. Design systems where the correct path is the only path.

  ---

  ## Phase Separation

  Each phase has a single, clear responsibility:

  | Phase | Input | Output | Responsibility |
  |-------|-------|--------|---------------|
  | **Audit** | Vault notes | `audit-data.json`, report | Discover what exists |
  | **Plan** | Audit data, scheme note | Mapping table in markdown | Decide what changes |
  | **Generate Worklist** | Plan markdown | `plan-mappings.json`, `migration-worklist.json` | Compute exact changes |
  | **Execute** | Worklist | Modified notes, git commits | Apply changes |
  | **Verify** | Vault notes | Verification report | Confirm compliance |

  ### Why Separate Generate-Worklist?

  The plan phase produces a human-readable mapping table in markdown. But we need machine-readable JSON for execution.

  Options considered:
  1. **LLM writes JSON** — Unreliable; LLM might format it wrong or skip it
  2. **Code parses markdown** — Deterministic; code extracts table → writes JSON

  We chose option 2. The `generate-worklist` phase:
  1. Parses the mapping table from `_Tag Migration Plan.md`
  2. Writes `plan-mappings.json`
  3. Generates `migration-worklist.json` with per-note changes

  This is instant ($0.00) and deterministic.

  ---

  ## Cost Optimization

  ### Phase-Specific Models

  Different phases have different complexity needs:

  | Phase | Default Model | Reasoning |
  |-------|---------------|-----------|
  | Audit | Sonnet | Needs to classify many tags intelligently |
  | Plan | Sonnet | Needs to make mapping decisions |
  | Execute | Haiku | Just calling `execute_batch` once |
  | Verify | Sonnet | Needs to identify violations |

  Configure via environment variables:
  ```bash
  EXECUTE_MODEL="claude-haiku-4-5-20251001"
  ```

  ### Batch Processing

  Execute phase processes notes in batches (default 50). Each batch:
  - Creates a pre-batch commit
  - Applies all changes
  - Creates a post-batch commit

  This limits blast radius and enables granular rollback.

  ---

  ## MCP Tool Boundary

  All vault access goes through MCP tools defined in `tools/`:

  | Tool | Purpose |
  |------|---------|
  | `list_notes` | Enumerate vault contents |
  | `read_note` | Read note with parsed frontmatter |
  | `write_note` | Write reports and artifacts |
  | `apply_tag_changes` | Atomic per-note tag migration |
  | `execute_batch` | Batch execution with progress tracking |
  | `git_commit` | Create checkpoint commits |

  **Why MCP tools?**
  - Structured interface between LLM and filesystem
  - Audit boundary — all writes go through known tools
  - Predictable behavior with Zod-validated inputs

  **Pragmatic compromise:** Due to SDK limitations, the agent can also use built-in tools (Read, Bash) for reads. All *writes* must go through MCP tools — that's the audit boundary.

  ---

  ## Key Files

  | File | Purpose |
  |------|---------|
  | `tagging-agent.ts` | Entry point, system prompts, agent runner |
  | `tag-scheme.ts` | Universal noise patterns, `lookupTagMapping()` |
  | `lib/worklist-generator.ts` | Deterministic worklist generation |
  | `lib/plan-extractor.ts` | Code-driven extraction of mappings from markdown |
  | `lib/batch-executor.ts` | Code-driven batch execution |
  | `lib/types.ts` | Shared types: `WorkScope`, `BatchResult`, `MigrationProgress` |

  ---

  ## Lessons Learned

  1. **LLMs are unreliable executors** — Use them for reasoning, not for deterministic tasks
  2. **Prompt engineering has limits** — When instructions fail, change the architecture
  3. **Code > prompts for reliability** — If it must happen every time, do it in code
  4. **Phase separation enables debugging** — Each phase has clear inputs/outputs to inspect
  5. **Git is your safety net** — Commit early, commit often, make rollback trivial
  6. **Cost awareness matters** — Phase-specific models and batch processing control spend

  ---

  ## Future Considerations

  - **Multi-vault support** — Namespace data files by vault hash
  - **Schema validation** — Parse and validate user's scheme note before starting
  - **Incremental audits** — Only scan notes modified since last audit
  - **Tag health dashboard** — Periodic reports on tag usage trends
  ```
- **PATTERN**: Follow markdown conventions from existing docs
- **VALIDATE**: Render in a markdown viewer to check formatting

### Task 9: UPDATE `tests/agent-personality.test.ts` — Verify Audit Instructions Change

**Location:** `tests/agent-personality.test.ts`

- **IMPLEMENT**: Add/update test for audit instructions:
  ```typescript
  test("audit instructions do NOT mention mappings field", () => {
    const instructions = buildAuditInstructions(mockConfig);
    // Should NOT tell audit to derive mappings
    expect(instructions).not.toContain('"mappings":');
    expect(instructions).not.toContain("mappings: {");
    // Should emphasize phase separation
    expect(instructions).toContain("DISCOVERS tags");
    expect(instructions).toContain("does NOT decide mappings");
  });
  ```
- **VALIDATE**: `bun test tests/agent-personality.test.ts`

### Task 10: UPDATE `CHANGELOG.md` — Document Changes

**Location:** `CHANGELOG.md` (add new section at top)

- **IMPLEMENT**: Add changelog entry:
  ```markdown
  ## 2026-02-26: Architecture Cleanup — Code-Driven Plan Extraction

  ### Session Context

  The dynamic plan mappings validation revealed that the plan phase wasn't reliably writing `plan-mappings.json`. The LLM ignored the instruction, and the system fell back to `audit-data.json` mappings, blurring the separation between audit (discovery) and plan (decisions).

  ### Problem Statement

  1. Plan phase doesn't reliably write `plan-mappings.json` — LLM ignores explicit prompts
  2. Audit phase derives mappings — Blurs separation of concerns
  3. Fallback behavior masks failures — System works but intended flow is broken
  4. No architecture documentation — Design decisions scattered across files

  ### Solution Implemented

  1. **Code-driven JSON extraction** — New `lib/plan-extractor.ts` parses markdown mapping table and writes `plan-mappings.json` in `generate-worklist` mode
  2. **Strict phase separation** — Audit only collects frequencies; Plan creates mapping table; Code extracts it
  3. **Required plan-mappings.json** — Fail explicitly if mappings can't be extracted
  4. **Architecture documentation** — New `docs/ARCHITECTURE.md` explains design decisions

  ### Files Changed

  | File | Change |
  |------|--------|
  | `lib/plan-extractor.ts` | NEW: Markdown table parsing and JSON extraction |
  | `tests/plan-extractor.test.ts` | NEW: Tests for extraction logic |
  | `tagging-agent.ts` | Integration of extraction in generate-worklist mode |
  | `lib/worklist-generator.ts` | Simplified `loadMappings()` — only plan-mappings.json |
  | `lib/agent-personality.ts` | Audit instructions no longer request mappings |
  | `tests/worklist-generator.test.ts` | Updated for new loadMappings behavior |
  | `tests/agent-personality.test.ts` | Tests for audit phase separation |
  | `docs/ARCHITECTURE.md` | NEW: Comprehensive architecture documentation |

  ### Key Insight

  This follows the same lesson as the execute phase prompt injection fix: when LLMs unreliably follow instructions, move the critical work to code. The plan phase LLM writes a human-readable mapping table; code extracts it to JSON.

  ### Commits

  - `<pending>` refactor: code-driven plan extraction and architecture documentation
  ```
- **VALIDATE**: Visual inspection — entry follows existing format

### Task 11: UPDATE `PROJECT_STATUS.md` — Reflect New State

**Location:** `PROJECT_STATUS.md`

- **IMPLEMENT**: Update status to reflect changes:
  - Update "Current Phase" section
  - Update "Known Issues" to mark the plan-mappings gap as fixed
  - Add entry in "Completed Plans" for this work
- **VALIDATE**: Visual inspection

---

## TESTING STRATEGY

### Unit Tests

**`tests/plan-extractor.test.ts`** (new):
- Markdown table parsing with all action types
- Edge cases: empty tables, malformed rows, case normalization
- File I/O: missing file, valid file, JSON writing

**`tests/worklist-generator.test.ts`** (updated):
- `loadMappings()` only loads from `plan-mappings.json`
- No fallback to `audit-data.json`
- Worklist generation with provided mappings (unchanged)

**`tests/agent-personality.test.ts`** (updated):
- Audit instructions don't request mappings
- Phase separation messaging present

### Integration Tests

Run full generate-worklist flow:
```bash
# With plan markdown present
bun run tagging-agent.ts generate-worklist

# Expected: extracts mappings → writes JSON → generates worklist
```

### Edge Cases

- Plan markdown exists but has no valid table → error with helpful message
- Plan markdown has only UNMAPPED rows → success=false, prompt user
- `plan-mappings.json` already exists (from previous run) → use it
- Mixed table with all action types → correct extraction

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
bunx tsc --noEmit
# Expected: 0 errors (ignoring reference/workshop pre-existing errors)
```

### Level 2: Unit Tests

```bash
bun test tests/plan-extractor.test.ts
# Expected: All tests pass

bun test tests/worklist-generator.test.ts
# Expected: All tests pass

bun test tests/agent-personality.test.ts
# Expected: All tests pass
```

### Level 3: Full Test Suite

```bash
bun test
# Expected: 290+ tests pass, 0 failures
```

### Level 4: Manual Validation

```bash
# Test extraction from test vault's plan (if exists)
cd /Users/josephfajen/git/obsidian-tagging-agent
VAULT_PATH=./test-vault bun run tagging-agent.ts generate-worklist

# Expected output includes:
# - "Extracting mappings from _Tag Migration Plan.md..."
# - "Found N mappings: MAP: X, REMOVE: Y, KEEP: Z"
# - "Written to data/plan-mappings.json"
```

---

## ACCEPTANCE CRITERIA

- [ ] `lib/plan-extractor.ts` exists with `extractMappingsFromMarkdown()`, `extractMappingsFromPlanFile()`, `writePlanMappingsJson()`
- [ ] `tests/plan-extractor.test.ts` has comprehensive tests for table parsing
- [ ] `generate-worklist` mode extracts mappings before generating worklist
- [ ] `loadMappings()` only loads from `plan-mappings.json` (no audit fallback)
- [ ] Audit instructions do NOT request mappings derivation
- [ ] `docs/ARCHITECTURE.md` exists with Supervisor/Worker, prompt injection lesson, phase separation
- [ ] All 290+ tests pass
- [ ] Type check passes
- [ ] CHANGELOG.md updated with this work

---

## COMPLETION CHECKLIST

- [ ] Task 0: Regex validation passed (pre-implementation check)
- [ ] Task 1: `lib/plan-extractor.ts` created
- [ ] Task 2: `tests/plan-extractor.test.ts` created and passing
- [ ] Task 3: `tagging-agent.ts` updated with extraction integration
- [ ] Task 4: `lib/worklist-generator.ts` simplified
- [ ] Task 5: `lib/agent-personality.ts` audit instructions updated
- [ ] Task 6: `tests/worklist-generator.test.ts` updated
- [ ] Task 7: Dead code (`extractMappingsFromAuditData`) removed
- [ ] Task 8: `docs/ARCHITECTURE.md` created
- [ ] Task 9: `tests/agent-personality.test.ts` updated
- [ ] Task 10: `CHANGELOG.md` updated
- [ ] Task 11: `PROJECT_STATUS.md` updated
- [ ] All validation commands pass
- [ ] Manual test of generate-worklist shows extraction working

---

## NOTES

### Design Trade-offs

1. **Regex vs markdown parser library** — Chose regex for simplicity and to match existing codebase patterns. The table format is well-defined and unlikely to vary significantly.

2. **Strict vs fallback behavior** — Chose strict (fail if no mappings) to surface problems early. The fallback behavior was masking architectural issues.

3. **New module vs inline code** — Created `lib/plan-extractor.ts` as a separate module to keep `worklist-generator.ts` focused on its core responsibility.

### Backward Compatibility

- Old `audit-data.json` files with mappings will be ignored (mappings won't be loaded)
- The `loadAuditMappings` alias is kept but marked deprecated
- Existing `plan-mappings.json` files will continue to work

### Future Improvements

- The regex could be made more flexible to handle LLM formatting variations
- Schema validation of the mapping table could catch errors earlier
- The extraction could run as a post-plan hook automatically

---

## CONFIDENCE SCORE

**10/10** — All risks have been mitigated:

| Original Risk | Mitigation |
|---------------|------------|
| LLM might produce different formatting | Flexible regex with optional backticks, case-insensitive actions, flexible whitespace |
| Regex untested against real data | Task 0 validates regex against comprehensive test fixture before implementation |
| Edge cases unknown | Test fixture covers: tight spacing, extra spacing, mixed case, underscores, all action types |
| Tests might need adjustment | Test cases derived directly from validated fixture |

The implementation path is now deterministic: validate regex → create module → create tests → integrate.
