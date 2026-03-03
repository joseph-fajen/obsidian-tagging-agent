import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { generateAudit, formatAuditMarkdown, writeAuditJson } from "../lib/audit-generator.js";

let testVaultPath: string;

beforeAll(async () => {
  testVaultPath = await mkdtemp(join(tmpdir(), "audit-test-"));

  // Create test notes with various tag scenarios
  await mkdir(join(testVaultPath, "journal"), { recursive: true });
  await mkdir(join(testVaultPath, "projects"), { recursive: true });

  // Note 1: Frontmatter tags (valid format)
  await writeFile(
    join(testVaultPath, "journal", "day1.md"),
    `---\ntags:\n  - type/daily-note\n  - ai-tools\n---\nSome content here.\n`,
  );

  // Note 2: Inline tags
  await writeFile(
    join(testVaultPath, "journal", "day2.md"),
    `---\ntags: []\n---\nSome text #blockchain and #prompting here.\n`,
  );

  // Note 3: Format issues (uppercase, underscores)
  await writeFile(
    join(testVaultPath, "projects", "alpha.md"),
    `---\ntags:\n  - Project_Alpha\n  - AI-Tools\n---\nProject notes.\n`,
  );

  // Note 4: Noise tags
  await writeFile(
    join(testVaultPath, "projects", "links.md"),
    `# Links\nSee [doc](https://docs.google.com/document#heading=h.abc123)\nAlso #heading and #123\n`,
  );

  // Note 5: No tags
  await writeFile(join(testVaultPath, "projects", "empty.md"), `# Empty\nNo tags.\n`);

  // Note 6: Agent artifact (should be skipped by scopeToNotes)
  await writeFile(
    join(testVaultPath, "_Tag Audit Report.md"),
    `---\ntags:\n  - type/report\n---\n# Audit\n`,
  );

  // Note 7: Templater file (should be skipped)
  await writeFile(
    join(testVaultPath, "template.md"),
    `---\ntags:\n  - <% tp.date.now() %>\n---\nTemplate content.\n`,
  );

  // Note 8: Tags in both frontmatter and inline
  await writeFile(
    join(testVaultPath, "journal", "both.md"),
    `---\ntags:\n  - meditation\n---\nContent with #meditation inline too.\n`,
  );
});

afterAll(async () => {
  await rm(testVaultPath, { recursive: true, force: true });
});

describe("generateAudit", () => {
  test("counts unique tags correctly", async () => {
    const result = await generateAudit(testVaultPath);
    // Should find: type/daily-note, ai-tools, blockchain, prompting, project-alpha (normalized),
    // heading, 123, meditation
    expect(result.stats.uniqueTags).toBeGreaterThanOrEqual(5);
  });

  test("detects format issues", async () => {
    const result = await generateAudit(testVaultPath);
    // Project_Alpha and AI-Tools have format issues
    expect(result.stats.formatIssues).toBeGreaterThanOrEqual(2);

    const alphaIssue = result.data.formatIssues.find(i => i.normalized === "project-alpha");
    expect(alphaIssue).toBeDefined();
    expect(alphaIssue!.issues).toContain("contains underscores");
  });

  test("identifies noise tags", async () => {
    const result = await generateAudit(testVaultPath);
    expect(result.stats.noiseTags).toBeGreaterThanOrEqual(2);

    const headingNoise = result.data.noiseTags.find(n => n.tag === "heading");
    expect(headingNoise).toBeDefined();
  });

  test("skips Templater files", async () => {
    const result = await generateAudit(testVaultPath);
    const templaterWarning = result.warnings.find(w => w.includes("Templater"));
    expect(templaterWarning).toBeDefined();
  });

  test("tracks tag locations correctly", async () => {
    const result = await generateAudit(testVaultPath);

    // meditation appears in both frontmatter and inline in journal/both.md
    const meditation = result.data.tags.find(t => t.normalized === "meditation");
    expect(meditation).toBeDefined();
    expect(meditation!.location).toBe("both");

    // blockchain should be inline only
    const blockchain = result.data.tags.find(t => t.normalized === "blockchain");
    expect(blockchain).toBeDefined();
    expect(blockchain!.location).toBe("inline");

    // type/daily-note should be frontmatter only
    const dailyNote = result.data.tags.find(t => t.normalized === "type/daily-note");
    expect(dailyNote).toBeDefined();
    expect(dailyNote!.location).toBe("frontmatter");
  });

  test("builds tagFrequencies for backward compatibility", async () => {
    const result = await generateAudit(testVaultPath);
    expect(result.data.tagFrequencies).toBeDefined();
    expect(typeof result.data.tagFrequencies).toBe("object");
    // Should have entries
    expect(Object.keys(result.data.tagFrequencies).length).toBeGreaterThan(0);
  });

  test("counts notes with frontmatter and inline tags", async () => {
    const result = await generateAudit(testVaultPath);
    expect(result.data.notesWithFrontmatter).toBeGreaterThanOrEqual(3);
    expect(result.data.notesWithInlineTags).toBeGreaterThanOrEqual(3);
  });

  test("handles empty vault gracefully", async () => {
    const emptyVault = await mkdtemp(join(tmpdir(), "empty-vault-"));
    const result = await generateAudit(emptyVault);
    expect(result.stats.uniqueTags).toBe(0);
    expect(result.stats.notesWithTags).toBe(0);
    expect(result.warnings.length).toBe(0);
    await rm(emptyVault, { recursive: true });
  });

  test("deduplicates case variants under normalized form", async () => {
    const result = await generateAudit(testVaultPath);
    // AI-Tools and ai-tools should be combined under ai-tools
    const aiTools = result.data.tags.find(t => t.normalized === "ai-tools");
    expect(aiTools).toBeDefined();
    // Count should reflect all occurrences
    expect(aiTools!.count).toBeGreaterThanOrEqual(2);
  });
});

describe("formatAuditMarkdown", () => {
  test("produces markdown with frontmatter", async () => {
    const result = await generateAudit(testVaultPath);
    const md = formatAuditMarkdown(result);

    expect(md).toContain("---");
    expect(md).toContain("type/report");
    expect(md).toContain("# Tag Audit Report");
  });

  test("includes executive summary", async () => {
    const result = await generateAudit(testVaultPath);
    const md = formatAuditMarkdown(result);

    expect(md).toContain("## Executive Summary");
    expect(md).toContain("Total notes scanned:");
    expect(md).toContain("Unique tags found:");
  });

  test("includes format issues section when present", async () => {
    const result = await generateAudit(testVaultPath);
    const md = formatAuditMarkdown(result);

    if (result.stats.formatIssues > 0) {
      expect(md).toContain("Format Issues Detected");
      expect(md).toContain("| Tag | Should Be | Issues | Count |");
    }
  });

  test("includes noise tags section when present", async () => {
    const result = await generateAudit(testVaultPath);
    const md = formatAuditMarkdown(result);

    if (result.stats.noiseTags > 0) {
      expect(md).toContain("Noise Tags");
      expect(md).toContain("| Tag | Count |");
    }
  });

  test("includes tag frequency table", async () => {
    const result = await generateAudit(testVaultPath);
    const md = formatAuditMarkdown(result);

    expect(md).toContain("## Tag Frequency");
    expect(md).toContain("| Tag | Count | Location | Format |");
  });

  test("includes next steps", async () => {
    const result = await generateAudit(testVaultPath);
    const md = formatAuditMarkdown(result);

    expect(md).toContain("## Next Steps");
    expect(md).toContain("generate-worklist");
  });

  test("shows valid format check when no issues", async () => {
    // Create a vault with only valid tags
    const cleanVault = await mkdtemp(join(tmpdir(), "clean-vault-"));
    await writeFile(
      join(cleanVault, "note.md"),
      `---\ntags:\n  - ai-tools\n  - blockchain\n---\nClean.\n`,
    );
    const result = await generateAudit(cleanVault);
    const md = formatAuditMarkdown(result);

    expect(md).toContain("Format Validation");
    expect(md).toContain("All tags follow proper lowercase kebab-case format");
    await rm(cleanVault, { recursive: true });
  });
});

describe("writeAuditJson", () => {
  test("writes valid JSON file", async () => {
    const result = await generateAudit(testVaultPath);
    const dataDir = await mkdtemp(join(tmpdir(), "audit-data-"));

    await writeAuditJson(dataDir, result.data);

    const jsonPath = join(dataDir, "audit-data.json");
    const content = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.generatedBy).toBe("deterministic-audit-generator");
    expect(parsed.tagFrequencies).toBeDefined();
    expect(parsed.uniqueTags).toBe(result.stats.uniqueTags);

    await rm(dataDir, { recursive: true });
  });

  test("JSON is compatible with plan phase format", async () => {
    const result = await generateAudit(testVaultPath);
    const dataDir = await mkdtemp(join(tmpdir(), "audit-data-"));

    await writeAuditJson(dataDir, result.data);

    const jsonPath = join(dataDir, "audit-data.json");
    const content = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(content);

    // Required fields for plan phase compatibility
    expect(parsed.generatedAt).toBeDefined();
    expect(parsed.generatedBy).toBeDefined();
    expect(parsed.totalNotes).toBeDefined();
    expect(parsed.totalTaggedNotes).toBeDefined();
    expect(parsed.uniqueTags).toBeDefined();
    expect(parsed.tagFrequencies).toBeDefined();

    // tagFrequencies should be Record<string, number>
    for (const [tag, count] of Object.entries(parsed.tagFrequencies)) {
      expect(typeof tag).toBe("string");
      expect(typeof count).toBe("number");
    }

    await rm(dataDir, { recursive: true });
  });
});
