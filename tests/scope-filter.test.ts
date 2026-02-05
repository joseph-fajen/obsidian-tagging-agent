import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm, utimes } from "fs/promises";
import { join } from "path";
import {
  scopeToNotes,
  getAllNotes,
  getNotesInFolder,
  validateFilePaths,
  getRecentNotes,
  getNotesByTag,
  formatScope,
  validateScope,
} from "../lib/scope-filter.js";
import type { WorkScope } from "../lib/types.js";

// Test vault structure:
// - journal/
//   - 2025-01-15.md (tags: daily-reflection, meditation)
//   - 2025-01-16.md (tags: daily-reflection)
// - projects/
//   - alpha.md (tags: status/pending, ai-tools)
//   - beta.md (tags: status/completed)
// - archive/
//   - old/
//     - legacy.md (tags: archived)
// - _Agent Report.md (should be excluded)
// - standalone.md (no tags, modified 30 days ago)

const TEST_VAULT_PATH = join(import.meta.dir, "__scope_test_vault__");

async function createTestVault() {
  await mkdir(TEST_VAULT_PATH, { recursive: true });
  await mkdir(join(TEST_VAULT_PATH, "journal"), { recursive: true });
  await mkdir(join(TEST_VAULT_PATH, "projects"), { recursive: true });
  await mkdir(join(TEST_VAULT_PATH, "archive", "old"), { recursive: true });

  // Journal notes
  await writeFile(
    join(TEST_VAULT_PATH, "journal", "2025-01-15.md"),
    `---
tags:
  - daily-reflection
  - meditation
---
# January 15

Today was good. #inline-tag
`
  );
  await writeFile(
    join(TEST_VAULT_PATH, "journal", "2025-01-16.md"),
    `---
tags:
  - daily-reflection
---
# January 16

Another day.
`
  );

  // Project notes
  await writeFile(
    join(TEST_VAULT_PATH, "projects", "alpha.md"),
    `---
tags:
  - status/pending
  - ai-tools
---
# Project Alpha

Work in progress.
`
  );
  await writeFile(
    join(TEST_VAULT_PATH, "projects", "beta.md"),
    `---
tags:
  - status/completed
---
# Project Beta

Done!
`
  );

  // Archive note
  await writeFile(
    join(TEST_VAULT_PATH, "archive", "old", "legacy.md"),
    `---
tags:
  - archived
---
# Legacy

Old stuff.
`
  );

  // Agent artifact (should be excluded)
  await writeFile(
    join(TEST_VAULT_PATH, "_Agent Report.md"),
    `---
tags:
  - type/report
---
# Report

This should be excluded.
`
  );

  // Standalone note (no tags, old modification time)
  const standaloneFile = join(TEST_VAULT_PATH, "standalone.md");
  await writeFile(standaloneFile, "# Standalone\n\nNo tags here.");
  // Set mtime to 30 days ago
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  await utimes(standaloneFile, thirtyDaysAgo, thirtyDaysAgo);
}

async function cleanupTestVault() {
  await rm(TEST_VAULT_PATH, { recursive: true, force: true });
}

beforeAll(async () => {
  await cleanupTestVault();
  await createTestVault();
});

afterAll(async () => {
  await cleanupTestVault();
});

// ============================================================================
// getAllNotes
// ============================================================================

describe("getAllNotes", () => {
  test("returns all notes except _ prefixed", async () => {
    const notes = await getAllNotes(TEST_VAULT_PATH);
    expect(notes).toHaveLength(6);
    expect(notes).not.toContain("_Agent Report.md");
  });

  test("returns notes sorted alphabetically", async () => {
    const notes = await getAllNotes(TEST_VAULT_PATH);
    const sorted = [...notes].sort();
    expect(notes).toEqual(sorted);
  });

  test("includes nested directory notes", async () => {
    const notes = await getAllNotes(TEST_VAULT_PATH);
    expect(notes).toContain("archive/old/legacy.md");
  });
});

// ============================================================================
// scopeToNotes - full scope
// ============================================================================

describe("scopeToNotes", () => {
  describe("full scope", () => {
    test("returns all notes except _ prefixed", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "full" });
      expect(notes).toHaveLength(6);
      expect(notes).not.toContain("_Agent Report.md");
    });

    test("returns notes sorted", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "full" });
      const sorted = [...notes].sort();
      expect(notes).toEqual(sorted);
    });
  });

  describe("folder scope", () => {
    test("returns only notes in the specified folder", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "folder", path: "journal" });
      expect(notes).toHaveLength(2);
      expect(notes).toContain("journal/2025-01-15.md");
      expect(notes).toContain("journal/2025-01-16.md");
    });

    test("handles nested folders", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "folder", path: "archive" });
      expect(notes).toHaveLength(1);
      expect(notes).toContain("archive/old/legacy.md");
    });

    test("handles trailing slash in folder path", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "folder", path: "projects/" });
      expect(notes).toHaveLength(2);
    });

    test("returns empty array for nonexistent folder", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "folder", path: "nonexistent" });
      expect(notes).toHaveLength(0);
    });
  });

  describe("files scope", () => {
    test("validates file existence and returns valid paths", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, {
        type: "files",
        paths: ["journal/2025-01-15.md", "nonexistent.md", "projects/alpha.md"],
      });
      expect(notes).toHaveLength(2);
      expect(notes).toContain("journal/2025-01-15.md");
      expect(notes).toContain("projects/alpha.md");
    });

    test("filters out non-.md files", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, {
        type: "files",
        paths: ["journal/2025-01-15.md", "somefile.txt"],
      });
      expect(notes).toHaveLength(1);
    });

    test("filters out _ prefixed files", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, {
        type: "files",
        paths: ["_Agent Report.md", "projects/alpha.md"],
      });
      expect(notes).toHaveLength(1);
      expect(notes).not.toContain("_Agent Report.md");
    });
  });

  describe("recent scope", () => {
    test("returns only recently modified notes", async () => {
      // standalone.md was set to 30 days ago, so with days=7 it should be excluded
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "recent", days: 7 });
      expect(notes).not.toContain("standalone.md");
    });

    test("includes notes within the cutoff", async () => {
      // All notes except standalone.md should be recent (created during test setup)
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "recent", days: 1 });
      expect(notes.length).toBeGreaterThan(0);
      expect(notes).not.toContain("standalone.md");
    });

    test("includes old notes when days is large enough", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "recent", days: 60 });
      expect(notes).toContain("standalone.md");
    });
  });

  describe("tag scope", () => {
    test("finds notes with frontmatter tag", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "tag", tagName: "daily-reflection" });
      expect(notes).toHaveLength(2);
      expect(notes).toContain("journal/2025-01-15.md");
      expect(notes).toContain("journal/2025-01-16.md");
    });

    test("finds notes with inline tag", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "tag", tagName: "inline-tag" });
      expect(notes).toHaveLength(1);
      expect(notes).toContain("journal/2025-01-15.md");
    });

    test("tag matching is case-insensitive", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "tag", tagName: "DAILY-REFLECTION" });
      expect(notes).toHaveLength(2);
    });

    test("returns empty array for nonexistent tag", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "tag", tagName: "nonexistent-tag" });
      expect(notes).toHaveLength(0);
    });

    test("finds notes with hierarchical tags", async () => {
      const notes = await scopeToNotes(TEST_VAULT_PATH, { type: "tag", tagName: "status/pending" });
      expect(notes).toHaveLength(1);
      expect(notes).toContain("projects/alpha.md");
    });
  });
});

// ============================================================================
// formatScope
// ============================================================================

describe("formatScope", () => {
  test("formats full scope", () => {
    expect(formatScope({ type: "full" })).toBe("all notes in the vault");
  });

  test("formats folder scope", () => {
    expect(formatScope({ type: "folder", path: "journal" })).toBe('notes in folder "journal"');
  });

  test("formats single file scope", () => {
    expect(formatScope({ type: "files", paths: ["note.md"] })).toBe('file "note.md"');
  });

  test("formats multiple files scope", () => {
    expect(formatScope({ type: "files", paths: ["a.md", "b.md", "c.md"] })).toBe("3 specific files");
  });

  test("formats recent scope with 1 day", () => {
    expect(formatScope({ type: "recent", days: 1 })).toBe("notes modified today");
  });

  test("formats recent scope with multiple days", () => {
    expect(formatScope({ type: "recent", days: 7 })).toBe("notes modified in the last 7 days");
  });

  test("formats tag scope", () => {
    expect(formatScope({ type: "tag", tagName: "ai-tools" })).toBe('notes with tag "ai-tools"');
  });
});

// ============================================================================
// validateScope
// ============================================================================

describe("validateScope", () => {
  test("validates full scope", () => {
    const scope = validateScope({ type: "full" });
    expect(scope).toEqual({ type: "full" });
  });

  test("validates folder scope", () => {
    const scope = validateScope({ type: "folder", path: "journal" });
    expect(scope).toEqual({ type: "folder", path: "journal" });
  });

  test("throws on folder scope without path", () => {
    expect(() => validateScope({ type: "folder" })).toThrow("path");
  });

  test("validates files scope", () => {
    const scope = validateScope({ type: "files", paths: ["a.md", "b.md"] });
    expect(scope).toEqual({ type: "files", paths: ["a.md", "b.md"] });
  });

  test("throws on files scope without paths", () => {
    expect(() => validateScope({ type: "files" })).toThrow("paths");
  });

  test("validates recent scope", () => {
    const scope = validateScope({ type: "recent", days: 7 });
    expect(scope).toEqual({ type: "recent", days: 7 });
  });

  test("throws on recent scope with invalid days", () => {
    expect(() => validateScope({ type: "recent", days: 0 })).toThrow("days");
    expect(() => validateScope({ type: "recent", days: -1 })).toThrow("days");
  });

  test("validates tag scope", () => {
    const scope = validateScope({ type: "tag", tagName: "ai-tools" });
    expect(scope).toEqual({ type: "tag", tagName: "ai-tools" });
  });

  test("throws on tag scope without tagName", () => {
    expect(() => validateScope({ type: "tag" })).toThrow("tagName");
  });

  test("throws on unknown scope type", () => {
    expect(() => validateScope({ type: "unknown" as any })).toThrow("Unknown scope type");
  });
});
