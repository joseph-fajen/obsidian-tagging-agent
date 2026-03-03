import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { generateVerify, formatVerifyMarkdown, writeVerifyJson } from "../lib/verify-generator.js";

let testVaultPath: string;

beforeAll(async () => {
  testVaultPath = await mkdtemp(join(tmpdir(), "verify-test-"));

  // Create test notes with various compliance states
  await mkdir(join(testVaultPath, "journal"), { recursive: true });
  await mkdir(join(testVaultPath, "projects"), { recursive: true });

  // Note 1: Fully compliant (valid prefixed and flat tags)
  await writeFile(
    join(testVaultPath, "journal", "compliant.md"),
    `---
tags:
  - type/daily-note
  - area/career
  - ai-tools
  - blockchain
---
Clean content with no inline tags.
`,
  );

  // Note 2: Inline tags (violation)
  await writeFile(
    join(testVaultPath, "journal", "inline-tags.md"),
    `---
tags:
  - type/daily-note
---
Some text with #inline-tag and #another-inline here.
`,
  );

  // Note 3: Hash prefix in frontmatter (violation)
  await writeFile(
    join(testVaultPath, "journal", "hash-prefix.md"),
    `---
tags:
  - "#invalid-prefix"
  - type/meeting
---
Content here.
`,
  );

  // Note 4: Invalid format (uppercase, underscores)
  await writeFile(
    join(testVaultPath, "projects", "invalid-format.md"),
    `---
tags:
  - Project_Alpha
  - AI-Tools
  - TYPE/Meeting
---
Project notes.
`,
  );

  // Note 5: Duplicate tags (violation)
  await writeFile(
    join(testVaultPath, "projects", "duplicates.md"),
    `---
tags:
  - ai-tools
  - AI-Tools
  - blockchain
---
Content with duplicate tags.
`,
  );

  // Note 6: Noise tags remaining (violation)
  await writeFile(
    join(testVaultPath, "projects", "noise.md"),
    `---
tags:
  - heading
  - "123"
  - type/research
---
Content with noise tags.
`,
  );

  // Note 7: Multiple violations in one note
  await writeFile(
    join(testVaultPath, "projects", "multi-violation.md"),
    `---
tags:
  - "#hash-prefix"
  - Project_Name
  - heading
---
Content with #inline-tag here.
`,
  );

  // Note 8: No tags at all (should be compliant)
  await writeFile(
    join(testVaultPath, "journal", "no-tags.md"),
    `---
title: No Tags
---
This note has no tags at all.
`,
  );

  // Note 9: Empty tags array (should be compliant)
  await writeFile(
    join(testVaultPath, "journal", "empty-tags.md"),
    `---
tags: []
---
Empty tags array.
`,
  );

  // Note 10: Agent artifact (should be excluded from scan)
  await writeFile(
    join(testVaultPath, "_Tag Audit Report.md"),
    `---
tags:
  - type/report
---
# Audit Report
This should be excluded.
`,
  );

  // Note 11: Templater file (should be skipped)
  await writeFile(
    join(testVaultPath, "template.md"),
    `---
tags:
  - <% tp.date.now() %>
---
Template content.
`,
  );

  // Note 12: Tags in code blocks (should NOT be flagged as inline)
  await writeFile(
    join(testVaultPath, "journal", "code-blocks.md"),
    `---
tags:
  - type/research
---
Here's some code:

\`\`\`javascript
const tag = "#not-a-real-tag";
console.log(tag);
\`\`\`

And inline code: \`#also-not-a-tag\`
`,
  );

  // Note 13: URL with hash anchor (should NOT be flagged)
  await writeFile(
    join(testVaultPath, "journal", "urls.md"),
    `---
tags:
  - type/reference
---
Check this link: [docs](https://example.com/page#section)
And another: https://docs.google.com/document#heading=h.abc123
`,
  );
});

afterAll(async () => {
  await rm(testVaultPath, { recursive: true, force: true });
});

describe("generateVerify", () => {
  test("identifies compliant notes correctly", async () => {
    const result = await generateVerify(testVaultPath);
    // compliant.md, no-tags.md, empty-tags.md, code-blocks.md, urls.md should be compliant
    expect(result.stats.notesCompliant).toBeGreaterThanOrEqual(5);
  });

  test("detects inline tags", async () => {
    const result = await generateVerify(testVaultPath);
    expect(result.stats.inlineTagViolations).toBeGreaterThanOrEqual(2);

    const inlineViolation = result.data.violations.find(v => v.path.includes("inline-tags.md"));
    expect(inlineViolation).toBeDefined();
    expect(inlineViolation!.inlineTags.length).toBeGreaterThan(0);
  });

  test("detects hash prefix in frontmatter", async () => {
    const result = await generateVerify(testVaultPath);
    expect(result.stats.hashPrefixViolations).toBeGreaterThanOrEqual(1);

    const hashViolation = result.data.violations.find(v => v.path.includes("hash-prefix.md"));
    expect(hashViolation).toBeDefined();
    expect(hashViolation!.hashPrefixTags.length).toBeGreaterThan(0);
  });

  test("detects invalid format tags", async () => {
    const result = await generateVerify(testVaultPath);
    expect(result.stats.formatViolations).toBeGreaterThanOrEqual(1);

    const formatViolation = result.data.violations.find(v => v.path.includes("invalid-format.md"));
    expect(formatViolation).toBeDefined();
    expect(formatViolation!.invalidFormatTags.length).toBeGreaterThan(0);
  });

  test("detects duplicate tags", async () => {
    const result = await generateVerify(testVaultPath);
    expect(result.stats.duplicateViolations).toBeGreaterThanOrEqual(1);

    const dupViolation = result.data.violations.find(v => v.path.includes("duplicates.md"));
    expect(dupViolation).toBeDefined();
    expect(dupViolation!.duplicateTags.length).toBeGreaterThan(0);
  });

  test("detects noise tags", async () => {
    const result = await generateVerify(testVaultPath);
    expect(result.stats.noiseTagViolations).toBeGreaterThanOrEqual(1);

    const noiseViolation = result.data.violations.find(v => v.path.includes("noise.md"));
    expect(noiseViolation).toBeDefined();
    expect(noiseViolation!.noiseTags.length).toBeGreaterThan(0);
  });

  test("detects multiple violations in single note", async () => {
    const result = await generateVerify(testVaultPath);

    const multiViolation = result.data.violations.find(v => v.path.includes("multi-violation.md"));
    expect(multiViolation).toBeDefined();

    // Should have hash prefix, invalid format, inline tags, and noise
    const violationTypes = [
      multiViolation!.hashPrefixTags.length > 0,
      multiViolation!.invalidFormatTags.length > 0,
      multiViolation!.inlineTags.length > 0,
      multiViolation!.noiseTags.length > 0,
    ].filter(Boolean).length;

    expect(violationTypes).toBeGreaterThanOrEqual(3);
  });

  test("excludes agent artifacts from scan", async () => {
    const result = await generateVerify(testVaultPath);

    // Should NOT find _Tag Audit Report.md in violations or compliant count
    const artifactViolation = result.data.violations.find(v => v.path.includes("_Tag Audit"));
    expect(artifactViolation).toBeUndefined();

    // Total notes should not include the artifact
    // We have 13 notes created, minus 1 artifact = 12 scanned
    // But Templater file is skipped, so 11 actually verified
    expect(result.stats.totalNotesScanned).toBeLessThanOrEqual(12);
  });

  test("skips Templater files", async () => {
    const result = await generateVerify(testVaultPath);
    const templaterWarning = result.warnings.find(w => w.includes("Templater"));
    expect(templaterWarning).toBeDefined();
    expect(result.stats.notesSkipped).toBeGreaterThanOrEqual(1);
  });

  test("does not flag tags in code blocks as inline", async () => {
    const result = await generateVerify(testVaultPath);

    // code-blocks.md should be compliant - tags in code blocks are not real inline tags
    const codeBlockViolation = result.data.violations.find(v => v.path.includes("code-blocks.md"));
    expect(codeBlockViolation).toBeUndefined();
  });

  test("does not flag URL anchors as inline tags", async () => {
    const result = await generateVerify(testVaultPath);

    // urls.md should be compliant - hash anchors in URLs are not tags
    const urlViolation = result.data.violations.find(v => v.path.includes("urls.md"));
    expect(urlViolation).toBeUndefined();
  });

  test("calculates compliance percentage correctly", async () => {
    const result = await generateVerify(testVaultPath);
    const expectedPercent = (result.stats.notesCompliant / (result.stats.totalNotesScanned - result.stats.notesSkipped)) * 100;
    expect(result.data.compliancePercent).toBeCloseTo(expectedPercent, 1);
  });

  test("handles empty vault gracefully", async () => {
    const emptyVault = await mkdtemp(join(tmpdir(), "empty-verify-"));
    const result = await generateVerify(emptyVault);

    expect(result.stats.totalNotesScanned).toBe(0);
    expect(result.stats.notesCompliant).toBe(0);
    expect(result.stats.notesWithViolations).toBe(0);
    expect(result.data.compliancePercent).toBe(100); // Empty vault is 100% compliant

    await rm(emptyVault, { recursive: true });
  });

  test("handles vault with only agent artifacts", async () => {
    const artifactOnlyVault = await mkdtemp(join(tmpdir(), "artifact-verify-"));
    await writeFile(
      join(artifactOnlyVault, "_Tag Audit Report.md"),
      `---\ntags:\n  - type/report\n---\n# Report\n`,
    );
    await writeFile(
      join(artifactOnlyVault, "_Tag Migration Plan.md"),
      `---\ntags:\n  - type/report\n---\n# Plan\n`,
    );

    const result = await generateVerify(artifactOnlyVault);

    expect(result.stats.totalNotesScanned).toBe(0); // All excluded
    expect(result.data.compliancePercent).toBe(100);

    await rm(artifactOnlyVault, { recursive: true });
  });

  test("builds tag summary correctly", async () => {
    const result = await generateVerify(testVaultPath);

    expect(result.data.tagSummary.uniqueTags).toBeGreaterThan(0);
    expect(result.data.tagSummary.tagsByPrefix).toBeDefined();
    expect(result.data.tagSummary.flatTopicTags).toBeGreaterThanOrEqual(0);

    // Should have type/ prefix from compliant notes
    expect(result.data.tagSummary.tagsByPrefix["type"]).toBeGreaterThan(0);
  });
});

describe("formatVerifyMarkdown", () => {
  test("produces markdown with frontmatter", async () => {
    const result = await generateVerify(testVaultPath);
    const md = formatVerifyMarkdown(result);

    expect(md).toContain("---");
    expect(md).toContain("type/report");
    expect(md).toContain("# Tag Migration Verification Report");
  });

  test("includes executive summary", async () => {
    const result = await generateVerify(testVaultPath);
    const md = formatVerifyMarkdown(result);

    expect(md).toContain("## Executive Summary");
    expect(md).toContain("Compliance");
  });

  test("includes violation summary when violations exist", async () => {
    const result = await generateVerify(testVaultPath);
    const md = formatVerifyMarkdown(result);

    if (result.stats.notesWithViolations > 0) {
      expect(md).toContain("## Violation Summary");
      expect(md).toContain("| Violation Type | Notes Affected |");
    }
  });

  test("includes detailed violations section", async () => {
    const result = await generateVerify(testVaultPath);
    const md = formatVerifyMarkdown(result);

    if (result.stats.notesWithViolations > 0) {
      expect(md).toContain("## Notes with Violations");
    }
  });

  test("includes tag distribution summary", async () => {
    const result = await generateVerify(testVaultPath);
    const md = formatVerifyMarkdown(result);

    expect(md).toContain("## Tag Distribution");
    expect(md).toContain("Unique tags in use:");
  });

  test("includes statistics section", async () => {
    const result = await generateVerify(testVaultPath);
    const md = formatVerifyMarkdown(result);

    expect(md).toContain("## Statistics");
    expect(md).toContain("Notes scanned:");
    expect(md).toContain("deterministic code (not LLM)");
  });

  test("includes next steps", async () => {
    const result = await generateVerify(testVaultPath);
    const md = formatVerifyMarkdown(result);

    expect(md).toContain("## Next Steps");
  });

  test("shows pass message for fully compliant vault", async () => {
    const cleanVault = await mkdtemp(join(tmpdir(), "clean-verify-"));
    await writeFile(
      join(cleanVault, "note.md"),
      `---\ntags:\n  - ai-tools\n  - type/research\n---\nClean.\n`,
    );

    const result = await generateVerify(cleanVault);
    const md = formatVerifyMarkdown(result);

    expect(md).toContain("PASS");
    expect(md).toContain("100.0%");

    await rm(cleanVault, { recursive: true });
  });
});

describe("writeVerifyJson", () => {
  test("writes valid JSON file", async () => {
    const result = await generateVerify(testVaultPath);
    const dataDir = await mkdtemp(join(tmpdir(), "verify-data-"));

    await writeVerifyJson(dataDir, result.data);

    const jsonPath = join(dataDir, "verify-data.json");
    const content = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.generatedBy).toBe("deterministic-verify-generator");
    expect(parsed.totalNotes).toBeDefined();
    expect(parsed.compliancePercent).toBeDefined();
    expect(parsed.violations).toBeDefined();

    await rm(dataDir, { recursive: true });
  });

  test("JSON contains all required fields", async () => {
    const result = await generateVerify(testVaultPath);
    const dataDir = await mkdtemp(join(tmpdir(), "verify-data-"));

    await writeVerifyJson(dataDir, result.data);

    const jsonPath = join(dataDir, "verify-data.json");
    const content = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(content);

    // Required top-level fields
    expect(parsed.generatedAt).toBeDefined();
    expect(parsed.generatedBy).toBeDefined();
    expect(parsed.totalNotes).toBeDefined();
    expect(parsed.notesCompliant).toBeDefined();
    expect(parsed.notesWithViolations).toBeDefined();
    expect(parsed.compliancePercent).toBeDefined();
    expect(parsed.violationCounts).toBeDefined();
    expect(parsed.violations).toBeDefined();
    expect(parsed.tagSummary).toBeDefined();

    // Violation counts structure
    expect(parsed.violationCounts.inlineTags).toBeDefined();
    expect(parsed.violationCounts.hashPrefixTags).toBeDefined();
    expect(parsed.violationCounts.invalidFormat).toBeDefined();
    expect(parsed.violationCounts.duplicates).toBeDefined();
    expect(parsed.violationCounts.noiseTags).toBeDefined();

    await rm(dataDir, { recursive: true });
  });
});
