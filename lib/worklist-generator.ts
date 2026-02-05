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
        case "keep":
          // Generate change if tag is inline (needs migration to frontmatter)
          if (isInline) {
            changes.push({ oldTag: tag, newTag: tag, reason: "inline-migration" });
            inlineMigrations++;
          }
          // Skip if tag is ONLY in frontmatter (truly no change needed)
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
      inlineMigrations,
    },
  };
}

/**
 * Extract mappings from various audit-data.json formats.
 * Supports both the expected format (mappings) and alternative formats
 * that the interactive agent may produce.
 */
function extractMappingsFromAuditData(data: Record<string, unknown>): Record<string, string | null> {
  const mappings: Record<string, string | null> = {};

  // Expected format: { mappings: { "old-tag": "new-tag" | null } }
  if (data.mappings && typeof data.mappings === "object") {
    Object.assign(mappings, data.mappings);
  }

  // Alternative format: { consolidationOpportunities: { *Priority: [{ migrationMap: {...} }] } }
  if (data.consolidationOpportunities && typeof data.consolidationOpportunities === "object") {
    const opportunities = data.consolidationOpportunities as Record<string, unknown>;

    // Process all priority levels (highPriority, mediumPriority, lowPriority)
    for (const priorityKey of Object.keys(opportunities)) {
      const priorityItems = opportunities[priorityKey];
      if (!Array.isArray(priorityItems)) continue;

      for (const item of priorityItems) {
        if (!item || typeof item !== "object") continue;
        const itemObj = item as Record<string, unknown>;

        // Extract migrationMap if present
        if (itemObj.migrationMap && typeof itemObj.migrationMap === "object") {
          Object.assign(mappings, itemObj.migrationMap);
        }

        // Extract targetTag for simple consolidations
        if (typeof itemObj.targetTag === "string" && Array.isArray(itemObj.currentTags)) {
          const targetTag = itemObj.targetTag as string;
          for (const oldTag of itemObj.currentTags) {
            if (typeof oldTag === "string" && oldTag !== targetTag) {
              mappings[oldTag] = targetTag;
            }
          }
        }
      }
    }
  }

  return mappings;
}

/**
 * Load audit-discovered mappings from data/ directory (or vault for backward compatibility).
 * Returns undefined if the file doesn't exist or can't be parsed.
 *
 * Supports both expected format ({ mappings: {...} }) and alternative formats
 * that the interactive agent may produce ({ consolidationOpportunities: {...} }).
 */
export async function loadAuditMappings(
  dataPath: string,
  vaultPath: string,
): Promise<AuditMappings | undefined> {
  // Try data/ first (new location)
  try {
    const raw = await readFile(join(dataPath, "audit-data.json"), "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;

    // Extract mappings from whatever format the agent used
    const extractedMappings = extractMappingsFromAuditData(data);

    if (Object.keys(extractedMappings).length > 0) {
      return { mappings: extractedMappings } as AuditMappings;
    }

    // Even if no mappings found, the file exists - return empty mappings
    // so we know audit was run (worklist generator will use hardcoded mappings)
    if (data) {
      return { mappings: {} } as AuditMappings;
    }
  } catch {
    // Fall through to vault
  }

  // Fallback: try vault (old location)
  try {
    const raw = await readFile(join(vaultPath, "_Tag Audit Data.json"), "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;

    const extractedMappings = extractMappingsFromAuditData(data);

    if (Object.keys(extractedMappings).length > 0) {
      return { mappings: extractedMappings } as AuditMappings;
    }

    if (data) {
      return { mappings: {} } as AuditMappings;
    }
  } catch {
    // No audit data found
  }

  return undefined;
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
