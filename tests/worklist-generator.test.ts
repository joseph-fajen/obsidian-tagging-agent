import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { generateWorklist, loadMappings, loadAuditMappings, formatWorklistMarkdown, writeWorklistJson } from "../lib/worklist-generator.js";

let testVaultPath: string;
let testDataPath: string;

beforeAll(async () => {
  testVaultPath = await mkdtemp(join(tmpdir(), "worklist-test-"));
  testDataPath = await mkdtemp(join(tmpdir(), "worklist-data-"));

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

  // Note 8: File with Templater in body but valid frontmatter (should be processed)
  await writeFile(
    join(testVaultPath, "journal", "daily-with-cursor.md"),
    `---
created: '2025-01-31 09:35'
tags:
  - daily-reflection
---
# Daily Note

Some content here
- <% tp.file.cursor() %>
`,
  );

  // Note 9: File with Templater in frontmatter (should be skipped)
  await mkdir(join(testVaultPath, "templates"), { recursive: true });
  await writeFile(
    join(testVaultPath, "templates", "templater-frontmatter.md"),
    `---
created: '<% tp.date.now("YYYY-MM-DD") %>'
tags:
  - template
---
# Template

This is a template.
`,
  );
});

afterAll(async () => {
  await rm(testVaultPath, { recursive: true, force: true });
  await rm(testDataPath, { recursive: true, force: true });
});

// Test mappings that simulate what plan-mappings.json would provide
const testMappings = {
  mappings: {
    "daily-reflection": "type/daily-note",
    "todo": "status/pending",
    "meeting-notes": "type/meeting",
    "research": "type/research",
  }
};

describe("generateWorklist", () => {
  test("produces correct worklist for test vault", async () => {
    const result = await generateWorklist(testVaultPath, testMappings);

    // Should scan all non-artifact notes
    // Notes: day1, day2, links, valid, empty, unknown, daily-with-cursor = 7
    // Plus templater-frontmatter which is scanned but skipped due to Templater in frontmatter = 8
    expect(result.stats.totalNotesScanned).toBe(8); // excludes _Tag Audit Report.md

    // Notes with changes: day1 (2 mappings), day2 (2 mappings), links (noise removal), daily-with-cursor (1 mapping)
    expect(result.stats.notesWithChanges).toBeGreaterThanOrEqual(3);

    // Valid note should NOT appear in worklist
    const validEntry = result.worklist.worklist.find(
      (w) => w.path === join("projects", "valid.md"),
    );
    expect(validEntry).toBeUndefined();
  });

  test("maps known tags correctly with provided mappings", async () => {
    const result = await generateWorklist(testVaultPath, testMappings);
    const day1 = result.worklist.worklist.find(
      (w) => w.path === join("journal", "day1.md"),
    );
    expect(day1).toBeDefined();
    expect(day1!.changes).toContainEqual({ oldTag: "daily-reflection", newTag: "type/daily-note", reason: "format-change" });
    expect(day1!.changes).toContainEqual({ oldTag: "todo", newTag: "status/pending", reason: "format-change" });
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

  test("processes files with Templater in body but valid frontmatter", async () => {
    const result = await generateWorklist(testVaultPath, testMappings);
    // Should find the daily note with cursor placeholder in body
    const dailyNote = result.worklist.worklist.find(
      (w) => w.path === join("journal", "daily-with-cursor.md"),
    );
    expect(dailyNote).toBeDefined();
    expect(dailyNote!.changes).toContainEqual({ oldTag: "daily-reflection", newTag: "type/daily-note", reason: "format-change" });
  });

  test("skips files with Templater in frontmatter", async () => {
    const result = await generateWorklist(testVaultPath);
    // Should NOT find the template file with Templater in frontmatter
    const templateNote = result.worklist.worklist.find(
      (w) => w.path === join("templates", "templater-frontmatter.md"),
    );
    expect(templateNote).toBeUndefined();
    // Should have a warning about skipping it
    const skippedWarning = result.warnings.find((w) => w.includes("templater-frontmatter.md"));
    expect(skippedWarning).toBeDefined();
    expect(skippedWarning).toContain("Templater syntax in frontmatter");
  });

  test("uses audit mappings as fallback", async () => {
    const auditMappings = { mappings: { "tag.with.dots": "type/mystery" } };
    const result = await generateWorklist(testVaultPath, auditMappings);

    // Should now map tag.with.dots instead of flagging as unmapped
    const unknown = result.worklist.worklist.find(
      (w) => w.path === join("projects", "unknown.md"),
    );
    expect(unknown).toBeDefined();
    expect(unknown!.changes).toContainEqual({ oldTag: "tag.with.dots", newTag: "type/mystery", reason: "format-change" });

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

describe("loadMappings", () => {
  test("returns undefined when no files exist", async () => {
    const result = await loadMappings(testDataPath, testVaultPath);
    expect(result).toBeUndefined();
  });

  test("loads mappings from audit-data.json in data/", async () => {
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify({ mappings: { "custom": "type/custom" } }),
    );
    const result = await loadMappings(testDataPath, testVaultPath);
    expect(result).toBeDefined();
    expect(result!.mappings["custom"]).toBe("type/custom");
    // Clean up
    await rm(join(testDataPath, "audit-data.json"));
  });

  test("loads mappings from vault (fallback location)", async () => {
    await writeFile(
      join(testVaultPath, "_Tag Audit Data.json"),
      JSON.stringify({ mappings: { "vault-custom": "type/vault" } }),
    );
    const result = await loadMappings(testDataPath, testVaultPath);
    expect(result).toBeDefined();
    expect(result!.mappings["vault-custom"]).toBe("type/vault");
    // Clean up
    await rm(join(testVaultPath, "_Tag Audit Data.json"));
  });

  test("plan-mappings.json takes priority over audit-data.json", async () => {
    // Create both files with different mappings for same tag
    await writeFile(
      join(testDataPath, "plan-mappings.json"),
      JSON.stringify({ mappings: { "test-tag": "plan-value" } }),
    );
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify({ mappings: { "test-tag": "audit-value" } }),
    );

    const result = await loadMappings(testDataPath, testVaultPath);
    expect(result).toBeDefined();
    expect(result!.mappings["test-tag"]).toBe("plan-value"); // plan wins

    // Clean up
    await rm(join(testDataPath, "plan-mappings.json"));
    await rm(join(testDataPath, "audit-data.json"));
  });

  test("merges plan-mappings with audit-data (plan takes priority)", async () => {
    // Create plan with one mapping, audit with another
    await writeFile(
      join(testDataPath, "plan-mappings.json"),
      JSON.stringify({ mappings: { "from-plan": "plan-value" } }),
    );
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify({ mappings: { "from-audit": "audit-value" } }),
    );

    const result = await loadMappings(testDataPath, testVaultPath);
    expect(result).toBeDefined();
    expect(result!.mappings["from-plan"]).toBe("plan-value");
    expect(result!.mappings["from-audit"]).toBe("audit-value");

    // Clean up
    await rm(join(testDataPath, "plan-mappings.json"));
    await rm(join(testDataPath, "audit-data.json"));
  });

  test("extracts mappings from consolidationOpportunities format", async () => {
    // Create audit-data.json with alternative format (consolidationOpportunities)
    const auditData = {
      generatedAt: new Date().toISOString(),
      consolidationOpportunities: {
        highPriority: [
          {
            category: "Daily Note Variants",
            targetTag: "type/daily-note",
            currentTags: ["daily-note", "daily-notes", "daily_log", "daily-reflection"],
          },
        ],
        mediumPriority: [
          {
            category: "Project References",
            migrationMap: {
              "blockfrost-current-work": "project/blockfrost",
              "partner-chains-docs": "project/partner-chains",
            },
          },
        ],
      },
    };
    await writeFile(
      join(testDataPath, "audit-data.json"),
      JSON.stringify(auditData, null, 2)
    );

    const result = await loadMappings(testDataPath, testVaultPath);
    expect(result).toBeDefined();

    // Should extract from migrationMap
    expect(result!.mappings["blockfrost-current-work"]).toBe("project/blockfrost");
    expect(result!.mappings["partner-chains-docs"]).toBe("project/partner-chains");

    // Should extract from targetTag + currentTags
    // All tags in currentTags (including "daily-note") should map to targetTag
    expect(result!.mappings["daily-note"]).toBe("type/daily-note");
    expect(result!.mappings["daily-notes"]).toBe("type/daily-note");
    expect(result!.mappings["daily_log"]).toBe("type/daily-note");
    expect(result!.mappings["daily-reflection"]).toBe("type/daily-note");

    // Clean up
    await rm(join(testDataPath, "audit-data.json"));
  });

  test("loadAuditMappings is alias for loadMappings", async () => {
    // loadAuditMappings should be the same function as loadMappings
    expect(loadAuditMappings).toBe(loadMappings);
  });
});

describe("formatWorklistMarkdown", () => {
  test("produces markdown WITHOUT embedded JSON (now external)", async () => {
    const result = await generateWorklist(testVaultPath);
    const md = formatWorklistMarkdown(result);
    // Should NOT contain JSON block anymore
    expect(md).not.toContain("```json");
    // Should reference the external file
    expect(md).toContain("data/migration-worklist.json");
    expect(md).toContain("deterministic code");
    expect(md).toContain("Obsidian indexing issues");
  });

  test("includes unmapped tags table when present", async () => {
    const result = await generateWorklist(testVaultPath);
    const md = formatWorklistMarkdown(result);
    if (result.worklist.unmappedTags.length > 0) {
      expect(md).toContain("Unmapped Tags Requiring Decisions");
    }
  });
});

describe("inline tag migration", () => {
  test("generates change for inline-only valid tag", async () => {
    // Create a note with a valid tag only in the body (not frontmatter)
    const testDir = await mkdtemp(join(tmpdir(), "worklist-inline-"));
    const notePath = join(testDir, "inline-only.md");
    await writeFile(notePath, `---
tags: []
---
# Note with inline tag

This note has #ai-tools inline but not in frontmatter.
`, "utf-8");

    const result = await generateWorklist(testDir);

    expect(result.worklist.worklist.length).toBe(1);
    expect(result.worklist.worklist[0].changes).toContainEqual({
      oldTag: "ai-tools",
      newTag: "ai-tools",
      reason: "inline-migration",
    });
    expect(result.stats.inlineMigrations).toBe(1);

    await rm(testDir, { recursive: true });
  });

  test("does NOT generate change for frontmatter-only valid tag", async () => {
    // Create a note with a valid tag only in frontmatter (not inline)
    const testDir = await mkdtemp(join(tmpdir(), "worklist-fm-"));
    const notePath = join(testDir, "frontmatter-only.md");
    await writeFile(notePath, `---
tags:
  - ai-tools
---
# Note with frontmatter tag

This note has no inline tags.
`, "utf-8");

    const result = await generateWorklist(testDir);

    // Should have no changes — tag is already in frontmatter with valid format
    expect(result.worklist.worklist.length).toBe(0);
    expect(result.stats.inlineMigrations).toBe(0);

    await rm(testDir, { recursive: true });
  });

  test("generates change for tag in both locations (cleans up inline)", async () => {
    // Create a note with the same tag in both frontmatter AND inline
    const testDir = await mkdtemp(join(tmpdir(), "worklist-both-"));
    const notePath = join(testDir, "both-locations.md");
    await writeFile(notePath, `---
tags:
  - ai-tools
---
# Note with tag in both places

This note has #ai-tools inline AND in frontmatter.
`, "utf-8");

    const result = await generateWorklist(testDir);

    // Should generate a change to clean up the inline occurrence
    expect(result.worklist.worklist.length).toBe(1);
    expect(result.worklist.worklist[0].changes).toContainEqual({
      oldTag: "ai-tools",
      newTag: "ai-tools",
      reason: "inline-migration",
    });
    expect(result.stats.inlineMigrations).toBe(1);

    await rm(testDir, { recursive: true });
  });

  test("tracks inline migrations separately from format changes", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "worklist-mixed-"));
    const notePath = join(testDir, "mixed-changes.md");
    await writeFile(notePath, `---
tags: []
---
# Mixed changes

Has #ai-tools (valid inline) and #daily-reflection (needs mapping).
`, "utf-8");

    // Provide mappings for daily-reflection
    const localMappings = { mappings: { "daily-reflection": "type/daily-note" } };
    const result = await generateWorklist(testDir, localMappings);

    expect(result.worklist.worklist.length).toBe(1);
    const changes = result.worklist.worklist[0].changes;

    // Should have both types of changes
    const inlineMigration = changes.find(c => c.reason === "inline-migration");
    const formatChange = changes.find(c => c.reason === "format-change");

    expect(inlineMigration).toBeDefined();
    expect(inlineMigration?.oldTag).toBe("ai-tools");
    expect(inlineMigration?.newTag).toBe("ai-tools");

    expect(formatChange).toBeDefined();
    expect(formatChange?.oldTag).toBe("daily-reflection");
    expect(formatChange?.newTag).toBe("type/daily-note");

    expect(result.stats.inlineMigrations).toBe(1);
    expect(result.stats.totalChanges).toBe(2);

    await rm(testDir, { recursive: true });
  });
});

describe("writeWorklistJson", () => {
  test("writes valid JSON file to data/ directory", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "worklist-json-"));
    const testData = await mkdtemp(join(tmpdir(), "worklist-json-data-"));

    // Create a minimal test note so worklist has content
    await writeFile(
      join(testDir, "test.md"),
      `---\ntags:\n  - todo\n---\nTest note.\n`,
    );
    const localMappings = { mappings: { "todo": "status/pending" } };
    const result = await generateWorklist(testDir, localMappings);

    // Write the JSON file to dataPath
    await writeWorklistJson(testData, result.worklist);

    // Verify file exists in data/ directory (new location)
    const jsonPath = join(testData, "migration-worklist.json");
    const content = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.totalNotes).toBe(result.worklist.totalNotes);
    expect(parsed.worklist).toBeInstanceOf(Array);
    expect(parsed.generatedBy).toBe("deterministic-worklist-generator");

    await rm(testDir, { recursive: true });
    await rm(testData, { recursive: true });
  });

  test("JSON file contains all required fields", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "worklist-json-fields-"));
    const testData = await mkdtemp(join(tmpdir(), "worklist-json-fields-data-"));

    await writeFile(
      join(testDir, "note.md"),
      `---\ntags:\n  - meeting-notes\n---\nMeeting content.\n`,
    );
    const localMappings = { mappings: { "meeting-notes": "type/meeting" } };
    const result = await generateWorklist(testDir, localMappings);
    await writeWorklistJson(testData, result.worklist);

    const jsonPath = join(testData, "migration-worklist.json");
    const content = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(content);

    // Verify all MigrationWorklist fields are present
    expect(parsed).toHaveProperty("generatedAt");
    expect(parsed).toHaveProperty("schemeVersion");
    expect(parsed).toHaveProperty("generatedBy");
    expect(parsed).toHaveProperty("totalNotes");
    expect(parsed).toHaveProperty("totalChanges");
    expect(parsed).toHaveProperty("worklist");
    expect(parsed).toHaveProperty("unmappedTags");

    await rm(testDir, { recursive: true });
    await rm(testData, { recursive: true });
  });

  test("worklist entries have correct structure", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "worklist-json-entries-"));
    const testData = await mkdtemp(join(tmpdir(), "worklist-json-entries-data-"));

    await writeFile(
      join(testDir, "note.md"),
      `---\ntags:\n  - daily-reflection\n---\nDaily note.\n`,
    );
    const localMappings = { mappings: { "daily-reflection": "type/daily-note" } };
    const result = await generateWorklist(testDir, localMappings);
    await writeWorklistJson(testData, result.worklist);

    const jsonPath = join(testData, "migration-worklist.json");
    const content = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.worklist.length).toBe(1);
    const entry = parsed.worklist[0];
    expect(entry).toHaveProperty("path");
    expect(entry).toHaveProperty("changes");
    expect(entry.changes[0]).toHaveProperty("oldTag");
    expect(entry.changes[0]).toHaveProperty("newTag");

    await rm(testDir, { recursive: true });
    await rm(testData, { recursive: true });
  });
});
