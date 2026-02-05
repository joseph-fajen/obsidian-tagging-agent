/**
 * Shared types for Supervisor/Worker architecture.
 *
 * This module defines the core types used across scope filtering,
 * preview generation, batch execution, and progress tracking.
 */

/**
 * Scope specification for filtering which notes to process.
 * Used by preview_changes and execute_batch tools.
 */
export type WorkScope =
  | { type: "full" }
  | { type: "folder"; path: string }
  | { type: "files"; paths: string[] }
  | { type: "recent"; days: number }
  | { type: "tag"; tagName: string };

/**
 * Preview of changes for a single note.
 * Shows what will be added, removed, and kept without applying changes.
 */
export interface NotePreview {
  /** Relative path to the note from vault root */
  path: string;
  /** Tags that will be removed */
  removals: string[];
  /** Tags that will be added (including remapped tags) */
  additions: string[];
  /** Tags that will be kept as-is */
  keeps: string[];
  /** Count of inline tags that will be migrated to frontmatter */
  inlineMigrations: number;
}

/**
 * Result of generating a preview for a scope.
 */
export interface PreviewResult {
  /** The scope that was previewed */
  scope: WorkScope;
  /** Per-note previews */
  previews: NotePreview[];
  /** Total notes with changes */
  totalNotes: number;
  /** Total tag changes across all notes */
  totalChanges: number;
  /** True if results were truncated due to limit */
  limitApplied: boolean;
}

/**
 * Result of executing a batch of tag changes.
 */
export interface BatchResult {
  /** Batch number (1-indexed) */
  batchNumber: number;
  /** Total notes attempted */
  processed: number;
  /** Notes successfully updated */
  succeeded: number;
  /** Notes that encountered errors */
  failed: number;
  /** Non-fatal issues encountered */
  warnings: Array<{ path: string; message: string }>;
  /** Fatal errors encountered */
  errors: Array<{ path: string; error: string }>;
  /** Git commit hash (null if commit failed or skipped) */
  commitHash: string | null;
  /** Execution time in milliseconds */
  durationMs: number;
}

/**
 * Progress tracking for migration across resume.
 * Stored in data/migration-progress.json.
 */
export interface MigrationProgress {
  /** Unique identifier for this migration run */
  migrationId: string;
  /** The scope being processed */
  scope: WorkScope;
  /** When the migration started */
  startedAt: string;
  /** When progress was last updated */
  lastUpdatedAt: string;
  /** Total notes in the migration scope */
  totalInScope: number;
  /** Notes processed so far */
  processedCount: number;
  /** Paths of processed notes (for resume) */
  processedPaths: string[];
  /** History of completed batches */
  batchHistory: Array<{
    batchNumber: number;
    completedAt: string;
    notesProcessed: number;
    commitHash: string | null;
  }>;
}

/**
 * Entry in a batch — a note with its tag changes.
 * Re-exported from worklist-generator for convenience.
 */
export interface BatchEntry {
  /** Relative path to the note from vault root */
  path: string;
  /** Tag changes to apply */
  changes: Array<{
    oldTag: string;
    newTag: string | null;
  }>;
}
