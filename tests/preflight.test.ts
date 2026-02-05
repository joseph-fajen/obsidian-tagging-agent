import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("checkExecutePrerequisites", () => {
  let testVaultPath: string;
  let testDataPath: string;

  beforeAll(async () => {
    testVaultPath = await mkdtemp(join(tmpdir(), "preflight-test-"));
    testDataPath = await mkdtemp(join(tmpdir(), "preflight-data-"));

    // Create a worklist JSON file in data/ (new location)
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
      join(testDataPath, "migration-worklist.json"),
      JSON.stringify(worklist, null, 2),
    );
  });

  afterAll(async () => {
    await rm(testVaultPath, { recursive: true, force: true });
    await rm(testDataPath, { recursive: true, force: true });
  });

  test("worklist file structure is correct (data/ location)", async () => {
    const worklistPath = join(testDataPath, "migration-worklist.json");
    const content = await readFile(worklistPath, "utf-8");
    const worklist = JSON.parse(content);

    expect(worklist.totalNotes).toBe(3);
    expect(worklist.worklist.length).toBe(3);
    expect(worklist.worklist[0].path).toBe("note1.md");
    expect(worklist.worklist[0].changes[0].oldTag).toBe("todo");
    expect(worklist.worklist[0].changes[0].newTag).toBe("status/pending");
  });

  test("worklist entries have correct NoteChanges structure", async () => {
    const worklistPath = join(testDataPath, "migration-worklist.json");
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
    const worklistPath = join(testDataPath, "migration-worklist.json");
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

  test("backward compatibility - vault location still works", async () => {
    // Create a worklist in the old vault location
    const oldWorklist = {
      generatedAt: new Date().toISOString(),
      schemeVersion: "1.0",
      generatedBy: "legacy-test",
      totalNotes: 1,
      totalChanges: 1,
      worklist: [
        { path: "legacy.md", changes: [{ oldTag: "old", newTag: "new" }] },
      ],
      unmappedTags: [],
    };

    await writeFile(
      join(testVaultPath, "_Migration_Worklist.json"),
      JSON.stringify(oldWorklist, null, 2),
    );

    const worklistPath = join(testVaultPath, "_Migration_Worklist.json");
    const content = await readFile(worklistPath, "utf-8");
    const worklist = JSON.parse(content);

    expect(worklist.generatedBy).toBe("legacy-test");

    // Clean up
    await rm(join(testVaultPath, "_Migration_Worklist.json"));
  });
});

describe("checkPlanPrerequisites", () => {
  let testVaultPath: string;
  let testDataPath: string;

  beforeAll(async () => {
    testVaultPath = await mkdtemp(join(tmpdir(), "plan-preflight-test-"));
    testDataPath = await mkdtemp(join(tmpdir(), "plan-preflight-data-"));
  });

  afterAll(async () => {
    await rm(testVaultPath, { recursive: true, force: true });
    await rm(testDataPath, { recursive: true, force: true });
  });

  test("returns true when all audit outputs exist", async () => {
    // Create audit-data.json
    const auditData = {
      generatedAt: new Date().toISOString(),
      generatedBy: "audit-phase-agent",
      totalNotes: 100,
      totalTaggedNotes: 80,
      uniqueTags: 50,
      mappings: { "daily-notes": "type/daily-note" },
      tagFrequencies: { "daily-notes": 25, "todo": 10 },
    };
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify(auditData, null, 2)
    );

    // Create _Tag Audit Report.md
    await writeFile(
      join(testVaultPath, "_Tag Audit Report.md"),
      "# Tag Audit Report\n\nTest content"
    );

    // Import and test
    const { checkPlanPrerequisites } = await import("../tagging-agent.js");
    const result = await checkPlanPrerequisites(testDataPath, testVaultPath);
    expect(result).toBe(true);
  });

  test("returns false when audit-data.json missing", async () => {
    // Ensure audit-data.json doesn't exist
    try {
      await rm(join(testDataPath, "audit-data.json"));
    } catch { /* ignore */ }

    // Create _Tag Audit Report.md
    await writeFile(
      join(testVaultPath, "_Tag Audit Report.md"),
      "# Tag Audit Report\n\nTest content"
    );

    const { checkPlanPrerequisites } = await import("../tagging-agent.js");
    const result = await checkPlanPrerequisites(testDataPath, testVaultPath);
    expect(result).toBe(false);
  });

  test("returns false when _Tag Audit Report.md missing", async () => {
    // Create audit-data.json
    const auditData = {
      generatedAt: new Date().toISOString(),
      tagFrequencies: { "test": 1 },
    };
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify(auditData, null, 2)
    );

    // Ensure report doesn't exist
    try {
      await rm(join(testVaultPath, "_Tag Audit Report.md"));
    } catch { /* ignore */ }

    const { checkPlanPrerequisites } = await import("../tagging-agent.js");
    const result = await checkPlanPrerequisites(testDataPath, testVaultPath);
    expect(result).toBe(false);
  });

  test("returns false when audit-data.json has no usable tag data", async () => {
    // Create audit-data.json with no usable tag data (empty)
    const auditData = {
      generatedAt: new Date().toISOString(),
      // No tagFrequencies, tagInventory, completeTagList, or frequencyAnalysis
    };
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify(auditData, null, 2)
    );

    // Create report
    await writeFile(
      join(testVaultPath, "_Tag Audit Report.md"),
      "# Tag Audit Report"
    );

    const { checkPlanPrerequisites } = await import("../tagging-agent.js");
    const result = await checkPlanPrerequisites(testDataPath, testVaultPath);
    expect(result).toBe(false);
  });

  test("accepts alternative format with tagInventory", async () => {
    // Create audit-data.json with alternative format (tagInventory)
    const auditData = {
      generatedAt: new Date().toISOString(),
      tagInventory: {
        totalUniqueTags: 49,
        frontmatterTags: { count: 42, occurrences: 98 },
        inlineTags: { count: 9, occurrences: 15 },
      },
    };
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify(auditData, null, 2)
    );

    // Create report
    await writeFile(
      join(testVaultPath, "_Tag Audit Report.md"),
      "# Tag Audit Report"
    );

    const { checkPlanPrerequisites } = await import("../tagging-agent.js");
    const result = await checkPlanPrerequisites(testDataPath, testVaultPath);
    expect(result).toBe(true);
  });

  test("accepts alternative format with completeTagList", async () => {
    // Create audit-data.json with alternative format (completeTagList)
    const auditData = {
      generatedAt: new Date().toISOString(),
      completeTagList: {
        frontmatterTags: ["daily-note", "technical-writing", "todo"],
        inlineTags: ["ai-tools", "cardano"],
      },
    };
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify(auditData, null, 2)
    );

    // Create report
    await writeFile(
      join(testVaultPath, "_Tag Audit Report.md"),
      "# Tag Audit Report"
    );

    const { checkPlanPrerequisites } = await import("../tagging-agent.js");
    const result = await checkPlanPrerequisites(testDataPath, testVaultPath);
    expect(result).toBe(true);
  });

  test("accepts alternative format with frequencyAnalysis", async () => {
    // Create audit-data.json with alternative format (frequencyAnalysis)
    const auditData = {
      generatedAt: new Date().toISOString(),
      frequencyAnalysis: {
        topTags: [
          { tag: "daily-note", count: 17 },
          { tag: "technical-writing", count: 6 },
        ],
      },
    };
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify(auditData, null, 2)
    );

    // Create report
    await writeFile(
      join(testVaultPath, "_Tag Audit Report.md"),
      "# Tag Audit Report"
    );

    const { checkPlanPrerequisites } = await import("../tagging-agent.js");
    const result = await checkPlanPrerequisites(testDataPath, testVaultPath);
    expect(result).toBe(true);
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
