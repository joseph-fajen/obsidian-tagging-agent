import matter from "gray-matter";

export interface ParsedNote {
  data: Record<string, unknown>;
  content: string;
  hasFrontmatter: boolean;
}

export function parseFrontmatter(raw: string): ParsedNote {
  const hasFrontmatter = matter.test(raw);
  const { data, content } = matter(raw);
  return {
    data: data as Record<string, unknown>,
    content,
    hasFrontmatter,
  };
}

export function serializeFrontmatter(
  content: string,
  data: Record<string, unknown>,
): string {
  return matter.stringify(content, data);
}

export function getFrontmatterTags(data: Record<string, unknown>): string[] {
  const tags = data.tags;
  if (tags == null) return [];
  if (typeof tags === "string") return [tags];
  if (Array.isArray(tags)) return tags.filter((t): t is string => typeof t === "string");
  return [];
}

export function setFrontmatterTags(
  data: Record<string, unknown>,
  tags: string[],
): Record<string, unknown> {
  return { ...data, tags };
}
