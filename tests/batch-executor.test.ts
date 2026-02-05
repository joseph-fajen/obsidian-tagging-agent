import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import {
  executeBatch,
  getProgress,
  clearProgress,
  formatBatchSummary,
  formatProgressSummary,
} from "../lib/batch-executor.js";
import type { BatchEntry } from "../lib/types.js";

// Test vault and data directory paths
const TEST_VAULT_PATH = join(import.meta.dir, "__batch_test_vault__");
const TEST_DATA_PATH = join(import.meta.dir, "__batch_test_data__");

// Note: Git operations in executeBatch will fail in test vault that's not a git repo
// We test the core functionality; git commit returns null in that case

async function createTestVault() {
  await mkdir(TEST_VAULT_PATH, { recursive: true });
  await mkdir(TEST_DATA_PATH, { recursive: true });

  // Create test notes with tags
  await writeFile(
    join(TEST_VAULT_PATH, "note1.md"),
    `---
tags:
  - daily-reflection
  - meditation
---
# Note 1

Content with #inline-tag here.
`
  );

  await writeFile(
    join(TEST_VAULT_PATH, "note2.md"),
    `---
tags:
  - todo
  - research
---
# Note 2

Some content.
`
  );

  await writeFile(
    join(TEST_VAULT_PATH, "note3.md"),
    `---
tags:
  - status/pending
---
# Note 3

Already has hierarchical tag.
`
  );
}

async function cleanupTestDirectories() {
  await rm(TEST_VAULT_PATH, { recursive: true, force: true });
  await rm(TEST_DATA_PATH, { recursive: true, force: true });
}

beforeAll(async () => {
  await cleanupTestDirectories();
  await createTestVault();
});

afterAll(async () => {
  await cleanupTestDirectories();
});

beforeEach(async () => {
  // Clear progress before each test
  await clearProgress(TEST_DATA_PATH);
  // Recreate test vault to reset files
  await cleanupTestDirectories();
  await createTestVault();
});

// ============================================================================
// executeBatch
// ============================================================================

describe("executeBatch", () => {
  test("processes batch successfully", async () => {
    const entries: BatchEntry[] = [
      {
        path: "note1.md",
        changes: [
          { oldTag: "daily-reflection", newTag: "type/daily-note" },
          { oldTag: "meditation", newTag: "topic/meditation" },
        ],
      },
    ];

    const result = await executeBatch(
      TEST_VAULT_PATH,
      TEST_DATA_PATH,
      entries,
      1
    );

    expect(result.batchNumber).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.durationMs).toBeGreaterThan(0);

    // Verify file was modified
    const content = await readFile(join(TEST_VAULT_PATH, "note1.md"), "utf-8");
    expect(content).toContain("type/daily-note");
    expect(content).toContain("topic/meditation");
    expect(content).not.toContain("daily-reflection");
    expect(content).not.toContain("- meditation");
  });

  test("updates progress file", async () => {
    const entries: BatchEntry[] = [
      {
        path: "note1.md",
        changes: [{ oldTag: "daily-reflection", newTag: "type/daily-note" }],
      },
    ];

    await executeBatch(TEST_VAULT_PATH, TEST_DATA_PATH, entries, 1);

    const progress = await getProgress(TEST_DATA_PATH);
    expect(progress).not.toBeNull();
    expect(progress!.processedCount).toBe(1);
    expect(progress!.processedPaths).toContain("note1.md");
    expect(progress!.batchHistory.length).toBe(1);
    expect(progress!.batchHistory[0].batchNumber).toBe(1);
    expect(progress!.batchHistory[0].notesProcessed).toBe(1);
  });

  test("handles missing tags gracefully with warning", async () => {
    const entries: BatchEntry[] = [
      {
        path: "note1.md",
        changes: [
          { oldTag: "nonexistent-tag", newTag: "type/something" },
        ],
      },
    ];

    const result = await executeBatch(
      TEST_VAULT_PATH,
      TEST_DATA_PATH,
      entries,
      1
    );

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].message).toContain("nonexistent-tag");
    expect(result.warnings[0].message).toContain("not found");
  });

  test("handles nonexistent files with error", async () => {
    const entries: BatchEntry[] = [
      {
        path: "nonexistent.md",
        changes: [{ oldTag: "test", newTag: "new-test" }],
      },
    ];

    const result = await executeBatch(
      TEST_VAULT_PATH,
      TEST_DATA_PATH,
      entries,
      1
    );

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].path).toBe("nonexistent.md");
  });

  test("processes multiple entries in batch", async () => {
    const entries: BatchEntry[] = [
      {
        path: "note1.md",
        changes: [{ oldTag: "daily-reflection", newTag: "type/daily-note" }],
      },
      {
        path: "note2.md",
        changes: [{ oldTag: "todo", newTag: "status/pending" }],
      },
    ];

    const result = await executeBatch(
      TEST_VAULT_PATH,
      TEST_DATA_PATH,
      entries,
      1
    );

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);

    // Check progress
    const progress = await getProgress(TEST_DATA_PATH);
    expect(progress!.processedCount).toBe(2);
    expect(progress!.processedPaths).toContain("note1.md");
    expect(progress!.processedPaths).toContain("note2.md");
  });

  test("handles tag removal (newTag null)", async () => {
    const entries: BatchEntry[] = [
      {
        path: "note1.md",
        changes: [{ oldTag: "meditation", newTag: null }],
      },
    ];

    const result = await executeBatch(
      TEST_VAULT_PATH,
      TEST_DATA_PATH,
      entries,
      1
    );

    expect(result.succeeded).toBe(1);

    const content = await readFile(join(TEST_VAULT_PATH, "note1.md"), "utf-8");
    expect(content).not.toContain("meditation");
    expect(content).toContain("daily-reflection"); // Other tag still there
  });
});

// ============================================================================
// getProgress / clearProgress
// ============================================================================

describe("getProgress / clearProgress", () => {
  test("returns null when no progress file exists", async () => {
    const progress = await getProgress(TEST_DATA_PATH);
    expect(progress).toBeNull();
  });

  test("returns progress after batch execution", async () => {
    const entries: BatchEntry[] = [
      {
        path: "note1.md",
        changes: [{ oldTag: "daily-reflection", newTag: "type/daily-note" }],
      },
    ];

    await executeBatch(TEST_VAULT_PATH, TEST_DATA_PATH, entries, 1);

    const progress = await getProgress(TEST_DATA_PATH);
    expect(progress).not.toBeNull();
    expect(progress!.migrationId).toMatch(/^migration-/);
    expect(progress!.processedCount).toBe(1);
    expect(progress!.batchHistory.length).toBe(1);
  });

  test("clearProgress removes progress file", async () => {
    // Create some progress
    const entries: BatchEntry[] = [
      {
        path: "note1.md",
        changes: [{ oldTag: "daily-reflection", newTag: "type/daily-note" }],
      },
    ];
    await executeBatch(TEST_VAULT_PATH, TEST_DATA_PATH, entries, 1);

    // Verify it exists
    let progress = await getProgress(TEST_DATA_PATH);
    expect(progress).not.toBeNull();

    // Clear it
    await clearProgress(TEST_DATA_PATH);

    // Verify it's gone
    progress = await getProgress(TEST_DATA_PATH);
    expect(progress).toBeNull();
  });

  test("tracks multiple batches in history", async () => {
    // Batch 1
    await executeBatch(
      TEST_VAULT_PATH,
      TEST_DATA_PATH,
      [{ path: "note1.md", changes: [{ oldTag: "daily-reflection", newTag: "type/daily" }] }],
      1
    );

    // Batch 2
    await executeBatch(
      TEST_VAULT_PATH,
      TEST_DATA_PATH,
      [{ path: "note2.md", changes: [{ oldTag: "todo", newTag: "status/pending" }] }],
      2
    );

    const progress = await getProgress(TEST_DATA_PATH);
    expect(progress!.batchHistory.length).toBe(2);
    expect(progress!.batchHistory[0].batchNumber).toBe(1);
    expect(progress!.batchHistory[1].batchNumber).toBe(2);
    expect(progress!.processedCount).toBe(2);
  });

  test("handles old format progress file gracefully", async () => {
    // Write an old format progress file (missing processedPaths, batchHistory, etc.)
    const oldFormatProgress = {
      lastUpdated: "2026-02-04",
      totalBatches: 5,
      notesProcessed: 100,
      batches: [{ batchNumber: 1, status: "completed" }],
      completedMigrations: ["daily-reflection"],
    };
    const progressPath = join(TEST_DATA_PATH, "migration-progress.json");
    await writeFile(progressPath, JSON.stringify(oldFormatProgress), "utf-8");

    // getProgress should return a valid MigrationProgress with defaults
    const progress = await getProgress(TEST_DATA_PATH);
    expect(progress).not.toBeNull();
    expect(progress!.processedPaths).toEqual([]); // Default to empty array
    expect(progress!.batchHistory).toEqual([]); // Default to empty array
    expect(progress!.processedCount).toBe(0); // Default to 0
    expect(progress!.scope).toEqual({ type: "full" }); // Default scope
  });

  test("executeBatch handles old format progress file without crashing", async () => {
    // Write an old format progress file
    const oldFormatProgress = {
      lastUpdated: "2026-02-04",
      notesProcessed: 100,
    };
    const progressPath = join(TEST_DATA_PATH, "migration-progress.json");
    await writeFile(progressPath, JSON.stringify(oldFormatProgress), "utf-8");

    // executeBatch should NOT crash — it should initialize missing fields
    const entries: BatchEntry[] = [
      {
        path: "note1.md",
        changes: [{ oldTag: "daily-reflection", newTag: "type/daily-note" }],
      },
    ];

    const result = await executeBatch(TEST_VAULT_PATH, TEST_DATA_PATH, entries, 1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    // Progress should now have proper format
    const progress = await getProgress(TEST_DATA_PATH);
    expect(progress!.processedPaths).toContain("note1.md");
    expect(progress!.batchHistory.length).toBe(1);
  });
});

// ============================================================================
// formatBatchSummary / formatProgressSummary
// ============================================================================

describe("formatBatchSummary", () => {
  test("formats successful batch", () => {
    const result = {
      batchNumber: 1,
      processed: 50,
      succeeded: 50,
      failed: 0,
      warnings: [],
      errors: [],
      commitHash: "abc1234",
      durationMs: 2340,
    };

    const summary = formatBatchSummary(result);
    expect(summary).toContain("Batch 1");
    expect(summary).toContain("succeeded");
    expect(summary).toContain("abc1234");
    expect(summary).toContain("2340ms");
  });

  test("formats batch with failures", () => {
    const result = {
      batchNumber: 2,
      processed: 50,
      succeeded: 48,
      failed: 2,
      warnings: [],
      errors: [],
      commitHash: "def5678",
      durationMs: 3000,
    };

    const summary = formatBatchSummary(result);
    expect(summary).toContain("48/50");
  });

  test("handles null commit hash", () => {
    const result = {
      batchNumber: 1,
      processed: 10,
      succeeded: 10,
      failed: 0,
      warnings: [],
      errors: [],
      commitHash: null,
      durationMs: 500,
    };

    const summary = formatBatchSummary(result);
    expect(summary).not.toContain("committed");
  });
});

describe("formatProgressSummary", () => {
  test("formats progress with single batch", () => {
    const progress = {
      migrationId: "migration-123",
      scope: { type: "full" as const },
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      totalInScope: 100,
      processedCount: 50,
      processedPaths: [],
      batchHistory: [{ batchNumber: 1, completedAt: "", notesProcessed: 50, commitHash: null }],
    };

    const summary = formatProgressSummary(progress);
    expect(summary).toContain("50 notes processed");
    expect(summary).toContain("1 batch");
  });

  test("formats progress with multiple batches", () => {
    const progress = {
      migrationId: "migration-123",
      scope: { type: "full" as const },
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      totalInScope: 100,
      processedCount: 150,
      processedPaths: [],
      batchHistory: [
        { batchNumber: 1, completedAt: "", notesProcessed: 50, commitHash: null },
        { batchNumber: 2, completedAt: "", notesProcessed: 50, commitHash: null },
        { batchNumber: 3, completedAt: "", notesProcessed: 50, commitHash: null },
      ],
    };

    const summary = formatProgressSummary(progress);
    expect(summary).toContain("150 notes processed");
    expect(summary).toContain("3 batches");
  });
});
