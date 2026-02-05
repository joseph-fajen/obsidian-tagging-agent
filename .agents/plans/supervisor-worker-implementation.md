---
status: PENDING
created: 2026-02-05
estimated_complexity: high
confidence_score: 8/10
---

# Feature: Supervisor/Worker Architecture (Path C)

## Overview

Transform the tagging agent from rigid phase-based CLI into a **collaborative automation assistant**. The LLM (Supervisor) handles conversation, intent parsing, and exception handling. Code (Worker) handles deterministic execution.

**User Story:** As a vault owner, I want to specify what notes to process, preview changes, and have reliable execution with predictable costs.

**Problem:** Current execute phase is LLM-driven per-note, causing 10x cost overrun ($1.50 vs $0.15), unpredictable behavior, and broken progress tracking.

**Solution:** New MCP tools (`preview_changes`, `execute_batch`, `get_progress`) that let code do the work while the LLM supervises.

---

## Context References

**Read before implementing:**

| File | Lines | Why |
|------|-------|-----|
| `lib/worklist-generator.ts` | 69-210 | Pattern: deterministic file processing |
| `tools/tag-tools.ts` | 21-131 | Pattern: MCP tool with Zod schema |
| `tools/vault-tools.ts` | 8-18 | Reuse: `safePath()`, `errorResult()` |
| `lib/session-state.ts` | 35-84 | Extend: `SessionState`, `createInitialState()` |
| `lib/config.ts` | 5-55 | Extend: `Config`, `loadConfig()` |
| `lib/agent-personality.ts` | 111-206 | Modify: phase instructions |
| `tests/worklist-generator.test.ts` | 1-100 | Pattern: test fixtures |

**New files to create:** `lib/types.ts`, `lib/scope-filter.ts`, `lib/preview-generator.ts`, `lib/batch-executor.ts`, `tests/scope-filter.test.ts`, `tests/batch-executor.test.ts`

---

## Stage 1: Foundation — Types and Scope Filtering

### Task 1.1: Create `lib/types.ts`

```typescript
/**
 * Shared types for Supervisor/Worker architecture.
 */

export type WorkScope =
  | { type: "full" }
  | { type: "folder"; path: string }
  | { type: "files"; paths: string[] }
  | { type: "recent"; days: number }
  | { type: "tag"; tagName: string };

export interface NotePreview {
  path: string;
  removals: string[];
  additions: string[];
  keeps: string[];
  inlineMigrations: number;
}

export interface PreviewResult {
  scope: WorkScope;
  previews: NotePreview[];
  totalNotes: number;
  totalChanges: number;
  limitApplied: boolean;
}

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

### Task 1.2: Create `lib/scope-filter.ts`

Implement `scopeToNotes(vaultPath, scope)` that returns relative note paths matching the scope.

**Key functions:**
- `scopeToNotes(vaultPath: string, scope: WorkScope): Promise<string[]>` — Main dispatcher
- `getAllNotes(vaultPath)` — Recursive readdir, excludes `_` prefixed files
- `getNotesInFolder(vaultPath, folderPath)` — Filter by path prefix
- `validateFilePaths(vaultPath, paths)` — Check files exist
- `getRecentNotes(vaultPath, days)` — Filter by mtime
- `getNotesByTag(vaultPath, tagName)` — Parse and match tags
- `formatScope(scope: WorkScope): string` — Human-readable description

**Pattern:** Follow `lib/worklist-generator.ts:84-98` for file discovery.

**Imports:** `readdir`, `stat` from `fs/promises`; `parseFrontmatter`, `getFrontmatterTags` from `./frontmatter.js`; `extractInlineTags` from `./tag-parser.js`

### Task 1.3: Create `tests/scope-filter.test.ts`

**Test structure:**
```typescript
// Setup: Create temp vault with folders (journal/, projects/, archive/old/)
// Create 5-6 test notes with various tags and dates
// Set one file's mtime to 30 days ago for "recent" tests

describe("scopeToNotes", () => {
  describe("full scope", () => { /* returns all except _ prefixed, sorted */ });
  describe("folder scope", () => { /* handles nested, trailing slash, nonexistent */ });
  describe("files scope", () => { /* validates existence, filters non-.md */ });
  describe("recent scope", () => { /* respects cutoff date */ });
  describe("tag scope", () => { /* finds frontmatter and inline, case-insensitive */ });
});

describe("formatScope", () => { /* human-readable strings for each type */ });
```

### Task 1.4: Update `lib/worklist-generator.ts`

Add optional `scope` parameter to `generateWorklist()`:

```typescript
// Change signature:
export async function generateWorklist(
  vaultPath: string,
  auditMappings?: AuditMappings,
  scope?: WorkScope  // NEW
): Promise<WorklistGeneratorResult>

// Replace readdir loop with:
const notePaths = scope
  ? await scopeToNotes(vaultPath, scope)
  : await scopeToNotes(vaultPath, { type: "full" });
```

**Gotcha:** Remove `entry.name.startsWith("_")` check — `scopeToNotes()` already filters these.

---

## Stage 2: Preview Mode

### Task 2.1: Create `lib/preview-generator.ts`

Implement `generatePreview(vaultPath, scope, auditMappings?, limit?)` that computes changes without applying.

**Logic:**
1. Get notes via `scopeToNotes()`
2. For each note (up to limit):
   - Skip Templater files (check frontmatter for `<%`)
   - Parse tags (frontmatter + inline)
   - Look up each tag in mappings
   - Categorize: removals, additions, keeps, inlineMigrations
3. Return `PreviewResult` with aggregate stats

Also implement `formatPreviewForDisplay(preview: PreviewResult): string` for conversation output.

**Pattern:** Follow `lib/worklist-generator.ts:119-180` for tag processing logic.

### Task 2.2: Add `preview_changes` MCP Tool

Add to `tools/tag-tools.ts`:

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

Returns:
    JSON object with:
    - success: boolean — true if preview generated without errors
    - preview: PreviewResult object containing:
      - scope: the WorkScope that was previewed
      - previews: array of NotePreview objects (path, removals, additions, keeps, inlineMigrations)
      - totalNotes: count of notes with changes
      - totalChanges: aggregate change count
      - limitApplied: true if results were truncated
    - displayText: Formatted markdown suitable for conversation display

Performance notes:
- Fast: only reads files, no writes (~50-200ms for 10 notes)
- Default limit of 10 notes; increase for more comprehensive preview
- Returns ~100 tokens per note in preview
- Cost: ~$0.01 for supervisor to process typical results

Examples:
    # Sample changes across entire vault
    preview_changes({
        scope: { type: "full" },
        limit: 5
    })

    # Preview all changes in journal folder
    preview_changes({
        scope: { type: "folder", path: "Journal" },
        limit: 20
    })

    # Check recently modified notes (last 7 days)
    preview_changes({
        scope: { type: "recent", days: 7 },
        limit: 10
    })

    # Preview notes with specific tag before migration
    preview_changes({
        scope: { type: "tag", tagName: "daily-reflection" },
        limit: 15
    })`,
  {
    scope: z.object({
      type: z.enum(["full", "folder", "files", "recent", "tag"]),
      path: z.string().optional(),
      paths: z.array(z.string()).optional(),
      days: z.number().optional(),
      tagName: z.string().optional(),
    }).describe(`Scope to preview. Choose based on user intent:
      - full: Entire vault ("all", "everything")
      - folder: Specific directory (user mentions folder name)
      - files: Explicit paths (user provides specific files)
      - recent: Time-based ("recent", "this week", "last N days")
      - tag: Filter by tag (notes with specific tag)`),
    limit: z.number().optional().describe("Max notes to preview (default 10). Increase for comprehensive preview, decrease for quick check."),
  },
  async ({ scope, limit }) => {
    // Validate scope, load audit mappings, generate preview
    // Return { success, preview, displayText }
  }
);
```

**Helper needed:** `validateScope(scope: Record<string, unknown>): WorkScope` — type-safe conversion from tool input.

### Task 2.3: Update Tool Registration

In `tagging-agent.ts`, add `"mcp__vault__preview_changes"` to `getAllowedTools()`.

Update `createTagTools()` return: `return [applyTagChanges, previewChanges];`

---

## Stage 3: Code-Driven Execution

### Task 3.1: Create `lib/batch-executor.ts`

Implement `executeBatch(vaultPath, dataPath, entries, batchNumber)`:

1. Process each entry via `applyChangesToNote()` (inline helper)
2. Track succeeded/failed/warnings
3. Create git commit: `git add -A && git commit -m "..."`
4. Update progress file via `updateProgress()`
5. Return `BatchResult`

**Also implement:**
- `getProgress(dataPath): Promise<MigrationProgress | null>`
- `clearProgress(dataPath): Promise<void>`

**Pattern:** Follow `tools/tag-tools.ts:55-127` for tag application, `tools/git-tools.ts:35-70` for commits.

### Task 3.2: Add `execute_batch` and `get_progress` MCP Tools

Add to `tools/tag-tools.ts`:

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

Returns:
    JSON object with:
    - success: boolean — true if all notes processed without errors
    - result: BatchResult object containing:
      - batchNumber: the batch that was processed
      - processed: total notes attempted
      - succeeded: notes successfully updated
      - failed: notes that encountered errors
      - warnings: array of { path, message } for non-fatal issues
      - errors: array of { path, error } for failures
      - commitHash: git commit hash (null if commit failed)
      - durationMs: execution time in milliseconds
    - summary: Human-readable string like "Batch 1: 48/50 succeeded, committed a1b2c3d (2340ms)"

Performance notes:
- Processes entire batch in one call (~2-5 seconds for 50 notes)
- Creates git commit after batch completes
- Updates progress file automatically
- Cost: $0.00 (no LLM, pure code execution)

Examples:
    # Execute first batch with entries from worklist
    execute_batch({
        entries: [
            {
                path: "Journal/2025-01-15.md",
                changes: [
                    { oldTag: "daily-reflection", newTag: "type/daily-note" }
                ]
            },
            {
                path: "Projects/Alpha.md",
                changes: [
                    { oldTag: "todo", newTag: "status/pending" },
                    { oldTag: "heading", newTag: null }
                ]
            }
        ],
        batchNumber: 1
    })

    # Continue migration from batch 5
    execute_batch({
        entries: nextBatchFromFile.entries,
        batchNumber: 5
    })`,
  {
    entries: z.array(z.object({
      path: z.string().describe("Relative path from vault root"),
      changes: z.array(z.object({
        oldTag: z.string().describe("Tag to remove/replace"),
        newTag: z.string().nullable().describe("New tag (null to just remove)"),
      })),
    })).describe("Notes with their tag changes. Get from next-batch.json or preview_changes result."),
    batchNumber: z.number().describe("Batch number for progress tracking and commit message"),
  },
  async ({ entries, batchNumber }) => {
    // Call executeBatch(), return { success, result, summary }
  }
);

const getProgressTool = tool(
  "get_progress",
  `Get current migration progress.

Use this when:
- Checking how much work remains before starting
- Resuming a paused migration
- Reporting progress to user

Do NOT use this for:
- Previewing changes (use preview_changes)
- Executing batches (use execute_batch)

Returns:
    JSON object with:
    - hasProgress: boolean — false if no migration in progress
    - message: string — explanation when hasProgress is false
    - progress: MigrationProgress object (when hasProgress is true) containing:
      - migrationId: unique identifier for this migration
      - scope: the WorkScope being processed
      - startedAt/lastUpdatedAt: ISO timestamps
      - totalInScope: total notes in the migration scope
      - processedCount: notes completed so far
      - processedPaths: array of completed note paths
      - batchHistory: array of { batchNumber, completedAt, notesProcessed, commitHash }
    - summary: Human-readable string like "150 notes processed, 3 batches completed"

Performance notes:
- Instant: just reads JSON file (~5ms)
- Returns ~200 tokens with full batch history
- Cost: $0.00

Examples:
    # Check progress before starting execute phase
    get_progress({})
    // Returns: { hasProgress: false, message: "No migration in progress" }

    # Check progress mid-migration
    get_progress({})
    // Returns: { hasProgress: true, progress: {...}, summary: "150 notes processed, 3 batches completed" }`,
  {},
  async () => {
    // Call getProgress(), return status and summary
  }
);
```

### Task 3.3: Update Tool Registration

Add to `getAllowedTools()`: `"mcp__vault__execute_batch"`, `"mcp__vault__get_progress"`

Update `createTagTools()` return: `return [applyTagChanges, previewChanges, executeBatchTool, getProgressTool];`

### Task 3.4: Simplify Execute Phase Instructions

Replace `buildExecuteInstructions()` in `lib/agent-personality.ts`:

```typescript
export function buildExecuteInstructions(config: Config): string {
  return `## Current Phase: EXECUTE

Your task is to execute the tag migration using pre-computed worklist.

### Workflow

1. **Check progress**: Call \`get_progress({})\`
2. **Load batch**: Call \`read_data_file({ filename: "next-batch.json" })\`
3. **Confirm with user**: Show what will be processed, ask for confirmation
4. **Execute**: Call \`execute_batch({ entries, batchNumber })\`
5. **Report results**: Succeeded, failed, warnings
6. **Repeat or complete**: If more batches, ask to continue

### Key Points

- \`execute_batch\` handles everything: applies changes, commits, updates progress
- Do NOT call \`apply_tag_changes\` directly
- Each batch is atomic — can resume later if stopped

### Constraints

- Do NOT use \`search_notes\` or \`Bash\` — everything is pre-computed
- Do NOT skip confirmation before executing
- Vault path: ${config.vaultPath}`;
}
```

---

## Stage 4: Model Optimization and Polish

### Task 4.1: Add Phase-Specific Models to Config

Update `lib/config.ts`:

```typescript
export type ModelsByPhase = {
  AUDIT: string;
  PLAN: string;
  EXECUTE: string;
  VERIFY: string;
  CONVERSATION: string;
};

const DEFAULT_MODELS: ModelsByPhase = {
  AUDIT: "claude-sonnet-4-20250514",
  PLAN: "claude-sonnet-4-20250514",
  EXECUTE: "claude-haiku-4-5-20251001",  // Cheaper for simple supervision
  VERIFY: "claude-sonnet-4-20250514",
  CONVERSATION: "claude-sonnet-4-20250514",
};

// Add to Config interface:
modelsByPhase: ModelsByPhase;

// In loadConfig(), parse from env vars with DEFAULT_MODELS fallback
```

### Task 4.2: Add Scope to Session State

Update `lib/session-state.ts`:

```typescript
import type { WorkScope } from "./types.js";

export interface SessionState {
  // ... existing fields
  selectedScope?: WorkScope;  // ADD
}

export function createInitialState(vaultPath: string): SessionState {
  return {
    // ... existing fields
    selectedScope: undefined,  // ADD
  };
}
```

### Task 4.3: Use Phase-Specific Models in Interactive Agent

Update `lib/interactive-agent.ts`:

```typescript
function getModelForPhase(phase: AgentPhase, config: Config): string {
  switch (phase) {
    case "AUDIT": return config.modelsByPhase.AUDIT;
    case "PLAN": return config.modelsByPhase.PLAN;
    case "EXECUTE": return config.modelsByPhase.EXECUTE;
    case "VERIFY": return config.modelsByPhase.VERIFY;
    default: return config.modelsByPhase.CONVERSATION;
  }
}

// In query() call, change model to: getModelForPhase(state.currentPhase, config)
```

### Task 4.4: Add Scope Selection Instructions

Add to `lib/agent-personality.ts`:

```typescript
export function buildScopeSelectionInstructions(config: Config): string {
  return `## Scope Selection

Help user choose what to process:

1. **Full vault**: "Process everything" / "All notes"
2. **Folder**: "Just the Journal folder" → Ask which folder
3. **Files**: "Process these files: ..." → User provides list
4. **Recent**: "Check my recent notes" → Ask how many days
5. **Tag**: "All notes with #daily" → Ask which tag

After selection:
1. Use \`preview_changes\` to show what will change
2. Confirm they want to proceed
3. Store scope for execute phase`;
}
```

Update `buildInteractiveSystemPrompt()` to include this for `REVIEW_WORKLIST` phase.

### Task 4.5: Create Tests

**`tests/scope-filter.test.ts`:** See Task 1.3 structure.

**`tests/batch-executor.test.ts`:**
```typescript
// Setup: temp vault as git repo, test notes with tags

describe("executeBatch", () => {
  test("processes batch successfully");      // Check file modified, commit created
  test("updates progress file");             // Check progress.json contents
  test("handles missing tags gracefully");   // Succeeds with warning
  test("handles nonexistent files");         // Failed count, error in result
});

describe("getProgress / clearProgress", () => {
  test("returns null when no progress");
  test("returns progress after batch");
  test("clearProgress removes file");
});
```

### Task 4.6: Update `.env.example`

Add phase-specific model configuration:

```bash
# Phase-specific models (optional - defaults shown)
AUDIT_MODEL="claude-sonnet-4-20250514"
PLAN_MODEL="claude-sonnet-4-20250514"
EXECUTE_MODEL="claude-haiku-4-5-20251001"
VERIFY_MODEL="claude-sonnet-4-20250514"
CONVERSATION_MODEL="claude-sonnet-4-20250514"
```

---

## Validation

Run after each stage:

```bash
bunx tsc --noEmit           # Type check
bun test                    # All tests
bun test tests/scope-filter.test.ts      # Stage 1
bun test tests/batch-executor.test.ts    # Stage 3
```

Manual smoke test:
```bash
bun run tagging-agent.ts
# 1. Ask to preview changes for specific folder
# 2. Ask to process only recent notes
# 3. Execute small batch, verify git commit
# 4. Check progress tracking
```

---

## Acceptance Criteria

- [ ] User can specify scope: full, folder, file list, recent, tag
- [ ] `preview_changes` shows changes without applying
- [ ] `execute_batch` processes batches deterministically (no LLM)
- [ ] Progress tracking works across resume
- [ ] Phase-specific models reduce costs
- [ ] All existing tests pass
- [ ] Cost for full migration < $2.50 (down from $20+)

---

## Design Notes

**Scope in session state:** Allows resume with same scope.

**Preview separate from execute:** User always sees before doing.

**Haiku for execute:** 5x cheaper, sufficient for simple supervision.

**Risks:**
- Large scope (1000+ notes) may need pagination
- Haiku 4.5 must be available on user's API tier
