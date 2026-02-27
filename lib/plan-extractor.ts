import { readFile, writeFile } from "fs/promises";
import { join } from "path";

/**
 * Result of extracting mappings from plan markdown.
 */
export interface PlanExtractionResult {
  success: boolean;
  mappings: Record<string, string | null>;
  stats: {
    totalMappings: number;
    mapActions: number;
    removeActions: number;
    keepActions: number;
    unmappedActions: number;
    fixActions: number;
  };
  warnings: string[];
}

/**
 * Regex to match mapping table rows.
 * Expected format: | `old-tag` | `new-tag` or (remove) or — or ? | ACTION | notes |
 *
 * Handles variations:
 * - Backticks optional around BOTH old and new tags
 * - Whitespace flexible (tight or spaced formatting)
 * - Action case-insensitive
 * - New tag can be: `tag`, bare-tag, (remove), —, -, or ?
 * - Action can be bold: **MAP**, **KEEP**, etc.
 * - Action column may have extra text after action word (e.g., "**MAP** to `type/reference`")
 * - Action can be "Fix Format", "Fix Case", "Fix Case + Map" — treated as MAP
 *
 * Captures:
 * - Group 1: old tag (without backticks)
 * - Group 2: new tag (backtick-enclosed), or undefined
 * - Group 3: new tag (bare, no backticks), or undefined
 * - Group 4: action (MAP, REMOVE, KEEP, UNMAPPED, or FIX for format/case fixes)
 *
 * Note: Either group 2 or group 3 will capture the new tag, depending on whether
 * the LLM used backticks. Code must check both: `newTag = match[2] || match[3]`
 */
const TABLE_ROW_REGEX = /^\|\s*`?([^`|\n]+?)`?\s*\|\s*(?:`([^`|\n]+?)`|([a-z][a-z0-9/_-]*)|—|-|\(remove\)|\?|)\s*\|\s*\*?\*?(MAP|REMOVE|KEEP|UNMAPPED|FIX)\*?\*?[^|]*\|/gim;

/**
 * Extract tag mappings from a plan markdown string.
 * Parses the mapping table and converts to machine-readable format.
 */
export function extractMappingsFromMarkdown(markdown: string): PlanExtractionResult {
  const mappings: Record<string, string | null> = {};
  const warnings: string[] = [];
  let mapActions = 0;
  let removeActions = 0;
  let keepActions = 0;
  let unmappedActions = 0;
  let fixActions = 0;

  // Reset regex state
  TABLE_ROW_REGEX.lastIndex = 0;

  let match;
  while ((match = TABLE_ROW_REGEX.exec(markdown)) !== null) {
    const [, oldTag, backtickedNewTag, bareNewTag, action] = match;
    const newTag = backtickedNewTag || bareNewTag; // Either group may capture the new tag
    const normalizedOld = oldTag.toLowerCase().trim();
    const upperAction = action.toUpperCase();

    // Determine the new value before checking for collisions
    let newValue: string | null | undefined;

    switch (upperAction) {
      case "MAP":
        if (newTag) {
          newValue = newTag.toLowerCase().trim();
          mapActions++;
        } else {
          warnings.push(`MAP action for "${oldTag}" has no new tag`);
        }
        break;
      case "FIX":
        // "Fix Format", "Fix Case", "Fix Case + Map" — all treated as MAP
        if (newTag) {
          newValue = newTag.toLowerCase().trim();
          fixActions++;
        } else {
          warnings.push(`FIX action for "${oldTag}" has no new tag`);
        }
        break;
      case "REMOVE":
        newValue = null;
        removeActions++;
        break;
      case "KEEP":
        // KEEP means tag stays as-is; store identity mapping
        newValue = normalizedOld;
        keepActions++;
        break;
      case "UNMAPPED":
        // Don't add to mappings — these need user decision
        unmappedActions++;
        break;
    }

    // Store mapping and warn on collisions
    if (newValue !== undefined) {
      if (normalizedOld in mappings) {
        const existingValue = mappings[normalizedOld];
        if (existingValue !== newValue) {
          warnings.push(
            `Key collision: "${normalizedOld}" already mapped to "${existingValue}", ` +
            `overwriting with "${newValue}" (from "${oldTag}")`
          );
        }
      }
      mappings[normalizedOld] = newValue;
    }
  }

  const totalMappings = Object.keys(mappings).length;

  return {
    success: totalMappings > 0,
    mappings,
    stats: {
      totalMappings,
      mapActions,
      removeActions,
      keepActions,
      unmappedActions,
      fixActions,
    },
    warnings,
  };
}

/**
 * Read plan markdown from vault and extract mappings.
 * Returns null if plan file doesn't exist.
 */
export async function extractMappingsFromPlanFile(
  vaultPath: string
): Promise<PlanExtractionResult | null> {
  const planPath = join(vaultPath, "_Tag Migration Plan.md");

  try {
    const markdown = await readFile(planPath, "utf-8");
    return extractMappingsFromMarkdown(markdown);
  } catch {
    // File doesn't exist
    return null;
  }
}

/**
 * Write extracted mappings to plan-mappings.json.
 */
export async function writePlanMappingsJson(
  dataPath: string,
  mappings: Record<string, string | null>,
  schemeNotePath: string
): Promise<void> {
  const output = {
    generatedAt: new Date().toISOString(),
    generatedBy: "plan-extractor",
    schemeNotePath,
    mappings,
  };

  const jsonPath = join(dataPath, "plan-mappings.json");
  await writeFile(jsonPath, JSON.stringify(output, null, 2), "utf-8");
}
