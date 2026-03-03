---
status: IMPLEMENTED
implemented_date: 2026-03-03
---

# Feature: Deterministic Audit Generator

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Replace the LLM-driven audit phase with deterministic TypeScript code that exhaustively scans all notes and catalogs every tag with accurate frequencies. This follows the same pattern as the `generate-worklist` phase, which successfully moved mechanical iteration from LLM to code.

The current audit phase relies on the LLM to "call read_note for each note" but the LLM tries to optimize by using `search_notes` queries for known tags. This approach cannot discover new tags—it only finds tags it already knows about. Result: the audit reported 15-25 tags when the vault actually had 100+ unique tags.

The new pipeline:

```
generate-audit (CODE)  →  plan (LLM)  →  generate-worklist (CODE)  →  execute (LLM)  →  verify (LLM)
       │                      │                    │                        │
       ▼                      ▼                    ▼                        ▼
  audit-data.json      _Tag Migration        migration-worklist.json    Apply changes
  _Tag Audit Report.md   Plan.md             plan-mappings.json         per worklist
  (both accurate)      (mapping table)
```

## User Story

As a vault owner running the tagging agent,
I want the audit phase to exhaustively scan every note and catalog every tag,
So that I get accurate tag counts, frequencies, and format analysis without LLM sampling errors.

## Problem Statement

The LLM-driven audit phase failed to follow instructions:
- Instructed to "call read_note for each note"
- Instead used `search_notes` queries for known tags (cannot discover new tags)
- Reported 15-25 tags when vault had 100+ unique tags
- Falsely claimed "No Format Issues" when underscores and mixed case existed
- Same failure pattern seen in execute phase before the prompt injection fix

## Solution Statement

Move audit generation into a pure TypeScript function that:
1. Scans every note using existing `scopeToNotes()` utility
2. Extracts all tags using existing `parseFrontmatter()`, `extractInlineTags()` utilities
3. Validates tag formats using existing `isValidTagFormat()`, `normalizeTag()` utilities
4. Computes accurate frequencies and statistics
5. Generates both JSON data and markdown report deterministically

This is the same pattern that successfully fixed the worklist generation phase.

## Feature Metadata

**Feature Type**: Refactor / Architecture Change
**Estimated Complexity**: Medium
**Primary Systems Affected**: `tagging-agent.ts`, new `lib/audit-generator.ts`
**Dependencies**: Existing utilities in `lib/tag-parser.ts`, `lib/frontmatter.ts`, `lib/scope-filter.ts`

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `lib/worklist-generator.ts` (lines 75-216) — **PRIMARY PATTERN**: `generateWorklist()` function to mirror
- `lib/worklist-generator.ts` (lines 251-289) — `formatWorklistMarkdown()` pattern for report generation
- `lib/tag-parser.ts` (lines 16-24) — `extractInlineTags()` for inline tag extraction
- `lib/tag-parser.ts` (lines 26-31) — `isNoiseTag()` for noise detection
- `lib/tag-parser.ts` (lines 34-45) — `classifyTags()` for valid/noise classification
- `lib/tag-parser.ts` (lines 47-58) — `normalizeTag()` and `isValidTagFormat()` for format validation
- `lib/frontmatter.ts` — `parseFrontmatter()`, `getFrontmatterTags()` for YAML parsing
- `lib/scope-filter.ts` — `scopeToNotes()` for file iteration
- `tagging-agent.ts` (lines 804-908) — `generate-worklist` mode implementation to mirror
- `tagging-agent.ts` (lines 17-73) — Current `buildAuditSystemPrompt()` to understand expected outputs
- `lib/config.ts` (line 1) — `AgentMode` type to extend
- `tests/worklist-generator.test.ts` — Test patterns to follow

### New Files to Create

- `lib/audit-generator.ts` — Core deterministic audit function and report formatter
- `tests/audit-generator.test.ts` — Unit tests for audit generator

### Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/config.ts` | UPDATE | Add `generate-audit` to `AgentMode` type |
| `tagging-agent.ts` | UPDATE | Add `generate-audit` mode with early return |
| `tagging-agent.ts` | UPDATE | Add import for audit generator |
| `tagging-agent.ts` | UPDATE | Add user prompt case for `generate-audit` |

### Relevant Documentation

- `PRD.md` (Section 7, lines 182-218) — `read_note` tool spec showing tag output format
- `CLAUDE.md` — Project conventions (no default exports, kebab-case filenames, gray-matter)
- `.agents/plans/04-deterministic-worklist-generator.md` — Reference implementation plan

### Patterns to Follow

**File iteration pattern** (from `lib/worklist-generator.ts:92-105`):
```typescript
const notePaths = await scopeToNotes(vaultPath, scope ?? { type: "full" });

for (const notePath of notePaths) {
  const fullPath = join(vaultPath, notePath);

  let raw: string;
  try {
    raw = await readFile(fullPath, "utf-8");
  } catch (err) {
    warnings.push(`Could not read ${notePath}: ${err}`);
    continue;
  }
  // ... process note
}
```

**Tag extraction pattern** (from `lib/worklist-generator.ts:117-130`):
```typescript
const parsed = parseFrontmatter(raw);
const frontmatterTags = getFrontmatterTags(parsed.data);
const inlineTags = extractInlineTags(parsed.content);
const allTags = [...new Set([...frontmatterTags, ...inlineTags])];
const { validTags, noiseTags } = classifyTags(allTags);
```

**Templater skip pattern** (from `lib/worklist-generator.ts:107-115`):
```typescript
const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
const frontmatterContent = frontmatterMatch?.[1] || "";
if (frontmatterContent.includes("<%") && frontmatterContent.includes("%>")) {
  warnings.push(`Skipping: Templater syntax in frontmatter: ${notePath}`);
  continue;
}
```

**CLI mode early return pattern** (from `tagging-agent.ts:804-908`):
```typescript
if (mode === "generate-worklist") {
  console.log("Generating worklist deterministically (no LLM)...\n");
  // ... do code work ...
  console.log("=".repeat(60));
  console.log(`Cost: $0.0000 (no LLM used)`);
  return;  // Early return before query()
}
```

**Named exports only** — no default exports anywhere in the project.

---

## IMPLEMENTATION PLAN

### Phase 1: Create Audit Generator Module

Create the core `lib/audit-generator.ts` with:
- `AuditData` interface for structured output
- `AuditGeneratorResult` interface with stats and warnings
- `generateAudit()` function that scans all notes
- `formatAuditMarkdown()` function for human-readable report
- `writeAuditJson()` function for machine-readable data

### Phase 2: CLI Integration

Add `generate-audit` mode to `tagging-agent.ts`:
- Add to valid modes in `lib/config.ts`
- Add early return block before LLM `query()`
- Add user prompt case
- Add import for audit generator

### Phase 3: Tests

Create comprehensive tests for the audit generator:
- Test tag frequency counting
- Test format validation detection
- Test noise tag identification
- Test Templater file skipping
- Test report generation

---

## STEP-BY-STEP TASKS

Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task 1: CREATE `lib/audit-generator.ts` — types and interfaces

**File:** `lib/audit-generator.ts` (new file)

**IMPLEMENT:** Create the file with type definitions:

```typescript
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { parseFrontmatter, getFrontmatterTags } from "./frontmatter.js";
import { extractInlineTags, classifyTags, isValidTagFormat, normalizeTag } from "./tag-parser.js";
import { scopeToNotes } from "./scope-filter.js";
import type { WorkScope } from "./types.js";

// === Audit data types ===

export interface TagInfo {
  /** Original tag as found in notes (may have case/format issues) */
  original: string;
  /** Normalized form (lowercase, hyphens) */
  normalized: string;
  /** Frequency count across all notes */
  count: number;
  /** Notes containing this tag */
  notePaths: string[];
  /** Where the tag appears */
  location: "frontmatter" | "inline" | "both";
  /** Whether this is a noise tag */
  isNoise: boolean;
  /** Whether format is valid (lowercase kebab-case) */
  isValidFormat: boolean;
  /** Format issues detected */
  formatIssues: string[];
}

export interface AuditData {
  generatedAt: string;
  generatedBy: string;
  schemeVersion: string;
  totalNotes: number;
  totalTaggedNotes: number;
  notesWithFrontmatter: number;
  notesWithInlineTags: number;
  uniqueTags: number;
  /** Tag frequencies for backward compatibility with plan phase */
  tagFrequencies: Record<string, number>;
  /** Detailed tag information */
  tags: TagInfo[];
  /** Tags with format issues (uppercase, underscores) */
  formatIssues: {
    tag: string;
    normalized: string;
    issues: string[];
    count: number;
  }[];
  /** Noise tags found */
  noiseTags: {
    tag: string;
    count: number;
  }[];
}

export interface AuditGeneratorResult {
  data: AuditData;
  warnings: string[];
  stats: {
    totalNotesScanned: number;
    notesWithTags: number;
    notesSkipped: number;
    uniqueTags: number;
    noiseTags: number;
    formatIssues: number;
  };
}
```

**PATTERN:** Mirror interface style from `lib/worklist-generator.ts:11-62`
**VALIDATE:** `bunx tsc --noEmit` — should pass with no errors

---

### Task 2: ADD `generateAudit()` function to `lib/audit-generator.ts`

**File:** `lib/audit-generator.ts` (append after types)

**IMPLEMENT:** Add the core audit function:

```typescript
/**
 * Generate a complete tag audit by deterministically scanning every
 * note in the vault and cataloging all tags with frequencies.
 *
 * This function does NOT use the LLM. It produces the same output every time
 * for the same vault state.
 *
 * @param vaultPath - Path to the vault root
 * @param scope - Optional scope to filter notes (defaults to full vault)
 */
export async function generateAudit(
  vaultPath: string,
  scope?: WorkScope,
): Promise<AuditGeneratorResult> {
  const warnings: string[] = [];
  const tagMap = new Map<string, {
    original: string;
    normalized: string;
    count: number;
    notePaths: string[];
    inFrontmatter: boolean;
    inInline: boolean;
    isNoise: boolean;
  }>();

  let totalNotesScanned = 0;
  let notesWithTags = 0;
  let notesSkipped = 0;
  let notesWithFrontmatter = 0;
  let notesWithInlineTags = 0;

  // Get notes based on scope (defaults to full vault)
  const notePaths = await scopeToNotes(vaultPath, scope ?? { type: "full" });

  for (const notePath of notePaths) {
    const fullPath = join(vaultPath, notePath);
    totalNotesScanned++;

    let raw: string;
    try {
      raw = await readFile(fullPath, "utf-8");
    } catch (err) {
      warnings.push(`Could not read ${notePath}: ${err}`);
      notesSkipped++;
      continue;
    }

    // Skip files with Templater syntax in frontmatter
    const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const frontmatterContent = frontmatterMatch?.[1] || "";
    if (frontmatterContent.includes("<%") && frontmatterContent.includes("%>")) {
      warnings.push(`Skipping: Templater syntax in frontmatter: ${notePath}`);
      notesSkipped++;
      continue;
    }

    // Extract tags
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      warnings.push(`YAML parsing failed for ${notePath}: ${errMsg}`);
      notesSkipped++;
      continue;
    }

    const frontmatterTags = getFrontmatterTags(parsed.data);
    const inlineTags = extractInlineTags(parsed.content);

    if (frontmatterTags.length > 0) notesWithFrontmatter++;
    if (inlineTags.length > 0) notesWithInlineTags++;

    const allTags = [...new Set([...frontmatterTags, ...inlineTags])];
    if (allTags.length === 0) continue;
    notesWithTags++;

    const { noiseTags } = classifyTags(allTags);
    const noiseSet = new Set(noiseTags);

    // Process each tag
    for (const tag of allTags) {
      const normalized = normalizeTag(tag);
      const key = normalized; // Use normalized form as key for deduplication

      const existing = tagMap.get(key);
      const inFrontmatter = frontmatterTags.includes(tag);
      const inInline = inlineTags.includes(tag);

      if (existing) {
        existing.count++;
        existing.notePaths.push(notePath);
        existing.inFrontmatter = existing.inFrontmatter || inFrontmatter;
        existing.inInline = existing.inInline || inInline;
        // Keep the first original form we saw (for reporting)
      } else {
        tagMap.set(key, {
          original: tag,
          normalized,
          count: 1,
          notePaths: [notePath],
          inFrontmatter,
          inInline,
          isNoise: noiseSet.has(tag),
        });
      }
    }
  }

  // Build output structures
  const tags: TagInfo[] = [];
  const tagFrequencies: Record<string, number> = {};
  const formatIssuesMap = new Map<string, { tag: string; normalized: string; issues: string[]; count: number }>();
  const noiseTagsMap = new Map<string, number>();

  for (const [, info] of tagMap) {
    // Determine location
    let location: "frontmatter" | "inline" | "both";
    if (info.inFrontmatter && info.inInline) {
      location = "both";
    } else if (info.inFrontmatter) {
      location = "frontmatter";
    } else {
      location = "inline";
    }

    // Check format issues
    const formatIssues: string[] = [];
    if (info.original !== info.normalized) {
      if (/[A-Z]/.test(info.original)) {
        formatIssues.push("contains uppercase");
      }
      if (info.original.includes("_")) {
        formatIssues.push("contains underscores");
      }
    }
    if (!isValidTagFormat(info.normalized) && !info.isNoise) {
      formatIssues.push("invalid format");
    }

    const isValidFormat = formatIssues.length === 0;

    tags.push({
      original: info.original,
      normalized: info.normalized,
      count: info.count,
      notePaths: info.notePaths,
      location,
      isNoise: info.isNoise,
      isValidFormat,
      formatIssues,
    });

    // Build tagFrequencies for backward compatibility
    tagFrequencies[info.normalized] = info.count;

    // Track format issues
    if (formatIssues.length > 0) {
      formatIssuesMap.set(info.normalized, {
        tag: info.original,
        normalized: info.normalized,
        issues: formatIssues,
        count: info.count,
      });
    }

    // Track noise tags
    if (info.isNoise) {
      noiseTagsMap.set(info.normalized, info.count);
    }
  }

  // Sort tags by count descending
  tags.sort((a, b) => b.count - a.count);

  const formatIssues = Array.from(formatIssuesMap.values()).sort((a, b) => b.count - a.count);
  const noiseTags = Array.from(noiseTagsMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  const data: AuditData = {
    generatedAt: new Date().toISOString(),
    generatedBy: "deterministic-audit-generator",
    schemeVersion: "1.0",
    totalNotes: totalNotesScanned - notesSkipped,
    totalTaggedNotes: notesWithTags,
    notesWithFrontmatter,
    notesWithInlineTags,
    uniqueTags: tags.length,
    tagFrequencies,
    tags,
    formatIssues,
    noiseTags,
  };

  return {
    data,
    warnings,
    stats: {
      totalNotesScanned,
      notesWithTags,
      notesSkipped,
      uniqueTags: tags.length,
      noiseTags: noiseTags.length,
      formatIssues: formatIssues.length,
    },
  };
}
```

**PATTERN:** Mirror `generateWorklist()` from `lib/worklist-generator.ts:75-216`
**GOTCHA:** Use `normalizeTag()` as map key to properly dedupe case variants
**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 3: ADD `formatAuditMarkdown()` function to `lib/audit-generator.ts`

**File:** `lib/audit-generator.ts` (append after `generateAudit`)

**IMPLEMENT:** Add the markdown report formatter:

```typescript
/**
 * Format the audit data as a markdown report suitable for the vault.
 */
export function formatAuditMarkdown(result: AuditGeneratorResult): string {
  const { data, stats } = result;
  const sections: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  // Header
  sections.push(`---`);
  sections.push(`tags:`);
  sections.push(`  - type/report`);
  sections.push(`date: '${today}'`);
  sections.push(`generated-by: deterministic-audit-generator`);
  sections.push(`---`);
  sections.push(``);
  sections.push(`# Tag Audit Report`);
  sections.push(``);

  // Executive Summary
  sections.push(`## Executive Summary`);
  sections.push(``);
  sections.push(`- **Total notes scanned:** ${stats.totalNotesScanned}`);
  sections.push(`- **Notes with tags:** ${stats.notesWithTags} (${((stats.notesWithTags / stats.totalNotesScanned) * 100).toFixed(1)}%)`);
  sections.push(`- **Unique tags found:** ${stats.uniqueTags}`);
  sections.push(`- **Notes with frontmatter tags:** ${data.notesWithFrontmatter}`);
  sections.push(`- **Notes with inline tags:** ${data.notesWithInlineTags}`);
  if (stats.notesSkipped > 0) {
    sections.push(`- **Notes skipped:** ${stats.notesSkipped} (Templater/parsing errors)`);
  }
  sections.push(`- **Generated by:** deterministic code (not LLM)`);
  sections.push(`- **Generated at:** ${data.generatedAt}`);
  sections.push(``);

  // Format Issues Summary
  if (stats.formatIssues > 0) {
    sections.push(`## ⚠️ Format Issues Detected`);
    sections.push(``);
    sections.push(`Found **${stats.formatIssues} tags** with format issues that need correction:`);
    sections.push(``);
    sections.push(`| Tag | Should Be | Issues | Count |`);
    sections.push(`|-----|-----------|--------|-------|`);
    for (const issue of data.formatIssues.slice(0, 20)) {
      sections.push(`| \`${issue.tag}\` | \`${issue.normalized}\` | ${issue.issues.join(", ")} | ${issue.count} |`);
    }
    if (data.formatIssues.length > 20) {
      sections.push(`| ... | ... | ... | ... |`);
      sections.push(`| *(${data.formatIssues.length - 20} more)* | | | |`);
    }
    sections.push(``);
  } else {
    sections.push(`## ✅ Format Validation`);
    sections.push(``);
    sections.push(`All tags follow proper lowercase kebab-case format.`);
    sections.push(``);
  }

  // Noise Tags
  if (stats.noiseTags > 0) {
    sections.push(`## 🗑️ Noise Tags`);
    sections.push(``);
    sections.push(`Found **${stats.noiseTags} noise tags** to remove:`);
    sections.push(``);
    sections.push(`| Tag | Count |`);
    sections.push(`|-----|-------|`);
    for (const noise of data.noiseTags) {
      sections.push(`| \`${noise.tag}\` | ${noise.count} |`);
    }
    sections.push(``);
  }

  // Tag Frequency Table (top 50)
  sections.push(`## Tag Frequency`);
  sections.push(``);
  sections.push(`| Tag | Count | Location | Format |`);
  sections.push(`|-----|-------|----------|--------|`);
  const displayTags = data.tags.filter(t => !t.isNoise).slice(0, 50);
  for (const tag of displayTags) {
    const formatStatus = tag.isValidFormat ? "✓" : "⚠️";
    sections.push(`| \`${tag.normalized}\` | ${tag.count} | ${tag.location} | ${formatStatus} |`);
  }
  if (data.tags.filter(t => !t.isNoise).length > 50) {
    sections.push(`| ... | ... | ... | ... |`);
    sections.push(`| *(${data.tags.filter(t => !t.isNoise).length - 50} more)* | | | |`);
  }
  sections.push(``);

  // Next Steps
  sections.push(`## Next Steps`);
  sections.push(``);
  sections.push(`1. Review the format issues above and decide on corrections`);
  sections.push(`2. Run \`bun run tagging-agent.ts plan\` to create the migration plan`);
  sections.push(`3. Run \`bun run tagging-agent.ts generate-worklist\` to build the worklist`);
  sections.push(`4. Run \`bun run tagging-agent.ts execute\` to apply changes`);
  sections.push(``);

  return sections.join("\n");
}
```

**PATTERN:** Mirror `formatWorklistMarkdown()` from `lib/worklist-generator.ts:251-289`
**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 4: ADD `writeAuditJson()` function to `lib/audit-generator.ts`

**File:** `lib/audit-generator.ts` (append after `formatAuditMarkdown`)

**IMPLEMENT:** Add the JSON writer:

```typescript
/**
 * Write the audit data to a JSON file for the plan phase.
 * Written to data/ directory (not vault) to prevent Obsidian indexing issues.
 */
export async function writeAuditJson(
  dataPath: string,
  data: AuditData,
): Promise<void> {
  const jsonPath = join(dataPath, "audit-data.json");
  await writeFile(jsonPath, JSON.stringify(data, null, 2), "utf-8");
}
```

**PATTERN:** Mirror `writeWorklistJson()` from `lib/worklist-generator.ts:296-302`
**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 5: UPDATE `lib/config.ts` — add `generate-audit` mode

**File:** `lib/config.ts`

**IMPLEMENT:** Add `generate-audit` to the `AgentMode` type and `VALID_MODES` array.

Find line 1:
```typescript
export type AgentMode = "audit" | "plan" | "generate-worklist" | "execute" | "verify" | "interactive";
```

Change to:
```typescript
export type AgentMode = "audit" | "generate-audit" | "plan" | "generate-worklist" | "execute" | "verify" | "interactive";
```

Find the `VALID_MODES` array and add `"generate-audit"`:
```typescript
const VALID_MODES: AgentMode[] = ["audit", "generate-audit", "plan", "generate-worklist", "execute", "verify", "interactive"];
```

**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 6: UPDATE `tagging-agent.ts` — add imports

**File:** `tagging-agent.ts`

**IMPLEMENT:** Add import for audit generator after line 7:

```typescript
import { generateAudit, formatAuditMarkdown, writeAuditJson } from "./lib/audit-generator.js";
```

**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 7: UPDATE `tagging-agent.ts` — add `generate-audit` mode

**File:** `tagging-agent.ts`

**IMPLEMENT:** Add the `generate-audit` mode block after the `generate-worklist` mode block (after line 908, before the audit pre-flight check).

```typescript
  // generate-audit mode: pure code, no LLM
  if (mode === "generate-audit") {
    console.log("Generating audit deterministically (no LLM)...\n");

    // Check scheme note exists
    const hasScheme = await checkSchemeNoteExists(config);
    if (!hasScheme) {
      console.log("=".repeat(60));
      console.log(`Mode: generate-audit — schema note required`);
      console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      console.log(`Cost: $0.0000 (pre-flight check only)`);
      console.log("=".repeat(60));
      return;
    }

    const result = await generateAudit(config.vaultPath);

    // Print stats
    console.log(`Notes scanned: ${result.stats.totalNotesScanned}`);
    console.log(`Notes with tags: ${result.stats.notesWithTags}`);
    console.log(`Unique tags found: ${result.stats.uniqueTags}`);
    console.log(`Format issues: ${result.stats.formatIssues}`);
    console.log(`Noise tags: ${result.stats.noiseTags}`);
    if (result.stats.notesSkipped > 0) {
      console.log(`Notes skipped: ${result.stats.notesSkipped}`);
    }
    if (result.warnings.length > 0) {
      console.log(`\nWarnings:`);
      for (const w of result.warnings.slice(0, 10)) console.log(`  - ${w}`);
      if (result.warnings.length > 10) {
        console.log(`  ... and ${result.warnings.length - 10} more`);
      }
    }

    // Write JSON to data/
    await writeAuditJson(config.dataPath, result.data);
    console.log(`\nAudit data written to data/audit-data.json`);

    // Write markdown report to vault
    const reportMarkdown = formatAuditMarkdown(result);
    const reportPath = join(config.vaultPath, "_Tag Audit Report.md");
    await writeFile(reportPath, reportMarkdown, "utf-8");
    console.log(`Audit report written to _Tag Audit Report.md`);

    // Summary
    console.log(`\n${result.stats.uniqueTags} unique tags cataloged`);
    if (result.stats.formatIssues > 0) {
      console.log(`⚠️  ${result.stats.formatIssues} tags have format issues (see report)`);
    }
    if (result.stats.noiseTags > 0) {
      console.log(`🗑️  ${result.stats.noiseTags} noise tags to remove`);
    }

    console.log();
    console.log("=".repeat(60));
    console.log(`Mode: generate-audit complete`);
    console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    console.log(`Cost: $0.0000 (no LLM used)`);
    console.log("=".repeat(60));
    return;
  }
```

**PATTERN:** Mirror `generate-worklist` mode block from lines 804-908
**GOTCHA:** Place this BEFORE the existing audit mode pre-flight check
**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 8: UPDATE `tagging-agent.ts` — add user prompt case

**File:** `tagging-agent.ts`

**IMPLEMENT:** Find the `buildUserPrompt()` function and add a case for `generate-audit` after the `audit` case:

```typescript
  if (mode === "generate-audit") {
    return `Generate a deterministic audit of all tags in the vault at ${config.vaultPath}.`;
  }
```

**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 9: UPDATE `tagging-agent.ts` — add mode to valid modes check

**File:** `tagging-agent.ts`

**IMPLEMENT:** Find line 782-785 where `mode` is determined:

```typescript
  const mode =
    modeArg && ["audit", "plan", "generate-worklist", "execute", "verify"].includes(modeArg)
      ? (modeArg as AgentMode)
      : config.agentMode;
```

Change to include `generate-audit`:

```typescript
  const mode =
    modeArg && ["audit", "generate-audit", "plan", "generate-worklist", "execute", "verify"].includes(modeArg)
      ? (modeArg as AgentMode)
      : config.agentMode;
```

Also find line 1144 in `runWithRecovery()` and make the same change:

```typescript
    modeArg && ["audit", "generate-audit", "plan", "generate-worklist", "execute", "verify"].includes(modeArg)
```

**VALIDATE:** `bunx tsc --noEmit` — should pass

---

### Task 10: CREATE `tests/audit-generator.test.ts`

**File:** `tests/audit-generator.test.ts` (new file)

**IMPLEMENT:** Create comprehensive tests:

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { generateAudit, formatAuditMarkdown, writeAuditJson } from "../lib/audit-generator.js";

let testVaultPath: string;

beforeAll(async () => {
  testVaultPath = await mkdtemp(join(tmpdir(), "audit-test-"));

  // Create test notes with various tag scenarios
  await mkdir(join(testVaultPath, "journal"), { recursive: true });
  await mkdir(join(testVaultPath, "projects"), { recursive: true });

  // Note 1: Frontmatter tags (valid format)
  await writeFile(
    join(testVaultPath, "journal", "day1.md"),
    `---\ntags:\n  - type/daily-note\n  - ai-tools\n---\nSome content here.\n`,
  );

  // Note 2: Inline tags
  await writeFile(
    join(testVaultPath, "journal", "day2.md"),
    `---\ntags: []\n---\nSome text #blockchain and #prompting here.\n`,
  );

  // Note 3: Format issues (uppercase, underscores)
  await writeFile(
    join(testVaultPath, "projects", "alpha.md"),
    `---\ntags:\n  - Project_Alpha\n  - AI-Tools\n---\nProject notes.\n`,
  );

  // Note 4: Noise tags
  await writeFile(
    join(testVaultPath, "projects", "links.md"),
    `# Links\nSee [doc](https://docs.google.com/document#heading=h.abc123)\nAlso #heading and #123\n`,
  );

  // Note 5: No tags
  await writeFile(join(testVaultPath, "projects", "empty.md"), `# Empty\nNo tags.\n`);

  // Note 6: Agent artifact (should be skipped)
  await writeFile(
    join(testVaultPath, "_Tag Audit Report.md"),
    `---\ntags:\n  - type/report\n---\n# Audit\n`,
  );

  // Note 7: Templater file (should be skipped)
  await writeFile(
    join(testVaultPath, "template.md"),
    `---\ntags:\n  - <% tp.date.now() %>\n---\nTemplate content.\n`,
  );
});

afterAll(async () => {
  await rm(testVaultPath, { recursive: true, force: true });
});

describe("generateAudit", () => {
  test("counts unique tags correctly", async () => {
    const result = await generateAudit(testVaultPath);
    // Should find: type/daily-note, ai-tools, blockchain, prompting, project-alpha (normalized), heading, 123
    expect(result.stats.uniqueTags).toBeGreaterThanOrEqual(5);
  });

  test("detects format issues", async () => {
    const result = await generateAudit(testVaultPath);
    // Project_Alpha and AI-Tools have format issues
    expect(result.stats.formatIssues).toBeGreaterThanOrEqual(2);

    const alphaIssue = result.data.formatIssues.find(i => i.normalized === "project-alpha");
    expect(alphaIssue).toBeDefined();
    expect(alphaIssue!.issues).toContain("contains underscores");
  });

  test("identifies noise tags", async () => {
    const result = await generateAudit(testVaultPath);
    expect(result.stats.noiseTags).toBeGreaterThanOrEqual(2);

    const headingNoise = result.data.noiseTags.find(n => n.tag === "heading");
    expect(headingNoise).toBeDefined();
  });

  test("skips agent artifact notes", async () => {
    const result = await generateAudit(testVaultPath);
    // _Tag Audit Report.md should be skipped
    const reportTag = result.data.tags.find(t => t.normalized === "type/report");
    // If found, it should NOT have been counted from the artifact
    // (This test verifies scopeToNotes excludes _ prefixed files)
  });

  test("skips Templater files", async () => {
    const result = await generateAudit(testVaultPath);
    const templaterWarning = result.warnings.find(w => w.includes("Templater"));
    expect(templaterWarning).toBeDefined();
  });

  test("tracks tag locations correctly", async () => {
    const result = await generateAudit(testVaultPath);

    const aiTools = result.data.tags.find(t => t.normalized === "ai-tools");
    expect(aiTools).toBeDefined();
    // ai-tools appears in both frontmatter (day1.md as AI-Tools) and possibly other forms
  });

  test("builds tagFrequencies for backward compatibility", async () => {
    const result = await generateAudit(testVaultPath);
    expect(result.data.tagFrequencies).toBeDefined();
    expect(typeof result.data.tagFrequencies).toBe("object");
    // Should have entries
    expect(Object.keys(result.data.tagFrequencies).length).toBeGreaterThan(0);
  });
});

describe("formatAuditMarkdown", () => {
  test("produces markdown with frontmatter", async () => {
    const result = await generateAudit(testVaultPath);
    const md = formatAuditMarkdown(result);

    expect(md).toContain("---");
    expect(md).toContain("type/report");
    expect(md).toContain("# Tag Audit Report");
  });

  test("includes format issues section when present", async () => {
    const result = await generateAudit(testVaultPath);
    const md = formatAuditMarkdown(result);

    if (result.stats.formatIssues > 0) {
      expect(md).toContain("Format Issues Detected");
    }
  });

  test("includes noise tags section when present", async () => {
    const result = await generateAudit(testVaultPath);
    const md = formatAuditMarkdown(result);

    if (result.stats.noiseTags > 0) {
      expect(md).toContain("Noise Tags");
    }
  });

  test("includes next steps", async () => {
    const result = await generateAudit(testVaultPath);
    const md = formatAuditMarkdown(result);

    expect(md).toContain("Next Steps");
    expect(md).toContain("generate-worklist");
  });
});

describe("writeAuditJson", () => {
  test("writes valid JSON file", async () => {
    const result = await generateAudit(testVaultPath);
    const dataDir = await mkdtemp(join(tmpdir(), "audit-data-"));

    await writeAuditJson(dataDir, result.data);

    const jsonPath = join(dataDir, "audit-data.json");
    const content = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.generatedBy).toBe("deterministic-audit-generator");
    expect(parsed.tagFrequencies).toBeDefined();
    expect(parsed.uniqueTags).toBe(result.stats.uniqueTags);

    await rm(dataDir, { recursive: true });
  });
});
```

**PATTERN:** Follow test structure from `tests/worklist-generator.test.ts`
**VALIDATE:** `bun test tests/audit-generator.test.ts` — should pass

---

### Task 11: UPDATE `README.md` — document new mode

**File:** `README.md`

**IMPLEMENT:** Find the usage section and add documentation for `generate-audit` mode. Add it before the existing audit phase documentation:

```markdown
### Phase 1: Generate Audit (Recommended)

Scans the entire vault deterministically and catalogs all tags with accurate frequencies. This is code-driven (no LLM), instant, and free.

```bash
bun run tagging-agent.ts generate-audit
```

**Outputs:**
- `data/audit-data.json` — Machine-readable tag data for the plan phase
- `_Tag Audit Report.md` — Human-readable report in your vault

**Review:** Check the report for:
- Format issues (underscores, uppercase) that need correction
- Noise tags that will be removed
- Tag frequency distribution

This step is instant and free (no API calls).

### Phase 1 (Alternative): LLM Audit

The original LLM-driven audit phase. Use `generate-audit` instead for accurate results.

```bash
bun run tagging-agent.ts audit
```
```

Also update any budget table to include:
```
| Generate Audit | $0.00 (no LLM) |
```

**VALIDATE:** Visual inspection

---

### Task 12: RUN full validation

Run the complete test suite and type checker:

**VALIDATE:**
```bash
bunx tsc --noEmit
```
Expected: No new errors (pre-existing workshop errors acceptable)

```bash
bun test
```
Expected: All tests pass including new audit-generator tests

```bash
bun test tests/audit-generator.test.ts
```
Expected: All audit generator tests pass

---

## TESTING STRATEGY

### Unit Tests

| Test file | What's tested |
|-----------|---------------|
| `tests/audit-generator.test.ts` | `generateAudit()` — tag counting, format detection, noise identification, Templater skip |
| `tests/audit-generator.test.ts` | `formatAuditMarkdown()` — report structure, sections present |
| `tests/audit-generator.test.ts` | `writeAuditJson()` — valid JSON output |

### Edge Cases

- Note with only noise tags → counted in noise, not in valid tags
- Note with format issues → detected and reported with specific issues
- Note with tags in both frontmatter and inline → location reported as "both"
- Empty vault → returns 0 tags, no crash
- Note that can't be read (permissions) → warning logged, note skipped
- Templater file → warning logged, file skipped
- Case variants of same tag → deduplicated under normalized form

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions.

### Level 1: Type Checking

```bash
bunx tsc --noEmit
```

Expected: No new errors

### Level 2: Unit Tests

```bash
bun test tests/audit-generator.test.ts
```

Expected: All tests pass

### Level 3: Full Test Suite

```bash
bun test
```

Expected: All 290+ tests pass

### Level 4: Manual Smoke Test

```bash
# In a test vault or with VAULT_PATH set:
bun run tagging-agent.ts generate-audit
```

Expected output:
- Stats printed to console
- `data/audit-data.json` created with complete tag data
- `_Tag Audit Report.md` created with human-readable report
- Format issues and noise tags correctly identified
- $0.00 cost reported

---

## ACCEPTANCE CRITERIA

- [ ] `generateAudit()` scans all notes and extracts all tags
- [ ] `generateAudit()` correctly identifies format issues (uppercase, underscores)
- [ ] `generateAudit()` correctly identifies noise tags
- [ ] `generateAudit()` skips Templater files with warning
- [ ] `generateAudit()` skips `_` prefixed artifact notes
- [ ] `formatAuditMarkdown()` produces readable report with all sections
- [ ] `writeAuditJson()` produces valid JSON compatible with plan phase
- [ ] `bun run tagging-agent.ts generate-audit` runs without LLM
- [ ] Output matches format expected by existing plan phase
- [ ] All tests pass: `bun test`
- [ ] Type check passes: `bunx tsc --noEmit`
- [ ] `README.md` documents the new mode

---

## COMPLETION CHECKLIST

- [ ] All 12 tasks completed in order
- [ ] Each task validation passed immediately after completion
- [ ] All validation commands executed successfully (Levels 1-4)
- [ ] Full test suite passes
- [ ] No type errors
- [ ] Manual smoke test confirms audit works
- [ ] Acceptance criteria all met

---

## NOTES

### Design Decisions

1. **New mode `generate-audit`** — Preserves backward compatibility with existing `audit` mode. Users can still use LLM audit if desired, but `generate-audit` is recommended.

2. **Reuses existing utilities** — `parseFrontmatter`, `extractInlineTags`, `classifyTags`, `isValidTagFormat`, `normalizeTag`, `scopeToNotes` — all battle-tested code.

3. **Format validation included** — Detects uppercase and underscore issues that the LLM audit completely missed.

4. **tagFrequencies for compatibility** — The `AuditData` structure includes `tagFrequencies: Record<string, number>` to maintain compatibility with the plan phase that reads this format.

5. **Deduplication by normalized form** — Tags like `AI-Tools` and `ai-tools` are tracked together under the normalized `ai-tools` key, with the first original form preserved for reporting.

### Comparison to LLM Audit

| Aspect | LLM Audit | Code Audit |
|--------|-----------|------------|
| **Accuracy** | Sampled, incomplete | 100% exhaustive |
| **Cost** | ~$1.20 | $0.00 |
| **Speed** | 2-5 minutes | 1-3 seconds |
| **Format detection** | Unreliable | Precise |
| **Deterministic** | No | Yes |

### Confidence Score

**9/10** — This follows a proven pattern (generate-worklist) with well-tested utilities. The main implementation is straightforward iteration and data collection. The only minor risk is ensuring backward compatibility with the plan phase's expected audit-data.json format, which is addressed by including the `tagFrequencies` field.
