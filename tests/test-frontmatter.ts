import { describe, test, expect } from "bun:test";
import {
  parseFrontmatter,
  serializeFrontmatter,
  getFrontmatterTags,
  setFrontmatterTags,
} from "../lib/frontmatter.js";

describe("parseFrontmatter", () => {
  test("parses standard YAML frontmatter with tags array", () => {
    const raw = "---\ntags:\n  - foo\n  - bar\n---\nBody content";
    const result = parseFrontmatter(raw);
    expect(result.hasFrontmatter).toBe(true);
    expect(result.data.tags).toEqual(["foo", "bar"]);
    expect(result.content).toContain("Body content");
  });

  test("parses note with no frontmatter", () => {
    const raw = "Just some body text\nNo frontmatter here.";
    const result = parseFrontmatter(raw);
    expect(result.hasFrontmatter).toBe(false);
    expect(result.content).toContain("Just some body text");
  });

  test("parses empty frontmatter block", () => {
    const raw = "---\n---\nBody";
    const result = parseFrontmatter(raw);
    expect(result.hasFrontmatter).toBe(true);
    expect(Object.keys(result.data).length).toBe(0);
  });

  test("parses complex frontmatter preserving all fields", () => {
    const raw = "---\ntags:\n  - test\naliases:\n  - my-alias\ncssclasses: wide\ncustom_field: 42\n---\nContent";
    const result = parseFrontmatter(raw);
    expect(result.hasFrontmatter).toBe(true);
    expect(result.data.tags).toEqual(["test"]);
    expect(result.data.aliases).toEqual(["my-alias"]);
    expect(result.data.cssclasses).toBe("wide");
    expect(result.data.custom_field).toBe(42);
  });

  test("parses tags as single string", () => {
    const raw = "---\ntags: single-tag\n---\nBody";
    const result = parseFrontmatter(raw);
    expect(result.data.tags).toBe("single-tag");
  });
});

describe("serializeFrontmatter", () => {
  test("roundtrip preserves content", () => {
    const raw = "---\ntags:\n  - foo\n---\nBody content here";
    const parsed = parseFrontmatter(raw);
    const serialized = serializeFrontmatter(parsed.content, parsed.data);
    expect(serialized).toContain("Body content here");
    expect(serialized).toContain("foo");
  });

  test("setting tags preserves other fields", () => {
    const data = { tags: ["old"], aliases: ["my-alias"], custom: "value" };
    const output = serializeFrontmatter("Body", { ...data, tags: ["new-tag"] });
    expect(output).toContain("new-tag");
    expect(output).toContain("my-alias");
    expect(output).toContain("custom");
  });
});

describe("getFrontmatterTags", () => {
  test("returns array from tags array", () => {
    expect(getFrontmatterTags({ tags: ["a", "b"] })).toEqual(["a", "b"]);
  });

  test("returns array from single string", () => {
    expect(getFrontmatterTags({ tags: "single" })).toEqual(["single"]);
  });

  test("returns empty array when tags missing", () => {
    expect(getFrontmatterTags({})).toEqual([]);
  });

  test("returns empty array when tags null", () => {
    expect(getFrontmatterTags({ tags: null })).toEqual([]);
  });
});

describe("setFrontmatterTags", () => {
  test("returns new object with tags set", () => {
    const original = { aliases: ["x"], custom: 1 };
    const result = setFrontmatterTags(original, ["new-tag"]);
    expect(result.tags).toEqual(["new-tag"]);
    expect(result.aliases).toEqual(["x"]);
  });

  test("does not mutate input", () => {
    const original = { tags: ["old"] };
    setFrontmatterTags(original, ["new"]);
    expect(original.tags).toEqual(["old"]);
  });
});
