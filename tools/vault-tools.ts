import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, resolve, relative } from "path";
import { parseFrontmatter, serializeFrontmatter, getFrontmatterTags } from "../lib/frontmatter.js";
import { extractInlineTags, classifyTags } from "../lib/tag-parser.js";

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

export function createVaultTools(vaultPath: string) {
  const listNotes = tool(
    "list_notes",
    `Get an index of all markdown notes in the vault.

Use this when:
- Starting an audit phase and need to enumerate all notes
- Checking how many notes exist in a subdirectory before batch processing
- Building a worklist for the execute phase

Do NOT use this for:
- Reading note content (use read_note instead)
- Finding notes by tag or text (use search_notes instead)

Performance notes:
- Returns lightweight metadata only (~20 tokens per note)
- Full vault scan (~884 notes) returns ~17K tokens
- Filter by path to reduce scope

Examples:
- list_notes({ recursive: true }) — full vault inventory for audit
- list_notes({ path: "Archive/", recursive: true }) — scope to Archive folder`,
    {
      path: z.string().optional().describe("Subdirectory to list, relative to vault root. Omit for entire vault."),
      recursive: z.boolean().optional().describe("Whether to recurse into subdirectories. Default false."),
    },
    async ({ path: subPath, recursive = false }) => {
      try {
        const dirPath = subPath ? safePath(vaultPath, subPath) : vaultPath;
        const entries = await readdir(dirPath, { recursive, withFileTypes: true });
        const results: { path: string; hasFrontmatter: boolean; tagCount: number }[] = [];

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
          const parentPath = "parentPath" in entry ? (entry as unknown as { parentPath: string }).parentPath : dirPath;
          const fullPath = join(parentPath, entry.name);
          const notePath = relative(vaultPath, fullPath);
          try {
            const raw = await readFile(fullPath, "utf-8");
            const parsed = parseFrontmatter(raw);
            const tags = getFrontmatterTags(parsed.data);
            results.push({ path: notePath, hasFrontmatter: parsed.hasFrontmatter, tagCount: tags.length });
          } catch {
            results.push({ path: notePath, hasFrontmatter: false, tagCount: 0 });
          }
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      } catch (err) {
        return errorResult(String(err));
      }
    },
  );

  const readNote = tool(
    "read_note",
    `Read a single note's content with parsed frontmatter and classified tags.

Use this when:
- Need to view a specific note's content, frontmatter, or tags
- Checking a note's current tag state before or after migration
- Verifying frontmatter integrity after a write operation

Do NOT use this for:
- Finding notes by tag or text pattern (use search_notes)
- Enumerating notes in a directory (use list_notes)
- Applying tag changes (use apply_tag_changes)

Performance notes:
- Minimal detail ~50 tokens; standard ~150 tokens; full ~500-2000 tokens
- For audit phase scanning all 884 notes, use "minimal" to stay under budget

Examples:
- read_note({ path: "daily/2025-01-15.md", detail: "minimal" }) — audit: count tags
- read_note({ path: "Projects/Blockfrost API.md", detail: "standard" }) — verify after migration
- read_note({ path: "Proposed Tagging System.md", detail: "full" }) — read scheme definition`,
    {
      path: z.string().describe("Relative path to the note from vault root."),
      detail: z.enum(["minimal", "standard", "full"]).optional().describe(
        'Detail level. "minimal": tags only (~50 tokens). "standard" (default): tags + first 200 chars. "full": everything.',
      ),
    },
    async ({ path: notePath, detail = "standard" }) => {
      try {
        const fullPath = safePath(vaultPath, notePath);
        const raw = await readFile(fullPath, "utf-8");
        const parsed = parseFrontmatter(raw);
        const frontmatterTags = getFrontmatterTags(parsed.data);
        const inlineTags = extractInlineTags(parsed.content);
        const allTags = [...new Set([...frontmatterTags, ...inlineTags])];
        const { validTags, noiseTags } = classifyTags(allTags);

        const result: Record<string, unknown> = {
          path: notePath,
          frontmatterTags,
          inlineTags,
          allTags: validTags,
          noiseTags,
        };

        if (detail === "standard" || detail === "full") {
          result.content = detail === "full" ? parsed.content : parsed.content.slice(0, 200);
          result.frontmatter = parsed.data;
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return errorResult(String(err));
      }
    },
  );

  const searchNotes = tool(
    "search_notes",
    `Find notes matching a tag name, text pattern, or directory filter.

Use this when:
- Finding all notes that use a specific tag (e.g., audit frequency counting)
- Searching for notes containing specific text patterns
- Scoping a batch to notes matching certain criteria

Do NOT use this for:
- Reading a note you already know the path of (use read_note)
- Getting a full directory listing (use list_notes)
- Modifying notes (use apply_tag_changes or write_note)

Performance notes:
- Returns ~30 tokens per match
- Tag search scans frontmatter and inline tags
- Text search scans note bodies (~500ms for full vault)
- Combine with directory to reduce scan scope

Examples:
- search_notes({ tag: "heading" }) — find all notes with the noise tag
- search_notes({ tag: "daily-reflection", directory: "Journal/" }) — scoped tag search
- search_notes({ text: "follow-up-required" }) — find obsolete workflow tags`,
    {
      tag: z.string().optional().describe("Tag name to search for (without # prefix)."),
      text: z.string().optional().describe("Text pattern to search in note bodies."),
      directory: z.string().optional().describe("Subdirectory to scope the search."),
    },
    async ({ tag, text, directory }) => {
      if (!tag && !text) {
        return errorResult("At least one of 'tag' or 'text' is required.");
      }

      try {
        const dirPath = directory ? safePath(vaultPath, directory) : vaultPath;
        const entries = await readdir(dirPath, { recursive: true, withFileTypes: true });
        const results: { path: string; matchContext: string }[] = [];

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
          const parentPath = "parentPath" in entry ? (entry as unknown as { parentPath: string }).parentPath : dirPath;
          const fullPath = join(parentPath, entry.name);
          const notePath = relative(vaultPath, fullPath);

          try {
            const raw = await readFile(fullPath, "utf-8");
            const parsed = parseFrontmatter(raw);

            if (tag) {
              const fmTags = getFrontmatterTags(parsed.data);
              const inTags = extractInlineTags(parsed.content);
              const allTags = [...fmTags, ...inTags];
              if (allTags.some((t) => t === tag || t.toLowerCase() === tag.toLowerCase())) {
                results.push({ path: notePath, matchContext: `Tag: ${tag}` });
                continue;
              }
            }

            if (text) {
              const idx = raw.toLowerCase().indexOf(text.toLowerCase());
              if (idx !== -1) {
                const start = Math.max(0, idx - 30);
                const end = Math.min(raw.length, idx + text.length + 30);
                results.push({ path: notePath, matchContext: raw.slice(start, end).replace(/\n/g, " ") });
              }
            }
          } catch {
            // skip unreadable files
          }
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      } catch (err) {
        return errorResult(String(err));
      }
    },
  );

  const writeNote = tool(
    "write_note",
    `Write or update a markdown note, used primarily for generating reports and audit artifacts.

Use this when:
- Writing audit reports, migration plans, or verification reports to the vault
- Creating new notes as agent artifacts (prefixed with _)
- Updating an existing report with new data

Do NOT use this for:
- Changing tags on a note (use apply_tag_changes — it handles inline removal + frontmatter updates atomically)
- Reading notes (use read_note)

Performance notes:
- Write operation ~20ms
- Creates parent directories if needed
- Safely serializes frontmatter via gray-matter — preserves existing fields when frontmatter is provided

Examples:
- write_note({ path: "_Tag Audit Report.md", content: "# Tag Audit\\n..." })
- write_note({ path: "_Tag Migration Plan.md", content: planMarkdown, frontmatter: { tags: ["type/report"] } })`,
    {
      path: z.string().describe("Relative path for the note within the vault."),
      content: z.string().describe("Markdown body content of the note."),
      frontmatter: z.record(z.string(), z.unknown()).optional().describe("Optional YAML frontmatter fields as key-value pairs."),
    },
    async ({ path: notePath, content, frontmatter }) => {
      try {
        const fullPath = safePath(vaultPath, notePath);
        let output: string;
        if (frontmatter && Object.keys(frontmatter).length > 0) {
          output = serializeFrontmatter(content, frontmatter);
        } else {
          output = content;
        }
        await mkdir(join(fullPath, ".."), { recursive: true });
        await writeFile(fullPath, output, "utf-8");
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, path: notePath }) }] };
      } catch (err) {
        return errorResult(String(err));
      }
    },
  );

  return [listNotes, readNote, searchNotes, writeNote];
}
