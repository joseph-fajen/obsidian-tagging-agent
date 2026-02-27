import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { parseFrontmatter, getFrontmatterTags } from "./frontmatter.js";
import { extractInlineTags, classifyTags } from "./tag-parser.js";
import { lookupTagMapping, type AuditMappings } from "../tag-scheme.js";
import { scopeToNotes } from "./scope-filter.js";
import type { WorkScope } from "./types.js";

// === Worklist types (matching ARCHITECTURE_CHANGES.md schema) ===

export interface TagChange {
  oldTag: string;
  newTag: string | null;
  reason?: "format-change" | "inline-migration" | "noise-removal";
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

/**
 * Pre-computed batch for execute mode.
 * Written by checkExecutePrerequisites(), read by execute agent.
 */
export interface NextBatch {
  batchNumber: number;
  totalInWorklist: number;
  processedSoFar: number;
  remaining: number;
  entries: NoteChanges[];
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
    inlineMigrations: number;
  };
}

/**
 * Generate a complete migration worklist by deterministically scanning notes
 * in the vault and looking up each tag in the mapping table.
 *
 * This function does NOT use the LLM. It produces the same output every time
 * for the same vault state + mapping table.
 *
 * @param vaultPath - Path to the vault root
 * @param auditMappings - Optional audit-discovered mappings
 * @param scope - Optional scope to filter notes (defaults to full vault)
 */
export async function generateWorklist(
  vaultPath: string,
  auditMappings?: AuditMappings,
  scope?: WorkScope,
): Promise<WorklistGeneratorResult> {
  const warnings: string[] = [];
  const worklist: NoteChanges[] = [];
  const unmappedTracker = new Map<string, { occurrences: number; notePaths: string[] }>();

  let totalNotesScanned = 0;
  let notesWithTags = 0;
  let notesSkipped = 0;
  let totalChanges = 0;
  let inlineMigrations = 0;

  // Get notes based on scope (defaults to full vault)
  // scopeToNotes already excludes _ prefixed files
  const notePaths = await scopeToNotes(vaultPath, scope ?? { type: "full" });

  for (const notePath of notePaths) {
    const fullPath = join(vaultPath, notePath);
    totalNotesScanned++;

    let raw: string;
    try {
      raw = await readFile(fullPath, "utf-8");
    } catch (err) {
      warnings.push(`Could not read ${notePath}: ${err}`);
      notesSkipped++;
      continue;
    }

    // Skip files with Templater syntax IN THE FRONTMATTER (unparseable YAML)
    // Files with Templater in body only (e.g., cursor placeholders) are safe to parse
    const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const frontmatterContent = frontmatterMatch?.[1] || "";
    if (frontmatterContent.includes("<%") && frontmatterContent.includes("%>")) {
      warnings.push(`Skipping: Templater syntax in frontmatter: ${notePath}`);
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
      const isInline = inlineTags.includes(tag.toLowerCase());

      switch (lookup.action) {
        case "map":
          changes.push({ oldTag: tag, newTag: lookup.newTag, reason: "format-change" });
          break;
        case "remove":
          changes.push({ oldTag: tag, newTag: null, reason: "noise-removal" });
          break;
        case "keep": {
          // Check if original tag differs from newTag (case/format difference)
          // e.g., "AI-Tools" vs "ai-tools" — these should be format changes
          const needsFormatFix = tag !== lookup.newTag;

          if (needsFormatFix) {
            // Original tag has different case/format — treat as format change
            changes.push({ oldTag: tag, newTag: lookup.newTag, reason: "format-change" });
          } else if (isInline) {
            // Tag is inline but already correct format — just needs migration to frontmatter
            changes.push({ oldTag: tag, newTag: tag, reason: "inline-migration" });
            inlineMigrations++;
          }
          // Skip if tag is ONLY in frontmatter and already correct (truly no change needed)
          break;
        }
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
      inlineMigrations,
    },
  };
}

/**
 * Load mappings from plan-mappings.json.
 *
 * After the architecture cleanup, mappings come ONLY from the plan phase.
 * Audit-data.json no longer contains mappings — it only has tag frequencies.
 *
 * Returns undefined if plan-mappings.json doesn't exist.
 */
export async function loadMappings(
  dataPath: string,
  _vaultPath: string, // Kept for API compatibility
): Promise<AuditMappings | undefined> {
  try {
    const raw = await readFile(join(dataPath, "plan-mappings.json"), "utf-8");
    const data = JSON.parse(raw) as { mappings?: Record<string, string | null> };
    if (data.mappings && Object.keys(data.mappings).length > 0) {
      return { mappings: data.mappings };
    }
  } catch {
    // Plan mappings don't exist
  }

  return undefined;
}

// Keep old name as alias for backward compatibility (but deprecated)
/** @deprecated Use loadMappings instead */
export const loadAuditMappings = loadMappings;

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
  if (stats.inlineMigrations > 0) {
    sections.push(`- **Inline tag migrations:** ${stats.inlineMigrations} (valid tags moved to frontmatter)`);
  }
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
  sections.push("The full worklist is stored in the project's `data/` directory:");
  sections.push("- `data/migration-worklist.json` — Complete worklist for execute mode");
  sections.push("");
  sections.push("This file is not embedded here to prevent Obsidian indexing issues.");

  return sections.join("\n");
}

/**
 * Write the worklist to a separate JSON file for fast machine access.
 * This file is used by checkExecutePrerequisites() to compute batches.
 * Written to data/ directory (not vault) to prevent Obsidian indexing issues.
 */
export async function writeWorklistJson(
  dataPath: string,
  worklist: MigrationWorklist,
): Promise<void> {
  const jsonPath = join(dataPath, "migration-worklist.json");
  await writeFile(jsonPath, JSON.stringify(worklist, null, 2), "utf-8");
}
