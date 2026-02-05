/**
 * Preview generator for the Supervisor/Worker architecture.
 *
 * Generates previews of tag changes without applying them,
 * allowing users to review what will happen before execution.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { parseFrontmatter, getFrontmatterTags } from "./frontmatter.js";
import { extractInlineTags, classifyTags } from "./tag-parser.js";
import { lookupTagMapping, type AuditMappings } from "../tag-scheme.js";
import { scopeToNotes, formatScope } from "./scope-filter.js";
import type { WorkScope, NotePreview, PreviewResult } from "./types.js";

/**
 * Default limit for preview results to manage token costs.
 */
export const DEFAULT_PREVIEW_LIMIT = 10;

/**
 * Generate a preview of tag changes for a given scope without applying them.
 *
 * @param vaultPath - Path to the vault root
 * @param scope - Scope specifying which notes to preview
 * @param auditMappings - Optional audit-discovered mappings
 * @param limit - Maximum number of notes to preview (default 10)
 * @returns Preview result with per-note changes and aggregate stats
 */
export async function generatePreview(
  vaultPath: string,
  scope: WorkScope,
  auditMappings?: AuditMappings,
  limit: number = DEFAULT_PREVIEW_LIMIT,
): Promise<PreviewResult> {
  const notePaths = await scopeToNotes(vaultPath, scope);
  const previews: NotePreview[] = [];
  let totalChanges = 0;
  let notesWithChanges = 0;

  // Track whether we truncated results
  const limitApplied = notePaths.length > limit;
  const notesToProcess = notePaths.slice(0, limit);

  for (const notePath of notesToProcess) {
    const fullPath = join(vaultPath, notePath);

    let raw: string;
    try {
      raw = await readFile(fullPath, "utf-8");
    } catch {
      // Skip unreadable files
      continue;
    }

    // Skip files with Templater syntax in frontmatter
    const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const frontmatterContent = frontmatterMatch?.[1] || "";
    if (frontmatterContent.includes("<%") && frontmatterContent.includes("%>")) {
      continue;
    }

    // Parse frontmatter and extract tags
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch {
      // Skip files with invalid YAML
      continue;
    }

    const frontmatterTags = getFrontmatterTags(parsed.data);
    const inlineTags = extractInlineTags(parsed.content);
    const allTags = [...new Set([...frontmatterTags, ...inlineTags])];
    const { noiseTags } = classifyTags(allTags);

    // Include noise tags for processing
    const tagsToProcess = [...new Set([...allTags, ...noiseTags])];

    if (tagsToProcess.length === 0) continue;

    // Build preview for this note
    const removals: string[] = [];
    const additions: string[] = [];
    const keeps: string[] = [];
    let inlineMigrations = 0;

    for (const tag of tagsToProcess) {
      const lookup = lookupTagMapping(tag, auditMappings);
      const isInline = inlineTags.includes(tag.toLowerCase());

      switch (lookup.action) {
        case "map":
          removals.push(tag);
          if (lookup.newTag && !additions.includes(lookup.newTag)) {
            additions.push(lookup.newTag);
          }
          break;

        case "remove":
          removals.push(tag);
          break;

        case "keep":
          if (isInline) {
            // Inline tag needs migration to frontmatter
            inlineMigrations++;
            // It's both a removal (from inline) and an addition (to frontmatter)
            // but since the tag stays, we count it as a keep with inline migration
            keeps.push(tag);
          } else {
            keeps.push(tag);
          }
          break;

        case "unmapped":
          // Unmapped tags are kept as-is
          keeps.push(tag);
          break;
      }
    }

    // Only include notes that have actual changes
    const hasChanges = removals.length > 0 || additions.length > 0 || inlineMigrations > 0;
    if (hasChanges) {
      notesWithChanges++;
      totalChanges += removals.length + additions.length;

      previews.push({
        path: notePath,
        removals,
        additions,
        keeps,
        inlineMigrations,
      });
    }
  }

  return {
    scope,
    previews,
    totalNotes: notesWithChanges,
    totalChanges,
    limitApplied,
  };
}

/**
 * Format a preview result for display in conversation.
 * Returns markdown suitable for showing to the user.
 */
export function formatPreviewForDisplay(preview: PreviewResult): string {
  const lines: string[] = [];

  // Header
  lines.push(`## Preview: ${formatScope(preview.scope)}`);
  lines.push("");

  // Summary stats
  lines.push(`**Notes with changes:** ${preview.totalNotes}`);
  lines.push(`**Total tag changes:** ${preview.totalChanges}`);
  if (preview.limitApplied) {
    lines.push(`*Preview limited to first ${preview.previews.length} notes*`);
  }
  lines.push("");

  // Per-note details
  if (preview.previews.length === 0) {
    lines.push("No changes needed for notes in this scope.");
  } else {
    lines.push("### Changes by Note");
    lines.push("");

    for (const notePreview of preview.previews) {
      lines.push(`**${notePreview.path}**`);

      if (notePreview.removals.length > 0) {
        lines.push(`- Remove: ${notePreview.removals.map(t => `\`${t}\``).join(", ")}`);
      }
      if (notePreview.additions.length > 0) {
        lines.push(`- Add: ${notePreview.additions.map(t => `\`${t}\``).join(", ")}`);
      }
      if (notePreview.inlineMigrations > 0) {
        lines.push(`- Migrate ${notePreview.inlineMigrations} inline tag(s) to frontmatter`);
      }
      if (notePreview.keeps.length > 0 && notePreview.removals.length === 0 && notePreview.additions.length === 0) {
        lines.push(`- Keep: ${notePreview.keeps.map(t => `\`${t}\``).join(", ")}`);
      }

      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Generate a concise summary string for the preview.
 */
export function formatPreviewSummary(preview: PreviewResult): string {
  const scopeDesc = formatScope(preview.scope);

  if (preview.totalNotes === 0) {
    return `Preview of ${scopeDesc}: No changes needed.`;
  }

  let summary = `Preview of ${scopeDesc}: ${preview.totalNotes} notes with ${preview.totalChanges} changes`;
  if (preview.limitApplied) {
    summary += ` (showing first ${preview.previews.length})`;
  }

  return summary;
}
