import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  extractMappingsFromMarkdown,
  extractMappingsFromPlanFile,
  writePlanMappingsJson,
} from "../lib/plan-extractor.js";

describe("extractMappingsFromMarkdown", () => {
  test("extracts MAP actions correctly", () => {
    const markdown = `
# Tag Migration Plan

| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`daily-reflection\` | \`type/daily-note\` | MAP | Move to type |
| \`todo\` | \`status/pending\` | MAP | Status tag |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["daily-reflection"]).toBe("type/daily-note");
    expect(result.mappings["todo"]).toBe("status/pending");
    expect(result.stats.mapActions).toBe(2);
  });

  test("extracts REMOVE actions correctly", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`heading\` | (remove) | REMOVE | Noise tag |
| \`follow-up-required-weekly\` | (remove) | REMOVE | Obsolete |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["heading"]).toBeNull();
    expect(result.mappings["follow-up-required-weekly"]).toBeNull();
    expect(result.stats.removeActions).toBe(2);
  });

  test("extracts KEEP actions as identity mappings", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`ai-tools\` | \`ai-tools\` | KEEP | Already valid |
| \`blockchain\` | \`blockchain\` | KEEP | Topic tag |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["ai-tools"]).toBe("ai-tools");
    expect(result.mappings["blockchain"]).toBe("blockchain");
    expect(result.stats.keepActions).toBe(2);
  });

  test("does not include UNMAPPED actions in mappings", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`unknown-tag\` | ? | UNMAPPED | Needs decision |
| \`ai-tools\` | \`ai-tools\` | KEEP | Valid |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["unknown-tag"]).toBeUndefined();
    expect(result.mappings["ai-tools"]).toBe("ai-tools");
    expect(result.stats.unmappedActions).toBe(1);
  });

  test("handles mixed actions in one table", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`daily-reflection\` | \`type/daily-note\` | MAP | Remap |
| \`heading\` | (remove) | REMOVE | Noise |
| \`ai-tools\` | \`ai-tools\` | KEEP | Valid |
| \`mystery\` | ? | UNMAPPED | Unknown |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.stats.totalMappings).toBe(3); // MAP + REMOVE + KEEP
    expect(result.stats.mapActions).toBe(1);
    expect(result.stats.removeActions).toBe(1);
    expect(result.stats.keepActions).toBe(1);
    expect(result.stats.unmappedActions).toBe(1);
  });

  test("normalizes tags to lowercase", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`Daily-Reflection\` | \`type/daily-note\` | MAP | Case |
| \`AI-Tools\` | \`ai-tools\` | KEEP | Mixed case |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.mappings["daily-reflection"]).toBe("type/daily-note");
    expect(result.mappings["ai-tools"]).toBe("ai-tools");
  });

  test("returns success=false for empty table", () => {
    const markdown = `
# Tag Migration Plan

No mapping table here.
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(false);
    expect(result.stats.totalMappings).toBe(0);
  });

  test("handles table with only header row", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(false);
  });

  test("handles tight formatting (no spaces)", () => {
    const markdown = `
|Old Tag|New Tag|Action|Notes|
|---|---|---|---|
|\`tight-tag\`|\`type/tight\`|MAP|No spaces|
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["tight-tag"]).toBe("type/tight");
  });

  test("handles extra whitespace", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`spaced-tag\` |  \`type/spaced\`  |  MAP  | Extra whitespace |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["spaced-tag"]).toBe("type/spaced");
  });

  test("handles case-insensitive actions", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`tag1\` | \`type/a\` | map | lowercase |
| \`tag2\` | \`type/b\` | Map | mixed |
| \`tag3\` | (remove) | remove | lowercase remove |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["tag1"]).toBe("type/a");
    expect(result.mappings["tag2"]).toBe("type/b");
    expect(result.mappings["tag3"]).toBeNull();
    expect(result.stats.mapActions).toBe(2);
    expect(result.stats.removeActions).toBe(1);
  });

  test("warns when MAP action has no new tag", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`orphan\` | ? | MAP | Oops wrong action |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("orphan");
  });

  test("handles REMOVE with em-dash (—)", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`heading\` | — | REMOVE | Noise tag |
| \`follow-up-required-weekly\` | — | REMOVE | Obsolete |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["heading"]).toBeNull();
    expect(result.mappings["follow-up-required-weekly"]).toBeNull();
    expect(result.stats.removeActions).toBe(2);
  });

  test("handles REMOVE with hyphen (-)", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`noise-tag\` | - | REMOVE | Using hyphen |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["noise-tag"]).toBeNull();
    expect(result.stats.removeActions).toBe(1);
  });

  test("warns on key collision when different values", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`research\` | \`type/research\` | MAP | Add prefix |
| \`Research\` | \`research\` | MAP | Fix case |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    // Both normalize to "research" - second one wins but should warn
    expect(result.mappings["research"]).toBe("research"); // Last value wins
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("collision");
    expect(result.warnings[0]).toContain("research");
  });

  test("no warning when same key mapped to same value", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`ai-tools\` | \`ai-tools\` | KEEP | Keep it |
| \`AI-Tools\` | \`ai-tools\` | MAP | Fix case |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["ai-tools"]).toBe("ai-tools");
    // No collision warning because values are the same
    expect(result.warnings.filter(w => w.includes("collision")).length).toBe(0);
  });

  test("handles bold action words (**MAP**, **KEEP**, etc.)", () => {
    const markdown = `
| Old Tag | New Tag | Action | Frequency | Reason |
|---------|---------|---------|-----------|---------|
| \`ai-tools\` | \`ai-tools\` | **KEEP** | 14 | Already perfect |
| \`todo\` | \`status/pending\` | **MAP** | 12 | Standardize workflow |
| \`heading\` | — | **REMOVE** | 6 | Google Docs artifact |
| \`mystery\` | ? | **UNMAPPED** | 1 | Needs decision |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["ai-tools"]).toBe("ai-tools");
    expect(result.mappings["todo"]).toBe("status/pending");
    expect(result.mappings["heading"]).toBeNull();
    expect(result.mappings["mystery"]).toBeUndefined();
    expect(result.stats.keepActions).toBe(1);
    expect(result.stats.mapActions).toBe(1);
    expect(result.stats.removeActions).toBe(1);
    expect(result.stats.unmappedActions).toBe(1);
  });

  test("handles extra content after action word in action column", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`type/resource\` | \`type/resource\` | **MAP** to \`type/reference\` | 1 | Consolidate types |
| \`career\` | \`area/career\` | **MAP** | 14 | Promote to area |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    // The type/resource row should be parsed as MAP action
    // (The "to `type/reference`" part is extra text that gets ignored by regex)
    expect(result.mappings["type/resource"]).toBe("type/resource");
    expect(result.mappings["career"]).toBe("area/career");
    expect(result.stats.mapActions).toBe(2);
  });

  test("handles real-world LLM output format with extra columns", () => {
    const markdown = `
| Old Tag | New Tag | Action | Frequency | Reason |
|---------|---------|---------|-----------|---------|
| \`ai-tools\` | \`ai-tools\` | **KEEP** | 14 | Already perfect kebab-case topic tag |
| \`career\` | \`area/career\` | **MAP** | 14 | Promote to life area |
| \`daily-notes\` | \`type/daily-note\` | **MAP** | 4 | Consolidate daily note variants |
| \`heading\` | — | **REMOVE** | 6 | Google Docs import artifact |
| \`follow-up-required-weekly\` | — | **REMOVE** | 1 | Old workflow system |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.stats.totalMappings).toBe(5);
    expect(result.mappings["ai-tools"]).toBe("ai-tools");
    expect(result.mappings["career"]).toBe("area/career");
    expect(result.mappings["daily-notes"]).toBe("type/daily-note");
    expect(result.mappings["heading"]).toBeNull();
    expect(result.mappings["follow-up-required-weekly"]).toBeNull();
    expect(result.stats.keepActions).toBe(1);
    expect(result.stats.mapActions).toBe(2);
    expect(result.stats.removeActions).toBe(2);
  });

  test("handles tags WITHOUT backticks (bare tags)", () => {
    // This is a critical test case - some LLMs write tables without backticks
    const markdown = `
| Current Tag | New Tag | Action | Frequency | Rationale |
|-------------|---------|---------|-----------|-----------|
| career | area/career | MAP | 12 | Promote to life domain |
| health | area/health | MAP | 6 | Promote to life domain |
| todo | status/pending | MAP | 10 | Standardize workflow state |
| ai-tools | ai-tools | KEEP | 14 | Already valid topic tag |
| blockchain | blockchain | KEEP | 11 | Already valid topic tag |
| heading | — | REMOVE | 8 | Google Docs import artifact |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.stats.totalMappings).toBe(6);
    expect(result.mappings["career"]).toBe("area/career");
    expect(result.mappings["health"]).toBe("area/health");
    expect(result.mappings["todo"]).toBe("status/pending");
    expect(result.mappings["ai-tools"]).toBe("ai-tools");
    expect(result.mappings["blockchain"]).toBe("blockchain");
    expect(result.mappings["heading"]).toBeNull();
    expect(result.stats.mapActions).toBe(3);
    expect(result.stats.keepActions).toBe(2);
    expect(result.stats.removeActions).toBe(1);
  });

  test("handles bare tags with section headers in table", () => {
    // Test the exact format from the failed migration - LLM added section headers as rows
    const markdown = `
| Current Tag | New Tag | Action | Frequency | Rationale |
|-------------|---------|---------|-----------|-----------|
| **HIERARCHICAL PROMOTIONS** |
| career | area/career | MAP | 12 | Promote to life domain |
| research | type/research | MAP | 7 | Classify as note type |
| **STATUS STANDARDIZATION** |
| todo | status/pending | MAP | 10 | Standardize workflow state |
| wip | status/in-progress | MAP | 3 | Standardize workflow state |
| **NOISE REMOVAL** |
| heading | — | REMOVE | 8 | Google Docs import artifact |
| **TOPIC TAGS (KEEP AS-IS)** |
| ai-tools | ai-tools | KEEP | 14 | Already valid topic tag |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["career"]).toBe("area/career");
    expect(result.mappings["research"]).toBe("type/research");
    expect(result.mappings["todo"]).toBe("status/pending");
    expect(result.mappings["wip"]).toBe("status/in-progress");
    expect(result.mappings["heading"]).toBeNull();
    expect(result.mappings["ai-tools"]).toBe("ai-tools");
    expect(result.stats.mapActions).toBe(4);
    expect(result.stats.keepActions).toBe(1);
    expect(result.stats.removeActions).toBe(1);
  });

  test("handles mixed backtick and bare tag formats", () => {
    // Test when LLM mixes formats in the same table
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`with-backticks\` | \`type/backticked\` | MAP | With backticks |
| bare-tag | type/bare | MAP | No backticks |
| \`mixed\` | area/destination | MAP | Backtick old, bare new |
| source | \`area/quoted\` | MAP | Bare old, backtick new |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["with-backticks"]).toBe("type/backticked");
    expect(result.mappings["bare-tag"]).toBe("type/bare");
    expect(result.mappings["mixed"]).toBe("area/destination");
    expect(result.mappings["source"]).toBe("area/quoted");
    expect(result.stats.mapActions).toBe(4);
  });

  test("handles bare tags with hierarchical paths (slashes)", () => {
    const markdown = `
| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| project-catalyst | project/catalyst | MAP | Add project prefix |
| daily-notes | type/daily-note | MAP | Add type prefix |
| status/in-progress | status/in-progress | KEEP | Already correct |
`;
    const result = extractMappingsFromMarkdown(markdown);

    expect(result.success).toBe(true);
    expect(result.mappings["project-catalyst"]).toBe("project/catalyst");
    expect(result.mappings["daily-notes"]).toBe("type/daily-note");
    expect(result.mappings["status/in-progress"]).toBe("status/in-progress");
    expect(result.stats.mapActions).toBe(2);
    expect(result.stats.keepActions).toBe(1);
  });
});

describe("extractMappingsFromPlanFile", () => {
  let testVaultPath: string;

  beforeAll(async () => {
    testVaultPath = await mkdtemp(join(tmpdir(), "plan-extractor-"));
  });

  afterAll(async () => {
    await rm(testVaultPath, { recursive: true, force: true });
  });

  test("returns null when plan file does not exist", async () => {
    const result = await extractMappingsFromPlanFile(testVaultPath);
    expect(result).toBeNull();
  });

  test("extracts mappings from existing plan file", async () => {
    await writeFile(
      join(testVaultPath, "_Tag Migration Plan.md"),
      `---
tags:
  - type/report
---
# Tag Migration Plan

| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`todo\` | \`status/pending\` | MAP | Status |
| \`heading\` | (remove) | REMOVE | Noise |
`,
      "utf-8"
    );

    const result = await extractMappingsFromPlanFile(testVaultPath);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.mappings["todo"]).toBe("status/pending");
    expect(result!.mappings["heading"]).toBeNull();
  });
});

describe("writePlanMappingsJson", () => {
  let testDataPath: string;

  beforeAll(async () => {
    testDataPath = await mkdtemp(join(tmpdir(), "plan-mappings-"));
  });

  afterAll(async () => {
    await rm(testDataPath, { recursive: true, force: true });
  });

  test("writes valid JSON file", async () => {
    const mappings = {
      "todo": "status/pending",
      "heading": null,
    };

    await writePlanMappingsJson(testDataPath, mappings, "Proposed Tagging System.md");

    const content = await readFile(join(testDataPath, "plan-mappings.json"), "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.generatedBy).toBe("plan-extractor");
    expect(parsed.schemeNotePath).toBe("Proposed Tagging System.md");
    expect(parsed.mappings["todo"]).toBe("status/pending");
    expect(parsed.mappings["heading"]).toBeNull();
  });

  test("includes timestamp in output", async () => {
    const mappings = { "test": "type/test" };

    await writePlanMappingsJson(testDataPath, mappings, "Test.md");

    const content = await readFile(join(testDataPath, "plan-mappings.json"), "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.generatedAt).toBeDefined();
    expect(new Date(parsed.generatedAt).getTime()).not.toBeNaN();
  });
});
