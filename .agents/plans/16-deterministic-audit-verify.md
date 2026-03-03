---
status: PENDING
---

# Feature: Deterministic Audit and Verify Phases

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Replace LLM-driven audit and verify phases with deterministic code implementations. The LLM audit was unreliable (reported 172 tags but only wrote 88 to JSON). The LLM verify only sampled ~10 notes before declaring "100% compliance". Code-driven phases are instant, free, accurate, and consistent.

This continues the established pattern where deterministic operations use code (`generate-audit`, `generate-worklist`, `batch-executor`) while LLM handles interpretation tasks (plan phase).

## User Story

As a vault owner running tag migrations
I want the agent to use deterministic code for audit and verify phases
So that I get accurate, consistent results at lower cost

## Problem Statement

1. **LLM audit is unreliable** — Reports incorrect tag counts, misses tags, costs ~$0.50
2. **LLM verify only samples** — Checks ~10 notes, gives false confidence of "100% compliance"
3. **Interactive mode uses LLM for both** — Wastes money on deterministic operations
4. **Note count discrepancies** — Different phases report different counts (76 vs 84 vs 79)

## Solution Statement

1. Deprecate LLM audit entirely — `audit` mode becomes code-driven (current `generate-audit`)
2. Create `lib/verify-generator.ts` — Deterministic verification following audit-generator pattern
3. Update interactive mode — Use code functions for audit and verify phases
4. Document note counting — Clarify `_` prefixed files are excluded (by design)

## Feature Metadata

**Feature Type**: Enhancement
**Estimated Complexity**: Medium
**Primary Systems Affected**: `lib/interactive-agent.ts`, `tagging-agent.ts`, new `lib/verify-generator.ts`
**Dependencies**: None (uses existing patterns)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: READ THESE FILES BEFORE IMPLEMENTING!

- `lib/audit-generator.ts` (lines 79-279) - **PRIMARY PATTERN** to follow for verify-generator
- `lib/audit-generator.ts` (lines 284-378) - Markdown report formatting pattern
- `lib/scope-filter.ts` (lines 18-36) - Note filtering, `_` file exclusion
- `lib/interactive-agent.ts` (lines 415-528) - `runGenerateWorklistPhase()` pattern for code phases
- `lib/interactive-agent.ts` (lines 658-711) - Phase handling in main loop
- `lib/session-state.ts` (lines 22-29, 147-162) - AgentPhase type and progression
- `tagging-agent.ts` (lines 307-404) - Verify rules in `buildVerifySystemPrompt()`
- `tagging-agent.ts` (lines 915-975) - Current `generate-audit` mode handling
- `tests/audit-generator.test.ts` (full file) - Test patterns to follow

### New Files to Create

- `lib/verify-generator.ts` - Deterministic verification generator
- `tests/verify-generator.test.ts` - Tests for verify generator

### Relevant Documentation READ THESE BEFORE IMPLEMENTING!

- `docs/ARCHITECTURE.md` - Design principles (code > LLM for reliability)
- `CLAUDE.md` - Project conventions (gray-matter, zod, named exports, kebab-case)

### Patterns to Follow

**Generator Function Signature (from audit-generator.ts:79-82):**
```typescript
export async function generateVerify(
  vaultPath: string,
  scope?: WorkScope,
): Promise<VerifyGeneratorResult> {
```

**Result Interface Pattern (from audit-generator.ts:56-67):**
```typescript
export interface VerifyGeneratorResult {
  data: VerifyData;
  warnings: string[];
  stats: {
    totalNotesScanned: number;
    notesCompliant: number;
    notesWithViolations: number;
    // ... violation counts by type
  };
}
```

**Interactive Phase Function Pattern (from interactive-agent.ts:415-528):**
```typescript
async function runGenerateVerifyPhase(config: Config): Promise<boolean> {
  console.log("Verifying deterministically (no LLM)...");
  try {
    const result = await generateVerify(config.vaultPath);
    // Print stats, write report
    return true;
  } catch (error) {
    console.error("Error:", error);
    return false;
  }
}
```

**Test Pattern (from audit-generator.test.ts):**
```typescript
describe("generateVerify", () => {
  let testVaultPath: string;

  beforeAll(async () => {
    testVaultPath = await mkdtemp(join(tmpdir(), "verify-test-"));
    // Create test notes with various compliance states
  });

  afterAll(async () => {
    await rm(testVaultPath, { recursive: true });
  });

  test("detects inline tags", async () => {
    const result = await generateVerify(testVaultPath);
    expect(result.stats.inlineTagViolations).toBeGreaterThan(0);
  });
});
```

---

## IMPLEMENTATION PLAN

### Phase 1: Create Verify Generator

Create `lib/verify-generator.ts` following the audit-generator pattern. Implement all verification rules from `buildVerifySystemPrompt()`.

**Verification Rules to Implement (from tagging-agent.ts:334-373):**
1. No inline tags remaining (all in frontmatter)
2. No hash prefixes in frontmatter tags
3. Valid tag formats:
   - Prefixed: `status/`, `type/`, `area/`, `project/`, `tool/`, `skill/`, `topic/`
   - Flat topic: lowercase kebab-case (e.g., `ai-tools`, `blockchain`)
4. No duplicate tags (case-insensitive)
5. No noise tags (Google Docs anchors, `heading`, `follow-up-required-*`)

### Phase 2: Deprecate LLM Audit

Remove `buildAuditSystemPrompt()` and make `audit` mode use code-driven generation. Update config to reflect this.

### Phase 3: Update Interactive Mode

Replace LLM phase calls with code functions for audit and verify. Update phase transitions.

### Phase 4: Testing & Validation

Add tests for verify-generator following audit-generator.test.ts pattern.

---

## STEP-BY-STEP TASKS

### Task 1: CREATE `lib/verify-generator.ts`

**IMPLEMENT:** Create verify generator with these exports:
- `VerifyData` interface - verification results data
- `VerifyGeneratorResult` interface - full result with stats
- `generateVerify()` function - main verification logic
- `formatVerifyMarkdown()` function - markdown report formatting
- `writeVerifyJson()` function - JSON output to data/

**PATTERN:** Mirror `lib/audit-generator.ts` structure exactly

**IMPORTS:**
```typescript
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { parseFrontmatter, getFrontmatterTags } from "./frontmatter.js";
import { extractInlineTags, classifyTags, isValidTagFormat, normalizeTag, isNoiseTag } from "./tag-parser.js";
import { scopeToNotes } from "./scope-filter.js";
import type { WorkScope } from "./types.js";
```

**GOTCHA:** Use `isNoiseTag()` from tag-parser.ts for noise detection, not hardcoded patterns

**VALIDATE:** `bunx tsc --noEmit` passes

---

### Task 2: IMPLEMENT Verification Logic in verify-generator.ts

**IMPLEMENT:** The `generateVerify()` function must check:

```typescript
interface NoteViolation {
  path: string;
  inlineTags: string[];           // Tags found inline (should be in frontmatter)
  hashPrefixTags: string[];       // Tags with # prefix in frontmatter
  invalidFormatTags: string[];    // Tags not matching lowercase kebab-case
  duplicateTags: string[];        // Duplicate tags (case-insensitive)
  noiseTags: string[];            // Noise patterns that should be removed
}
```

**PATTERN:** Follow audit-generator.ts lines 103-179 for per-note processing

**IMPORTS:** Use existing helpers:
- `extractInlineTags()` from tag-parser.ts
- `getFrontmatterTags()` from frontmatter.ts
- `isNoiseTag()` from tag-parser.ts
- `isValidTagFormat()` from tag-parser.ts

**GOTCHA:** Inline tags in code blocks should NOT be flagged — `extractInlineTags()` already handles this

**VALIDATE:** `bun test tests/verify-generator.test.ts`

---

### Task 3: IMPLEMENT formatVerifyMarkdown() in verify-generator.ts

**IMPLEMENT:** Markdown report with sections:
1. Executive Summary (pass/fail, compliance %)
2. Violation Summary by Type
3. Notes with Violations (detailed list)
4. Tag Distribution Summary
5. Next Steps

**PATTERN:** Mirror `formatAuditMarkdown()` at audit-generator.ts:284-378

**FRONTMATTER:**
```yaml
---
tags:
  - type/report
date: '{today}'
generated-by: deterministic-verify-generator
---
```

**VALIDATE:** Manual review of generated markdown

---

### Task 4: CREATE `tests/verify-generator.test.ts`

**IMPLEMENT:** Test cases covering:
1. Fully compliant vault (no violations)
2. Inline tags detected
3. Hash prefix tags detected
4. Invalid format tags detected
5. Duplicate tags detected
6. Noise tags detected
7. Mixed violations in single note
8. Agent artifacts (`_` prefixed) excluded from scan

**PATTERN:** Mirror `tests/audit-generator.test.ts` structure

**IMPORTS:**
```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { generateVerify, formatVerifyMarkdown } from "../lib/verify-generator.js";
```

**VALIDATE:** `bun test tests/verify-generator.test.ts` — all tests pass

---

### Task 5: ADD `generate-verify` mode to tagging-agent.ts

**IMPLEMENT:** Add handling for `generate-verify` mode following `generate-audit` pattern

**LOCATION:** After line 975 (after generate-audit block), add:

```typescript
// generate-verify mode: pure code, no LLM
if (mode === "generate-verify") {
  console.log("Verifying deterministically (no LLM)...\n");

  const result = await generateVerify(config.vaultPath);

  // Print stats
  console.log(`Notes scanned: ${result.stats.totalNotesScanned}`);
  console.log(`Notes compliant: ${result.stats.notesCompliant}`);
  console.log(`Notes with violations: ${result.stats.notesWithViolations}`);
  // ... more stats

  // Write report
  const reportMarkdown = formatVerifyMarkdown(result);
  const reportPath = join(config.vaultPath, "_Tag Migration Verification.md");
  await writeFile(reportPath, reportMarkdown, "utf-8");
  console.log(`\nVerification report written to _Tag Migration Verification.md`);

  // Summary
  const compliance = (result.stats.notesCompliant / result.stats.totalNotesScanned * 100).toFixed(1);
  console.log(`\n${compliance}% compliance`);

  console.log();
  console.log("=".repeat(60));
  console.log(`Mode: generate-verify complete`);
  console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`Cost: $0.0000 (no LLM used)`);
  console.log("=".repeat(60));
  return;
}
```

**IMPORTS:** Add at top of file:
```typescript
import { generateVerify, formatVerifyMarkdown } from "./lib/verify-generator.js";
```

**VALIDATE:** `bun run tagging-agent.ts generate-verify` runs successfully

---

### Task 6: UPDATE AgentMode type in lib/config.ts

**UPDATE:** Add `generate-verify` to AgentMode type

**LOCATION:** `lib/config.ts` line 3

**OLD:**
```typescript
export type AgentMode = "audit" | "generate-audit" | "plan" | "generate-worklist" | "execute" | "verify" | "interactive";
```

**NEW:**
```typescript
export type AgentMode = "audit" | "generate-audit" | "plan" | "generate-worklist" | "execute" | "verify" | "generate-verify" | "interactive";
```

**ALSO UPDATE:** VALID_MODES array at line 40

**VALIDATE:** `bunx tsc --noEmit`

---

### Task 7: UPDATE interactive mode to use code-driven audit

**UPDATE:** Replace LLM audit with code-driven audit in interactive mode

**LOCATION:** `lib/interactive-agent.ts` lines 658-662

**OLD:**
```typescript
if (phase === "AUDIT" || phase === "VERIFY") {
  // LLM phases (no pre-flight needed)
  const result = await runLLMPhase(phase, state.sessionId, config);
  state.sessionId = result.sessionId;
  phaseSuccess = result.success;
}
```

**NEW:**
```typescript
if (phase === "AUDIT") {
  // Code-driven audit (no LLM)
  phaseSuccess = await runGenerateAuditPhase(config);
} else if (phase === "VERIFY") {
  // Code-driven verify (no LLM)
  phaseSuccess = await runGenerateVerifyPhase(config);
}
```

**IMPORTS:** Add imports for audit and verify generators

**VALIDATE:** Run interactive mode, confirm audit phase is instant

---

### Task 8: CREATE runGenerateAuditPhase() in interactive-agent.ts

**IMPLEMENT:** New function following `runGenerateWorklistPhase()` pattern

**LOCATION:** After line 528, add:

```typescript
async function runGenerateAuditPhase(config: Config): Promise<boolean> {
  console.log("Auditing deterministically (no LLM)...\n");

  try {
    const result = await generateAudit(config.vaultPath);

    // Print stats
    console.log(`Notes scanned: ${result.stats.totalNotesScanned}`);
    console.log(`Notes with tags: ${result.stats.notesWithTags}`);
    console.log(`Unique tags found: ${result.stats.uniqueTags}`);
    console.log(`Format issues: ${result.stats.formatIssues}`);
    console.log(`Noise tags: ${result.stats.noiseTags}`);

    if (result.warnings.length > 0) {
      console.log(`\nWarnings:`);
      for (const w of result.warnings.slice(0, 10)) console.log(`  - ${w}`);
      if (result.warnings.length > 10) {
        console.log(`  ... and ${result.warnings.length - 10} more`);
      }
    }

    // Write JSON
    await writeAuditJson(config.dataPath, result.data);
    console.log(`\nAudit data written to data/audit-data.json`);

    // Write markdown report
    const reportMarkdown = formatAuditMarkdown(result);
    const reportPath = join(config.vaultPath, "_Tag Audit Report.md");
    await writeFile(reportPath, reportMarkdown, "utf-8");
    console.log(`Audit report written to _Tag Audit Report.md`);

    return true;
  } catch (error) {
    console.error("Error running audit:", error);
    return false;
  }
}
```

**IMPORTS:** Add at top:
```typescript
import { generateAudit, formatAuditMarkdown, writeAuditJson } from "./audit-generator.js";
```

**VALIDATE:** Interactive mode audit phase completes without LLM calls

---

### Task 9: CREATE runGenerateVerifyPhase() in interactive-agent.ts

**IMPLEMENT:** New function for code-driven verification

**LOCATION:** After `runGenerateAuditPhase()`, add:

```typescript
async function runGenerateVerifyPhase(config: Config): Promise<boolean> {
  console.log("Verifying deterministically (no LLM)...\n");

  try {
    const result = await generateVerify(config.vaultPath);

    // Print stats
    console.log(`Notes scanned: ${result.stats.totalNotesScanned}`);
    console.log(`Notes compliant: ${result.stats.notesCompliant}`);
    console.log(`Notes with violations: ${result.stats.notesWithViolations}`);

    if (result.stats.notesWithViolations > 0) {
      console.log(`\nViolation breakdown:`);
      if (result.stats.inlineTagViolations > 0) {
        console.log(`  - Inline tags: ${result.stats.inlineTagViolations} notes`);
      }
      if (result.stats.formatViolations > 0) {
        console.log(`  - Format issues: ${result.stats.formatViolations} notes`);
      }
      if (result.stats.duplicateViolations > 0) {
        console.log(`  - Duplicates: ${result.stats.duplicateViolations} notes`);
      }
      if (result.stats.noiseTagViolations > 0) {
        console.log(`  - Noise tags: ${result.stats.noiseTagViolations} notes`);
      }
    }

    // Write markdown report
    const reportMarkdown = formatVerifyMarkdown(result);
    const reportPath = join(config.vaultPath, "_Tag Migration Verification.md");
    await writeFile(reportPath, reportMarkdown, "utf-8");
    console.log(`\nVerification report written to _Tag Migration Verification.md`);

    // Summary
    const compliance = (result.stats.notesCompliant / result.stats.totalNotesScanned * 100).toFixed(1);
    if (result.stats.notesWithViolations === 0) {
      console.log(`\n✅ ${compliance}% compliance — all notes pass verification!`);
    } else {
      console.log(`\n⚠️  ${compliance}% compliance — ${result.stats.notesWithViolations} notes need attention`);
    }

    return true;
  } catch (error) {
    console.error("Error running verification:", error);
    return false;
  }
}
```

**IMPORTS:** Add at top:
```typescript
import { generateVerify, formatVerifyMarkdown } from "./verify-generator.js";
```

**VALIDATE:** Interactive mode verify phase completes without LLM calls

---

### Task 10: UPDATE phase transition messages in agent-personality.ts

**UPDATE:** Modify messages to reflect that audit/verify are now instant

**LOCATION:** `lib/agent-personality.ts` - find `buildPhaseTransitionPrompt()`

**CHANGES:**
- Audit completion message: Remove cost mention, emphasize "instant" and "deterministic"
- Verify completion message: Same updates

**VALIDATE:** Run interactive mode, confirm messages are appropriate

---

### Task 11: DEPRECATE LLM audit mode (make audit = generate-audit)

**UPDATE:** In `tagging-agent.ts`, redirect `audit` mode to code-driven implementation

**LOCATION:** Lines 978-988 and 1026-1028

**OPTION A (Recommended):** Remove `audit` LLM path, keep `generate-audit` as alias
```typescript
// Both "audit" and "generate-audit" now run code-driven audit
if (mode === "audit" || mode === "generate-audit") {
  // ... generate-audit code (lines 916-975)
}
```

**OPTION B:** Keep `audit` as LLM for backward compatibility, deprecation warning
```typescript
if (mode === "audit") {
  console.log("⚠️  LLM audit is deprecated. Use 'generate-audit' for accurate results.");
  console.log("    The 'audit' mode will be removed in a future version.\n");
  // ... existing LLM audit code
}
```

**DECISION:** Use Option A — clean break, no deprecation period

**ALSO:** Remove `buildAuditSystemPrompt()` function (lines 18-74) if no longer used

**VALIDATE:** `bun run tagging-agent.ts audit` runs code-driven audit

---

### Task 12: DEPRECATE LLM verify mode (make verify = generate-verify)

**UPDATE:** In `tagging-agent.ts`, redirect `verify` mode to code-driven implementation

**LOCATION:** Lines 1032-1033

**CHANGE:** Both `verify` and `generate-verify` run code-driven verification

```typescript
// Both "verify" and "generate-verify" now run code-driven verification
if (mode === "verify" || mode === "generate-verify") {
  // ... generate-verify code
}
```

**ALSO:** Remove `buildVerifySystemPrompt()` function (lines 307-404) if no longer used

**VALIDATE:** `bun run tagging-agent.ts verify` runs code-driven verification

---

### Task 13: UPDATE README.md documentation

**UPDATE:** Reflect that audit and verify are now code-driven

**CHANGES:**
1. Remove references to LLM audit costs (~$0.30-0.50)
2. Remove references to LLM verify costs (~$0.30-0.50)
3. Update cost table:
   ```
   | Phase | Estimate |
   |-------|----------|
   | Audit | $0.00 (deterministic) |
   | Plan | ~$0.15-0.25 |
   | Generate Worklist | $0.00 (deterministic) |
   | Execute (per batch) | ~$0.06 |
   | Verify | $0.00 (deterministic) |
   ```
4. Update phase descriptions to mention "instant" and "deterministic"
5. Remove "Phase 1 (Alternative): LLM Audit" section

**VALIDATE:** Manual review of README

---

### Task 14: UPDATE PROJECT_STATUS.md

**UPDATE:** Document the architectural change

**ADD to "Key Changes" section:**
```markdown
**Key Changes (YYYY-MM-DD):**
- `lib/verify-generator.ts` — New deterministic verification (no LLM)
- Audit and verify modes now code-driven by default
- Interactive mode uses code for audit/verify phases
- LLM audit/verify removed (unreliable, expensive)
```

**VALIDATE:** Manual review

---

### Task 15: ADD note count documentation to scope-filter.ts

**UPDATE:** Add documentation explaining `_` file exclusion

**LOCATION:** `lib/scope-filter.ts` lines 14-25

**ADD COMMENT:**
```typescript
/**
 * Get all markdown notes in the vault, excluding:
 * - Agent artifact files (prefixed with `_`)
 * - Non-markdown files
 *
 * Agent artifacts like `_Tag Audit Report.md`, `_Tag Migration Plan.md`,
 * and `_Tag Migration Verification.md` are excluded because they are
 * generated by the agent, not user content to be migrated.
 *
 * This means note counts may appear lower than the total `.md` files
 * in the vault. This is intentional.
 */
```

**VALIDATE:** `bunx tsc --noEmit`

---

## TESTING STRATEGY

### Unit Tests

**File:** `tests/verify-generator.test.ts`

Test cases:
1. Empty vault (no notes) — returns zero counts
2. Fully compliant vault — 100% compliance, no violations
3. Inline tags detected — flags notes with `#tag` in body
4. Hash prefix in frontmatter — flags `tags: [#invalid]`
5. Invalid format — flags uppercase, underscores
6. Duplicate tags — flags `tags: [foo, FOO]`
7. Noise tags — flags `heading`, Google Docs anchors
8. Agent artifacts excluded — `_Tag*.md` not scanned
9. Templater files skipped — `<% %>` in frontmatter
10. Mixed violations — single note with multiple issues

### Integration Tests

Run full interactive mode cycle on test-vault-complex:
```bash
rm -f data/*.json
bun run tagging-agent.ts
# Verify audit phase is instant ($0.00)
# Verify verify phase is instant ($0.00)
```

### Edge Cases

- Vault with only agent artifacts (should report 0 notes)
- Note with tags in code blocks (should NOT flag as inline)
- Note with URL containing `#anchor` (should NOT flag)

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
bunx tsc --noEmit
```

### Level 2: Unit Tests

```bash
bun test tests/verify-generator.test.ts
bun test tests/audit-generator.test.ts
bun test
```

### Level 3: CLI Mode Tests

```bash
# Test audit mode (should be instant)
rm -f data/*.json
time bun run tagging-agent.ts audit
# Expected: completes in <1s, $0.00 cost

# Test verify mode (should be instant)
time bun run tagging-agent.ts verify
# Expected: completes in <1s, $0.00 cost
```

### Level 4: Interactive Mode Test

```bash
rm -f data/*.json
VAULT_PATH="./test-vault-complex" bun run tagging-agent.ts
# Walk through full cycle
# Verify audit/verify phases show "$0.0000" cost
```

### Level 5: Manual Validation

- Review `_Tag Audit Report.md` — accurate counts, all tags listed
- Review `_Tag Migration Verification.md` — all notes checked, violations detailed
- Check `data/audit-data.json` — `tagFrequencies` matches report counts

---

## ACCEPTANCE CRITERIA

- [ ] `audit` mode runs code-driven (not LLM), costs $0.00
- [ ] `verify` mode runs code-driven (not LLM), costs $0.00
- [ ] Interactive mode uses code for audit/verify phases
- [ ] Verify checks ALL notes (not sampling)
- [ ] All 5 verification rules implemented (inline, hash prefix, format, duplicates, noise)
- [ ] `_` prefixed files excluded from all scans
- [ ] Tests pass for verify-generator
- [ ] No regressions in existing tests
- [ ] README updated with new cost table
- [ ] PROJECT_STATUS.md documents changes

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works
- [ ] Acceptance criteria all met
- [ ] CHANGELOG.md updated
- [ ] PROJECT_STATUS.md updated
- [ ] Plan status header updated to IMPLEMENTED

---

## NOTES

### Architectural Decision

This change completes the evolution from "LLM does everything" to "LLM where it adds value":
- **Code handles:** Audit (counting), Worklist (applying mappings), Execute (file operations), Verify (rule checking)
- **LLM handles:** Plan (interpreting user's scheme note), Interactive conversation

### Backward Compatibility

- `audit` now means code-driven (was LLM)
- `verify` now means code-driven (was LLM)
- `generate-audit` and `generate-verify` are kept as aliases for clarity
- No breaking changes to data file formats

### Cost Savings

Before: Audit (~$0.50) + Verify (~$0.50) = ~$1.00 per migration
After: Audit ($0.00) + Verify ($0.00) = $0.00 per migration

**Total migration cost reduced from ~$1.50 to ~$0.25** (only plan phase uses LLM)
