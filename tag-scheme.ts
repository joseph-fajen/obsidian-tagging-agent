import { z } from "zod";

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
