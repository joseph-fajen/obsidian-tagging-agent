---
status: PENDING
created: 2026-02-05
estimated_complexity: high
confidence_score: 8/10
---

# Feature: Supervisor/Worker Architecture (Path C)

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Transform the tagging agent from a rigid phase-based CLI into a **collaborative automation assistant** using a Supervisor/Worker architecture. The LLM (Supervisor) handles conversation, intent parsing, and exception handling. Code (Worker) handles deterministic execution.

This plan implements all 4 stages:
- **Stage 1:** Scope Selection — User can specify folder, file list, or recent changes
- **Stage 2:** Preview Mode — Show changes before applying
- **Stage 3:** Code-Driven Execution — `execute_batch` tool runs deterministic code
- **Stage 4:** Model Optimization — Phase-specific model selection

## User Story

```
As a vault owner using the tagging agent
I want to specify what notes to process, preview changes, and have reliable execution
So that I can migrate tags confidently with predictable costs and results
```

## Problem Statement

The current execute phase is LLM-driven per-note, causing:
1. **High cost:** $1.50+ per batch vs designed $0.15 (10x overrun)
2. **Unpredictable behavior:** Agent ignores batch file, does autonomous discovery
3. **Broken progress tracking:** Counter stuck at "615 remaining"
4. **No scope control:** User must process entire vault or nothing
5. **No preview:** User can't see changes before they're applied

## Solution Statement

Implement a Supervisor/Worker architecture where:
1. **Supervisor (LLM):** Handles conversation, scope selection, preview display, exception handling
2. **Worker (Code):** Executes batches deterministically via `execute_batch` MCP tool
3. **Scope Selection:** User can target folder, file list, or recent changes
4. **Preview Mode:** New `preview_changes` tool shows what will happen before doing it
5. **Model Optimization:** Use cheaper models for simpler tasks

## Feature Metadata

**Feature Type**: Refactor + Enhancement
**Estimated Complexity**: High
**Primary Systems Affected**: `lib/interactive-agent.ts`, `lib/worklist-generator.ts`, `tools/tag-tools.ts`, `lib/session-state.ts`, `lib/config.ts`, `lib/agent-personality.ts`
**Dependencies**: Existing MCP tools, worklist generator, session state, tag scheme

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING!

| File | Lines | Why |
|------|-------|-----|
| `lib/worklist-generator.ts` | 69-210 | **Pattern:** Deterministic file processing, tag change computation |
| `lib/worklist-generator.ts` | 84-98 | **Modify:** Note discovery loop — add scope filtering here |
| `lib/worklist-generator.ts` | 7-60 | **Extend:** Types (`NoteChanges`, `TagChange`, `MigrationWorklist`) |
| `tools/tag-tools.ts` | 21-131 | **Pattern:** MCP tool with Zod schema, `apply_tag_changes` implementation |
| `tools/vault-tools.ts` | 8-18 | **Reuse:** `safePath()` and `errorResult()` helpers |
| `lib/session-state.ts` | 35-54 | **Extend:** `SessionState` interface — add `selectedScope` |
| `lib/session-state.ts` | 69-84 | **Update:** `createInitialState()` — initialize scope |
| `lib/config.ts` | 5-14 | **Extend:** `Config` interface — add `modelsByPhase` |
| `lib/config.ts` | 18-55 | **Update:** `loadConfig()` — load phase-specific models |
| `lib/interactive-agent.ts` | 426-471 | **Pattern:** State transition logic |
| `lib/interactive-agent.ts` | 547-597 | **Modify:** Phase execution — add scope/preview flows |
| `lib/agent-personality.ts` | 111-134 | **Simplify:** Execute instructions — just call `execute_batch` |
| `lib/agent-personality.ts` | 175-206 | **Pattern:** `buildInteractiveSystemPrompt()` combining personality + phase |
| `tagging-agent.ts` | 487-575 | **Reference:** Current pre-flight batch computation |
| `tests/worklist-generator.test.ts` | 1-100 | **Pattern:** Test fixtures with temp directories |

### New Files to Create

| File | Purpose |
|------|---------|
| `lib/types.ts` | Shared types: `WorkScope`, `PreviewResult`, `BatchResult` |
| `lib/scope-filter.ts` | `scopeToNotes()` function for filtering by scope |
| `lib/batch-executor.ts` | `executeBatch()` function for code-driven execution |
| `tests/scope-filter.test.ts` | Unit tests for scope filtering |
| `tests/batch-executor.test.ts` | Unit tests for batch execution |

### Relevant Documentation — READ BEFORE IMPLEMENTING!

- [Claude Agent SDK Tool Pattern](https://platform.claude.com/docs/en/agent-sdk/custom-tools)
  - How to define MCP tools with `tool()` function
  - Zod schema validation for inputs
- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
  - Haiku 4.5: $1/$5 per MTok (input/output)
  - Sonnet 4.5: $3/$15 per MTok
  - Use for cost projections in tests

### Patterns to Follow

**MCP Tool Definition Pattern** (from `tools/tag-tools.ts`):
```typescript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export function createMyTools(basePath: string) {
  const myTool = tool(
    "tool_name",
    `One-line summary.

Use this when:
- Condition 1
- Condition 2

Do NOT use this for:
- Anti-pattern 1

Performance notes:
- Timing/cost info

Examples:
- tool_name({ param: "value" }) — description`,
    {
      param: z.string().describe("What this param is for"),
    },
    async ({ param }) => {
      try {
        // Implementation
        const result = { success: true, data: "..." };
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err}` }], isError: true };
      }
    }
  );

  return [myTool];
}
```

**File Modification Time Check** (for "recent" scope):
```typescript
import { stat } from "fs/promises";

const stats = await stat(filePath);
const cutoffMs = Date.now() - (days * 24 * 60 * 60 * 1000);
const isRecent = stats.mtime.getTime() > cutoffMs;
```

**State Persistence Pattern** (from `lib/session-state.ts`):
```typescript
export interface SessionState {
  // ... existing fields
  selectedScope?: WorkScope;  // Add new optional field
}

export function createInitialState(vaultPath: string): SessionState {
  return {
    // ... existing fields
    selectedScope: undefined,  // Initialize as undefined
  };
}
```

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — Types and Scope Filtering

Create shared types and implement scope filtering logic.

**Tasks:**
- Create `lib/types.ts` with `WorkScope`, `PreviewResult`, `BatchResult`
- Create `lib/scope-filter.ts` with `scopeToNotes()` function
- Update `lib/worklist-generator.ts` to accept optional scope
- Add tests for scope filtering

### Phase 2: Preview Mode

Implement preview functionality that shows changes without applying.

**Tasks:**
- Add `preview_changes` MCP tool to `tools/tag-tools.ts`
- Update `lib/interactive-agent.ts` with preview conversation flow
- Update `lib/agent-personality.ts` with preview instructions
- Add tests for preview tool

### Phase 3: Code-Driven Execution

Replace LLM-driven per-note execution with code-driven batch execution.

**Tasks:**
- Create `lib/batch-executor.ts` with `executeBatch()` function
- Add `execute_batch` MCP tool to `tools/tag-tools.ts`
- Simplify execute phase in `lib/agent-personality.ts`
- Update `lib/interactive-agent.ts` to use new flow
- Add tests for batch executor

### Phase 4: Model Optimization and Polish

Add phase-specific model selection and polish the conversation flow.

**Tasks:**
- Update `lib/config.ts` with `modelsByPhase`
- Update `lib/interactive-agent.ts` to use phase-specific models
- Add scope selection conversation flow
- Update session state with scope persistence
- Polish conversation transitions

---

## STEP-BY-STEP TASKS

Execute every task in order, top to bottom. Each task is atomic and independently testable.

---

### STAGE 1: FOUNDATION — TYPES AND SCOPE FILTERING

---

#### Task 1.1: CREATE `lib/types.ts`

Create shared type definitions used across the supervisor/worker architecture.

**IMPLEMENT:** New file with exported types

```typescript
/**
 * Shared types for Supervisor/Worker architecture.
 * These types are used by scope filtering, preview, and batch execution.
 */

/**
 * Scope selection — what the user wants to process.
 * Used by the supervisor to communicate intent to worker functions.
 */
export type WorkScope =
  | { type: "full" }
  | { type: "folder"; path: string }
  | { type: "files"; paths: string[] }
  | { type: "recent"; days: number }
  | { type: "tag"; tagName: string };

/**
 * Preview of changes for a single note.
 * Returned by preview_changes tool for supervisor to display.
 */
export interface NotePreview {
  path: string;
  removals: string[];      // Tags that will be removed
  additions: string[];     // Tags that will be added
  keeps: string[];         // Tags that will stay unchanged
  inlineMigrations: number; // Count of inline tags moving to frontmatter
}

/**
 * Aggregate preview result for a scope.
 */
export interface PreviewResult {
  scope: WorkScope;
  previews: NotePreview[];
  totalNotes: number;
  totalChanges: number;
  limitApplied: boolean;   // True if results were truncated
}

/**
 * Result of executing a batch of changes.
 * Returned by execute_batch tool.
 */
export interface BatchResult {
  batchNumber: number;
  processed: number;
  succeeded: number;
  failed: number;
  warnings: Array<{ path: string; message: string }>;
  errors: Array<{ path: string; error: string }>;
  commitHash: string | null;
  durationMs: number;
}

/**
 * Progress state for migration.
 * Stored in data/migration-progress.json.
 */
export interface MigrationProgress {
  migrationId: string;
  scope: WorkScope;
  startedAt: string;
  lastUpdatedAt: string;
  totalInScope: number;
  processedCount: number;
  processedPaths: string[];
  batchHistory: Array<{
    batchNumber: number;
    completedAt: string;
    notesProcessed: number;
    commitHash: string | null;
  }>;
}
```

**VALIDATE:** `bunx tsc --noEmit` — no type errors

---

#### Task 1.2: CREATE `lib/scope-filter.ts`

Implement scope filtering logic to determine which notes to process.

**IMPLEMENT:** New file with `scopeToNotes()` function

```typescript
/**
 * Scope filtering for Supervisor/Worker architecture.
 * Determines which notes to process based on user-specified scope.
 */

import { readdir, stat } from "fs/promises";
import { join, relative } from "path";
import type { WorkScope } from "./types.js";
import { extractInlineTags } from "./tag-parser.js";
import { parseFrontmatter, getFrontmatterTags } from "./frontmatter.js";

/**
 * Filter vault notes based on the specified scope.
 * Returns relative paths from vault root.
 *
 * @param vaultPath - Absolute path to the vault
 * @param scope - What to process (full, folder, files, recent, tag)
 * @returns Array of relative note paths matching the scope
 */
export async function scopeToNotes(
  vaultPath: string,
  scope: WorkScope
): Promise<string[]> {
  switch (scope.type) {
    case "full":
      return getAllNotes(vaultPath);

    case "folder":
      return getNotesInFolder(vaultPath, scope.path);

    case "files":
      return validateFilePaths(vaultPath, scope.paths);

    case "recent":
      return getRecentNotes(vaultPath, scope.days);

    case "tag":
      return getNotesByTag(vaultPath, scope.tagName);

    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = scope;
      throw new Error(`Unknown scope type: ${JSON.stringify(_exhaustive)}`);
  }
}

/**
 * Get all markdown notes in the vault (excluding agent artifacts).
 */
async function getAllNotes(vaultPath: string): Promise<string[]> {
  const entries = await readdir(vaultPath, { recursive: true, withFileTypes: true });
  const notes: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (entry.name.startsWith("_")) continue; // Skip agent artifacts

    const parentPath = "parentPath" in entry
      ? (entry as unknown as { parentPath: string }).parentPath
      : vaultPath;
    const fullPath = join(parentPath, entry.name);
    const notePath = relative(vaultPath, fullPath);
    notes.push(notePath);
  }

  return notes.sort();
}

/**
 * Get notes in a specific folder (recursive).
 */
async function getNotesInFolder(vaultPath: string, folderPath: string): Promise<string[]> {
  const allNotes = await getAllNotes(vaultPath);
  const normalizedFolder = folderPath.replace(/\/$/, ""); // Remove trailing slash

  return allNotes.filter(notePath =>
    notePath.startsWith(normalizedFolder + "/") ||
    notePath.startsWith(normalizedFolder + "\\")
  );
}

/**
 * Validate and return only existing file paths.
 */
async function validateFilePaths(vaultPath: string, paths: string[]): Promise<string[]> {
  const validPaths: string[] = [];

  for (const notePath of paths) {
    const fullPath = join(vaultPath, notePath);
    try {
      const stats = await stat(fullPath);
      if (stats.isFile() && notePath.endsWith(".md")) {
        validPaths.push(notePath);
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  return validPaths;
}

/**
 * Get notes modified within the last N days.
 */
async function getRecentNotes(vaultPath: string, days: number): Promise<string[]> {
  const allNotes = await getAllNotes(vaultPath);
  const cutoffMs = Date.now() - (days * 24 * 60 * 60 * 1000);
  const recentNotes: string[] = [];

  for (const notePath of allNotes) {
    const fullPath = join(vaultPath, notePath);
    try {
      const stats = await stat(fullPath);
      if (stats.mtime.getTime() > cutoffMs) {
        recentNotes.push(notePath);
      }
    } catch {
      // Skip files that can't be stat'd
    }
  }

  return recentNotes;
}

/**
 * Get notes containing a specific tag.
 */
async function getNotesByTag(vaultPath: string, tagName: string): Promise<string[]> {
  const allNotes = await getAllNotes(vaultPath);
  const normalizedTag = tagName.toLowerCase().replace(/^#/, "");
  const matchingNotes: string[] = [];

  for (const notePath of allNotes) {
    const fullPath = join(vaultPath, notePath);
    try {
      const raw = await Bun.file(fullPath).text();
      const parsed = parseFrontmatter(raw);
      const frontmatterTags = getFrontmatterTags(parsed.data).map(t => t.toLowerCase());
      const inlineTags = extractInlineTags(parsed.content).map(t => t.toLowerCase());
      const allTags = [...new Set([...frontmatterTags, ...inlineTags])];

      if (allTags.includes(normalizedTag)) {
        matchingNotes.push(notePath);
      }
    } catch {
      // Skip files that can't be read/parsed
    }
  }

  return matchingNotes;
}

/**
 * Format a scope for display in conversation.
 */
export function formatScope(scope: WorkScope): string {
  switch (scope.type) {
    case "full":
      return "the entire vault";
    case "folder":
      return `the "${scope.path}" folder`;
    case "files":
      return `${scope.paths.length} specific file${scope.paths.length === 1 ? "" : "s"}`;
    case "recent":
      return `notes modified in the last ${scope.days} day${scope.days === 1 ? "" : "s"}`;
    case "tag":
      return `notes with the #${scope.tagName} tag`;
  }
}
```

**PATTERN:** `lib/worklist-generator.ts:84-98` — file discovery loop
**IMPORTS:** `lib/tag-parser.ts`, `lib/frontmatter.ts`
**VALIDATE:** `bunx tsc --noEmit` — no type errors

---

#### Task 1.3: CREATE `tests/scope-filter.test.ts`

Add comprehensive tests for scope filtering.

**IMPLEMENT:** New test file following existing pattern

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { scopeToNotes, formatScope } from "../lib/scope-filter.js";
import type { WorkScope } from "../lib/types.js";

let testVaultPath: string;

beforeAll(async () => {
  testVaultPath = await mkdtemp(join(tmpdir(), "scope-filter-test-"));

  // Create folder structure
  await mkdir(join(testVaultPath, "journal"), { recursive: true });
  await mkdir(join(testVaultPath, "projects"), { recursive: true });
  await mkdir(join(testVaultPath, "archive", "old"), { recursive: true });

  // Create test notes
  await writeFile(join(testVaultPath, "journal", "day1.md"), "---\ntags: [daily]\n---\nContent");
  await writeFile(join(testVaultPath, "journal", "day2.md"), "---\ntags: [daily, work]\n---\nContent");
  await writeFile(join(testVaultPath, "projects", "proj1.md"), "---\ntags: [project]\n---\nContent #inline-tag");
  await writeFile(join(testVaultPath, "projects", "proj2.md"), "No frontmatter #project");
  await writeFile(join(testVaultPath, "archive", "old", "ancient.md"), "---\ntags: [archived]\n---\nOld");
  await writeFile(join(testVaultPath, "_Agent Report.md"), "---\ntags: [report]\n---\nAgent artifact");

  // Set modification times for "recent" tests
  const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  await utimes(join(testVaultPath, "archive", "old", "ancient.md"), oldDate, oldDate);
});

afterAll(async () => {
  await rm(testVaultPath, { recursive: true, force: true });
});

describe("scopeToNotes", () => {
  describe("full scope", () => {
    test("returns all notes except agent artifacts", async () => {
      const scope: WorkScope = { type: "full" };
      const notes = await scopeToNotes(testVaultPath, scope);

      expect(notes).toContain("journal/day1.md");
      expect(notes).toContain("journal/day2.md");
      expect(notes).toContain("projects/proj1.md");
      expect(notes).toContain("projects/proj2.md");
      expect(notes).toContain("archive/old/ancient.md");
      expect(notes).not.toContain("_Agent Report.md");
      expect(notes.length).toBe(5);
    });

    test("returns sorted paths", async () => {
      const scope: WorkScope = { type: "full" };
      const notes = await scopeToNotes(testVaultPath, scope);

      const sorted = [...notes].sort();
      expect(notes).toEqual(sorted);
    });
  });

  describe("folder scope", () => {
    test("returns only notes in specified folder", async () => {
      const scope: WorkScope = { type: "folder", path: "journal" };
      const notes = await scopeToNotes(testVaultPath, scope);

      expect(notes).toContain("journal/day1.md");
      expect(notes).toContain("journal/day2.md");
      expect(notes).not.toContain("projects/proj1.md");
      expect(notes.length).toBe(2);
    });

    test("handles nested folders", async () => {
      const scope: WorkScope = { type: "folder", path: "archive" };
      const notes = await scopeToNotes(testVaultPath, scope);

      expect(notes).toContain("archive/old/ancient.md");
      expect(notes.length).toBe(1);
    });

    test("handles trailing slash", async () => {
      const scope: WorkScope = { type: "folder", path: "journal/" };
      const notes = await scopeToNotes(testVaultPath, scope);

      expect(notes.length).toBe(2);
    });

    test("returns empty for non-existent folder", async () => {
      const scope: WorkScope = { type: "folder", path: "nonexistent" };
      const notes = await scopeToNotes(testVaultPath, scope);

      expect(notes.length).toBe(0);
    });
  });

  describe("files scope", () => {
    test("returns only specified existing files", async () => {
      const scope: WorkScope = {
        type: "files",
        paths: ["journal/day1.md", "projects/proj1.md", "nonexistent.md"],
      };
      const notes = await scopeToNotes(testVaultPath, scope);

      expect(notes).toContain("journal/day1.md");
      expect(notes).toContain("projects/proj1.md");
      expect(notes).not.toContain("nonexistent.md");
      expect(notes.length).toBe(2);
    });

    test("returns empty for all non-existent files", async () => {
      const scope: WorkScope = { type: "files", paths: ["a.md", "b.md"] };
      const notes = await scopeToNotes(testVaultPath, scope);

      expect(notes.length).toBe(0);
    });
  });

  describe("recent scope", () => {
    test("returns only recently modified notes", async () => {
      const scope: WorkScope = { type: "recent", days: 7 };
      const notes = await scopeToNotes(testVaultPath, scope);

      // All notes except ancient.md should be recent (created in beforeAll)
      expect(notes).toContain("journal/day1.md");
      expect(notes).not.toContain("archive/old/ancient.md");
      expect(notes.length).toBe(4);
    });

    test("returns all notes for large day range", async () => {
      const scope: WorkScope = { type: "recent", days: 365 };
      const notes = await scopeToNotes(testVaultPath, scope);

      expect(notes.length).toBe(5);
    });
  });

  describe("tag scope", () => {
    test("finds notes with frontmatter tag", async () => {
      const scope: WorkScope = { type: "tag", tagName: "daily" };
      const notes = await scopeToNotes(testVaultPath, scope);

      expect(notes).toContain("journal/day1.md");
      expect(notes).toContain("journal/day2.md");
      expect(notes.length).toBe(2);
    });

    test("finds notes with inline tag", async () => {
      const scope: WorkScope = { type: "tag", tagName: "inline-tag" };
      const notes = await scopeToNotes(testVaultPath, scope);

      expect(notes).toContain("projects/proj1.md");
      expect(notes.length).toBe(1);
    });

    test("handles hash prefix in tag name", async () => {
      const scope: WorkScope = { type: "tag", tagName: "#daily" };
      const notes = await scopeToNotes(testVaultPath, scope);

      expect(notes.length).toBe(2);
    });

    test("is case-insensitive", async () => {
      const scope: WorkScope = { type: "tag", tagName: "DAILY" };
      const notes = await scopeToNotes(testVaultPath, scope);

      expect(notes.length).toBe(2);
    });
  });
});

describe("formatScope", () => {
  test("formats full scope", () => {
    expect(formatScope({ type: "full" })).toBe("the entire vault");
  });

  test("formats folder scope", () => {
    expect(formatScope({ type: "folder", path: "journal" })).toBe('the "journal" folder');
  });

  test("formats files scope singular", () => {
    expect(formatScope({ type: "files", paths: ["a.md"] })).toBe("1 specific file");
  });

  test("formats files scope plural", () => {
    expect(formatScope({ type: "files", paths: ["a.md", "b.md"] })).toBe("2 specific files");
  });

  test("formats recent scope singular", () => {
    expect(formatScope({ type: "recent", days: 1 })).toBe("notes modified in the last 1 day");
  });

  test("formats recent scope plural", () => {
    expect(formatScope({ type: "recent", days: 7 })).toBe("notes modified in the last 7 days");
  });

  test("formats tag scope", () => {
    expect(formatScope({ type: "tag", tagName: "daily" })).toBe("notes with the #daily tag");
  });
});
```

**PATTERN:** `tests/worklist-generator.test.ts:1-100`
**VALIDATE:** `bun test tests/scope-filter.test.ts`

---

#### Task 1.4: UPDATE `lib/worklist-generator.ts` — Add Scope Support

Modify the worklist generator to accept an optional scope parameter.

**MODIFY:** `lib/worklist-generator.ts`

**IMPORTS:** Add at top of file
```typescript
import type { WorkScope } from "./types.js";
import { scopeToNotes } from "./scope-filter.js";
```

**UPDATE:** Function signature (around line 69)
```typescript
// Change from:
export async function generateWorklist(
  vaultPath: string,
  auditMappings?: AuditMappings
): Promise<WorklistGeneratorResult>

// Change to:
export async function generateWorklist(
  vaultPath: string,
  auditMappings?: AuditMappings,
  scope?: WorkScope
): Promise<WorklistGeneratorResult>
```

**UPDATE:** Note discovery section (around lines 84-98)
```typescript
// Replace the readdir loop with:
const notePaths = scope
  ? await scopeToNotes(vaultPath, scope)
  : await scopeToNotes(vaultPath, { type: "full" });

for (const notePath of notePaths) {
  const fullPath = join(vaultPath, notePath);
  // ... rest of processing loop unchanged
```

**GOTCHA:** The existing loop uses `entry.name` to check for agent artifacts (`_` prefix). Since `scopeToNotes()` already filters these, this check can be removed from the loop.

**VALIDATE:** `bun test tests/worklist-generator.test.ts` — all existing tests still pass

---

### STAGE 2: PREVIEW MODE

---

#### Task 2.1: CREATE `lib/preview-generator.ts`

Create a function to generate preview of changes without applying them.

**IMPLEMENT:** New file

```typescript
/**
 * Preview generator for Supervisor/Worker architecture.
 * Computes what changes would be made without applying them.
 */

import { join } from "path";
import type { WorkScope, NotePreview, PreviewResult } from "./types.js";
import type { NoteChanges } from "./worklist-generator.js";
import { scopeToNotes } from "./scope-filter.js";
import { parseFrontmatter, getFrontmatterTags } from "./frontmatter.js";
import { extractInlineTags, classifyTags } from "./tag-parser.js";
import { lookupTagMapping } from "../tag-scheme.js";
import type { AuditMappings } from "./worklist-generator.js";

/**
 * Generate a preview of tag changes for the given scope.
 *
 * @param vaultPath - Absolute path to the vault
 * @param scope - What to preview (full, folder, files, recent, tag)
 * @param auditMappings - Optional audit-discovered mappings
 * @param limit - Maximum number of notes to preview (default 10)
 * @returns Preview result with changes for each note
 */
export async function generatePreview(
  vaultPath: string,
  scope: WorkScope,
  auditMappings?: AuditMappings,
  limit: number = 10
): Promise<PreviewResult> {
  const notePaths = await scopeToNotes(vaultPath, scope);
  const previews: NotePreview[] = [];
  let totalChanges = 0;

  for (const notePath of notePaths) {
    if (previews.length >= limit) break;

    const fullPath = join(vaultPath, notePath);
    try {
      const raw = await Bun.file(fullPath).text();

      // Skip Templater files
      const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const frontmatterContent = frontmatterMatch?.[1] || "";
      if (frontmatterContent.includes("<%") && frontmatterContent.includes("%>")) {
        continue;
      }

      const parsed = parseFrontmatter(raw);
      const frontmatterTags = getFrontmatterTags(parsed.data);
      const inlineTags = extractInlineTags(parsed.content);
      const allTags = [...new Set([...frontmatterTags, ...inlineTags])];
      const { noiseTags } = classifyTags(allTags);
      const tagsToProcess = [...new Set([...allTags, ...noiseTags])];

      if (tagsToProcess.length === 0) continue;

      const removals: string[] = [];
      const additions: string[] = [];
      const keeps: string[] = [];
      let inlineMigrations = 0;

      for (const tag of tagsToProcess) {
        const lookup = lookupTagMapping(tag, auditMappings);
        const isInline = inlineTags.map(t => t.toLowerCase()).includes(tag.toLowerCase());

        switch (lookup.action) {
          case "map":
            removals.push(tag);
            if (lookup.newTag && !additions.includes(lookup.newTag)) {
              additions.push(lookup.newTag);
            }
            break;
          case "remove":
            removals.push(tag);
            break;
          case "keep":
            if (isInline) {
              inlineMigrations++;
              // Tag stays but moves from inline to frontmatter
            } else {
              keeps.push(tag);
            }
            break;
          case "unmapped":
            keeps.push(tag);
            break;
        }
      }

      // Only include notes with actual changes
      if (removals.length > 0 || additions.length > 0 || inlineMigrations > 0) {
        previews.push({
          path: notePath,
          removals,
          additions,
          keeps,
          inlineMigrations,
        });
        totalChanges += removals.length + additions.length + inlineMigrations;
      }
    } catch {
      // Skip files that can't be read/parsed
    }
  }

  return {
    scope,
    previews,
    totalNotes: previews.length,
    totalChanges,
    limitApplied: notePaths.length > limit && previews.length === limit,
  };
}

/**
 * Format a preview for conversational display.
 */
export function formatPreviewForDisplay(preview: PreviewResult): string {
  if (preview.previews.length === 0) {
    return "No changes needed for the selected scope.";
  }

  const lines: string[] = [];
  lines.push(`Preview of changes for ${preview.totalNotes} note${preview.totalNotes === 1 ? "" : "s"}:\n`);

  for (const note of preview.previews) {
    lines.push(`**${note.path}**`);
    if (note.removals.length > 0) {
      lines.push(`  - Remove: ${note.removals.map(t => `#${t}`).join(", ")}`);
    }
    if (note.additions.length > 0) {
      lines.push(`  - Add: ${note.additions.map(t => `#${t}`).join(", ")}`);
    }
    if (note.inlineMigrations > 0) {
      lines.push(`  - Migrate ${note.inlineMigrations} inline tag${note.inlineMigrations === 1 ? "" : "s"} to frontmatter`);
    }
    if (note.keeps.length > 0) {
      lines.push(`  - Keep: ${note.keeps.map(t => `#${t}`).join(", ")}`);
    }
    lines.push("");
  }

  if (preview.limitApplied) {
    lines.push(`(Showing first ${preview.totalNotes} notes. More notes may be affected.)`);
  }

  lines.push(`Total: ${preview.totalChanges} changes across ${preview.totalNotes} notes.`);

  return lines.join("\n");
}
```

**PATTERN:** `lib/worklist-generator.ts:119-180` — tag processing logic
**VALIDATE:** `bunx tsc --noEmit`

---

#### Task 2.2: ADD `preview_changes` MCP Tool

Add the preview tool to `tools/tag-tools.ts`.

**MODIFY:** `tools/tag-tools.ts`

**IMPORTS:** Add at top
```typescript
import type { WorkScope } from "../lib/types.js";
import { generatePreview, formatPreviewForDisplay } from "../lib/preview-generator.js";
import { loadAuditMappings } from "../lib/worklist-generator.js";
```

**ADD:** New tool definition after `apply_tag_changes` (around line 131)

```typescript
  const previewChanges = tool(
    "preview_changes",
    `Preview tag changes for a scope without applying them.

Use this when:
- User wants to see what changes will be made before executing
- Validating that the scope selection is correct
- Explaining the migration plan to the user

Do NOT use this for:
- Actually applying changes (use execute_batch instead)
- Getting a count of notes (use list_notes with scope filtering)

Performance notes:
- Fast: only reads files, no writes
- Default limit of 10 notes; increase for more comprehensive preview
- Cost: ~$0.01 for supervisor to process results

Examples:
- preview_changes({ scope: { type: "full" }, limit: 5 }) — sample 5 notes from full vault
- preview_changes({ scope: { type: "folder", path: "journal" } }) — preview journal folder
- preview_changes({ scope: { type: "recent", days: 7 }, limit: 20 }) — preview recent notes`,
    {
      scope: z.object({
        type: z.enum(["full", "folder", "files", "recent", "tag"]),
        path: z.string().optional(),
        paths: z.array(z.string()).optional(),
        days: z.number().optional(),
        tagName: z.string().optional(),
      }).describe("Scope to preview: { type: 'full' } | { type: 'folder', path: '...' } | { type: 'files', paths: [...] } | { type: 'recent', days: N } | { type: 'tag', tagName: '...' }"),
      limit: z.number().optional().describe("Max notes to preview (default 10)"),
    },
    async ({ scope, limit }) => {
      try {
        // Validate scope structure
        const validatedScope = validateScope(scope as Record<string, unknown>);

        // Load audit mappings if available
        const dataPath = join(vaultPath, "..", "data");
        const auditMappings = await loadAuditMappings(dataPath, vaultPath);

        // Generate preview
        const preview = await generatePreview(vaultPath, validatedScope, auditMappings, limit || 10);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              preview,
              displayText: formatPreviewForDisplay(preview),
            }),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );
```

**ADD:** Helper function for scope validation (before tool definitions)

```typescript
/**
 * Validate and convert a scope object from tool input.
 */
function validateScope(scope: Record<string, unknown>): WorkScope {
  const type = scope.type as string;

  switch (type) {
    case "full":
      return { type: "full" };
    case "folder":
      if (typeof scope.path !== "string") throw new Error("folder scope requires 'path' string");
      return { type: "folder", path: scope.path };
    case "files":
      if (!Array.isArray(scope.paths)) throw new Error("files scope requires 'paths' array");
      return { type: "files", paths: scope.paths as string[] };
    case "recent":
      if (typeof scope.days !== "number") throw new Error("recent scope requires 'days' number");
      return { type: "recent", days: scope.days };
    case "tag":
      if (typeof scope.tagName !== "string") throw new Error("tag scope requires 'tagName' string");
      return { type: "tag", tagName: scope.tagName };
    default:
      throw new Error(`Unknown scope type: ${type}`);
  }
}
```

**UPDATE:** Return array at end of `createTagTools()`
```typescript
  return [applyTagChanges, previewChanges];
```

**VALIDATE:** `bunx tsc --noEmit`

---

#### Task 2.3: UPDATE MCP Tool Registration

Update tool registration to include the new preview tool.

**MODIFY:** `tagging-agent.ts`

**UPDATE:** `getAllowedTools()` function (around line 391)
```typescript
function getAllowedTools(): string[] {
  return [
    "mcp__vault__list_notes",
    "mcp__vault__read_note",
    "mcp__vault__search_notes",
    "mcp__vault__write_note",
    "mcp__vault__apply_tag_changes",
    "mcp__vault__preview_changes",     // ADD THIS
    "mcp__vault__git_commit",
    "mcp__vault__read_data_file",
    "mcp__vault__write_data_file",
  ];
}
```

**VALIDATE:** `bunx tsc --noEmit`

---

### STAGE 3: CODE-DRIVEN EXECUTION

---

#### Task 3.1: CREATE `lib/batch-executor.ts`

Implement the code-driven batch execution function.

**IMPLEMENT:** New file

```typescript
/**
 * Batch executor for Supervisor/Worker architecture.
 * Executes tag changes deterministically without LLM involvement.
 */

import { join } from "path";
import { readFile, writeFile } from "fs/promises";
import type { BatchResult, MigrationProgress, WorkScope } from "./types.js";
import type { NoteChanges, TagChange } from "./worklist-generator.js";
import { parseFrontmatter, serializeFrontmatter, getFrontmatterTags } from "./frontmatter.js";
import { extractInlineTags, removeInlineTag } from "./tag-parser.js";
import { isValidTagFormat } from "../tag-scheme.js";

/**
 * Execute a batch of tag changes deterministically.
 *
 * @param vaultPath - Absolute path to the vault
 * @param dataPath - Path to data directory for progress tracking
 * @param entries - Array of notes with their changes to apply
 * @param batchNumber - Current batch number for progress tracking
 * @returns BatchResult with success/failure counts and commit hash
 */
export async function executeBatch(
  vaultPath: string,
  dataPath: string,
  entries: NoteChanges[],
  batchNumber: number
): Promise<BatchResult> {
  const startTime = Date.now();
  const warnings: Array<{ path: string; message: string }> = [];
  const errors: Array<{ path: string; error: string }> = [];
  let succeeded = 0;
  let failed = 0;

  // Process each entry
  for (const entry of entries) {
    try {
      const result = await applyChangesToNote(vaultPath, entry.path, entry.changes);
      if (result.success) {
        succeeded++;
        if (result.warnings.length > 0) {
          warnings.push(...result.warnings.map(w => ({ path: entry.path, message: w })));
        }
      } else {
        failed++;
        errors.push({ path: entry.path, error: result.error || "Unknown error" });
      }
    } catch (err) {
      failed++;
      errors.push({ path: entry.path, error: String(err) });
    }
  }

  // Create git commit
  let commitHash: string | null = null;
  try {
    commitHash = await createGitCommit(vaultPath, batchNumber, succeeded);
  } catch (err) {
    warnings.push({ path: "(git)", message: `Failed to commit: ${err}` });
  }

  // Update progress file
  await updateProgress(dataPath, entries, batchNumber, commitHash);

  return {
    batchNumber,
    processed: entries.length,
    succeeded,
    failed,
    warnings,
    errors,
    commitHash,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Apply tag changes to a single note.
 */
async function applyChangesToNote(
  vaultPath: string,
  notePath: string,
  changes: TagChange[]
): Promise<{ success: boolean; warnings: string[]; error?: string }> {
  const fullPath = join(vaultPath, notePath);
  const warnings: string[] = [];

  try {
    const raw = await readFile(fullPath, "utf-8");

    // Check for Templater syntax in frontmatter
    const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const frontmatterContent = frontmatterMatch?.[1] || "";
    if (frontmatterContent.includes("<%") && frontmatterContent.includes("%>")) {
      return { success: false, warnings: [], error: "Templater syntax in frontmatter" };
    }

    const parsed = parseFrontmatter(raw);
    let body = parsed.content;
    let frontmatterTags = getFrontmatterTags(parsed.data);
    const inlineTags = extractInlineTags(body);

    for (const change of changes) {
      const oldTagLower = change.oldTag.toLowerCase();

      // Check if tag exists
      const inFrontmatter = frontmatterTags.map(t => t.toLowerCase()).includes(oldTagLower);
      const inInline = inlineTags.map(t => t.toLowerCase()).includes(oldTagLower);

      if (!inFrontmatter && !inInline) {
        warnings.push(`Tag "${change.oldTag}" not found in note`);
        continue;
      }

      // Remove from frontmatter
      if (inFrontmatter) {
        frontmatterTags = frontmatterTags.filter(t => t.toLowerCase() !== oldTagLower);
      }

      // Remove from body
      if (inInline) {
        body = removeInlineTag(body, change.oldTag);
      }

      // Add new tag if specified
      if (change.newTag) {
        if (!isValidTagFormat(change.newTag)) {
          warnings.push(`Invalid tag format: "${change.newTag}"`);
        }
        if (!frontmatterTags.map(t => t.toLowerCase()).includes(change.newTag.toLowerCase())) {
          frontmatterTags.push(change.newTag);
        }
      }
    }

    // Serialize and write
    const newFrontmatter = { ...parsed.data, tags: frontmatterTags };
    const newContent = serializeFrontmatter(newFrontmatter, body);
    await writeFile(fullPath, newContent, "utf-8");

    return { success: true, warnings };
  } catch (err) {
    return { success: false, warnings, error: String(err) };
  }
}

/**
 * Create a git commit for the batch.
 */
async function createGitCommit(vaultPath: string, batchNumber: number, notesProcessed: number): Promise<string> {
  const message = `Tag migration batch ${batchNumber}: ${notesProcessed} notes processed`;

  // Stage all changes
  const addProc = Bun.spawn(["git", "add", "-A"], { cwd: vaultPath });
  await addProc.exited;

  // Commit
  const commitProc = Bun.spawn(["git", "commit", "-m", message], { cwd: vaultPath });
  const exitCode = await commitProc.exited;

  if (exitCode !== 0) {
    // Check if nothing to commit
    const statusProc = Bun.spawn(["git", "status", "--porcelain"], { cwd: vaultPath });
    const statusOutput = await new Response(statusProc.stdout).text();
    if (statusOutput.trim() === "") {
      return ""; // Nothing to commit, not an error
    }
    throw new Error(`git commit failed with exit code ${exitCode}`);
  }

  // Get commit hash
  const hashProc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: vaultPath });
  const hash = (await new Response(hashProc.stdout).text()).trim();
  return hash;
}

/**
 * Update the migration progress file.
 */
async function updateProgress(
  dataPath: string,
  entries: NoteChanges[],
  batchNumber: number,
  commitHash: string | null
): Promise<void> {
  const progressPath = join(dataPath, "migration-progress.json");
  let progress: MigrationProgress;

  try {
    const raw = await readFile(progressPath, "utf-8");
    progress = JSON.parse(raw) as MigrationProgress;
  } catch {
    // Create new progress file
    progress = {
      migrationId: `tag-migration-${new Date().toISOString().split("T")[0]}`,
      scope: { type: "full" },
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      totalInScope: 0,
      processedCount: 0,
      processedPaths: [],
      batchHistory: [],
    };
  }

  // Update progress
  progress.lastUpdatedAt = new Date().toISOString();
  progress.processedCount += entries.length;
  progress.processedPaths.push(...entries.map(e => e.path));
  progress.batchHistory.push({
    batchNumber,
    completedAt: new Date().toISOString(),
    notesProcessed: entries.length,
    commitHash,
  });

  await writeFile(progressPath, JSON.stringify(progress, null, 2), "utf-8");
}

/**
 * Get the current migration progress.
 */
export async function getProgress(dataPath: string): Promise<MigrationProgress | null> {
  const progressPath = join(dataPath, "migration-progress.json");
  try {
    const raw = await readFile(progressPath, "utf-8");
    return JSON.parse(raw) as MigrationProgress;
  } catch {
    return null;
  }
}

/**
 * Clear migration progress (for restart).
 */
export async function clearProgress(dataPath: string): Promise<void> {
  const progressPath = join(dataPath, "migration-progress.json");
  try {
    const { unlink } = await import("fs/promises");
    await unlink(progressPath);
  } catch {
    // File doesn't exist, that's fine
  }
}
```

**PATTERN:** `tools/tag-tools.ts:55-127` — tag application logic
**PATTERN:** `tools/git-tools.ts:35-70` — git commit logic
**VALIDATE:** `bunx tsc --noEmit`

---

#### Task 3.2: ADD `execute_batch` MCP Tool

Add the batch execution tool to `tools/tag-tools.ts`.

**MODIFY:** `tools/tag-tools.ts`

**IMPORTS:** Add at top
```typescript
import { executeBatch, getProgress, clearProgress } from "../lib/batch-executor.js";
import type { NoteChanges } from "../lib/worklist-generator.js";
```

**ADD:** New tool definition after `preview_changes`

```typescript
  const executeBatchTool = tool(
    "execute_batch",
    `Execute a batch of tag changes deterministically (no LLM involved).

Use this when:
- Ready to apply tag changes after preview/confirmation
- Processing a batch of notes from the worklist
- Resuming a migration after pause

Do NOT use this for:
- Previewing changes (use preview_changes instead)
- Discovering what needs to change (use preview_changes or generate worklist)
- Single-note changes (use apply_tag_changes for one-offs)

Performance notes:
- Processes entire batch in one call
- Creates git commit after batch completes
- Updates progress file automatically
- Cost: $0.00 (no LLM, pure code execution)
- Typical batch of 50 notes: ~2-5 seconds

Examples:
- execute_batch({ entries: [...], batchNumber: 1 }) — execute first batch
- execute_batch({ entries: worklist.slice(0, 50), batchNumber: 3 }) — execute batch 3`,
    {
      entries: z.array(z.object({
        path: z.string().describe("Relative path to note from vault root"),
        changes: z.array(z.object({
          oldTag: z.string().describe("Tag to remove/replace"),
          newTag: z.string().nullable().describe("Tag to add (null to just remove)"),
        })).describe("Tag changes for this note"),
      })).describe("Array of notes with their tag changes"),
      batchNumber: z.number().describe("Batch number for progress tracking and commit message"),
    },
    async ({ entries, batchNumber }) => {
      try {
        const dataPath = join(vaultPath, "..", "data");
        const result = await executeBatch(vaultPath, dataPath, entries as NoteChanges[], batchNumber);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: result.failed === 0,
              result,
              summary: `Batch ${batchNumber}: ${result.succeeded}/${result.processed} succeeded` +
                (result.commitHash ? `, committed ${result.commitHash.slice(0, 7)}` : "") +
                ` (${result.durationMs}ms)`,
            }),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );

  const getProgressTool = tool(
    "get_progress",
    `Get current migration progress.

Use this when:
- Checking how much work remains
- Resuming a paused migration
- Reporting progress to user

Do NOT use this for:
- Previewing changes (use preview_changes)
- Executing batches (use execute_batch)

Performance notes:
- Instant: just reads JSON file
- Cost: $0.00`,
    {},
    async () => {
      try {
        const dataPath = join(vaultPath, "..", "data");
        const progress = await getProgress(dataPath);

        if (!progress) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ hasProgress: false, message: "No migration in progress" }),
            }],
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              hasProgress: true,
              progress,
              summary: `${progress.processedCount} notes processed, ` +
                `${progress.batchHistory.length} batches completed`,
            }),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err}` }],
          isError: true,
        };
      }
    }
  );
```

**UPDATE:** Return array at end of `createTagTools()`
```typescript
  return [applyTagChanges, previewChanges, executeBatchTool, getProgressTool];
```

**VALIDATE:** `bunx tsc --noEmit`

---

#### Task 3.3: UPDATE Tool Registration for New Tools

**MODIFY:** `tagging-agent.ts`

**UPDATE:** `getAllowedTools()` function
```typescript
function getAllowedTools(): string[] {
  return [
    "mcp__vault__list_notes",
    "mcp__vault__read_note",
    "mcp__vault__search_notes",
    "mcp__vault__write_note",
    "mcp__vault__apply_tag_changes",
    "mcp__vault__preview_changes",
    "mcp__vault__execute_batch",        // ADD THIS
    "mcp__vault__get_progress",         // ADD THIS
    "mcp__vault__git_commit",
    "mcp__vault__read_data_file",
    "mcp__vault__write_data_file",
  ];
}
```

**VALIDATE:** `bunx tsc --noEmit`

---

#### Task 3.4: SIMPLIFY Execute Phase Instructions

Update the execute phase instructions to use the new `execute_batch` tool.

**MODIFY:** `lib/agent-personality.ts`

**REPLACE:** `buildExecuteInstructions()` function (lines 111-134)

```typescript
export function buildExecuteInstructions(config: Config): string {
  return `## Current Phase: EXECUTE

Your task is to execute the tag migration using the pre-computed worklist.

### Workflow

1. **Check progress**: Call \`get_progress({})\` to see current state
2. **Load batch**: Call \`read_data_file({ filename: "next-batch.json" })\` to get the next batch
3. **Confirm with user**: Show them what will be processed and ask for confirmation
4. **Execute**: Call \`execute_batch({ entries: <batch entries>, batchNumber: <N> })\`
5. **Report results**: Tell the user what happened (succeeded, failed, warnings)
6. **Repeat or complete**: If more batches remain, ask if they want to continue

### Key Points

- The \`execute_batch\` tool handles everything: applies changes, commits to git, updates progress
- You do NOT need to call \`apply_tag_changes\` directly — \`execute_batch\` does this internally
- If there are errors, report them clearly and ask how to proceed
- Each batch is atomic — if you stop mid-migration, you can resume later

### Available Tools

- \`get_progress\` — Check migration progress
- \`read_data_file\` — Load next-batch.json
- \`execute_batch\` — Execute a batch of changes (deterministic, no LLM)
- \`preview_changes\` — Preview what will change (if user wants to verify)

### Constraints

- Do NOT use \`search_notes\` or \`Bash\` — everything is pre-computed
- Do NOT skip the confirmation step before executing
- Vault path: ${config.vaultPath}`;
}
```

**VALIDATE:** `bunx tsc --noEmit`

---

### STAGE 4: MODEL OPTIMIZATION AND POLISH

---

#### Task 4.1: UPDATE `lib/config.ts` — Add Phase-Specific Models

**MODIFY:** `lib/config.ts`

**UPDATE:** `Config` interface (around line 5)
```typescript
export interface Config {
  vaultPath: string;
  dataPath: string;
  agentMode: AgentMode;
  batchSize: number;
  maxBudgetUsd: number;
  agentModel: string;              // Default model
  modelsByPhase: ModelsByPhase;    // ADD THIS
  sessionStatePath: string;
}

// ADD after Config interface
export type ModelsByPhase = {
  AUDIT: string;
  PLAN: string;
  EXECUTE: string;
  VERIFY: string;
  CONVERSATION: string;  // For interactive conversation
};

const DEFAULT_MODELS: ModelsByPhase = {
  AUDIT: "claude-sonnet-4-20250514",
  PLAN: "claude-sonnet-4-20250514",
  EXECUTE: "claude-haiku-4-5-20251001",    // Cheaper for simple supervision
  VERIFY: "claude-sonnet-4-20250514",
  CONVERSATION: "claude-sonnet-4-20250514",
};
```

**UPDATE:** `loadConfig()` function (around line 18)
```typescript
export function loadConfig(): Config {
  // ... existing validation code ...

  // Parse phase-specific models from env vars (optional)
  const modelsByPhase: ModelsByPhase = {
    AUDIT: process.env.AUDIT_MODEL || DEFAULT_MODELS.AUDIT,
    PLAN: process.env.PLAN_MODEL || DEFAULT_MODELS.PLAN,
    EXECUTE: process.env.EXECUTE_MODEL || DEFAULT_MODELS.EXECUTE,
    VERIFY: process.env.VERIFY_MODEL || DEFAULT_MODELS.VERIFY,
    CONVERSATION: process.env.CONVERSATION_MODEL || DEFAULT_MODELS.CONVERSATION,
  };

  return {
    vaultPath,
    dataPath,
    agentMode: modeRaw as AgentMode,
    batchSize,
    maxBudgetUsd,
    agentModel: process.env.AGENT_MODEL || "claude-sonnet-4-20250514",
    modelsByPhase,  // ADD THIS
    sessionStatePath: join(dataPath, "interactive-session.json"),
  };
}
```

**VALIDATE:** `bunx tsc --noEmit`

---

#### Task 4.2: UPDATE `lib/session-state.ts` — Add Scope to State

**MODIFY:** `lib/session-state.ts`

**UPDATE:** `SessionState` interface (around line 35)
```typescript
export interface SessionState {
  sessionId: string | null;
  currentPhase: AgentPhase;
  startedAt: string;
  lastUpdatedAt: string;
  vaultPath: string;
  selectedScope?: WorkScope;       // ADD THIS
  auditComplete: boolean;
  planComplete: boolean;
  worklistGenerated: boolean;
  executeBatchNumber: number;
  executeTotalBatches: number;
  verifyComplete: boolean;
}
```

**IMPORTS:** Add at top
```typescript
import type { WorkScope } from "./types.js";
```

**UPDATE:** `createInitialState()` function (around line 69)
```typescript
export function createInitialState(vaultPath: string): SessionState {
  return {
    sessionId: null,
    currentPhase: "WELCOME",
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    vaultPath,
    selectedScope: undefined,     // ADD THIS
    auditComplete: false,
    planComplete: false,
    worklistGenerated: false,
    executeBatchNumber: 0,
    executeTotalBatches: 0,
    verifyComplete: false,
  };
}
```

**VALIDATE:** `bunx tsc --noEmit`

---

#### Task 4.3: UPDATE Interactive Agent — Use Phase-Specific Models

**MODIFY:** `lib/interactive-agent.ts`

**FIND:** The `query()` call in `runLLMPhase()` or similar (around line 300)

**UPDATE:** Model selection to use phase-specific models

```typescript
// Map AgentPhase to model key
function getModelForPhase(phase: AgentPhase, config: Config): string {
  switch (phase) {
    case "AUDIT":
      return config.modelsByPhase.AUDIT;
    case "PLAN":
      return config.modelsByPhase.PLAN;
    case "EXECUTE":
      return config.modelsByPhase.EXECUTE;
    case "VERIFY":
      return config.modelsByPhase.VERIFY;
    default:
      return config.modelsByPhase.CONVERSATION;
  }
}

// In the query() call:
for await (const message of query({
  prompt: streamPrompt(),
  options: {
    mcpServers: { vault: server },
    allowedTools: getAllowedTools(),
    permissionMode: "bypassPermissions",
    maxBudgetUsd: config.maxBudgetUsd,
    model: getModelForPhase(state.currentPhase, config),  // CHANGE THIS
    systemPrompt,
  },
})) {
  // ... existing handling
}
```

**VALIDATE:** `bunx tsc --noEmit`

---

#### Task 4.4: ADD Scope Selection Conversation Flow

**MODIFY:** `lib/agent-personality.ts`

**ADD:** New function for scope selection instructions

```typescript
export function buildScopeSelectionInstructions(config: Config): string {
  return `## Scope Selection

The user can choose what to process. Help them select a scope:

### Scope Options

1. **Full vault**: Process all notes
   - "Process everything" / "Full migration" / "All notes"

2. **Specific folder**: Process notes in one folder
   - "Just the Journal folder" / "Only projects/"
   - Ask: "Which folder would you like to process?"

3. **Specific files**: Process named files
   - "Process these files: ..." / User provides a list
   - Ask: "Which files would you like to process?"

4. **Recent changes**: Process recently modified notes
   - "Check my recent notes" / "Notes from this week"
   - Ask: "How many days back should I look?"

5. **By tag**: Process notes with a specific tag
   - "All notes with #daily" / "Notes tagged project"
   - Ask: "Which tag should I filter by?"

### After Scope Selection

Once the user selects a scope:
1. Use \`preview_changes\` to show them what will change
2. Confirm they want to proceed
3. Store the scope for the execute phase

### Examples

User: "Just process my daily notes"
You: I'll focus on your Journal folder. Let me preview the changes...
[Call preview_changes with folder scope]

User: "Check what's changed recently"
You: How many days back should I look? (e.g., 7 days, 30 days)
[After they answer, call preview_changes with recent scope]`;
}
```

**UPDATE:** `buildInteractiveSystemPrompt()` to include scope selection for relevant phases

```typescript
export function buildInteractiveSystemPrompt(phase: AgentPhase, config: Config): string {
  const personality = buildPersonalityPrompt();

  let phaseInstructions: string;
  switch (phase) {
    case "AUDIT":
      phaseInstructions = buildAuditInstructions(config);
      break;
    case "PLAN":
      phaseInstructions = buildPlanInstructions(config);
      break;
    case "EXECUTE":
      phaseInstructions = buildExecuteInstructions(config);
      break;
    case "VERIFY":
      phaseInstructions = buildVerifyInstructions(config);
      break;
    case "REVIEW_WORKLIST":  // ADD THIS CASE
      phaseInstructions = buildScopeSelectionInstructions(config);
      break;
    default:
      phaseInstructions = "";
  }

  if (!phaseInstructions) return personality;

  return `${personality}\n\n---\n\n${phaseInstructions}`;
}
```

**VALIDATE:** `bunx tsc --noEmit`

---

#### Task 4.5: CREATE Integration Tests

**CREATE:** `tests/batch-executor.test.ts`

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { executeBatch, getProgress, clearProgress } from "../lib/batch-executor.js";
import type { NoteChanges } from "../lib/worklist-generator.js";

let testVaultPath: string;
let testDataPath: string;

beforeAll(async () => {
  testVaultPath = await mkdtemp(join(tmpdir(), "batch-exec-test-"));
  testDataPath = await mkdtemp(join(tmpdir(), "batch-data-test-"));

  // Initialize as git repo
  const initProc = Bun.spawn(["git", "init"], { cwd: testVaultPath });
  await initProc.exited;

  // Configure git for commits
  const configName = Bun.spawn(["git", "config", "user.name", "Test"], { cwd: testVaultPath });
  await configName.exited;
  const configEmail = Bun.spawn(["git", "config", "user.email", "test@test.com"], { cwd: testVaultPath });
  await configEmail.exited;

  // Create test notes
  await writeFile(
    join(testVaultPath, "note1.md"),
    "---\ntags:\n  - old-tag\n---\nContent with #inline-tag here.\n"
  );
  await writeFile(
    join(testVaultPath, "note2.md"),
    "---\ntags:\n  - another-tag\n---\nMore content.\n"
  );

  // Initial commit
  const addProc = Bun.spawn(["git", "add", "-A"], { cwd: testVaultPath });
  await addProc.exited;
  const commitProc = Bun.spawn(["git", "commit", "-m", "Initial"], { cwd: testVaultPath });
  await commitProc.exited;
});

afterAll(async () => {
  await rm(testVaultPath, { recursive: true, force: true });
  await rm(testDataPath, { recursive: true, force: true });
});

describe("executeBatch", () => {
  test("processes batch successfully", async () => {
    const entries: NoteChanges[] = [
      {
        path: "note1.md",
        changes: [
          { oldTag: "old-tag", newTag: "new-tag" },
          { oldTag: "inline-tag", newTag: null },
        ],
      },
    ];

    const result = await executeBatch(testVaultPath, testDataPath, entries, 1);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.batchNumber).toBe(1);
    expect(result.commitHash).toBeTruthy();

    // Verify file was updated
    const content = await readFile(join(testVaultPath, "note1.md"), "utf-8");
    expect(content).toContain("new-tag");
    expect(content).not.toContain("old-tag");
    expect(content).not.toContain("#inline-tag");
  });

  test("updates progress file", async () => {
    const progress = await getProgress(testDataPath);

    expect(progress).not.toBeNull();
    expect(progress!.processedCount).toBe(1);
    expect(progress!.processedPaths).toContain("note1.md");
    expect(progress!.batchHistory.length).toBe(1);
  });

  test("handles missing tags gracefully", async () => {
    const entries: NoteChanges[] = [
      {
        path: "note2.md",
        changes: [{ oldTag: "nonexistent-tag", newTag: "new-tag" }],
      },
    ];

    const result = await executeBatch(testVaultPath, testDataPath, entries, 2);

    expect(result.succeeded).toBe(1); // Still succeeds
    expect(result.warnings.length).toBeGreaterThan(0); // But has warning
  });

  test("handles nonexistent files", async () => {
    const entries: NoteChanges[] = [
      {
        path: "nonexistent.md",
        changes: [{ oldTag: "tag", newTag: "new-tag" }],
      },
    ];

    const result = await executeBatch(testVaultPath, testDataPath, entries, 3);

    expect(result.failed).toBe(1);
    expect(result.errors.length).toBe(1);
  });
});

describe("clearProgress", () => {
  test("clears progress file", async () => {
    await clearProgress(testDataPath);
    const progress = await getProgress(testDataPath);
    expect(progress).toBeNull();
  });
});
```

**VALIDATE:** `bun test tests/batch-executor.test.ts`

---

#### Task 4.6: UPDATE `.env.example`

**MODIFY:** `.env.example`

**ADD:** Phase-specific model configuration

```bash
# Path to Obsidian vault (required)
VAULT_PATH="/path/to/your/obsidian-vault"

# Agent execution mode
AGENT_MODE="audit"  # audit | plan | generate-worklist | execute | verify | interactive

# Batch size for execute mode
BATCH_SIZE=50

# Maximum budget per run (USD)
MAX_BUDGET_USD=1.00

# Default model
AGENT_MODEL="claude-sonnet-4-20250514"

# Phase-specific models (optional - defaults to AGENT_MODEL)
# Use cheaper models for simpler tasks to reduce costs
AUDIT_MODEL="claude-sonnet-4-20250514"
PLAN_MODEL="claude-sonnet-4-20250514"
EXECUTE_MODEL="claude-haiku-4-5-20251001"    # Cheaper for batch supervision
VERIFY_MODEL="claude-sonnet-4-20250514"
CONVERSATION_MODEL="claude-sonnet-4-20250514"
```

**VALIDATE:** File exists and is readable

---

## TESTING STRATEGY

### Unit Tests

| Test File | What It Tests |
|-----------|--------------|
| `tests/scope-filter.test.ts` | All scope types (full, folder, files, recent, tag) |
| `tests/batch-executor.test.ts` | Batch execution, progress tracking, error handling |
| `tests/worklist-generator.test.ts` | Existing tests + scope parameter |

### Integration Tests

| Scenario | How to Test |
|----------|-------------|
| Full migration flow | Run `bun run tagging-agent.ts` in interactive mode against test vault |
| Scope selection | Test each scope type via conversation |
| Preview → Execute | Verify preview matches actual execution |
| Resume after pause | Start migration, exit, resume and verify progress |

### Edge Cases

- [ ] Empty scope (no matching files)
- [ ] Scope with all files already processed
- [ ] Batch with mixed success/failure
- [ ] Templater files in scope (should be skipped)
- [ ] Large batch (100+ notes)
- [ ] Concurrent modifications to vault during execution

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Type Checking

```bash
bunx tsc --noEmit
```

### Level 2: Unit Tests

```bash
bun test
```

### Level 3: Specific New Tests

```bash
bun test tests/scope-filter.test.ts
bun test tests/batch-executor.test.ts
```

### Level 4: Smoke Test

```bash
# Verify tools register correctly
bun test tests/tools-smoke.test.ts
```

### Level 5: Manual Validation

```bash
# Test interactive mode with scope selection
bun run tagging-agent.ts

# In conversation:
# 1. Ask to preview changes for a specific folder
# 2. Ask to process only recent notes
# 3. Execute a small batch and verify git commit
# 4. Check progress tracking works
```

---

## ACCEPTANCE CRITERIA

- [ ] User can specify scope: full, folder, file list, recent, tag
- [ ] `preview_changes` tool shows changes without applying
- [ ] `execute_batch` tool processes batches deterministically (no LLM)
- [ ] Progress tracking works correctly across resume
- [ ] Phase-specific model selection reduces costs
- [ ] All existing tests pass
- [ ] New tests cover scope filtering and batch execution
- [ ] Interactive conversation feels natural
- [ ] Cost for full migration < $2.50 (down from $20+)

---

## COMPLETION CHECKLIST

- [ ] Task 1.1: Create `lib/types.ts`
- [ ] Task 1.2: Create `lib/scope-filter.ts`
- [ ] Task 1.3: Create `tests/scope-filter.test.ts`
- [ ] Task 1.4: Update `lib/worklist-generator.ts` with scope
- [ ] Task 2.1: Create `lib/preview-generator.ts`
- [ ] Task 2.2: Add `preview_changes` MCP tool
- [ ] Task 2.3: Update tool registration
- [ ] Task 3.1: Create `lib/batch-executor.ts`
- [ ] Task 3.2: Add `execute_batch` MCP tool
- [ ] Task 3.3: Update tool registration
- [ ] Task 3.4: Simplify execute phase instructions
- [ ] Task 4.1: Add phase-specific models to config
- [ ] Task 4.2: Add scope to session state
- [ ] Task 4.3: Use phase-specific models in interactive agent
- [ ] Task 4.4: Add scope selection conversation flow
- [ ] Task 4.5: Create integration tests
- [ ] Task 4.6: Update `.env.example`
- [ ] All validation commands pass
- [ ] Manual testing confirms feature works

---

## NOTES

### Design Decisions

1. **Scope stored in session state** — Allows resume with same scope
2. **Preview separate from execute** — User always sees before doing
3. **Haiku for execute supervision** — 5x cheaper, sufficient for simple supervision
4. **Progress in data/ not vault** — Keeps machine data separate from knowledge

### Risks

1. **Large scope performance** — May need pagination for 1000+ notes
2. **Git commit frequency** — One commit per batch; consider configurable
3. **Model availability** — Haiku 4.5 must be available on user's tier

### Future Improvements (Deferred)

1. **Complex query syntax** — "Notes with X but not Y"
2. **Automatic tag suggestions** — For untagged notes
3. **Scheduled tune-ups** — Cron-style automation
4. **Session logging** — Full conversation history for debugging
