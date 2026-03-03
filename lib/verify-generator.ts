/**
 * Deterministic verification generator for the Obsidian Vault Tagging Agent.
 *
 * This module provides code-driven verification of tag compliance,
 * replacing the unreliable LLM verify phase that only sampled notes.
 *
 * Checks performed:
 * 1. No inline tags remaining (all in frontmatter)
 * 2. No hash prefixes in frontmatter tags
 * 3. Valid tag formats (lowercase kebab-case with valid prefixes or flat topics)
 * 4. No duplicate tags (case-insensitive)
 * 5. No noise tags remaining
 */

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { parseFrontmatter } from "./frontmatter.js";
import { extractInlineTags, isValidTagFormat, normalizeTag, isNoiseTag } from "./tag-parser.js";
import { scopeToNotes } from "./scope-filter.js";
import type { WorkScope } from "./types.js";

/**
 * Get raw tags from frontmatter data WITHOUT stripping # prefix.
 * This is needed to detect hash prefix violations.
 */
function getRawFrontmatterTags(data: Record<string, unknown>): string[] {
  const tags = data.tags;
  if (tags == null) return [];
  if (typeof tags === "string") return [tags];
  if (Array.isArray(tags)) {
    return tags.filter((t): t is string => typeof t === "string");
  }
  return [];
}

/**
 * Check if a tag has format issues (before normalization).
 * Returns list of issues found.
 */
function checkTagFormatIssues(tag: string): string[] {
  const issues: string[] = [];

  // Strip # prefix for format checking
  const cleanTag = tag.startsWith("#") ? tag.slice(1) : tag;

  // Check for uppercase
  if (/[A-Z]/.test(cleanTag)) {
    issues.push("contains uppercase");
  }

  // Check for underscores
  if (cleanTag.includes("_")) {
    issues.push("contains underscores");
  }

  // After normalization, check if it's valid
  const normalized = normalizeTag(cleanTag);
  if (!isValidTagFormat(normalized) && !isNoiseTag(normalized)) {
    issues.push("invalid format");
  }

  return issues;
}

// === Verification data types ===

export interface NoteViolation {
  /** Relative path to the note from vault root */
  path: string;
  /** Tags found inline (should be in frontmatter) */
  inlineTags: string[];
  /** Tags with # prefix in frontmatter */
  hashPrefixTags: string[];
  /** Tags not matching lowercase kebab-case */
  invalidFormatTags: string[];
  /** Duplicate tags (case-insensitive) */
  duplicateTags: string[];
  /** Noise patterns that should be removed */
  noiseTags: string[];
}

export interface VerifyData {
  generatedAt: string;
  generatedBy: string;
  schemeVersion: string;
  totalNotes: number;
  notesCompliant: number;
  notesWithViolations: number;
  /** Overall compliance percentage */
  compliancePercent: number;
  /** Violation counts by type */
  violationCounts: {
    inlineTags: number;
    hashPrefixTags: number;
    invalidFormat: number;
    duplicates: number;
    noiseTags: number;
  };
  /** Notes with violations */
  violations: NoteViolation[];
  /** Tag distribution summary */
  tagSummary: {
    uniqueTags: number;
    tagsByPrefix: Record<string, number>;
    flatTopicTags: number;
  };
}

export interface VerifyGeneratorResult {
  data: VerifyData;
  warnings: string[];
  stats: {
    totalNotesScanned: number;
    notesCompliant: number;
    notesWithViolations: number;
    notesSkipped: number;
    inlineTagViolations: number;
    hashPrefixViolations: number;
    formatViolations: number;
    duplicateViolations: number;
    noiseTagViolations: number;
  };
}

/**
 * Check if a tag has a hash prefix (e.g., "#tag" in frontmatter).
 */
function hasHashPrefix(tag: string): boolean {
  return tag.startsWith("#");
}

/**
 * Find duplicate tags in a list (case-insensitive).
 * Returns the tags that appear more than once.
 */
function findDuplicates(tags: string[]): string[] {
  const seen = new Map<string, string>(); // normalized -> original
  const duplicates: string[] = [];

  for (const tag of tags) {
    const normalized = tag.toLowerCase();
    if (seen.has(normalized) && !duplicates.includes(tag)) {
      duplicates.push(tag);
      // Also include the original if not already
      const original = seen.get(normalized)!;
      if (!duplicates.includes(original)) {
        duplicates.push(original);
      }
    } else {
      seen.set(normalized, tag);
    }
  }

  return duplicates;
}

/**
 * Generate a complete verification scan by deterministically checking every
 * note in the vault for tag compliance.
 *
 * This function does NOT use the LLM. It produces the same output every time
 * for the same vault state.
 *
 * @param vaultPath - Path to the vault root
 * @param scope - Optional scope to filter notes (defaults to full vault)
 */
export async function generateVerify(
  vaultPath: string,
  scope?: WorkScope,
): Promise<VerifyGeneratorResult> {
  const warnings: string[] = [];
  const violations: NoteViolation[] = [];
  const tagSet = new Set<string>();
  const tagsByPrefix: Record<string, number> = {};
  let flatTopicCount = 0;

  let totalNotesScanned = 0;
  let notesCompliant = 0;
  let notesWithViolations = 0;
  let notesSkipped = 0;

  // Violation counters (notes with each type)
  let inlineTagViolations = 0;
  let hashPrefixViolations = 0;
  let formatViolations = 0;
  let duplicateViolations = 0;
  let noiseTagViolations = 0;

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

    // Parse frontmatter
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      warnings.push(`YAML parsing failed for ${notePath}: ${errMsg}`);
      notesSkipped++;
      continue;
    }

    // Get RAW tags from frontmatter (before stripping #)
    const rawFrontmatterTags = getRawFrontmatterTags(parsed.data);
    const inlineTags = extractInlineTags(parsed.content);

    // Build violation record for this note
    const noteViolation: NoteViolation = {
      path: notePath,
      inlineTags: [],
      hashPrefixTags: [],
      invalidFormatTags: [],
      duplicateTags: [],
      noiseTags: [],
    };

    // Check 1: Inline tags remaining
    if (inlineTags.length > 0) {
      noteViolation.inlineTags = inlineTags;
    }

    // Check 2: Hash prefixes in frontmatter
    for (const tag of rawFrontmatterTags) {
      if (hasHashPrefix(tag)) {
        noteViolation.hashPrefixTags.push(tag);
      }
    }

    // Check 3: Invalid format (check BEFORE normalization for uppercase/underscores)
    for (const tag of rawFrontmatterTags) {
      const cleanTag = hasHashPrefix(tag) ? tag.slice(1) : tag;

      // Check for format issues (uppercase, underscores)
      const formatIssues = checkTagFormatIssues(tag);
      if (formatIssues.length > 0) {
        noteViolation.invalidFormatTags.push(tag);
      }

      const normalized = normalizeTag(cleanTag);

      // Track tag statistics (using normalized form)
      tagSet.add(normalized);

      // Check if it's a prefixed tag
      const prefixMatch = normalized.match(/^([a-z]+)\//);
      if (prefixMatch) {
        const prefix = prefixMatch[1];
        tagsByPrefix[prefix] = (tagsByPrefix[prefix] || 0) + 1;
      } else if (!isNoiseTag(normalized)) {
        flatTopicCount++;
      }
    }

    // Check 4: Duplicate tags (using cleaned tags without # prefix)
    const cleanedFrontmatterTags = rawFrontmatterTags.map(t => hasHashPrefix(t) ? t.slice(1) : t);
    const duplicates = findDuplicates(cleanedFrontmatterTags);
    if (duplicates.length > 0) {
      noteViolation.duplicateTags = duplicates;
    }

    // Check 5: Noise tags remaining
    for (const tag of rawFrontmatterTags) {
      const cleanTag = hasHashPrefix(tag) ? tag.slice(1) : tag;
      const normalized = normalizeTag(cleanTag);
      if (isNoiseTag(normalized)) {
        noteViolation.noiseTags.push(tag);
      }
    }
    // Also check inline tags for noise
    for (const tag of inlineTags) {
      if (isNoiseTag(tag)) {
        noteViolation.noiseTags.push(tag);
      }
    }

    // Determine if this note has any violations
    const hasViolations =
      noteViolation.inlineTags.length > 0 ||
      noteViolation.hashPrefixTags.length > 0 ||
      noteViolation.invalidFormatTags.length > 0 ||
      noteViolation.duplicateTags.length > 0 ||
      noteViolation.noiseTags.length > 0;

    if (hasViolations) {
      notesWithViolations++;
      violations.push(noteViolation);

      // Update violation type counters
      if (noteViolation.inlineTags.length > 0) inlineTagViolations++;
      if (noteViolation.hashPrefixTags.length > 0) hashPrefixViolations++;
      if (noteViolation.invalidFormatTags.length > 0) formatViolations++;
      if (noteViolation.duplicateTags.length > 0) duplicateViolations++;
      if (noteViolation.noiseTags.length > 0) noiseTagViolations++;
    } else {
      notesCompliant++;
    }
  }

  // Calculate compliance percentage
  const scannedCount = totalNotesScanned - notesSkipped;
  const compliancePercent = scannedCount > 0
    ? (notesCompliant / scannedCount) * 100
    : 100;

  const data: VerifyData = {
    generatedAt: new Date().toISOString(),
    generatedBy: "deterministic-verify-generator",
    schemeVersion: "1.0",
    totalNotes: scannedCount,
    notesCompliant,
    notesWithViolations,
    compliancePercent,
    violationCounts: {
      inlineTags: inlineTagViolations,
      hashPrefixTags: hashPrefixViolations,
      invalidFormat: formatViolations,
      duplicates: duplicateViolations,
      noiseTags: noiseTagViolations,
    },
    violations,
    tagSummary: {
      uniqueTags: tagSet.size,
      tagsByPrefix,
      flatTopicTags: flatTopicCount,
    },
  };

  return {
    data,
    warnings,
    stats: {
      totalNotesScanned,
      notesCompliant,
      notesWithViolations,
      notesSkipped,
      inlineTagViolations,
      hashPrefixViolations,
      formatViolations,
      duplicateViolations,
      noiseTagViolations,
    },
  };
}

/**
 * Format the verification data as a markdown report suitable for the vault.
 */
export function formatVerifyMarkdown(result: VerifyGeneratorResult): string {
  const { data, stats } = result;
  const sections: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  // Header
  sections.push(`---`);
  sections.push(`tags:`);
  sections.push(`  - type/report`);
  sections.push(`date: '${today}'`);
  sections.push(`generated-by: deterministic-verify-generator`);
  sections.push(`---`);
  sections.push(``);
  sections.push(`# Tag Migration Verification Report`);
  sections.push(``);

  // Executive Summary
  sections.push(`## Executive Summary`);
  sections.push(``);

  const complianceStr = data.compliancePercent.toFixed(1);
  if (data.notesWithViolations === 0) {
    sections.push(`**✅ PASS — ${complianceStr}% Compliance**`);
    sections.push(``);
    sections.push(`All ${data.totalNotes} notes pass verification. The migration is complete!`);
  } else {
    sections.push(`**⚠️ ${complianceStr}% Compliance — ${data.notesWithViolations} notes need attention**`);
    sections.push(``);
    sections.push(`- **Notes scanned:** ${data.totalNotes}`);
    sections.push(`- **Notes compliant:** ${data.notesCompliant}`);
    sections.push(`- **Notes with violations:** ${data.notesWithViolations}`);
  }
  sections.push(``);

  // Violation Summary
  if (data.notesWithViolations > 0) {
    sections.push(`## Violation Summary`);
    sections.push(``);
    sections.push(`| Violation Type | Notes Affected |`);
    sections.push(`|----------------|----------------|`);
    if (data.violationCounts.inlineTags > 0) {
      sections.push(`| Inline tags remaining | ${data.violationCounts.inlineTags} |`);
    }
    if (data.violationCounts.hashPrefixTags > 0) {
      sections.push(`| Hash prefix in frontmatter | ${data.violationCounts.hashPrefixTags} |`);
    }
    if (data.violationCounts.invalidFormat > 0) {
      sections.push(`| Invalid tag format | ${data.violationCounts.invalidFormat} |`);
    }
    if (data.violationCounts.duplicates > 0) {
      sections.push(`| Duplicate tags | ${data.violationCounts.duplicates} |`);
    }
    if (data.violationCounts.noiseTags > 0) {
      sections.push(`| Noise tags remaining | ${data.violationCounts.noiseTags} |`);
    }
    sections.push(``);

    // Detailed Violations
    sections.push(`## Notes with Violations`);
    sections.push(``);

    for (const violation of data.violations.slice(0, 50)) {
      sections.push(`### \`${violation.path}\``);
      sections.push(``);

      if (violation.inlineTags.length > 0) {
        sections.push(`- **Inline tags:** ${violation.inlineTags.map(t => `\`#${t}\``).join(", ")}`);
      }
      if (violation.hashPrefixTags.length > 0) {
        sections.push(`- **Hash prefix:** ${violation.hashPrefixTags.map(t => `\`${t}\``).join(", ")}`);
      }
      if (violation.invalidFormatTags.length > 0) {
        sections.push(`- **Invalid format:** ${violation.invalidFormatTags.map(t => `\`${t}\``).join(", ")}`);
      }
      if (violation.duplicateTags.length > 0) {
        sections.push(`- **Duplicates:** ${violation.duplicateTags.map(t => `\`${t}\``).join(", ")}`);
      }
      if (violation.noiseTags.length > 0) {
        sections.push(`- **Noise tags:** ${violation.noiseTags.map(t => `\`${t}\``).join(", ")}`);
      }
      sections.push(``);
    }

    if (data.violations.length > 50) {
      sections.push(`*... and ${data.violations.length - 50} more notes with violations*`);
      sections.push(``);
    }
  }

  // Tag Distribution Summary
  sections.push(`## Tag Distribution`);
  sections.push(``);
  sections.push(`- **Unique tags in use:** ${data.tagSummary.uniqueTags}`);
  sections.push(`- **Flat topic tags:** ${data.tagSummary.flatTopicTags}`);
  sections.push(``);

  if (Object.keys(data.tagSummary.tagsByPrefix).length > 0) {
    sections.push(`### Tags by Prefix`);
    sections.push(``);
    sections.push(`| Prefix | Count |`);
    sections.push(`|--------|-------|`);
    const sortedPrefixes = Object.entries(data.tagSummary.tagsByPrefix)
      .sort((a, b) => b[1] - a[1]);
    for (const [prefix, count] of sortedPrefixes) {
      sections.push(`| \`${prefix}/\` | ${count} |`);
    }
    sections.push(``);
  }

  // Statistics
  sections.push(`## Statistics`);
  sections.push(``);
  sections.push(`- **Notes scanned:** ${stats.totalNotesScanned}`);
  if (stats.notesSkipped > 0) {
    sections.push(`- **Notes skipped:** ${stats.notesSkipped} (Templater/parsing errors)`);
  }
  sections.push(`- **Generated by:** deterministic code (not LLM)`);
  sections.push(`- **Generated at:** ${data.generatedAt}`);
  sections.push(``);

  // Next Steps
  if (data.notesWithViolations > 0) {
    sections.push(`## Next Steps`);
    sections.push(``);
    sections.push(`1. Review the violations listed above`);
    sections.push(`2. Fix any issues manually or re-run the migration`);
    sections.push(`3. Run \`bun run tagging-agent.ts verify\` again to confirm compliance`);
    sections.push(``);
  } else {
    sections.push(`## Next Steps`);
    sections.push(``);
    sections.push(`Your vault is fully compliant! You can:`);
    sections.push(`1. Delete the agent artifact notes (files starting with \`_\`)`);
    sections.push(`2. Clear the \`data/\` directory to remove migration state`);
    sections.push(`3. Enjoy your organized vault!`);
    sections.push(``);
  }

  return sections.join("\n");
}

/**
 * Write the verification data to a JSON file for programmatic access.
 * Written to data/ directory (not vault) to prevent Obsidian indexing issues.
 */
export async function writeVerifyJson(
  dataPath: string,
  data: VerifyData,
): Promise<void> {
  const jsonPath = join(dataPath, "verify-data.json");
  await writeFile(jsonPath, JSON.stringify(data, null, 2), "utf-8");
}
