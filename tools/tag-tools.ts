import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { parseFrontmatter, serializeFrontmatter, getFrontmatterTags, setFrontmatterTags } from "../lib/frontmatter.js";
import { extractInlineTags, isValidTagFormat, removeInlineTag } from "../lib/tag-parser.js";
import { validateScope, formatScope } from "../lib/scope-filter.js";
import { generatePreview, formatPreviewForDisplay, formatPreviewSummary } from "../lib/preview-generator.js";
import { loadAuditMappings } from "../lib/worklist-generator.js";
import { executeBatch, getProgress, formatBatchSummary, formatProgressSummary } from "../lib/batch-executor.js";
import { validateScope as validateScopeForBatch } from "../lib/scope-filter.js";
import type { BatchEntry } from "../lib/types.js";

function safePath(vaultPath: string, notePath: string): string {
  const resolved = resolve(vaultPath, notePath);
  if (!resolved.startsWith(resolve(vaultPath))) {
    throw new Error(`Path traversal rejected: "${notePath}"`);
  }
  return resolved;
}

function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

export function createTagTools(vaultPath: string, dataPath?: string) {
  const applyTagChanges = tool(
    "apply_tag_changes",
    `Apply a set of tag changes to a specific note — the core migration tool.

Use this when:
- Executing the migration plan on a note (renaming, removing, adding tags)
- Moving inline tags to YAML frontmatter
- Removing noise or obsolete tags

Do NOT use this for:
- Reading tags (use read_note with detail: "minimal")
- Writing report notes (use write_note)
- Bulk operations across many notes in one call (call this per-note in a batch loop)

Performance notes:
- ~30ms per note
- Validates new tags match scheme format (lowercase, kebab-case, valid prefix)
- Deduplicates — if two old tags map to the same new tag, it's added once
- Always check warnings in the response — non-empty array doesn't mean failure

Examples:
- apply_tag_changes({ path: "Journal/2025-01-15.md", changes: [{ oldTag: "daily-reflection", newTag: "type/daily-note" }, { oldTag: "heading", newTag: null }] })
- apply_tag_changes({ path: "Projects/Plutus.md", changes: [{ oldTag: "todo", newTag: "status/pending" }, { oldTag: "research", newTag: "type/research" }] })`,
    {
      path: z.string().describe("Relative path to the note from vault root."),
      changes: z
        .array(
          z.object({
            oldTag: z.string().describe("Tag to remove (without # prefix)."),
            newTag: z.string().nullable().describe("New tag to add, or null to remove entirely."),
          }),
        )
        .describe("Array of tag changes to apply."),
    },
    async ({ path: notePath, changes }) => {
      try {
        const fullPath = safePath(vaultPath, notePath);
        const raw = await readFile(fullPath, "utf-8");

        // Skip files with Templater syntax IN THE FRONTMATTER (unparseable YAML)
        // Files with Templater in body only are safe to process
        const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const frontmatterContent = frontmatterMatch?.[1] || "";
        if (frontmatterContent.includes("<%") && frontmatterContent.includes("%>")) {
          return errorResult(`Cannot process: Templater syntax in frontmatter: ${notePath}`);
        }

        const parsed = parseFrontmatter(raw);
        let body = parsed.content;
        let currentTags = getFrontmatterTags(parsed.data);
        const inlineTags = extractInlineTags(body);

        const tagsAdded: string[] = [];
        const tagsRemoved: string[] = [];
        const warnings: string[] = [];

        for (const { oldTag, newTag } of changes) {
          const inFrontmatter = currentTags.includes(oldTag);
          const inInline = inlineTags.includes(oldTag);

          if (!inFrontmatter && !inInline) {
            warnings.push(`Tag "${oldTag}" not found in note`);
          }

          // Remove old tag from frontmatter
          if (inFrontmatter) {
            currentTags = currentTags.filter((t) => t !== oldTag);
            tagsRemoved.push(oldTag);
          }

          // Remove old tag from inline body
          if (inInline) {
            body = removeInlineTag(body, oldTag);
            if (!inFrontmatter) tagsRemoved.push(oldTag);
          }

          // Add new tag to frontmatter
          if (newTag !== null) {
            if (!isValidTagFormat(newTag)) {
              warnings.push(`New tag "${newTag}" has invalid format — added anyway`);
            }
            if (!currentTags.includes(newTag)) {
              currentTags.push(newTag);
              tagsAdded.push(newTag);
            } else {
              warnings.push(`Duplicate after mapping: "${newTag}" already exists`);
            }
          }
        }

        // Write back
        const newData = setFrontmatterTags(parsed.data, currentTags);
        const output = serializeFrontmatter(body, newData);
        await writeFile(fullPath, output, "utf-8");

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, path: notePath, tagsAdded, tagsRemoved, warnings }),
            },
          ],
        };
      } catch (err) {
        return errorResult(String(err));
      }
    },
  );

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
    - summary: One-line summary string

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
    async ({ scope: rawScope, limit }) => {
      try {
        // Validate and convert scope
        const scope = validateScope(rawScope);

        // Load audit mappings if available
        const auditMappings = dataPath
          ? await loadAuditMappings(dataPath, vaultPath)
          : undefined;

        // Generate preview
        const preview = await generatePreview(vaultPath, scope, auditMappings, limit ?? 10);

        // Format for display
        const displayText = formatPreviewForDisplay(preview);
        const summary = formatPreviewSummary(preview);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, preview, displayText, summary }),
            },
          ],
        };
      } catch (err) {
        return errorResult(String(err));
      }
    },
  );

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
      if (!dataPath) {
        return errorResult("dataPath is required for execute_batch");
      }

      try {
        // Convert to BatchEntry type
        const batchEntries: BatchEntry[] = entries.map(e => ({
          path: e.path,
          changes: e.changes,
        }));

        const result = await executeBatch(vaultPath, dataPath, batchEntries, batchNumber);
        const summary = formatBatchSummary(result);
        const success = result.failed === 0;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success, result, summary }),
            },
          ],
        };
      } catch (err) {
        return errorResult(String(err));
      }
    },
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
      if (!dataPath) {
        return errorResult("dataPath is required for get_progress");
      }

      try {
        const progress = await getProgress(dataPath);

        if (!progress) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  hasProgress: false,
                  message: "No migration in progress",
                }),
              },
            ],
          };
        }

        const summary = formatProgressSummary(progress);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ hasProgress: true, progress, summary }),
            },
          ],
        };
      } catch (err) {
        return errorResult(String(err));
      }
    },
  );

  return [applyTagChanges, previewChanges, executeBatchTool, getProgressTool];
}
