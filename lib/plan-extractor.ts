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
  };
  warnings: string[];
}

/**
 * Regex to match mapping table rows.
 * Expected format: | `old-tag` | `new-tag` or (remove) or ? | ACTION | notes |
 *
 * Handles variations:
 * - Backticks optional (some LLMs might omit them)
 * - Whitespace flexible (tight or spaced formatting)
 * - Action case-insensitive
 * - New tag can be: `tag`, (remove), or ?
 *
 * Captures:
 * - Group 1: old tag (without backticks)
 * - Group 2: new tag (without backticks), or undefined for (remove)/?
 * - Group 3: action (MAP, REMOVE, KEEP, UNMAPPED)
 */
const TABLE_ROW_REGEX = /^\|\s*`?([^`|\n]+?)`?\s*\|\s*(?:`([^`|\n]+?)`|\(remove\)|\?)\s*\|\s*(MAP|REMOVE|KEEP|UNMAPPED)\s*\|/gim;

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

  // Reset regex state
  TABLE_ROW_REGEX.lastIndex = 0;

  let match;
  while ((match = TABLE_ROW_REGEX.exec(markdown)) !== null) {
    const [, oldTag, newTag, action] = match;
    const normalizedOld = oldTag.toLowerCase().trim();
    const upperAction = action.toUpperCase();

    switch (upperAction) {
      case "MAP":
        if (newTag) {
          mappings[normalizedOld] = newTag.toLowerCase().trim();
          mapActions++;
        } else {
          warnings.push(`MAP action for "${oldTag}" has no new tag`);
        }
        break;
      case "REMOVE":
        mappings[normalizedOld] = null;
        removeActions++;
        break;
      case "KEEP":
        // KEEP means tag stays as-is; store identity mapping
        mappings[normalizedOld] = normalizedOld;
        keepActions++;
        break;
      case "UNMAPPED":
        // Don't add to mappings — these need user decision
        unmappedActions++;
        break;
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
