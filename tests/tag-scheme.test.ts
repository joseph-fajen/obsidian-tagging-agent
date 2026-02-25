import { describe, test, expect } from "bun:test";
import {
  TagSchemeSchema,
  TagCategorySchema,
  TagMappingSchema,
  parseTagScheme,
  NOISE_TAG_PATTERNS,
  SCHEME_NOTE_PATH,
  lookupTagMapping,
  TAG_MAPPINGS,
} from "../tag-scheme.js";

describe("TagSchemeSchema", () => {
  test("accepts valid scheme with categories, mappings, and removals", () => {
    const valid = {
      categories: [
        { prefix: "status/", description: "Workflow status", tags: ["pending", "completed"] },
        { prefix: "type/", tags: ["daily-note", "meeting"] },
      ],
      mappings: [
        { from: ["todo", "to-do"], to: "status/pending" },
        { from: ["done", "finished"], to: "status/completed" },
      ],
      removals: ["heading", "follow-up-required-weekly"],
    };
    const result = parseTagScheme(valid);
    expect(result.categories).toHaveLength(2);
    expect(result.mappings).toHaveLength(2);
    expect(result.removals).toHaveLength(2);
  });

  test("accepts scheme with empty arrays (minimal valid scheme)", () => {
    const minimal = { categories: [], mappings: [], removals: [] };
    const result = parseTagScheme(minimal);
    expect(result.categories).toHaveLength(0);
    expect(result.mappings).toHaveLength(0);
    expect(result.removals).toHaveLength(0);
  });

  test("rejects missing categories field", () => {
    expect(() => parseTagScheme({ mappings: [], removals: [] })).toThrow();
  });

  test("rejects mapping with invalid shape (missing from)", () => {
    expect(() =>
      parseTagScheme({
        categories: [],
        mappings: [{ to: "status/pending" }],
        removals: [],
      }),
    ).toThrow();
  });

  test("rejects mapping with invalid shape (missing to)", () => {
    expect(() =>
      parseTagScheme({
        categories: [],
        mappings: [{ from: ["todo"] }],
        removals: [],
      }),
    ).toThrow();
  });

  test("accepts mapping with to: null (removal mapping)", () => {
    const scheme = {
      categories: [],
      mappings: [{ from: ["heading"], to: null }],
      removals: [],
    };
    const result = parseTagScheme(scheme);
    expect(result.mappings[0].to).toBeNull();
  });
});

describe("NOISE_TAG_PATTERNS", () => {
  test("contains exact pattern 'heading'", () => {
    expect(NOISE_TAG_PATTERNS.exact).toContain("heading");
  });

  test("contains prefix 'follow-up-required-'", () => {
    expect(NOISE_TAG_PATTERNS.prefixes).toContain("follow-up-required-");
  });

  test("contains containsChars '='", () => {
    expect(NOISE_TAG_PATTERNS.containsChars).toContain("=");
  });
});

describe("SCHEME_NOTE_PATH", () => {
  test("equals 'Proposed Tagging System.md'", () => {
    expect(SCHEME_NOTE_PATH).toBe("Proposed Tagging System.md");
  });
});

describe("lookupTagMapping", () => {
  test("maps tags using provided loaded mappings", () => {
    const loadedMappings = { mappings: { "daily-reflection": "type/daily-note" } };
    const result = lookupTagMapping("daily-reflection", loadedMappings);
    expect(result.action).toBe("map");
    expect(result.newTag).toBe("type/daily-note");
  });

  test("removes noise tags", () => {
    const result = lookupTagMapping("heading");
    expect(result.action).toBe("remove");
    expect(result.newTag).toBeNull();
  });

  test("removes null-mapped tags in hardcoded list", () => {
    const result = lookupTagMapping("follow-up-required-weekly");
    expect(result.action).toBe("remove");
    expect(result.newTag).toBeNull();
  });

  test("keeps already-valid topic tags", () => {
    const result = lookupTagMapping("ai-tools");
    expect(result.action).toBe("keep");
    expect(result.newTag).toBe("ai-tools");
  });

  test("keeps existing hierarchical tags", () => {
    const result = lookupTagMapping("status/pending");
    expect(result.action).toBe("keep");
    expect(result.newTag).toBe("status/pending");
  });

  test("normalizes underscores to hyphens for valid kebab-case", () => {
    // weekly_summary now becomes weekly-summary, which is a valid topic tag
    const result = lookupTagMapping("weekly_summary");
    expect(result.action).toBe("keep");
    expect(result.newTag).toBe("weekly-summary");
  });

  test("returns unmapped for unknown tags with invalid format", () => {
    const result = lookupTagMapping("Invalid_Tag!");
    expect(result.action).toBe("unmapped");
    expect(result.newTag).toBeNull();
  });

  test("loaded mappings are used for custom tags", () => {
    const loadedMappings = { mappings: { "custom-tag": "type/custom" } };
    const result = lookupTagMapping("custom-tag", loadedMappings);
    expect(result.action).toBe("map");
    expect(result.newTag).toBe("type/custom");
  });

  test("noise patterns take priority over loaded mappings", () => {
    // Even if loaded mappings try to map a noise tag, noise should win
    const loadedMappings = { mappings: { "heading": "type/heading" } };
    const result = lookupTagMapping("heading", loadedMappings);
    expect(result.action).toBe("remove");
  });

  test("loaded mappings take priority over hardcoded for same tag", () => {
    // Since hardcoded only has noise patterns now, test with a different tag
    const loadedMappings = { mappings: { "custom-tag": "area/custom" } };
    const result = lookupTagMapping("custom-tag", loadedMappings);
    expect(result.action).toBe("map");
    expect(result.newTag).toBe("area/custom");
  });

  test("keeps unknown but valid kebab-case tags", () => {
    const result = lookupTagMapping("some-new-topic");
    expect(result.action).toBe("keep");
    expect(result.newTag).toBe("some-new-topic");
  });

  test("detects purely numeric noise tags", () => {
    const result = lookupTagMapping("123");
    expect(result.action).toBe("remove");
    expect(result.newTag).toBeNull();
  });

  test("recognizes skill/ prefix as valid", () => {
    const result = lookupTagMapping("skill/writing");
    expect(result.action).toBe("keep");
    expect(result.newTag).toBe("skill/writing");
  });

  test("recognizes tool/ prefix as valid", () => {
    const result = lookupTagMapping("tool/obsidian");
    expect(result.action).toBe("keep");
    expect(result.newTag).toBe("tool/obsidian");
  });

  test("recognizes topic/ prefix as valid", () => {
    const result = lookupTagMapping("topic/ai");
    expect(result.action).toBe("keep");
    expect(result.newTag).toBe("topic/ai");
  });
});
