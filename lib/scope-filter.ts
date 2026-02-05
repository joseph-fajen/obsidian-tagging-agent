/**
 * Scope filtering for the Supervisor/Worker architecture.
 *
 * Provides functions to filter notes based on various scope criteria:
 * full vault, folder, specific files, recent modifications, or tag presence.
 */

import { readdir, stat, readFile } from "fs/promises";
import { join, relative } from "path";
import { parseFrontmatter, getFrontmatterTags } from "./frontmatter.js";
import { extractInlineTags } from "./tag-parser.js";
import type { WorkScope } from "./types.js";

/**
 * Get all markdown notes in the vault, excluding agent artifacts (prefixed with _).
 * Returns paths relative to vault root, sorted alphabetically.
 */
export async function getAllNotes(vaultPath: string): Promise<string[]> {
  const entries = await readdir(vaultPath, { recursive: true, withFileTypes: true });
  const notes: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    // Skip agent artifact notes (prefixed with _)
    if (entry.name.startsWith("_")) continue;

    const parentPath = "parentPath" in entry
      ? (entry as unknown as { parentPath: string }).parentPath
      : vaultPath;
    const fullPath = join(parentPath, entry.name);
    const notePath = relative(vaultPath, fullPath);
    notes.push(notePath);
  }

  return notes.sort();
}

/**
 * Get notes in a specific folder, including subdirectories.
 */
export async function getNotesInFolder(vaultPath: string, folderPath: string): Promise<string[]> {
  // Normalize folder path (remove trailing slash, handle leading slash)
  const normalizedFolder = folderPath.replace(/^\/+|\/+$/g, "");

  const allNotes = await getAllNotes(vaultPath);

  // Filter notes that start with the folder path
  return allNotes.filter(notePath => {
    // Handle exact match or path prefix (with /)
    return notePath === normalizedFolder ||
           notePath.startsWith(normalizedFolder + "/") ||
           notePath.startsWith(normalizedFolder + "\\");
  });
}

/**
 * Validate that file paths exist and are .md files.
 * Returns only the valid paths.
 */
export async function validateFilePaths(vaultPath: string, paths: string[]): Promise<string[]> {
  const validPaths: string[] = [];

  for (const notePath of paths) {
    // Skip non-markdown files
    if (!notePath.endsWith(".md")) continue;
    // Skip agent artifacts
    if (notePath.split("/").pop()?.startsWith("_")) continue;

    const fullPath = join(vaultPath, notePath);
    try {
      const stats = await stat(fullPath);
      if (stats.isFile()) {
        validPaths.push(notePath);
      }
    } catch {
      // File doesn't exist or isn't accessible
    }
  }

  return validPaths.sort();
}

/**
 * Get notes modified within the last N days.
 */
export async function getRecentNotes(vaultPath: string, days: number): Promise<string[]> {
  const allNotes = await getAllNotes(vaultPath);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffTime = cutoffDate.getTime();

  const recentNotes: string[] = [];

  for (const notePath of allNotes) {
    const fullPath = join(vaultPath, notePath);
    try {
      const stats = await stat(fullPath);
      if (stats.mtimeMs >= cutoffTime) {
        recentNotes.push(notePath);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return recentNotes.sort();
}

/**
 * Get notes that contain a specific tag (in frontmatter or inline).
 * Tag matching is case-insensitive.
 */
export async function getNotesByTag(vaultPath: string, tagName: string): Promise<string[]> {
  const allNotes = await getAllNotes(vaultPath);
  const normalizedTag = tagName.toLowerCase();
  const matchingNotes: string[] = [];

  for (const notePath of allNotes) {
    const fullPath = join(vaultPath, notePath);
    try {
      const raw = await readFile(fullPath, "utf-8");
      const parsed = parseFrontmatter(raw);
      const frontmatterTags = getFrontmatterTags(parsed.data).map(t => t.toLowerCase());
      const inlineTags = extractInlineTags(parsed.content); // Already lowercased

      const allTags = [...new Set([...frontmatterTags, ...inlineTags])];

      if (allTags.includes(normalizedTag)) {
        matchingNotes.push(notePath);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return matchingNotes.sort();
}

/**
 * Main dispatcher: convert a WorkScope to a list of note paths.
 */
export async function scopeToNotes(vaultPath: string, scope: WorkScope): Promise<string[]> {
  switch (scope.type) {
    case "full":
      return getAllNotes(vaultPath);

    case "folder":
      return getNotesInFolder(vaultPath, scope.path);

    case "files":
      return validateFilePaths(vaultPath, scope.paths);

    case "recent":
      return getRecentNotes(vaultPath, scope.days);

    case "tag":
      return getNotesByTag(vaultPath, scope.tagName);

    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = scope;
      throw new Error(`Unknown scope type: ${JSON.stringify(_exhaustive)}`);
  }
}

/**
 * Convert a WorkScope to a human-readable description.
 */
export function formatScope(scope: WorkScope): string {
  switch (scope.type) {
    case "full":
      return "all notes in the vault";

    case "folder":
      return `notes in folder "${scope.path}"`;

    case "files":
      if (scope.paths.length === 1) {
        return `file "${scope.paths[0]}"`;
      }
      return `${scope.paths.length} specific files`;

    case "recent":
      if (scope.days === 1) {
        return "notes modified today";
      }
      return `notes modified in the last ${scope.days} days`;

    case "tag":
      return `notes with tag "${scope.tagName}"`;

    default:
      return "unknown scope";
  }
}

/**
 * Validate and convert a raw scope object from tool input to a typed WorkScope.
 * Throws an error if the scope is invalid.
 */
export function validateScope(raw: {
  type: string;
  path?: string;
  paths?: string[];
  days?: number;
  tagName?: string;
}): WorkScope {
  switch (raw.type) {
    case "full":
      return { type: "full" };

    case "folder":
      if (!raw.path || typeof raw.path !== "string") {
        throw new Error("Folder scope requires a 'path' string");
      }
      return { type: "folder", path: raw.path };

    case "files":
      if (!raw.paths || !Array.isArray(raw.paths)) {
        throw new Error("Files scope requires a 'paths' array");
      }
      return { type: "files", paths: raw.paths };

    case "recent":
      if (typeof raw.days !== "number" || raw.days < 1) {
        throw new Error("Recent scope requires a positive 'days' number");
      }
      return { type: "recent", days: raw.days };

    case "tag":
      if (!raw.tagName || typeof raw.tagName !== "string") {
        throw new Error("Tag scope requires a 'tagName' string");
      }
      return { type: "tag", tagName: raw.tagName };

    default:
      throw new Error(`Unknown scope type: "${raw.type}"`);
  }
}
