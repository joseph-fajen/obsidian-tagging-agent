import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { parseFrontmatter, serializeFrontmatter, getFrontmatterTags, setFrontmatterTags } from "../lib/frontmatter.js";
import { extractInlineTags, isValidTagFormat, removeInlineTag } from "../lib/tag-parser.js";

function safePath(vaultPath: string, notePath: string): string {
  const resolved = resolve(vaultPath, notePath);
  if (!resolved.startsWith(resolve(vaultPath))) {
    throw new Error(`Path traversal rejected: "${notePath}"`);
  }
  return resolved;
}

function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

export function createTagTools(vaultPath: string) {
  const applyTagChanges = tool(
    "apply_tag_changes",
    `Apply a set of tag changes to a specific note — the core migration tool.

Use this when:
- Executing the migration plan on a note (renaming, removing, adding tags)
- Moving inline tags to YAML frontmatter
- Removing noise or obsolete tags

Do NOT use this for:
- Reading tags (use read_note with detail: "minimal")
- Writing report notes (use write_note)
- Bulk operations across many notes in one call (call this per-note in a batch loop)

Performance notes:
- ~30ms per note
- Validates new tags match scheme format (lowercase, kebab-case, valid prefix)
- Deduplicates — if two old tags map to the same new tag, it's added once
- Always check warnings in the response — non-empty array doesn't mean failure

Examples:
- apply_tag_changes({ path: "Journal/2025-01-15.md", changes: [{ oldTag: "daily-reflection", newTag: "type/daily-note" }, { oldTag: "heading", newTag: null }] })
- apply_tag_changes({ path: "Projects/Plutus.md", changes: [{ oldTag: "todo", newTag: "status/pending" }, { oldTag: "research", newTag: "type/research" }] })`,
    {
      path: z.string().describe("Relative path to the note from vault root."),
      changes: z
        .array(
          z.object({
            oldTag: z.string().describe("Tag to remove (without # prefix)."),
            newTag: z.string().nullable().describe("New tag to add, or null to remove entirely."),
          }),
        )
        .describe("Array of tag changes to apply."),
    },
    async ({ path: notePath, changes }) => {
      try {
        const fullPath = safePath(vaultPath, notePath);
        const raw = await readFile(fullPath, "utf-8");
        const parsed = parseFrontmatter(raw);
        let body = parsed.content;
        let currentTags = getFrontmatterTags(parsed.data);
        const inlineTags = extractInlineTags(body);

        const tagsAdded: string[] = [];
        const tagsRemoved: string[] = [];
        const warnings: string[] = [];

        for (const { oldTag, newTag } of changes) {
          const inFrontmatter = currentTags.includes(oldTag);
          const inInline = inlineTags.includes(oldTag);

          if (!inFrontmatter && !inInline) {
            warnings.push(`Tag "${oldTag}" not found in note`);
          }

          // Remove old tag from frontmatter
          if (inFrontmatter) {
            currentTags = currentTags.filter((t) => t !== oldTag);
            tagsRemoved.push(oldTag);
          }

          // Remove old tag from inline body
          if (inInline) {
            body = removeInlineTag(body, oldTag);
            if (!inFrontmatter) tagsRemoved.push(oldTag);
          }

          // Add new tag to frontmatter
          if (newTag !== null) {
            if (!isValidTagFormat(newTag)) {
              warnings.push(`New tag "${newTag}" has invalid format — added anyway`);
            }
            if (!currentTags.includes(newTag)) {
              currentTags.push(newTag);
              tagsAdded.push(newTag);
            } else {
              warnings.push(`Duplicate after mapping: "${newTag}" already exists`);
            }
          }
        }

        // Write back
        const newData = setFrontmatterTags(parsed.data, currentTags);
        const output = serializeFrontmatter(body, newData);
        await writeFile(fullPath, output, "utf-8");

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, path: notePath, tagsAdded, tagsRemoved, warnings }),
            },
          ],
        };
      } catch (err) {
        return errorResult(String(err));
      }
    },
  );

  return [applyTagChanges];
}
