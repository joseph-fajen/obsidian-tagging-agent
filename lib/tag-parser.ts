const VALID_PREFIXES = ["status/", "type/", "area/", "project/"];

const FENCED_CODE_BLOCK_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE_RE = /`[^`]+`/g;
const MARKDOWN_LINK_URL_RE = /\]\([^)]*\)/g;

function stripCodeAndLinks(content: string): string {
  return content
    .replace(FENCED_CODE_BLOCK_RE, "")
    .replace(INLINE_CODE_RE, "")
    .replace(MARKDOWN_LINK_URL_RE, "");
}

const INLINE_TAG_RE = /(?:^|(?<=\s))#([a-zA-Z0-9][a-zA-Z0-9_/=-]*)/g;

export function extractInlineTags(content: string): string[] {
  const cleaned = stripCodeAndLinks(content);
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = INLINE_TAG_RE.exec(cleaned)) !== null) {
    tags.push(match[1]);
  }
  return tags;
}

export function isNoiseTag(tag: string): boolean {
  if (tag === "heading") return true;
  if (tag.includes("=")) return true;
  if (/^follow-up-required-/.test(tag)) return true;
  return false;
}

export function classifyTags(allTags: string[]): { validTags: string[]; noiseTags: string[] } {
  const validTags: string[] = [];
  const noiseTags: string[] = [];
  for (const tag of allTags) {
    if (isNoiseTag(tag)) {
      noiseTags.push(tag);
    } else {
      validTags.push(tag);
    }
  }
  return { validTags, noiseTags };
}

export function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/_/g, "-");
}

export function isValidTagFormat(tag: string): boolean {
  const hasPrefix = VALID_PREFIXES.some((p) => tag.startsWith(p));
  const body = hasPrefix
    ? tag.slice(tag.indexOf("/") + 1)
    : tag;
  if (body.length === 0) return false;
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(body);
}

export function removeInlineTag(content: string, tag: string): string {
  const segments: { text: string; isCode: boolean }[] = [];
  let lastIndex = 0;

  // Find all code blocks and inline code spans
  const codeRanges: { start: number; end: number }[] = [];
  for (const re of [FENCED_CODE_BLOCK_RE, INLINE_CODE_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      codeRanges.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  codeRanges.sort((a, b) => a.start - b.start);

  // Also find markdown link URLs
  MARKDOWN_LINK_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKDOWN_LINK_URL_RE.exec(content)) !== null) {
    codeRanges.push({ start: m.index, end: m.index + m[0].length });
  }
  codeRanges.sort((a, b) => a.start - b.start);

  // Split content into code/non-code segments
  for (const range of codeRanges) {
    if (range.start > lastIndex) {
      segments.push({ text: content.slice(lastIndex, range.start), isCode: false });
    }
    segments.push({ text: content.slice(range.start, range.end), isCode: true });
    lastIndex = range.end;
  }
  if (lastIndex < content.length) {
    segments.push({ text: content.slice(lastIndex), isCode: false });
  }
  if (segments.length === 0) {
    segments.push({ text: content, isCode: false });
  }

  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagRemoveRe = new RegExp(`(^|\\s)#${escapedTag}(?=\\s|$|[.,;:!?)])`, "g");

  return segments
    .map((seg) => {
      if (seg.isCode) return seg.text;
      return seg.text.replace(tagRemoveRe, (match, prefix) => {
        // If the tag was preceded by whitespace, keep one space only if there's content after
        return prefix ? " " : "";
      });
    })
    .join("")
    .replace(/ {2,}/g, " ")
    .replace(/^ /gm, "");
}
