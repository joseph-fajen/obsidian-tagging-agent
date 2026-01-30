import { describe, test, expect } from "bun:test";
import {
  extractInlineTags,
  isNoiseTag,
  classifyTags,
  normalizeTag,
  isValidTagFormat,
  removeInlineTag,
} from "../lib/tag-parser.js";

describe("extractInlineTags", () => {
  test("extracts tags from plain text", () => {
    const tags = extractInlineTags("#tag1 some text #tag2");
    expect(tags).toContain("tag1");
    expect(tags).toContain("tag2");
  });

  test("skips tags inside fenced code blocks", () => {
    const content = "Before\n```\n#not-a-tag\n```\nAfter #real-tag";
    const tags = extractInlineTags(content);
    expect(tags).not.toContain("not-a-tag");
    expect(tags).toContain("real-tag");
  });

  test("skips tags inside inline code", () => {
    const tags = extractInlineTags("Use `#not-a-tag` in code, but #real-tag here");
    expect(tags).not.toContain("not-a-tag");
    expect(tags).toContain("real-tag");
  });

  test("skips tags inside markdown link URLs", () => {
    const tags = extractInlineTags("[link](https://example.com/page#fragment) and #real-tag");
    expect(tags).not.toContain("fragment");
    expect(tags).toContain("real-tag");
  });

  test("handles tag at start of line", () => {
    const tags = extractInlineTags("#start-tag rest of text");
    expect(tags).toContain("start-tag");
  });

  test("handles tag at end of line", () => {
    const tags = extractInlineTags("some text #end-tag");
    expect(tags).toContain("end-tag");
  });
});

describe("isNoiseTag", () => {
  test("identifies 'heading' as noise", () => {
    expect(isNoiseTag("heading")).toBe(true);
  });

  test("identifies Google Docs anchor as noise", () => {
    expect(isNoiseTag("heading=h.abc123")).toBe(true);
  });

  test("identifies follow-up-required tags as noise", () => {
    expect(isNoiseTag("follow-up-required-weekly")).toBe(true);
    expect(isNoiseTag("follow-up-required-monthly")).toBe(true);
  });

  test("does not flag normal tags as noise", () => {
    expect(isNoiseTag("daily-reflection")).toBe(false);
    expect(isNoiseTag("status/pending")).toBe(false);
  });
});

describe("classifyTags", () => {
  test("splits tags into valid and noise", () => {
    const result = classifyTags(["daily-reflection", "heading", "todo", "heading=h.xyz"]);
    expect(result.validTags).toEqual(["daily-reflection", "todo"]);
    expect(result.noiseTags).toEqual(["heading", "heading=h.xyz"]);
  });
});

describe("normalizeTag", () => {
  test("lowercases uppercase tags", () => {
    expect(normalizeTag("MyTag")).toBe("mytag");
  });

  test("converts underscores to hyphens", () => {
    expect(normalizeTag("my_tag_name")).toBe("my-tag-name");
  });

  test("handles mixed case and underscores", () => {
    expect(normalizeTag("My_Tag_Name")).toBe("my-tag-name");
  });
});

describe("isValidTagFormat", () => {
  test("accepts simple kebab-case tag", () => {
    expect(isValidTagFormat("daily-note")).toBe(true);
  });

  test("accepts prefixed tag", () => {
    expect(isValidTagFormat("status/pending")).toBe(true);
    expect(isValidTagFormat("type/daily-note")).toBe(true);
    expect(isValidTagFormat("area/career")).toBe(true);
    expect(isValidTagFormat("project/blockfrost")).toBe(true);
  });

  test("rejects uppercase", () => {
    expect(isValidTagFormat("Daily-Note")).toBe(false);
  });

  test("rejects underscores", () => {
    expect(isValidTagFormat("daily_note")).toBe(false);
  });

  test("rejects empty body after prefix", () => {
    expect(isValidTagFormat("status/")).toBe(false);
  });

  test("accepts single word", () => {
    expect(isValidTagFormat("career")).toBe(true);
  });
});

describe("removeInlineTag", () => {
  test("removes tag from body text", () => {
    const result = removeInlineTag("Hello #todo world", "todo");
    expect(result).not.toContain("#todo");
    expect(result).toContain("Hello");
    expect(result).toContain("world");
  });

  test("skips tag inside code block", () => {
    const content = "Before\n```\n#todo\n```\nAfter #todo";
    const result = removeInlineTag(content, "todo");
    // The code block occurrence should remain
    expect(result).toContain("```\n#todo\n```");
    // The inline occurrence should be removed
    expect(result.indexOf("#todo")).toBeLessThan(result.indexOf("```") + 10);
  });

  test("does not leave double spaces", () => {
    const result = removeInlineTag("word #tag next", "tag");
    expect(result).not.toContain("  ");
  });
});
