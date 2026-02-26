---
status: IMPLEMENTED
implemented_date: 2026-02-25
---

# Feature: Dynamic Plan Mappings

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Make the tagging agent usable by anyone by removing the dependency on hardcoded mappings in `tag-scheme.ts`. Currently, the agent has ~50 hardcoded tag mappings specific to the original author's vault. This change makes the plan phase write mappings to a machine-readable JSON file (`data/plan-mappings.json`), which the worklist generator then consumes as its primary mapping source.

## User Story

As an Obsidian user with messy tags
I want to provide my desired tagging schema as a note in my vault
So that the agent can audit my tags, propose a complete migration plan, and execute it — without me editing source code

## Problem Statement

Currently:
- `TAG_MAPPINGS` in `tag-scheme.ts` has ~50 hardcoded mappings specific to one vault
- Plan phase writes mappings to markdown (human-readable) but NOT to a machine-readable JSON file
- Worklist generator (`lookupTagMapping()`) checks: hardcoded → audit mappings → valid format → unmapped
- The plan phase's mapping table is NOT consumed by the worklist generator
- A new user would need to edit source code to use the agent

## Solution Statement

1. Plan phase writes mappings to `data/plan-mappings.json` (machine-readable)
2. Worklist generator loads plan mappings as PRIMARY source, audit mappings as fallback
3. `TAG_MAPPINGS` reduced to universal patterns only (noise removal)
4. Schema note path made configurable via `SCHEME_NOTE_PATH` env var
5. Pre-flight check validates schema note exists before audit/plan phases

## Feature Metadata

**Feature Type**: Enhancement/Refactor
**Estimated Complexity**: Low-Medium
**Primary Systems Affected**: `tagging-agent.ts`, `lib/worklist-generator.ts`, `tag-scheme.ts`, `lib/config.ts`
**Dependencies**: None (all internal changes)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — IMPORTANT: READ THESE FILES BEFORE IMPLEMENTING!

- `tag-scheme.ts` (lines 42-93) — **Hardcoded `TAG_MAPPINGS` to minimize**
- `tag-scheme.ts` (lines 103-142) — **`lookupTagMapping()` function to modify priority**
- `tag-scheme.ts` (line 35) — **`SCHEME_NOTE_PATH` constant to make configurable**
- `lib/worklist-generator.ts` (lines 264-308) — **`loadAuditMappings()` to rename/extend**
- `lib/worklist-generator.ts` (lines 75-79) — **`generateWorklist()` signature showing how mappings are passed**
- `tagging-agent.ts` (lines 75-162) — **`buildPlanSystemPrompt()` to add JSON output instruction**
- `tagging-agent.ts` (lines 656-692) — **`checkPlanPrerequisites()` pattern to follow for schema check**
- `lib/config.ts` (lines 25-36) — **`Config` interface to extend with `schemeNotePath`**
- `lib/config.ts` (lines 40-87) — **`loadConfig()` to add env var parsing**
- `tests/worklist-generator.test.ts` (lines 199-313) — **Test patterns for `loadAuditMappings`**
- `tests/preflight.test.ts` (lines 112-291) — **Test patterns for pre-flight checks**

### New Files to Create

- None — all changes are to existing files

### Files to Modify

| File | Change Summary |
|------|----------------|
| `tag-scheme.ts` | Minimize `TAG_MAPPINGS` to universal patterns; update `lookupTagMapping()` priority |
| `lib/worklist-generator.ts` | Rename `loadAuditMappings()` → `loadMappings()`; add plan-mappings.json loading |
| `tagging-agent.ts` | Update `buildPlanSystemPrompt()` to write plan-mappings.json; add schema note pre-flight |
| `lib/config.ts` | Add `schemeNotePath` to Config; parse `SCHEME_NOTE_PATH` env var |
| `.env.example` | Add `SCHEME_NOTE_PATH` documentation |
| `README.md` | Update setup instructions for new users |
| `tests/worklist-generator.test.ts` | Update tests for renamed function and new loading priority |
| `tests/preflight.test.ts` | Add tests for schema note pre-flight check |
| `tests/tag-scheme.test.ts` | Update tests for minimized `TAG_MAPPINGS` |

### Relevant Documentation — READ THESE BEFORE IMPLEMENTING!

- `CLAUDE.md` — Project conventions (named exports, kebab-case, Zod validation)
- `PRD.md` (Section 7) — Tool specifications for `write_data_file`
- `CHANGELOG.md` — Prior pattern for pre-flight checks (2026-02-05 entries)

### Patterns to Follow

**Pre-flight check pattern** (from `checkPlanPrerequisites`):
```typescript
export async function checkSchemeNoteExists(config: Config): Promise<boolean> {
  const schemePath = join(config.vaultPath, config.schemeNotePath);
  try {
    await readFile(schemePath, "utf-8");
    return true;
  } catch {
    console.error(`Schema note not found: ${config.schemeNotePath}`);
    console.error("");
    console.error("Please create a note describing your desired tagging schema.");
    console.error("The note should define:");
    console.error("  - Tag categories (e.g., status/, type/, area/, project/)");
    console.error("  - Example tags for each category");
    console.error("  - Any tags that should be removed (noise patterns)");
    console.error("");
    console.error(`Then set SCHEME_NOTE_PATH="${config.schemeNotePath}" in your .env file.`);
    return false;
  }
}
```

**Config loading pattern** (from `lib/config.ts`):
```typescript
schemeNotePath: process.env.SCHEME_NOTE_PATH || "Proposed Tagging System.md",
```

**Mapping loading priority** (new pattern):
```typescript
// Priority: plan-mappings.json → audit-data.json mappings → empty
export async function loadMappings(dataPath: string, vaultPath: string): Promise<AuditMappings | undefined> {
  // 1. Try plan-mappings.json first (user-approved mappings from plan phase)
  // 2. Fall back to audit-data.json mappings (auto-discovered)
  // 3. Return undefined if neither exists
}
```

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — Config and Types

1. Add `schemeNotePath` to Config interface
2. Parse `SCHEME_NOTE_PATH` env var in `loadConfig()`
3. Update `.env.example` with new variable

### Phase 2: Core Changes — Mapping Flow

1. Update `buildPlanSystemPrompt()` to instruct writing `plan-mappings.json`
2. Rename `loadAuditMappings()` → `loadMappings()` and add plan-mappings.json loading
3. Minimize `TAG_MAPPINGS` to universal patterns only
4. Update `lookupTagMapping()` to remove hardcoded priority (rely on loaded mappings)

### Phase 3: Pre-flight — Schema Note Check

1. Create `checkSchemeNoteExists()` function
2. Integrate into audit and plan phase pre-flight checks
3. Provide friendly error message with guidance

### Phase 4: Testing & Documentation

1. Update existing tests for renamed functions
2. Add new tests for schema note pre-flight
3. Update README.md for new user experience
4. Update CHANGELOG.md

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task 1: UPDATE `lib/config.ts` — Add schemeNotePath config

**Location:** `lib/config.ts`

- **IMPLEMENT**: Add `schemeNotePath: string` to `Config` interface (after line 35)
- **IMPLEMENT**: Add env var parsing in `loadConfig()` (after line 83):
  ```typescript
  schemeNotePath: process.env.SCHEME_NOTE_PATH || "Proposed Tagging System.md",
  ```
- **PATTERN**: Follow existing config patterns in the file
- **VALIDATE**: `bunx tsc --noEmit` — no type errors

### Task 2: UPDATE `.env.example` — Document SCHEME_NOTE_PATH

**Location:** `.env.example`

- **IMPLEMENT**: Add after line 30:
  ```bash
  # Path to your tagging schema note in the vault (optional, defaults shown)
  # This note should describe your desired tag categories and mappings
  SCHEME_NOTE_PATH="Proposed Tagging System.md"
  ```
- **VALIDATE**: File is valid bash syntax

### Task 3: UPDATE `tag-scheme.ts` — Minimize TAG_MAPPINGS

**Location:** `tag-scheme.ts` (lines 42-93)

- **IMPLEMENT**: Replace `TAG_MAPPINGS` with universal patterns only:
  ```typescript
  /**
   * Universal tag mappings that work for any vault.
   * These are noise patterns and widely-agreed conventions.
   * Vault-specific mappings come from plan-mappings.json (generated by plan phase).
   */
  export const TAG_MAPPINGS: Record<string, string | null> = {
    // === NOISE / REMOVAL (universal) ===
    "heading": null,           // Google Docs anchors
    "follow-up-required-weekly": null,
    "follow-up-required-monthly": null,
    "follow-up-required-quarterly": null,
  };
  ```
- **RATIONALE**: Remove all vault-specific mappings; they now come from plan-mappings.json
- **GOTCHA**: Keep noise patterns — they're truly universal
- **VALIDATE**: `bunx tsc --noEmit`

### Task 4: UPDATE `tag-scheme.ts` — Update lookupTagMapping priority

**Location:** `tag-scheme.ts` (lines 103-142)

- **IMPLEMENT**: Change the function to prioritize loaded mappings over hardcoded:
  ```typescript
  /**
   * Look up a tag in the mapping table.
   * Priority: noise patterns → loaded mappings (plan + audit) → hardcoded → valid format check → unmapped.
   */
  export function lookupTagMapping(
    tag: string,
    loadedMappings?: AuditMappings,
  ): { action: "map" | "remove" | "keep" | "unmapped"; newTag: string | null } {
    const normalized = tag.toLowerCase().replace(/_/g, "-");

    // Check noise patterns first
    if (isNoiseTag(normalized)) {
      return { action: "remove", newTag: null };
    }

    // Check loaded mappings (from plan-mappings.json or audit-data.json)
    if (loadedMappings && normalized in loadedMappings.mappings) {
      const newTag = loadedMappings.mappings[normalized];
      if (newTag === null) return { action: "remove", newTag: null };
      if (newTag === normalized) return { action: "keep", newTag };
      return { action: "map", newTag };
    }

    // Check hardcoded universal mappings (noise patterns only)
    if (normalized in TAG_MAPPINGS) {
      const newTag = TAG_MAPPINGS[normalized];
      if (newTag === null) return { action: "remove", newTag: null };
      if (newTag === normalized) return { action: "keep", newTag };
      return { action: "map", newTag };
    }

    // Check if it's already a valid hierarchical tag
    const VALID_PREFIXES = ["status/", "type/", "area/", "project/", "skill/", "tool/", "topic/"];
    if (VALID_PREFIXES.some((p) => normalized.startsWith(p))) {
      return { action: "keep", newTag: normalized };
    }

    // Check if it's a valid flat kebab-case topic tag
    if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(normalized)) {
      return { action: "keep", newTag: normalized };
    }

    return { action: "unmapped", newTag: null };
  }
  ```
- **KEY CHANGE**: Loaded mappings now take priority over hardcoded
- **VALIDATE**: `bun test tests/tag-scheme.test.ts`

### Task 5: UPDATE `lib/worklist-generator.ts` — Rename and extend loadAuditMappings

**Location:** `lib/worklist-generator.ts` (lines 264-308)

- **IMPLEMENT**: Rename `loadAuditMappings` → `loadMappings`
- **IMPLEMENT**: Add plan-mappings.json as primary source:
  ```typescript
  /**
   * Load mappings from plan-mappings.json (primary) or audit-data.json (fallback).
   * Plan mappings are user-approved mappings from the plan phase.
   * Audit mappings are auto-discovered mappings from the audit phase.
   */
  export async function loadMappings(
    dataPath: string,
    vaultPath: string,
  ): Promise<AuditMappings | undefined> {
    const allMappings: Record<string, string | null> = {};

    // 1. Try plan-mappings.json first (user-approved, highest priority)
    try {
      const raw = await readFile(join(dataPath, "plan-mappings.json"), "utf-8");
      const data = JSON.parse(raw) as { mappings?: Record<string, string | null> };
      if (data.mappings) {
        Object.assign(allMappings, data.mappings);
      }
    } catch {
      // Plan mappings don't exist yet — that's fine, fall through
    }

    // 2. Try audit-data.json (auto-discovered mappings, lower priority)
    try {
      const raw = await readFile(join(dataPath, "audit-data.json"), "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      const extractedMappings = extractMappingsFromAuditData(data);
      // Only add audit mappings that aren't already in plan mappings
      for (const [key, value] of Object.entries(extractedMappings)) {
        if (!(key in allMappings)) {
          allMappings[key] = value;
        }
      }
    } catch {
      // No audit data — fall through
    }

    // 3. Vault fallback for backward compatibility
    try {
      const raw = await readFile(join(vaultPath, "_Tag Audit Data.json"), "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      const extractedMappings = extractMappingsFromAuditData(data);
      for (const [key, value] of Object.entries(extractedMappings)) {
        if (!(key in allMappings)) {
          allMappings[key] = value;
        }
      }
    } catch {
      // No vault fallback
    }

    if (Object.keys(allMappings).length > 0) {
      return { mappings: allMappings };
    }

    return undefined;
  }

  // Keep old name as alias for backward compatibility
  export const loadAuditMappings = loadMappings;
  ```
- **GOTCHA**: Export old name as alias to avoid breaking existing imports
- **VALIDATE**: `bun test tests/worklist-generator.test.ts`

### Task 6: UPDATE `tagging-agent.ts` — Add buildPlanSystemPrompt JSON output

**Location:** `tagging-agent.ts` (lines 75-162)

- **IMPLEMENT**: Add instruction to write plan-mappings.json after writing the markdown plan. Insert after line 154 (before the final `git_commit` instruction):
  ```typescript
  ## Phase 4: Write Machine-Readable Mappings

  After writing the plan note, also write the mappings to a JSON file for the worklist generator:
  \`\`\`
  write_data_file({
    filename: "plan-mappings.json",
    content: JSON.stringify({
      generatedAt: "<ISO-8601 timestamp>",
      generatedBy: "plan-phase-agent",
      schemeNotePath: "${config.schemeNotePath}",
      mappings: {
        // Every tag from your mapping table
        // Format: "old-tag": "new-tag" or "old-tag": null (for removal)
        // Include ALL mappings, even KEEP actions (e.g., "ai-tools": "ai-tools")
      }
    }, null, 2)
  })
  \`\`\`

  This JSON file is consumed by the deterministic worklist generator.
  ```
- **IMPLEMENT**: Also update the system prompt to use `config.schemeNotePath` instead of hardcoded `SCHEME_NOTE_PATH` constant (line 103)
- **VALIDATE**: `bun test tests/agent-prompts.test.ts`

### Task 7: CREATE `checkSchemeNoteExists` — Pre-flight for schema note

**Location:** `tagging-agent.ts` (after `checkPlanPrerequisites`, around line 692)

- **IMPLEMENT**: Add new pre-flight function:
  ```typescript
  /**
   * Pre-flight check for audit/plan modes:
   * Verify the schema note exists in the vault.
   * Returns true if schema note exists, false if missing.
   */
  export async function checkSchemeNoteExists(config: Config): Promise<boolean> {
    const schemePath = join(config.vaultPath, config.schemeNotePath);
    try {
      await readFile(schemePath, "utf-8");
      console.log(`Found schema note: ${config.schemeNotePath}\n`);
      return true;
    } catch {
      console.error(`Schema note not found: ${config.schemeNotePath}\n`);
      console.error("The agent needs a note describing your desired tagging schema.");
      console.error("");
      console.error("Create a note in your vault that defines:");
      console.error("  1. Tag categories you want to use (e.g., status/, type/, area/, project/)");
      console.error("  2. Example tags for each category");
      console.error("  3. Any existing tags that should be removed (noise patterns)");
      console.error("  4. How you want to organize your existing tags");
      console.error("");
      console.error("Then either:");
      console.error(`  - Name it "${config.schemeNotePath}" (the default), OR`);
      console.error("  - Set SCHEME_NOTE_PATH in your .env to point to your note");
      console.error("");
      return false;
    }
  }
  ```
- **PATTERN**: Follow `checkPlanPrerequisites` structure
- **VALIDATE**: `bunx tsc --noEmit`

### Task 8: UPDATE `tagging-agent.ts` — Integrate schema pre-flight

**Location:** `tagging-agent.ts` — `runAgent()` function (around lines 802-825)

- **IMPLEMENT**: Add schema note check before audit and plan modes:
  ```typescript
  // Pre-flight check for audit mode — verify schema note exists
  if (mode === "audit") {
    const hasScheme = await checkSchemeNoteExists(config);
    if (!hasScheme) {
      console.log("=".repeat(60));
      console.log(`Mode: ${mode} — schema note required`);
      console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      console.log(`Cost: $0.0000 (pre-flight check only)`);
      console.log("=".repeat(60));
      return;
    }
  }
  ```
- **IMPLEMENT**: Add same check for plan mode (inside existing pre-flight block)
- **GOTCHA**: Don't add check for execute/verify — they don't need the schema note
- **VALIDATE**: `bun test tests/preflight.test.ts`

### Task 9: UPDATE `tests/worklist-generator.test.ts` — Update for renamed function

**Location:** `tests/worklist-generator.test.ts`

- **IMPLEMENT**: Update import to use new name:
  ```typescript
  import { generateWorklist, loadMappings, formatWorklistMarkdown, writeWorklistJson } from "../lib/worklist-generator.js";
  ```
- **IMPLEMENT**: Rename `describe("loadAuditMappings"` → `describe("loadMappings"`
- **IMPLEMENT**: Add new test for plan-mappings.json priority:
  ```typescript
  test("plan-mappings.json takes priority over audit-data.json", async () => {
    // Create both files with different mappings for same tag
    await writeFile(
      join(testDataPath, "plan-mappings.json"),
      JSON.stringify({ mappings: { "test-tag": "plan-value" } }),
    );
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify({ mappings: { "test-tag": "audit-value" } }),
    );

    const result = await loadMappings(testDataPath, testVaultPath);
    expect(result).toBeDefined();
    expect(result!.mappings["test-tag"]).toBe("plan-value"); // plan wins

    // Clean up
    await rm(join(testDataPath, "plan-mappings.json"));
    await rm(join(testDataPath, "audit-data.json"));
  });
  ```
- **VALIDATE**: `bun test tests/worklist-generator.test.ts`

### Task 10: UPDATE `tests/preflight.test.ts` — Add schema note tests

**Location:** `tests/preflight.test.ts`

- **IMPLEMENT**: Add new describe block:
  ```typescript
  describe("checkSchemeNoteExists", () => {
    let testVaultPath: string;

    beforeAll(async () => {
      testVaultPath = await mkdtemp(join(tmpdir(), "scheme-preflight-test-"));
    });

    afterAll(async () => {
      await rm(testVaultPath, { recursive: true, force: true });
    });

    test("returns true when schema note exists", async () => {
      await writeFile(
        join(testVaultPath, "My Tagging Schema.md"),
        "# My Tagging Schema\n\nDefines tags..."
      );

      const mockConfig = {
        vaultPath: testVaultPath,
        schemeNotePath: "My Tagging Schema.md",
      };

      const { checkSchemeNoteExists } = await import("../tagging-agent.js");
      const result = await checkSchemeNoteExists(mockConfig as any);
      expect(result).toBe(true);
    });

    test("returns false when schema note missing", async () => {
      const mockConfig = {
        vaultPath: testVaultPath,
        schemeNotePath: "NonExistent Schema.md",
      };

      const { checkSchemeNoteExists } = await import("../tagging-agent.js");
      const result = await checkSchemeNoteExists(mockConfig as any);
      expect(result).toBe(false);
    });

    test("uses default path when not configured", async () => {
      await writeFile(
        join(testVaultPath, "Proposed Tagging System.md"),
        "# Proposed Tagging System"
      );

      const mockConfig = {
        vaultPath: testVaultPath,
        schemeNotePath: "Proposed Tagging System.md", // default
      };

      const { checkSchemeNoteExists } = await import("../tagging-agent.js");
      const result = await checkSchemeNoteExists(mockConfig as any);
      expect(result).toBe(true);
    });
  });
  ```
- **VALIDATE**: `bun test tests/preflight.test.ts`

### Task 11: UPDATE `tests/tag-scheme.test.ts` — Update for minimized TAG_MAPPINGS

**Location:** `tests/tag-scheme.test.ts`

- **IMPLEMENT**: Update any tests that expect specific hardcoded mappings to reflect the new minimal set
- **IMPLEMENT**: Add test confirming loaded mappings take priority:
  ```typescript
  test("lookupTagMapping prioritizes loaded mappings over hardcoded", () => {
    const loadedMappings = { mappings: { "custom-tag": "type/custom" } };
    const result = lookupTagMapping("custom-tag", loadedMappings);
    expect(result.action).toBe("map");
    expect(result.newTag).toBe("type/custom");
  });
  ```
- **VALIDATE**: `bun test tests/tag-scheme.test.ts`

### Task 12: UPDATE `README.md` — New user experience

**Location:** `README.md`

- **IMPLEMENT**: Add "Getting Started with Your Vault" section after "Setup":
  ```markdown
  ## Getting Started with Your Vault

  ### 1. Create Your Tagging Schema Note

  Before running the agent, create a note in your vault that describes your desired tagging system. For example, create `Proposed Tagging System.md`:

  ```markdown
  # My Tagging Schema

  ## Categories

  - **status/** — Task status: `status/pending`, `status/completed`, `status/archived`
  - **type/** — Note type: `type/meeting`, `type/daily-note`, `type/research`
  - **area/** — Life areas: `area/career`, `area/health`, `area/learning`
  - **project/** — Active projects: `project/my-app`, `project/home-reno`

  ## Topic Tags

  Flat tags for topics: `ai-tools`, `productivity`, `cooking`

  ## Tags to Remove

  - `heading` — Noise from Google Docs imports
  - Any tag starting with `follow-up-required-`
  ```

  ### 2. Configure the Agent

  ```bash
  cp .env.example .env
  ```

  Edit `.env`:
  ```bash
  VAULT_PATH="/path/to/your/obsidian-vault"
  # Optional: if your schema note has a different name
  # SCHEME_NOTE_PATH="My Tagging Schema.md"
  ```

  ### 3. Run the Migration

  ```bash
  bun run tagging-agent.ts  # Interactive mode guides you through
  ```
  ```
- **VALIDATE**: Markdown renders correctly

### Task 13: UPDATE `CHANGELOG.md` — Document the change

**Location:** `CHANGELOG.md` (at top, after frontmatter)

- **IMPLEMENT**: Add entry following existing format:
  ```markdown
  ## 2026-02-25: Dynamic Plan Mappings — Generalization for Any Vault

  ### Session Context

  The agent was built with hardcoded tag mappings specific to one vault. To share it as a tool others can use, the architecture needed to support user-defined schemas without code editing.

  ### Problem Statement

  - `TAG_MAPPINGS` in `tag-scheme.ts` had ~50 hardcoded mappings
  - Plan phase wrote mappings to markdown but not machine-readable JSON
  - New users would need to edit source code to use the agent

  ### Solution Implemented

  1. **Plan phase writes `plan-mappings.json`** — Machine-readable mappings for worklist generator
  2. **`loadMappings()` loads plan mappings first** — User-approved mappings take priority
  3. **`TAG_MAPPINGS` minimized** — Only universal noise patterns remain
  4. **`SCHEME_NOTE_PATH` configurable** — Users point to their own schema note
  5. **Pre-flight validates schema note** — Friendly error if missing

  ### Files Changed

  | File | Change |
  |------|--------|
  | `lib/config.ts` | Added `schemeNotePath` config |
  | `tag-scheme.ts` | Minimized `TAG_MAPPINGS`, updated `lookupTagMapping()` priority |
  | `lib/worklist-generator.ts` | Renamed `loadAuditMappings()` → `loadMappings()`, added plan-mappings.json loading |
  | `tagging-agent.ts` | Updated `buildPlanSystemPrompt()`, added `checkSchemeNoteExists()` |
  | `.env.example` | Added `SCHEME_NOTE_PATH` |
  | `README.md` | Added "Getting Started with Your Vault" section |
  | `tests/*.test.ts` | Updated for new behavior |

  ### Commits

  - `<pending>` feat: implement dynamic plan mappings for vault generalization
  ```
- **VALIDATE**: Markdown syntax correct

---

## TESTING STRATEGY

### Unit Tests

**Scope:** Test each changed function in isolation

1. `loadMappings()` — Verify plan-mappings.json priority over audit-data.json
2. `lookupTagMapping()` — Verify loaded mappings priority over hardcoded
3. `checkSchemeNoteExists()` — Verify true/false returns and error messages

### Integration Tests

**Scope:** Test the full flow with a synthetic vault

1. Create temp vault with schema note
2. Run audit (mock or real)
3. Verify plan phase would produce plan-mappings.json instruction in prompt
4. Verify worklist generator loads mappings correctly

### Edge Cases

1. No plan-mappings.json exists (should fall back to audit-data.json)
2. Neither plan-mappings.json nor audit-data.json exists (should return undefined)
3. Schema note missing (should fail pre-flight with friendly message)
4. Plan-mappings.json has same tag as audit-data.json (plan should win)

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
bunx tsc --noEmit
```

Expected: No errors (ignore pre-existing `reference/workshop/` errors)

### Level 2: Unit Tests

```bash
bun test tests/config.test.ts
bun test tests/tag-scheme.test.ts
bun test tests/worklist-generator.test.ts
bun test tests/preflight.test.ts
bun test tests/agent-prompts.test.ts
```

Expected: All tests pass

### Level 3: Full Test Suite

```bash
bun test
```

Expected: All ~290 tests pass

### Level 4: Manual Validation

1. Create a fresh test vault with a custom schema note (not `Proposed Tagging System.md`)
2. Set `SCHEME_NOTE_PATH` to point to it
3. Run `bun run tagging-agent.ts audit` — should find schema note
4. Run `bun run tagging-agent.ts plan` — should reference schema note in prompt
5. Verify the plan phase prompt includes `write_data_file` instruction for `plan-mappings.json`

---

## ACCEPTANCE CRITERIA

- [ ] New user can use the agent with their own schema note (no code editing)
- [ ] `SCHEME_NOTE_PATH` env var is documented and works
- [ ] Plan phase prompt includes instruction to write `plan-mappings.json`
- [ ] `loadMappings()` loads plan-mappings.json with higher priority than audit-data.json
- [ ] `TAG_MAPPINGS` contains only universal noise patterns
- [ ] Pre-flight check fails gracefully if schema note missing (with helpful message)
- [ ] All existing tests pass (no regressions)
- [ ] New tests cover the changed behavior
- [ ] README documents the new user experience
- [ ] CHANGELOG documents the change

---

## COMPLETION CHECKLIST

- [ ] Task 1: Config updated with schemeNotePath
- [ ] Task 2: .env.example updated
- [ ] Task 3: TAG_MAPPINGS minimized
- [ ] Task 4: lookupTagMapping priority updated
- [ ] Task 5: loadMappings function created
- [ ] Task 6: buildPlanSystemPrompt updated
- [ ] Task 7: checkSchemeNoteExists created
- [ ] Task 8: Schema pre-flight integrated
- [ ] Task 9: worklist-generator tests updated
- [ ] Task 10: preflight tests added
- [ ] Task 11: tag-scheme tests updated
- [ ] Task 12: README updated
- [ ] Task 13: CHANGELOG updated
- [ ] All validation commands pass
- [ ] Manual testing confirms feature works

---

## NOTES

### Design Decisions

1. **Plan mappings take priority over audit mappings** — The user reviews and approves the plan, so those mappings should be authoritative.

2. **Keep noise patterns hardcoded** — Patterns like `heading` (Google Docs anchors) are truly universal and shouldn't require user configuration.

3. **Backward compatibility via alias** — `loadAuditMappings` is kept as an alias to `loadMappings` to avoid breaking any external references.

4. **Friendly error messages** — The schema note pre-flight provides actionable guidance, not just "file not found."

### Risks

1. **LLM may not follow instruction to write JSON** — Mitigated by clear, explicit prompt with exact format
2. **JSON parsing errors** — Mitigated by try/catch with graceful fallback

### Future Considerations

1. **v2: Schema proposal** — If no schema note exists, the audit phase could propose one based on discovered tags
2. **v2: Interactive schema editor** — The agent could help users create their schema interactively
