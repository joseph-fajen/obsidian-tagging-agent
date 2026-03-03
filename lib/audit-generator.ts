import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { parseFrontmatter, getFrontmatterTags } from "./frontmatter.js";
import { extractInlineTags, classifyTags, isValidTagFormat, normalizeTag } from "./tag-parser.js";
import { scopeToNotes } from "./scope-filter.js";
import type { WorkScope } from "./types.js";

// === Audit data types ===

export interface TagInfo {
  /** Original tag as found in notes (may have case/format issues) */
  original: string;
  /** Normalized form (lowercase, hyphens) */
  normalized: string;
  /** Frequency count across all notes */
  count: number;
  /** Notes containing this tag */
  notePaths: string[];
  /** Where the tag appears */
  location: "frontmatter" | "inline" | "both";
  /** Whether this is a noise tag */
  isNoise: boolean;
  /** Whether format is valid (lowercase kebab-case) */
  isValidFormat: boolean;
  /** Format issues detected */
  formatIssues: string[];
}

export interface AuditData {
  generatedAt: string;
  generatedBy: string;
  schemeVersion: string;
  totalNotes: number;
  totalTaggedNotes: number;
  notesWithFrontmatter: number;
  notesWithInlineTags: number;
  uniqueTags: number;
  /** Tag frequencies for backward compatibility with plan phase */
  tagFrequencies: Record<string, number>;
  /** Detailed tag information */
  tags: TagInfo[];
  /** Tags with format issues (uppercase, underscores) */
  formatIssues: {
    tag: string;
    normalized: string;
    issues: string[];
    count: number;
  }[];
  /** Noise tags found */
  noiseTags: {
    tag: string;
    count: number;
  }[];
}

export interface AuditGeneratorResult {
  data: AuditData;
  warnings: string[];
  stats: {
    totalNotesScanned: number;
    notesWithTags: number;
    notesSkipped: number;
    uniqueTags: number;
    noiseTags: number;
    formatIssues: number;
  };
}

/**
 * Generate a complete tag audit by deterministically scanning every
 * note in the vault and cataloging all tags with frequencies.
 *
 * This function does NOT use the LLM. It produces the same output every time
 * for the same vault state.
 *
 * @param vaultPath - Path to the vault root
 * @param scope - Optional scope to filter notes (defaults to full vault)
 */
export async function generateAudit(
  vaultPath: string,
  scope?: WorkScope,
): Promise<AuditGeneratorResult> {
  const warnings: string[] = [];
  const tagMap = new Map<string, {
    original: string;
    normalized: string;
    count: number;
    notePaths: string[];
    inFrontmatter: boolean;
    inInline: boolean;
    isNoise: boolean;
  }>();

  let totalNotesScanned = 0;
  let notesWithTags = 0;
  let notesSkipped = 0;
  let notesWithFrontmatter = 0;
  let notesWithInlineTags = 0;

  // Get notes based on scope (defaults to full vault)
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

    // Skip files with Templater syntax in frontmatter
    const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const frontmatterContent = frontmatterMatch?.[1] || "";
    if (frontmatterContent.includes("<%") && frontmatterContent.includes("%>")) {
      warnings.push(`Skipping: Templater syntax in frontmatter: ${notePath}`);
      notesSkipped++;
      continue;
    }

    // Extract tags
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

    if (frontmatterTags.length > 0) notesWithFrontmatter++;
    if (inlineTags.length > 0) notesWithInlineTags++;

    const allTags = [...new Set([...frontmatterTags, ...inlineTags])];
    if (allTags.length === 0) continue;
    notesWithTags++;

    const { noiseTags } = classifyTags(allTags);
    const noiseSet = new Set(noiseTags);

    // Process each tag
    for (const tag of allTags) {
      const normalized = normalizeTag(tag);
      const key = normalized; // Use normalized form as key for deduplication

      const existing = tagMap.get(key);
      const inFrontmatter = frontmatterTags.includes(tag);
      const inInline = inlineTags.includes(tag);

      if (existing) {
        existing.count++;
        existing.notePaths.push(notePath);
        existing.inFrontmatter = existing.inFrontmatter || inFrontmatter;
        existing.inInline = existing.inInline || inInline;
        // If this occurrence has format issues, prefer it as original (for reporting)
        if (tag !== normalized && existing.original === existing.normalized) {
          existing.original = tag;
        }
      } else {
        tagMap.set(key, {
          original: tag,
          normalized,
          count: 1,
          notePaths: [notePath],
          inFrontmatter,
          inInline,
          isNoise: noiseSet.has(tag),
        });
      }
    }
  }

  // Build output structures
  const tags: TagInfo[] = [];
  const tagFrequencies: Record<string, number> = {};
  const formatIssuesMap = new Map<string, { tag: string; normalized: string; issues: string[]; count: number }>();
  const noiseTagsMap = new Map<string, number>();

  for (const [, info] of tagMap) {
    // Determine location
    let location: "frontmatter" | "inline" | "both";
    if (info.inFrontmatter && info.inInline) {
      location = "both";
    } else if (info.inFrontmatter) {
      location = "frontmatter";
    } else {
      location = "inline";
    }

    // Check format issues
    const formatIssues: string[] = [];
    if (info.original !== info.normalized) {
      if (/[A-Z]/.test(info.original)) {
        formatIssues.push("contains uppercase");
      }
      if (info.original.includes("_")) {
        formatIssues.push("contains underscores");
      }
    }
    if (!isValidTagFormat(info.normalized) && !info.isNoise) {
      formatIssues.push("invalid format");
    }

    const isValidFormat = formatIssues.length === 0;

    tags.push({
      original: info.original,
      normalized: info.normalized,
      count: info.count,
      notePaths: info.notePaths,
      location,
      isNoise: info.isNoise,
      isValidFormat,
      formatIssues,
    });

    // Build tagFrequencies for backward compatibility
    tagFrequencies[info.normalized] = info.count;

    // Track format issues
    if (formatIssues.length > 0) {
      formatIssuesMap.set(info.normalized, {
        tag: info.original,
        normalized: info.normalized,
        issues: formatIssues,
        count: info.count,
      });
    }

    // Track noise tags
    if (info.isNoise) {
      noiseTagsMap.set(info.normalized, info.count);
    }
  }

  // Sort tags by count descending
  tags.sort((a, b) => b.count - a.count);

  const formatIssues = Array.from(formatIssuesMap.values()).sort((a, b) => b.count - a.count);
  const noiseTags = Array.from(noiseTagsMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  const data: AuditData = {
    generatedAt: new Date().toISOString(),
    generatedBy: "deterministic-audit-generator",
    schemeVersion: "1.0",
    totalNotes: totalNotesScanned - notesSkipped,
    totalTaggedNotes: notesWithTags,
    notesWithFrontmatter,
    notesWithInlineTags,
    uniqueTags: tags.length,
    tagFrequencies,
    tags,
    formatIssues,
    noiseTags,
  };

  return {
    data,
    warnings,
    stats: {
      totalNotesScanned,
      notesWithTags,
      notesSkipped,
      uniqueTags: tags.length,
      noiseTags: noiseTags.length,
      formatIssues: formatIssues.length,
    },
  };
}

/**
 * Format the audit data as a markdown report suitable for the vault.
 */
export function formatAuditMarkdown(result: AuditGeneratorResult): string {
  const { data, stats } = result;
  const sections: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  // Header
  sections.push(`---`);
  sections.push(`tags:`);
  sections.push(`  - type/report`);
  sections.push(`date: '${today}'`);
  sections.push(`generated-by: deterministic-audit-generator`);
  sections.push(`---`);
  sections.push(``);
  sections.push(`# Tag Audit Report`);
  sections.push(``);

  // Executive Summary
  sections.push(`## Executive Summary`);
  sections.push(``);
  sections.push(`- **Total notes scanned:** ${stats.totalNotesScanned}`);
  sections.push(`- **Notes with tags:** ${stats.notesWithTags} (${((stats.notesWithTags / stats.totalNotesScanned) * 100).toFixed(1)}%)`);
  sections.push(`- **Unique tags found:** ${stats.uniqueTags}`);
  sections.push(`- **Notes with frontmatter tags:** ${data.notesWithFrontmatter}`);
  sections.push(`- **Notes with inline tags:** ${data.notesWithInlineTags}`);
  if (stats.notesSkipped > 0) {
    sections.push(`- **Notes skipped:** ${stats.notesSkipped} (Templater/parsing errors)`);
  }
  sections.push(`- **Generated by:** deterministic code (not LLM)`);
  sections.push(`- **Generated at:** ${data.generatedAt}`);
  sections.push(``);

  // Format Issues Summary
  if (stats.formatIssues > 0) {
    sections.push(`## ⚠️ Format Issues Detected`);
    sections.push(``);
    sections.push(`Found **${stats.formatIssues} tags** with format issues that need correction:`);
    sections.push(``);
    sections.push(`| Tag | Should Be | Issues | Count |`);
    sections.push(`|-----|-----------|--------|-------|`);
    for (const issue of data.formatIssues.slice(0, 20)) {
      sections.push(`| \`${issue.tag}\` | \`${issue.normalized}\` | ${issue.issues.join(", ")} | ${issue.count} |`);
    }
    if (data.formatIssues.length > 20) {
      sections.push(`| ... | ... | ... | ... |`);
      sections.push(`| *(${data.formatIssues.length - 20} more)* | | | |`);
    }
    sections.push(``);
  } else {
    sections.push(`## ✅ Format Validation`);
    sections.push(``);
    sections.push(`All tags follow proper lowercase kebab-case format.`);
    sections.push(``);
  }

  // Noise Tags
  if (stats.noiseTags > 0) {
    sections.push(`## 🗑️ Noise Tags`);
    sections.push(``);
    sections.push(`Found **${stats.noiseTags} noise tags** to remove:`);
    sections.push(``);
    sections.push(`| Tag | Count |`);
    sections.push(`|-----|-------|`);
    for (const noise of data.noiseTags) {
      sections.push(`| \`${noise.tag}\` | ${noise.count} |`);
    }
    sections.push(``);
  }

  // Tag Frequency Table (top 50)
  sections.push(`## Tag Frequency`);
  sections.push(``);
  sections.push(`| Tag | Count | Location | Format |`);
  sections.push(`|-----|-------|----------|--------|`);
  const displayTags = data.tags.filter(t => !t.isNoise).slice(0, 50);
  for (const tag of displayTags) {
    const formatStatus = tag.isValidFormat ? "✓" : "⚠️";
    sections.push(`| \`${tag.normalized}\` | ${tag.count} | ${tag.location} | ${formatStatus} |`);
  }
  if (data.tags.filter(t => !t.isNoise).length > 50) {
    sections.push(`| ... | ... | ... | ... |`);
    sections.push(`| *(${data.tags.filter(t => !t.isNoise).length - 50} more)* | | | |`);
  }
  sections.push(``);

  // Next Steps
  sections.push(`## Next Steps`);
  sections.push(``);
  sections.push(`1. Review the format issues above and decide on corrections`);
  sections.push(`2. Run \`bun run tagging-agent.ts plan\` to create the migration plan`);
  sections.push(`3. Run \`bun run tagging-agent.ts generate-worklist\` to build the worklist`);
  sections.push(`4. Run \`bun run tagging-agent.ts execute\` to apply changes`);
  sections.push(``);

  return sections.join("\n");
}

/**
 * Write the audit data to a JSON file for the plan phase.
 * Written to data/ directory (not vault) to prevent Obsidian indexing issues.
 */
export async function writeAuditJson(
  dataPath: string,
  data: AuditData,
): Promise<void> {
  const jsonPath = join(dataPath, "audit-data.json");
  await writeFile(jsonPath, JSON.stringify(data, null, 2), "utf-8");
}
