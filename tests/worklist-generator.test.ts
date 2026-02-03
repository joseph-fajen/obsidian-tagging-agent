import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { generateWorklist, loadAuditMappings, formatWorklistMarkdown } from "../lib/worklist-generator.js";

let testVaultPath: string;

beforeAll(async () => {
  testVaultPath = await mkdtemp(join(tmpdir(), "worklist-test-"));

  // Create test notes with various tag scenarios
  await mkdir(join(testVaultPath, "journal"), { recursive: true });
  await mkdir(join(testVaultPath, "projects"), { recursive: true });

  // Note 1: Frontmatter tags needing mapping
  await writeFile(
    join(testVaultPath, "journal", "day1.md"),
    `---\ntags:\n  - daily-reflection\n  - todo\n---\nSome content here.\n`,
  );

  // Note 2: Inline tags needing mapping
  await writeFile(
    join(testVaultPath, "journal", "day2.md"),
    `---\ntags: []\n---\nSome text #meeting-notes and #research here.\n`,
  );

  // Note 3: Noise tags to remove
  await writeFile(
    join(testVaultPath, "projects", "links.md"),
    `# Links\nSee [doc](https://docs.google.com/document#heading=h.abc123)\nAlso #heading and #1\n`,
  );

  // Note 4: Already valid tags (no changes needed)
  await writeFile(
    join(testVaultPath, "projects", "valid.md"),
    `---\ntags:\n  - ai-tools\n  - blockchain\n---\nAll good here.\n`,
  );

  // Note 5: No tags at all
  await writeFile(join(testVaultPath, "projects", "empty.md"), `# Empty\nNo tags.\n`);

  // Note 6: Unmapped tag
  await writeFile(
    join(testVaultPath, "projects", "unknown.md"),
    `---\ntags:\n  - tag.with.dots\n---\nUnknown.\n`,
  );

  // Note 7: Agent artifact (should be skipped)
  await writeFile(
    join(testVaultPath, "_Tag Audit Report.md"),
    `---\ntags:\n  - type/report\n---\n# Audit\n`,
  );
});

afterAll(async () => {
  await rm(testVaultPath, { recursive: true, force: true });
});

describe("generateWorklist", () => {
  test("produces correct worklist for test vault", async () => {
    const result = await generateWorklist(testVaultPath);

    // Should scan all non-artifact notes
    expect(result.stats.totalNotesScanned).toBe(6); // excludes _Tag Audit Report.md

    // Notes with changes: day1 (2 mappings), day2 (2 mappings), links (noise removal)
    expect(result.stats.notesWithChanges).toBeGreaterThanOrEqual(3);

    // Valid note should NOT appear in worklist
    const validEntry = result.worklist.worklist.find(
      (w) => w.path === join("projects", "valid.md"),
    );
    expect(validEntry).toBeUndefined();
  });

  test("maps known tags correctly", async () => {
    const result = await generateWorklist(testVaultPath);
    const day1 = result.worklist.worklist.find(
      (w) => w.path === join("journal", "day1.md"),
    );
    expect(day1).toBeDefined();
    expect(day1!.changes).toContainEqual({ oldTag: "daily-reflection", newTag: "type/daily-note" });
    expect(day1!.changes).toContainEqual({ oldTag: "todo", newTag: "status/pending" });
  });

  test("removes noise tags", async () => {
    const result = await generateWorklist(testVaultPath);
    const links = result.worklist.worklist.find(
      (w) => w.path === join("projects", "links.md"),
    );
    expect(links).toBeDefined();
    const headingChange = links!.changes.find((c) => c.oldTag === "heading");
    expect(headingChange).toBeDefined();
    expect(headingChange!.newTag).toBeNull();
  });

  test("tracks unmapped tags", async () => {
    const result = await generateWorklist(testVaultPath);
    const unmapped = result.worklist.unmappedTags.find((u) => u.tag === "tag.with.dots");
    expect(unmapped).toBeDefined();
    expect(unmapped!.occurrences).toBe(1);
  });

  test("skips agent artifact notes", async () => {
    const result = await generateWorklist(testVaultPath);
    const artifactEntry = result.worklist.worklist.find(
      (w) => w.path === "_Tag Audit Report.md",
    );
    expect(artifactEntry).toBeUndefined();
  });

  test("uses audit mappings as fallback", async () => {
    const auditMappings = { mappings: { "tag.with.dots": "type/mystery" } };
    const result = await generateWorklist(testVaultPath, auditMappings);

    // Should now map tag.with.dots instead of flagging as unmapped
    const unknown = result.worklist.worklist.find(
      (w) => w.path === join("projects", "unknown.md"),
    );
    expect(unknown).toBeDefined();
    expect(unknown!.changes).toContainEqual({ oldTag: "tag.with.dots", newTag: "type/mystery" });

    // Should not appear in unmapped list
    const unmapped = result.worklist.unmappedTags.find((u) => u.tag === "tag.with.dots");
    expect(unmapped).toBeUndefined();
  });

  test("worklist totalNotes matches worklist array length", async () => {
    const result = await generateWorklist(testVaultPath);
    expect(result.worklist.totalNotes).toBe(result.worklist.worklist.length);
  });

  test("worklist totalChanges matches sum of all changes", async () => {
    const result = await generateWorklist(testVaultPath);
    const sum = result.worklist.worklist.reduce((acc, n) => acc + n.changes.length, 0);
    expect(result.worklist.totalChanges).toBe(sum);
  });
});

describe("loadAuditMappings", () => {
  test("returns undefined when file doesn't exist", async () => {
    const result = await loadAuditMappings(testVaultPath);
    expect(result).toBeUndefined();
  });

  test("loads valid audit mappings file", async () => {
    await writeFile(
      join(testVaultPath, "_Tag Audit Data.json"),
      JSON.stringify({ mappings: { "custom": "type/custom" } }),
    );
    const result = await loadAuditMappings(testVaultPath);
    expect(result).toBeDefined();
    expect(result!.mappings["custom"]).toBe("type/custom");
    // Clean up
    await rm(join(testVaultPath, "_Tag Audit Data.json"));
  });
});

describe("formatWorklistMarkdown", () => {
  test("produces markdown with JSON code block", async () => {
    const result = await generateWorklist(testVaultPath);
    const md = formatWorklistMarkdown(result);
    expect(md).toContain("```json");
    expect(md).toContain('"worklist"');
    expect(md).toContain("deterministic code");
  });

  test("includes unmapped tags table when present", async () => {
    const result = await generateWorklist(testVaultPath);
    const md = formatWorklistMarkdown(result);
    if (result.worklist.unmappedTags.length > 0) {
      expect(md).toContain("Unmapped Tags Requiring Decisions");
    }
  });
});
