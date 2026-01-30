import { describe, test, expect } from "bun:test";
import {
  TagSchemeSchema,
  TagCategorySchema,
  TagMappingSchema,
  parseTagScheme,
  NOISE_TAG_PATTERNS,
  SCHEME_NOTE_PATH,
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
