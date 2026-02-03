import { z } from "zod";
import { isNoiseTag } from "./lib/tag-parser.js";

export const TagCategorySchema = z.object({
  prefix: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()),
});

export const TagMappingSchema = z.object({
  from: z.array(z.string()),
  to: z.string().nullable(),
});

export const TagSchemeSchema = z.object({
  categories: z.array(TagCategorySchema),
  mappings: z.array(TagMappingSchema),
  removals: z.array(z.string()),
});

export type TagCategory = z.infer<typeof TagCategorySchema>;
export type TagMapping = z.infer<typeof TagMappingSchema>;
export type TagScheme = z.infer<typeof TagSchemeSchema>;

export function parseTagScheme(raw: unknown): TagScheme {
  return TagSchemeSchema.parse(raw);
}

export const NOISE_TAG_PATTERNS = {
  exact: ["heading"],
  prefixes: ["follow-up-required-"],
  containsChars: ["="],
};

export const SCHEME_NOTE_PATH = "Proposed Tagging System.md";

/**
 * Hardcoded tag mappings: old tag → new tag (or null to remove).
 * These are known, deterministic mappings that don't require LLM judgment.
 * Audit-discovered mappings supplement these at runtime.
 */
export const TAG_MAPPINGS: Record<string, string | null> = {
  // === NOISE / REMOVAL ===
  "heading": null,
  "follow-up-required-weekly": null,
  "follow-up-required-monthly": null,
  "follow-up-required-quarterly": null,

  // === STATUS MAPPINGS ===
  "todo": "status/pending",
  "to-do": "status/pending",
  "done": "status/completed",
  "finished": "status/completed",
  "completed": "status/completed",
  "archived": "status/archived",
  "in-progress": "status/in-progress",
  "wip": "status/in-progress",

  // === TYPE MAPPINGS ===
  "meeting-notes": "type/meeting",
  "meeting": "type/meeting",
  "daily-journal": "type/daily-note",
  "daily-notes": "type/daily-note",
  "daily-reflection": "type/daily-note",
  "research": "type/research",
  "research-notes": "type/research",
  "weekly-summary": "type/summary",
  "weekly_summary": "type/summary",
  "copilot-conversation": "type/conversation",
  "video-library": "type/resource",
  "appointment": "type/appointment",

  // === AREA MAPPINGS ===
  "career": "area/career",
  "health": "area/health",
  "health/vision": "area/health",
  "learning": "area/learning",

  // === PROJECT MAPPINGS ===
  "project-catalyst": "project/catalyst",

  // === CLEAN (already valid topic tags — no change needed) ===
  // These are explicitly listed so the worklist generator knows
  // they are "handled" and doesn't flag them as unmapped.
  // Value equals key = KEEP action.
  "ai-tools": "ai-tools",
  "technical-writing": "technical-writing",
  "blockchain": "blockchain",
  "productivity": "productivity",
  "meditation": "meditation",
  "spirituality": "spirituality",
  "prompting": "prompting",
};

export interface AuditMappings {
  mappings: Record<string, string | null>;
}

/**
 * Look up a tag in the mapping table.
 * Priority: noise patterns → hardcoded TAG_MAPPINGS → audit-discovered mappings → valid format check → unmapped.
 */
export function lookupTagMapping(
  tag: string,
  auditMappings?: AuditMappings,
): { action: "map" | "remove" | "keep" | "unmapped"; newTag: string | null } {
  const normalized = tag.toLowerCase().replace(/_/g, "-");

  // Check noise patterns first
  if (isNoiseTag(normalized)) {
    return { action: "remove", newTag: null };
  }

  // Check hardcoded mappings
  if (normalized in TAG_MAPPINGS) {
    const newTag = TAG_MAPPINGS[normalized];
    if (newTag === null) return { action: "remove", newTag: null };
    if (newTag === normalized) return { action: "keep", newTag };
    return { action: "map", newTag };
  }

  // Check audit-discovered mappings
  if (auditMappings && normalized in auditMappings.mappings) {
    const newTag = auditMappings.mappings[normalized];
    if (newTag === null) return { action: "remove", newTag: null };
    if (newTag === normalized) return { action: "keep", newTag };
    return { action: "map", newTag };
  }

  // Check if it's already a valid hierarchical tag
  const VALID_PREFIXES = ["status/", "type/", "area/", "project/"];
  if (VALID_PREFIXES.some((p) => normalized.startsWith(p))) {
    return { action: "keep", newTag: normalized };
  }

  // Check if it's a valid flat kebab-case topic tag
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(normalized)) {
    return { action: "keep", newTag: normalized };
  }

  return { action: "unmapped", newTag: null };
}
