# Bug Fixes: Three Critical Issues from Maiden Voyage

## Overview

Three bugs caused 4 notes to require manual intervention during the maiden voyage. All three are small fixes in the tag parsing and frontmatter libraries.

---

## Bug 1: Numeric Inline Tags Not Classified as Noise

### Symptom

The note `Partner Chains Links Reference.md` contained inline tag `#1`. This was not detected as a noise tag and was never removed by the agent.

### Root Cause

The `isNoiseTag()` function in `lib/tag-parser.ts` checks for:
- Tags containing `"heading"` (Google Docs anchors)
- Tags containing `"="` character
- Tags with `"follow-up-required-"` prefix

Purely numeric tags like `"1"`, `"123"`, `"2"` don't match any pattern.

### File to Modify

`lib/tag-parser.ts`

### Current Code (approximate)

```typescript
export function isNoiseTag(tag: string): boolean {
  // Normalize: remove leading # if present
  const normalized = tag.replace(/^#/, '').toLowerCase();
  
  // Google Docs anchor links: #heading=h.xxxxx
  if (normalized.includes('heading')) return true;
  if (normalized.includes('=')) return true;
  
  // Obsolete workflow tags
  if (normalized.startsWith('follow-up-required-')) return true;
  
  return false;
}
```

### Fixed Code

```typescript
export function isNoiseTag(tag: string): boolean {
  // Normalize: remove leading # if present
  const normalized = tag.replace(/^#/, '').toLowerCase();
  
  // Purely numeric tags are noise (e.g., "1", "123")
  if (/^\d+$/.test(normalized)) return true;
  
  // Google Docs anchor links: #heading=h.xxxxx
  if (normalized.includes('heading')) return true;
  if (normalized.includes('=')) return true;
  
  // Obsolete workflow tags
  if (normalized.startsWith('follow-up-required-')) return true;
  
  return false;
}
```

### Test Cases

Add to the relevant test file:

```typescript
import { describe, test, expect } from 'bun:test';
import { isNoiseTag } from '../lib/tag-parser';

describe('isNoiseTag - numeric tags', () => {
  test('single digit is noise', () => {
    expect(isNoiseTag('1')).toBe(true);
    expect(isNoiseTag('#1')).toBe(true);
  });
  
  test('multi-digit is noise', () => {
    expect(isNoiseTag('123')).toBe(true);
    expect(isNoiseTag('2025')).toBe(true);
  });
  
  test('alphanumeric is NOT noise', () => {
    expect(isNoiseTag('tag1')).toBe(false);
    expect(isNoiseTag('v2')).toBe(false);
    expect(isNoiseTag('2025-01-15')).toBe(false);
  });
});
```

---

## Bug 2: Frontmatter Tags with `#` Prefix Not Normalized

### Symptom

The note `Erlang SDK for Blockfrost API.md` had YAML frontmatter:

```yaml
tags:
  - "#project-catalyst"
```

The `getFrontmatterTags()` function returned `"#project-catalyst"` as-is. When `apply_tag_changes` looked for `oldTag: "project-catalyst"`, it couldn't match because of the `#` prefix.

### Root Cause

The `gray-matter` library parses `- #project-catalyst` as the string `"#project-catalyst"`. The `getFrontmatterTags()` function returns tags without normalization.

### File to Modify

`lib/frontmatter.ts`

### Current Code (approximate)

```typescript
export function getFrontmatterTags(frontmatter: Record<string, unknown>): string[] {
  const tags = frontmatter.tags;
  
  if (!tags) return [];
  if (typeof tags === 'string') return [tags];
  if (Array.isArray(tags)) return tags.filter(t => typeof t === 'string');
  
  return [];
}
```

### Fixed Code

```typescript
export function getFrontmatterTags(frontmatter: Record<string, unknown>): string[] {
  const tags = frontmatter.tags;
  
  if (!tags) return [];
  
  // Normalize: always return array, strip leading # from each tag
  const normalizeTag = (t: unknown): string | null => {
    if (typeof t !== 'string') return null;
    return t.replace(/^#/, '');
  };
  
  if (typeof tags === 'string') {
    const normalized = normalizeTag(tags);
    return normalized ? [normalized] : [];
  }
  
  if (Array.isArray(tags)) {
    return tags
      .map(normalizeTag)
      .filter((t): t is string => t !== null);
  }
  
  return [];
}
```

### Test Cases

```typescript
import { describe, test, expect } from 'bun:test';
import { getFrontmatterTags } from '../lib/frontmatter';

describe('getFrontmatterTags - hash prefix normalization', () => {
  test('strips # prefix from tags', () => {
    const frontmatter = { tags: ['#project-catalyst', 'blockfrost', '#api'] };
    expect(getFrontmatterTags(frontmatter)).toEqual(['project-catalyst', 'blockfrost', 'api']);
  });
  
  test('handles string tag with # prefix', () => {
    const frontmatter = { tags: '#single-tag' };
    expect(getFrontmatterTags(frontmatter)).toEqual(['single-tag']);
  });
  
  test('handles tags without # prefix (unchanged)', () => {
    const frontmatter = { tags: ['normal', 'tags'] };
    expect(getFrontmatterTags(frontmatter)).toEqual(['normal', 'tags']);
  });
  
  test('handles empty/missing tags', () => {
    expect(getFrontmatterTags({})).toEqual([]);
    expect(getFrontmatterTags({ tags: [] })).toEqual([]);
    expect(getFrontmatterTags({ tags: null })).toEqual([]);
  });
});
```

---

## Bug 3: Inline Tag Removal is Case-Sensitive

### Symptom

The note `Prompt for Plutus Onboarding Outline.md` contained inline tag `#Plutus-docs-design` (mixed case). The migration plan specified `oldTag: "plutus-docs-design"` (lowercase). The `removeInlineTag()` function couldn't match because the regex was case-sensitive.

### Root Cause

The `removeInlineTag()` function builds a regex from the tag name without the case-insensitive flag.

### File to Modify

`lib/tag-parser.ts`

### Current Code (approximate)

```typescript
export function removeInlineTag(content: string, tag: string): string {
  // Escape special regex characters in tag
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Match #tag followed by word boundary (not another word char or hyphen)
  const regex = new RegExp(`#${escapedTag}(?![\\w-])`, 'g');
  
  return content.replace(regex, '');
}
```

### Fixed Code

```typescript
export function removeInlineTag(content: string, tag: string): string {
  // Escape special regex characters in tag
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Match #tag followed by word boundary (not another word char or hyphen)
  // Use 'gi' flags for global AND case-insensitive matching
  const regex = new RegExp(`#${escapedTag}(?![\\w-])`, 'gi');
  
  return content.replace(regex, '');
}
```

### Test Cases

```typescript
import { describe, test, expect } from 'bun:test';
import { removeInlineTag } from '../lib/tag-parser';

describe('removeInlineTag - case insensitivity', () => {
  test('removes tag regardless of case', () => {
    const content = 'Some text #Plutus-docs-design more text';
    const result = removeInlineTag(content, 'plutus-docs-design');
    expect(result).toBe('Some text  more text');
  });
  
  test('removes uppercase tag with lowercase input', () => {
    const content = 'Text #AI-TOOLS here';
    const result = removeInlineTag(content, 'ai-tools');
    expect(result).toBe('Text  here');
  });
  
  test('removes mixed case variations', () => {
    const content = '#Tag1 and #TAG1 and #tag1';
    const result = removeInlineTag(content, 'tag1');
    expect(result).toBe(' and  and ');
  });
  
  test('still respects word boundaries', () => {
    const content = '#daily-notes and #daily-notes-archive';
    const result = removeInlineTag(content, 'daily-notes');
    // Should remove #daily-notes but NOT #daily-notes-archive
    expect(result).toBe(' and #daily-notes-archive');
  });
});
```

---

## Implementation Order

1. **Bug 2 first** — Frontmatter normalization affects how tags are read. Fix this before running any new migrations.

2. **Bug 1 second** — Numeric noise detection. Important for clean audits.

3. **Bug 3 third** — Case sensitivity. Important for execute phase reliability.

---

## Verification

After fixing all three bugs, run:

```bash
bun test
```

All new test cases should pass. Then verify manually:

```typescript
// Quick REPL verification
import { isNoiseTag, removeInlineTag } from './lib/tag-parser';
import { getFrontmatterTags } from './lib/frontmatter';

console.log(isNoiseTag('1'));  // true
console.log(isNoiseTag('tag1'));  // false

console.log(getFrontmatterTags({ tags: ['#foo', 'bar'] }));  // ['foo', 'bar']

console.log(removeInlineTag('text #Foo here', 'foo'));  // 'text  here'
```
