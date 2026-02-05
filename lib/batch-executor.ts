/**
 * Batch executor for the Supervisor/Worker architecture.
 *
 * Handles deterministic execution of tag changes across multiple notes,
 * with git commits and progress tracking.
 */

import { readFile, writeFile, unlink } from "fs/promises";
import { join, resolve } from "path";
import { parseFrontmatter, serializeFrontmatter, getFrontmatterTags, setFrontmatterTags } from "./frontmatter.js";
import { extractInlineTags, isValidTagFormat, removeInlineTag } from "./tag-parser.js";
import type { BatchResult, MigrationProgress, WorkScope, BatchEntry } from "./types.js";

const PROGRESS_FILENAME = "migration-progress.json";

/**
 * Apply tag changes to a single note.
 * Returns warnings if any non-fatal issues occurred.
 */
async function applyChangesToNote(
  vaultPath: string,
  entry: BatchEntry,
): Promise<{ success: boolean; warnings: string[]; error?: string }> {
  const warnings: string[] = [];
  const fullPath = join(vaultPath, entry.path);

  try {
    // Resolve and validate path
    const resolved = resolve(vaultPath, entry.path);
    if (!resolved.startsWith(resolve(vaultPath))) {
      return { success: false, warnings: [], error: `Path traversal rejected: "${entry.path}"` };
    }

    const raw = await readFile(fullPath, "utf-8");

    // Skip files with Templater syntax in frontmatter
    const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const frontmatterContent = frontmatterMatch?.[1] || "";
    if (frontmatterContent.includes("<%") && frontmatterContent.includes("%>")) {
      return { success: false, warnings: [], error: `Templater syntax in frontmatter` };
    }

    const parsed = parseFrontmatter(raw);
    let body = parsed.content;
    let currentTags = getFrontmatterTags(parsed.data);
    const inlineTags = extractInlineTags(body);

    for (const { oldTag, newTag } of entry.changes) {
      const inFrontmatter = currentTags.includes(oldTag);
      const inInline = inlineTags.includes(oldTag.toLowerCase());

      if (!inFrontmatter && !inInline) {
        warnings.push(`Tag "${oldTag}" not found in note`);
      }

      // Remove old tag from frontmatter
      if (inFrontmatter) {
        currentTags = currentTags.filter((t) => t !== oldTag);
      }

      // Remove old tag from inline body
      if (inInline) {
        body = removeInlineTag(body, oldTag);
      }

      // Add new tag to frontmatter
      if (newTag !== null) {
        if (!isValidTagFormat(newTag)) {
          warnings.push(`New tag "${newTag}" has invalid format — added anyway`);
        }
        if (!currentTags.includes(newTag)) {
          currentTags.push(newTag);
        } else {
          warnings.push(`Duplicate after mapping: "${newTag}" already exists`);
        }
      }
    }

    // Write back
    const newData = setFrontmatterTags(parsed.data, currentTags);
    const output = serializeFrontmatter(body, newData);
    await writeFile(fullPath, output, "utf-8");

    return { success: true, warnings };
  } catch (err) {
    return { success: false, warnings, error: String(err) };
  }
}

/**
 * Create a git commit in the vault.
 */
async function createGitCommit(vaultPath: string, message: string): Promise<string | null> {
  try {
    // Stage all changes
    const addProc = Bun.spawn(["git", "-C", vaultPath, "add", "-A"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await addProc.exited;

    // Commit
    const commitProc = Bun.spawn(["git", "-C", vaultPath, "commit", "-m", message], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await commitProc.exited;
    const stdout = await new Response(commitProc.stdout).text();
    const stderr = await new Response(commitProc.stderr).text();

    if (exitCode !== 0) {
      if (stderr.includes("nothing to commit") || stdout.includes("nothing to commit")) {
        return null; // No changes to commit
      }
      console.error(`Git commit failed: ${stderr}`);
      return null;
    }

    // Extract commit hash
    const hashMatch = stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
    return hashMatch ? hashMatch[1] : "unknown";
  } catch (err) {
    console.error(`Git commit error: ${err}`);
    return null;
  }
}

/**
 * Execute a batch of tag changes.
 *
 * @param vaultPath - Path to the vault root
 * @param dataPath - Path to the data directory for progress tracking
 * @param entries - Batch entries with paths and changes
 * @param batchNumber - Batch number for progress tracking
 * @param scope - The scope being processed (for progress tracking)
 * @returns Batch result with success/failure counts and commit hash
 */
export async function executeBatch(
  vaultPath: string,
  dataPath: string,
  entries: BatchEntry[],
  batchNumber: number,
  scope?: WorkScope,
): Promise<BatchResult> {
  const startTime = Date.now();
  const warnings: Array<{ path: string; message: string }> = [];
  const errors: Array<{ path: string; error: string }> = [];
  let succeeded = 0;
  let failed = 0;

  // Process each entry
  for (const entry of entries) {
    const result = await applyChangesToNote(vaultPath, entry);

    if (result.success) {
      succeeded++;
      for (const warning of result.warnings) {
        warnings.push({ path: entry.path, message: warning });
      }
    } else {
      failed++;
      errors.push({ path: entry.path, error: result.error || "Unknown error" });
    }
  }

  // Create git commit
  const commitMessage = `Tag migration batch ${batchNumber}: ${succeeded} notes processed`;
  const commitHash = await createGitCommit(vaultPath, commitMessage);

  // Update progress
  await updateProgress(dataPath, entries, batchNumber, commitHash, scope);

  const durationMs = Date.now() - startTime;

  return {
    batchNumber,
    processed: entries.length,
    succeeded,
    failed,
    warnings,
    errors,
    commitHash,
    durationMs,
  };
}

/**
 * Update the progress file after a batch completes.
 */
async function updateProgress(
  dataPath: string,
  entries: BatchEntry[],
  batchNumber: number,
  commitHash: string | null,
  scope?: WorkScope,
): Promise<void> {
  const progressPath = join(dataPath, PROGRESS_FILENAME);
  const now = new Date().toISOString();

  // Load existing progress or create new
  let progress: MigrationProgress;
  try {
    const raw = await readFile(progressPath, "utf-8");
    const parsed = JSON.parse(raw);

    // Defensive initialization: ensure all required fields exist
    // This handles old format files or corrupted data gracefully
    progress = {
      migrationId: parsed.migrationId ?? `migration-${Date.now()}`,
      scope: parsed.scope ?? scope ?? { type: "full" },
      startedAt: parsed.startedAt ?? now,
      lastUpdatedAt: parsed.lastUpdatedAt ?? now,
      totalInScope: parsed.totalInScope ?? 0,
      processedCount: parsed.processedCount ?? 0,
      processedPaths: Array.isArray(parsed.processedPaths) ? parsed.processedPaths : [],
      batchHistory: Array.isArray(parsed.batchHistory) ? parsed.batchHistory : [],
    };
  } catch {
    // Create new progress (file doesn't exist or is invalid JSON)
    progress = {
      migrationId: `migration-${Date.now()}`,
      scope: scope ?? { type: "full" },
      startedAt: now,
      lastUpdatedAt: now,
      totalInScope: 0, // Will be set by caller if needed
      processedCount: 0,
      processedPaths: [],
      batchHistory: [],
    };
  }

  // Update progress
  const processedPaths = entries.map((e) => e.path);
  progress.processedPaths.push(...processedPaths);
  progress.processedCount += entries.length;
  progress.lastUpdatedAt = now;
  progress.batchHistory.push({
    batchNumber,
    completedAt: now,
    notesProcessed: entries.length,
    commitHash,
  });

  // If scope was provided and this is a new migration, update it
  if (scope && progress.batchHistory.length === 1) {
    progress.scope = scope;
  }

  await writeFile(progressPath, JSON.stringify(progress, null, 2), "utf-8");
}

/**
 * Get current migration progress.
 * Returns null if no migration is in progress.
 * Handles old format files gracefully by initializing missing fields.
 */
export async function getProgress(dataPath: string): Promise<MigrationProgress | null> {
  const progressPath = join(dataPath, PROGRESS_FILENAME);
  try {
    const raw = await readFile(progressPath, "utf-8");
    const parsed = JSON.parse(raw);

    // Defensive initialization for old format files
    return {
      migrationId: parsed.migrationId ?? `migration-unknown`,
      scope: parsed.scope ?? { type: "full" },
      startedAt: parsed.startedAt ?? new Date().toISOString(),
      lastUpdatedAt: parsed.lastUpdatedAt ?? new Date().toISOString(),
      totalInScope: parsed.totalInScope ?? 0,
      processedCount: parsed.processedCount ?? 0,
      processedPaths: Array.isArray(parsed.processedPaths) ? parsed.processedPaths : [],
      batchHistory: Array.isArray(parsed.batchHistory) ? parsed.batchHistory : [],
    };
  } catch {
    return null;
  }
}

/**
 * Clear migration progress (for starting fresh).
 */
export async function clearProgress(dataPath: string): Promise<void> {
  const progressPath = join(dataPath, PROGRESS_FILENAME);
  try {
    await unlink(progressPath);
  } catch {
    // File doesn't exist — that's fine
  }
}

/**
 * Format a batch result as a human-readable summary.
 */
export function formatBatchSummary(result: BatchResult): string {
  const hashStr = result.commitHash ? `, committed ${result.commitHash}` : "";
  const status = result.failed === 0 ? "succeeded" : `${result.succeeded}/${result.processed} succeeded`;
  return `Batch ${result.batchNumber}: ${status}${hashStr} (${result.durationMs}ms)`;
}

/**
 * Format progress as a human-readable summary.
 */
export function formatProgressSummary(progress: MigrationProgress): string {
  const batches = progress.batchHistory.length;
  const batchWord = batches === 1 ? "batch" : "batches";
  return `${progress.processedCount} notes processed, ${batches} ${batchWord} completed`;
}
