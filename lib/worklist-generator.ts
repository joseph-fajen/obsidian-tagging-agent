import { readdir, readFile } from "fs/promises";
import { join, relative } from "path";
import { parseFrontmatter, getFrontmatterTags } from "./frontmatter.js";
import { extractInlineTags, classifyTags } from "./tag-parser.js";
import { lookupTagMapping, type AuditMappings } from "../tag-scheme.js";

// === Worklist types (matching ARCHITECTURE_CHANGES.md schema) ===

export interface TagChange {
  oldTag: string;
  newTag: string | null;
}

export interface NoteChanges {
  path: string;
  changes: TagChange[];
}

export interface UnmappedTag {
  tag: string;
  occurrences: number;
  notePaths: string[];
}

export interface MigrationWorklist {
  generatedAt: string;
  schemeVersion: string;
  generatedBy: string;
  totalNotes: number;
  totalChanges: number;
  worklist: NoteChanges[];
  unmappedTags: UnmappedTag[];
}

export interface WorklistGeneratorResult {
  worklist: MigrationWorklist;
  warnings: string[];
  stats: {
    totalNotesScanned: number;
    notesWithTags: number;
    notesWithChanges: number;
    notesSkipped: number;
    totalChanges: number;
    unmappedTagCount: number;
  };
}

/**
 * Generate a complete migration worklist by deterministically scanning every
 * note in the vault and looking up each tag in the mapping table.
 *
 * This function does NOT use the LLM. It produces the same output every time
 * for the same vault state + mapping table.
 */
export async function generateWorklist(
  vaultPath: string,
  auditMappings?: AuditMappings,
): Promise<WorklistGeneratorResult> {
  const warnings: string[] = [];
  const worklist: NoteChanges[] = [];
  const unmappedTracker = new Map<string, { occurrences: number; notePaths: string[] }>();

  let totalNotesScanned = 0;
  let notesWithTags = 0;
  let notesSkipped = 0;
  let totalChanges = 0;

  // Read all files recursively
  const entries = await readdir(vaultPath, { recursive: true, withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    // Skip agent artifact notes (prefixed with _)
    if (entry.name.startsWith("_")) continue;

    const parentPath = "parentPath" in entry
      ? (entry as unknown as { parentPath: string }).parentPath
      : vaultPath;
    const fullPath = join(parentPath, entry.name);
    const notePath = relative(vaultPath, fullPath);

    totalNotesScanned++;

    let raw: string;
    try {
      raw = await readFile(fullPath, "utf-8");
    } catch (err) {
      warnings.push(`Could not read ${notePath}: ${err}`);
      notesSkipped++;
      continue;
    }

    // Skip Templater template files (contain unexpanded <% %> syntax)
    // These have unparseable YAML due to nested quotes in expressions
    if (raw.includes("<%") && raw.includes("%>")) {
      warnings.push(`Skipping template file (contains Templater syntax): ${notePath}`);
      notesSkipped++;
      continue;
    }

    // Extract all tags with graceful YAML error handling
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      warnings.push(`YAML parsing failed for ${notePath}: ${errMsg}`);
      notesSkipped++;
      continue;
    }
    const frontmatterTags = getFrontmatterTags(parsed.data);
    const inlineTags = extractInlineTags(parsed.content);
    const allTags = [...new Set([...frontmatterTags, ...inlineTags])];
    const { noiseTags } = classifyTags(allTags);

    // Include noise tags in the processing set (they need removal)
    const tagsToProcess = [...new Set([...allTags, ...noiseTags])];

    if (tagsToProcess.length === 0) continue;
    notesWithTags++;

    // Look up each tag and build changes
    const changes: TagChange[] = [];

    for (const tag of tagsToProcess) {
      const lookup = lookupTagMapping(tag, auditMappings);

      switch (lookup.action) {
        case "map":
          changes.push({ oldTag: tag, newTag: lookup.newTag });
          break;
        case "remove":
          changes.push({ oldTag: tag, newTag: null });
          break;
        case "keep":
          // No change needed — skip
          break;
        case "unmapped": {
          // Track for the unmapped report
          const existing = unmappedTracker.get(tag);
          if (existing) {
            existing.occurrences++;
            existing.notePaths.push(notePath);
          } else {
            unmappedTracker.set(tag, { occurrences: 1, notePaths: [notePath] });
          }
          break;
        }
      }
    }

    if (changes.length > 0) {
      worklist.push({ path: notePath, changes });
      totalChanges += changes.length;
    }
  }

  // Build unmapped tags list
  const unmappedTags: UnmappedTag[] = Array.from(unmappedTracker.entries())
    .map(([tag, data]) => ({ tag, ...data }))
    .sort((a, b) => b.occurrences - a.occurrences);

  const result: MigrationWorklist = {
    generatedAt: new Date().toISOString(),
    schemeVersion: "1.0",
    generatedBy: "deterministic-worklist-generator",
    totalNotes: worklist.length,
    totalChanges,
    worklist,
    unmappedTags,
  };

  return {
    worklist: result,
    warnings,
    stats: {
      totalNotesScanned,
      notesWithTags,
      notesWithChanges: worklist.length,
      notesSkipped,
      totalChanges,
      unmappedTagCount: unmappedTags.length,
    },
  };
}

/**
 * Load audit-discovered mappings from _Tag Audit Data.json if it exists.
 * Returns undefined if the file doesn't exist or can't be parsed.
 */
export async function loadAuditMappings(vaultPath: string): Promise<AuditMappings | undefined> {
  try {
    const raw = await readFile(join(vaultPath, "_Tag Audit Data.json"), "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data.mappings === "object") {
      return data as AuditMappings;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Format the worklist as a markdown section suitable for embedding
 * in _Tag Migration Plan.md.
 */
export function formatWorklistMarkdown(result: WorklistGeneratorResult): string {
  const { worklist, stats } = result;
  const sections: string[] = [];

  sections.push("## Worklist Generation Summary\n");
  sections.push(`- **Notes scanned:** ${stats.totalNotesScanned}`);
  sections.push(`- **Notes with tags:** ${stats.notesWithTags}`);
  sections.push(`- **Notes requiring changes:** ${stats.notesWithChanges}`);
  sections.push(`- **Total tag changes:** ${stats.totalChanges}`);
  sections.push(`- **Unmapped tags:** ${stats.unmappedTagCount}`);
  if (stats.notesSkipped > 0) {
    sections.push(`- **Notes skipped (read errors):** ${stats.notesSkipped}`);
  }
  sections.push(`- **Generated by:** deterministic code (not LLM)`);
  sections.push(`- **Generated at:** ${worklist.generatedAt}`);
  sections.push("");

  if (worklist.unmappedTags.length > 0) {
    sections.push("## Unmapped Tags Requiring Decisions\n");
    sections.push("| Tag | Occurrences | Example Notes |");
    sections.push("|-----|-------------|---------------|");
    for (const ut of worklist.unmappedTags) {
      const examples = ut.notePaths.slice(0, 3).join(", ");
      sections.push(`| \`${ut.tag}\` | ${ut.occurrences} | ${examples} |`);
    }
    sections.push("");
  }

  sections.push("## Machine-Parseable Worklist\n");
  sections.push("```json");
  sections.push(JSON.stringify(worklist, null, 2));
  sections.push("```");

  return sections.join("\n");
}
