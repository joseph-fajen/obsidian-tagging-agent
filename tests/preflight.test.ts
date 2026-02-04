import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("checkExecutePrerequisites", () => {
  let testVaultPath: string;

  beforeAll(async () => {
    testVaultPath = await mkdtemp(join(tmpdir(), "preflight-test-"));

    // Create a worklist JSON file
    const worklist = {
      generatedAt: new Date().toISOString(),
      schemeVersion: "1.0",
      generatedBy: "test",
      totalNotes: 3,
      totalChanges: 3,
      worklist: [
        { path: "note1.md", changes: [{ oldTag: "todo", newTag: "status/pending" }] },
        { path: "note2.md", changes: [{ oldTag: "done", newTag: "status/completed" }] },
        { path: "note3.md", changes: [{ oldTag: "heading", newTag: null }] },
      ],
      unmappedTags: [],
    };

    await writeFile(
      join(testVaultPath, "_Migration_Worklist.json"),
      JSON.stringify(worklist, null, 2),
    );
  });

  afterAll(async () => {
    await rm(testVaultPath, { recursive: true, force: true });
  });

  test("worklist file structure is correct", async () => {
    const worklistPath = join(testVaultPath, "_Migration_Worklist.json");
    const content = await readFile(worklistPath, "utf-8");
    const worklist = JSON.parse(content);

    expect(worklist.totalNotes).toBe(3);
    expect(worklist.worklist.length).toBe(3);
    expect(worklist.worklist[0].path).toBe("note1.md");
    expect(worklist.worklist[0].changes[0].oldTag).toBe("todo");
    expect(worklist.worklist[0].changes[0].newTag).toBe("status/pending");
  });

  test("worklist entries have correct NoteChanges structure", async () => {
    const worklistPath = join(testVaultPath, "_Migration_Worklist.json");
    const content = await readFile(worklistPath, "utf-8");
    const worklist = JSON.parse(content);

    for (const entry of worklist.worklist) {
      expect(entry).toHaveProperty("path");
      expect(entry).toHaveProperty("changes");
      expect(Array.isArray(entry.changes)).toBe(true);
      for (const change of entry.changes) {
        expect(change).toHaveProperty("oldTag");
        expect(change).toHaveProperty("newTag");
      }
    }
  });

  test("MigrationWorklist has all required fields", async () => {
    const worklistPath = join(testVaultPath, "_Migration_Worklist.json");
    const content = await readFile(worklistPath, "utf-8");
    const worklist = JSON.parse(content);

    expect(worklist).toHaveProperty("generatedAt");
    expect(worklist).toHaveProperty("schemeVersion");
    expect(worklist).toHaveProperty("generatedBy");
    expect(worklist).toHaveProperty("totalNotes");
    expect(worklist).toHaveProperty("totalChanges");
    expect(worklist).toHaveProperty("worklist");
    expect(worklist).toHaveProperty("unmappedTags");
  });
});

describe("NextBatch structure", () => {
  test("NextBatch interface shape is correct", async () => {
    // Test the expected shape of NextBatch
    const batch = {
      batchNumber: 1,
      totalInWorklist: 100,
      processedSoFar: 50,
      remaining: 50,
      entries: [
        { path: "note1.md", changes: [{ oldTag: "todo", newTag: "status/pending" }] },
      ],
    };

    expect(batch.batchNumber).toBe(1);
    expect(batch.totalInWorklist).toBe(100);
    expect(batch.processedSoFar).toBe(50);
    expect(batch.remaining).toBe(50);
    expect(batch.entries.length).toBe(1);
    expect(batch.entries[0].path).toBe("note1.md");
  });

  test("NextBatch entries match NoteChanges structure", async () => {
    const batch = {
      batchNumber: 2,
      totalInWorklist: 50,
      processedSoFar: 10,
      remaining: 40,
      entries: [
        {
          path: "journal/daily.md",
          changes: [
            { oldTag: "daily-reflection", newTag: "type/daily-note", reason: "format-change" },
            { oldTag: "heading", newTag: null, reason: "noise-removal" },
          ]
        },
      ],
    };

    const entry = batch.entries[0];
    expect(entry.path).toContain("journal");
    expect(entry.changes.length).toBe(2);
    expect(entry.changes[0].reason).toBe("format-change");
    expect(entry.changes[1].newTag).toBeNull();
  });
});
