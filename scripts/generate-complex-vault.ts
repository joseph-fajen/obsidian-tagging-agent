#!/usr/bin/env bun
/**
 * Generate a complex test vault for rigorous testing of the tagging agent.
 *
 * Usage:
 *   bun run scripts/generate-complex-vault.ts
 *   bun run scripts/generate-complex-vault.ts --clean  # Remove and regenerate
 *
 * This script generates ~85 notes with systematic coverage of:
 * - Tag format variants (uppercase, underscores, mixed)
 * - Noise tag patterns (Google Docs anchors, workflow tags)
 * - Folder structures (flat, nested, edge cases)
 * - Note types (daily, meeting, research, project, quick capture)
 * - Edge cases (many tags, duplicates, code blocks, URLs)
 *
 * Manual edge cases go in test-vault-complex/Manual/ and are preserved.
 */

import { mkdir, writeFile, rm, readdir } from "fs/promises";
import { join } from "path";

const VAULT_PATH = "./test-vault-complex";
const MANUAL_DIR = "Manual";

// Seeded random for reproducibility
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  pickN<T>(arr: T[], n: number): T[] {
    const shuffled = [...arr].sort(() => this.next() - 0.5);
    return shuffled.slice(0, n);
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

const rng = new SeededRandom(42);

// === Tag Definitions ===

// Valid tags (lowercase kebab-case)
const VALID_TAGS = [
  "ai-tools", "blockchain", "career", "productivity", "learning",
  "meditation", "prompting", "health", "spirituality", "defi",
  "smart-contracts", "web3", "obsidian", "note-taking", "leadership",
  "facilitation", "team-building", "documentation", "automation",
  "python", "typescript", "rust", "golang", "kubernetes",
];

// Tags with prefixes
const PREFIXED_TAGS = [
  "type/meeting", "type/daily-note", "type/research", "type/resource",
  "type/weekly-summary", "type/conversation", "type/reference",
  "status/pending", "status/in-progress", "status/completed", "status/archived",
  "area/career", "area/health", "area/learning", "area/finance",
  "project/catalyst", "project/phoenix", "project/atlas", "project/nexus",
  "tool/obsidian", "tool/vscode", "tool/cursor", "tool/notion",
];

// Format variants (uppercase, underscores, mixed)
const FORMAT_VARIANTS: Record<string, string[]> = {
  "ai-tools": ["AI-Tools", "AI_Tools", "ai_tools", "AITools", "Ai-Tools"],
  "blockchain": ["Blockchain", "BLOCKCHAIN", "block_chain", "Block_Chain"],
  "career": ["Career", "CAREER", "career_goals", "Career_Goals"],
  "productivity": ["Productivity", "PRODUCTIVITY", "productivity_tips"],
  "learning": ["Learning", "LEARNING", "learning_log", "Learning_Log"],
  "meeting-notes": ["meeting_notes", "Meeting_Notes", "MeetingNotes", "MEETING_NOTES"],
  "weekly-summary": ["weekly_summary", "Weekly_Summary", "WeeklySummary"],
  "technical-writing": ["technical_writing", "Technical_Writing", "TechnicalWriting"],
  "research": ["Research", "RESEARCH", "research_notes", "Research_Notes"],
};

// Noise tags
const NOISE_TAGS = [
  "heading", "heading=h.abc123", "heading=h.xyz789",
  "123", "456", "789",
  "follow-up-required-weekly", "follow-up-required-monthly", "follow-up-required-quarterly",
  "key=value", "data=export", "id=12345",
  "1", "2", "3",
];

// === Content Templates ===

const DAILY_NOTE_CONTENT = (date: string) => `
## Morning Reflection

- Woke up feeling {mood}
- Today's focus: {focus}

## Tasks

- [ ] {task1}
- [ ] {task2}
- [x] {task3}

## Notes

{notes}

## Evening Review

{review}
`;

const MEETING_NOTE_CONTENT = (title: string) => `
## Attendees

- {person1}
- {person2}
- {person3}

## Agenda

1. {agenda1}
2. {agenda2}
3. {agenda3}

## Discussion

{discussion}

## Action Items

- [ ] {action1} (@{person1})
- [ ] {action2} (@{person2})

## Next Steps

{next_steps}
`;

const RESEARCH_NOTE_CONTENT = (topic: string) => `
## Overview

{overview}

## Key Findings

### Finding 1
{finding1}

### Finding 2
{finding2}

## Code Example

\`\`\`typescript
// Example code with #fake-tag in comment
const data = fetch("https://example.com#anchor");
console.log(data);
\`\`\`

## Links

- [Resource 1](https://example.com/doc#heading=h.abc123)
- [Resource 2](https://docs.google.com/document#heading=h.xyz789)

## References

{references}
`;

const PROJECT_NOTE_CONTENT = (name: string) => `
## Project Overview

**Status:** {status}
**Priority:** {priority}
**Owner:** {owner}

## Goals

1. {goal1}
2. {goal2}

## Milestones

- [ ] Phase 1: {milestone1}
- [ ] Phase 2: {milestone2}
- [x] Phase 3: {milestone3}

## Notes

{notes}
`;

const QUICK_NOTE_CONTENT = () => `
{content}

---
Captured: {timestamp}
`;

const IMPORTED_NOTE_CONTENT = () => `
# Imported Document

> This note was imported from Google Docs and may contain formatting artifacts.

{content}

---
Original: https://docs.google.com/document/d/{docId}
Imported: {timestamp}
`;

// === Note Generators ===

interface GeneratedNote {
  path: string;
  content: string;
}

function formatFrontmatter(tags: string[], extraFields?: Record<string, string>): string {
  const lines = ["---"];
  if (tags.length > 0) {
    lines.push("tags:");
    for (const tag of tags) {
      lines.push(`  - ${tag}`);
    }
  }
  if (extraFields) {
    for (const [key, value] of Object.entries(extraFields)) {
      lines.push(`${key}: '${value}'`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function generateDailyNotes(): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const baseDate = new Date("2026-01-01");

  for (let i = 0; i < 14; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split("T")[0];

    // Mix of tag formats
    const tags: string[] = [];

    // Sometimes use valid format, sometimes variants
    if (rng.next() > 0.5) {
      tags.push("type/daily-note");
    } else {
      tags.push(rng.pick(["daily-note", "daily_note", "DailyNote", "daily-notes"]));
    }

    // Add some topic tags with format variants (deduplicated)
    const topicCount = rng.int(1, 3);
    const selectedTopics = new Set<string>();
    while (selectedTopics.size < topicCount) {
      const tag = rng.pick(VALID_TAGS);
      if (FORMAT_VARIANTS[tag] && rng.next() > 0.6) {
        selectedTopics.add(rng.pick(FORMAT_VARIANTS[tag]));
      } else {
        selectedTopics.add(tag);
      }
    }
    tags.push(...Array.from(selectedTopics));

    // Occasionally add noise tags (simulating copy-paste from docs)
    if (rng.next() > 0.7) {
      tags.push(rng.pick(NOISE_TAGS));
    }

    const frontmatter = formatFrontmatter(tags, { date: dateStr });
    const body = DAILY_NOTE_CONTENT(dateStr)
      .replace("{mood}", rng.pick(["energized", "tired", "focused", "scattered"]))
      .replace("{focus}", rng.pick(["deep work", "meetings", "learning", "planning"]))
      .replace("{task1}", "Review project status")
      .replace("{task2}", "Prepare presentation")
      .replace("{task3}", "Send follow-up emails")
      .replace("{notes}", "Made progress on #" + rng.pick(VALID_TAGS) + " research.")
      .replace("{review}", "Productive day overall.");

    notes.push({
      path: `Daily/${dateStr}.md`,
      content: frontmatter + "\n" + body,
    });
  }

  return notes;
}

function generateMeetingNotes(): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const meetings = [
    { name: "Team Standup", folder: "Meetings/Standups" },
    { name: "Project Review", folder: "Meetings/Reviews" },
    { name: "1:1 with Manager", folder: "Meetings/OneOnOnes" },
    { name: "Client Call", folder: "Meetings/External" },
    { name: "Sprint Planning", folder: "Meetings/Agile" },
    { name: "Retrospective", folder: "Meetings/Agile" },
    { name: "Architecture Review", folder: "Meetings/Technical" },
    { name: "Design Review", folder: "Meetings/Technical" },
  ];

  for (let i = 0; i < meetings.length; i++) {
    const meeting = meetings[i];
    const date = new Date("2026-01-15");
    date.setDate(date.getDate() + i * 2);
    const dateStr = date.toISOString().split("T")[0];

    const tags: string[] = [];

    // Mix meeting tag formats
    const meetingTagVariant = rng.pick([
      "type/meeting",
      "meeting",
      "meeting-notes",
      ...FORMAT_VARIANTS["meeting-notes"] || [],
    ]);
    tags.push(meetingTagVariant);

    // Add status tags
    if (rng.next() > 0.5) {
      tags.push(rng.pick(["status/completed", "done", "completed", "finished"]));
    }

    // Add project tags
    if (rng.next() > 0.4) {
      tags.push(rng.pick(PREFIXED_TAGS.filter(t => t.startsWith("project/"))));
    }

    // Add topic tags with variants
    tags.push(rng.pick([
      "productivity",
      ...FORMAT_VARIANTS["productivity"] || [],
      "team-building",
      "leadership",
    ]));

    // Deduplicate tags before creating frontmatter
    const uniqueTags = Array.from(new Set(tags));
    const frontmatter = formatFrontmatter(uniqueTags, { date: dateStr });
    const body = MEETING_NOTE_CONTENT(meeting.name)
      .replace(/{person\d}/g, () => rng.pick(["Alice", "Bob", "Carol", "Dave", "Eve"]))
      .replace(/{agenda\d}/g, () => rng.pick(["Status update", "Blockers", "Next steps", "Demo"]))
      .replace("{discussion}", "Discussed various topics related to #" + rng.pick(VALID_TAGS))
      .replace(/{action\d}/g, () => rng.pick(["Follow up", "Create ticket", "Schedule meeting"]))
      .replace("{next_steps}", "Continue work on current sprint.");

    notes.push({
      path: `${meeting.folder}/${meeting.name.replace(/ /g, "-")}-${dateStr}.md`,
      content: frontmatter + "\n" + body,
    });
  }

  return notes;
}

function generateResearchNotes(): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const topics = [
    { name: "AI Agent Architectures", tags: ["ai-tools", "automation"] },
    { name: "Blockchain Consensus", tags: ["blockchain", "defi"] },
    { name: "Kubernetes Patterns", tags: ["kubernetes", "automation"] },
    { name: "TypeScript Best Practices", tags: ["typescript", "documentation"] },
    { name: "Obsidian Plugin Development", tags: ["obsidian", "typescript"] },
    { name: "Prompt Engineering", tags: ["prompting", "ai-tools"] },
    { name: "Documentation as Code", tags: ["documentation", "automation"] },
    { name: "Web3 Identity", tags: ["web3", "blockchain"] },
    { name: "Smart Contract Security", tags: ["smart-contracts", "blockchain"] },
    { name: "Rust for Systems", tags: ["rust", "productivity"] },
    { name: "Go Concurrency", tags: ["golang", "productivity"] },
    { name: "Python Data Pipelines", tags: ["python", "automation"] },
  ];

  for (const topic of topics) {
    const tags: string[] = [];

    // Add research type tag with variants
    tags.push(rng.pick([
      "type/research",
      "research",
      ...FORMAT_VARIANTS["research"] || [],
      "research-notes",
    ]));

    // Add topic tags with format variants
    for (const tag of topic.tags) {
      if (FORMAT_VARIANTS[tag] && rng.next() > 0.5) {
        tags.push(rng.pick(FORMAT_VARIANTS[tag]));
      } else {
        tags.push(tag);
      }
    }

    // Add status
    tags.push(rng.pick(["status/in-progress", "in-progress", "wip", "status/pending"]));

    // Sometimes add noise (simulating copy from web)
    if (rng.next() > 0.6) {
      tags.push(rng.pick(NOISE_TAGS));
    }

    const frontmatter = formatFrontmatter(tags);
    const body = RESEARCH_NOTE_CONTENT(topic.name)
      .replace("{overview}", `Research into ${topic.name.toLowerCase()} and related concepts.`)
      .replace("{finding1}", "Key insight about the topic.")
      .replace("{finding2}", "Another important discovery.")
      .replace("{references}", "See linked resources above.");

    notes.push({
      path: `Research/${topic.name.replace(/ /g, "-")}.md`,
      content: frontmatter + "\n" + body,
    });
  }

  return notes;
}

function generateProjectNotes(): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const projects = [
    { name: "Project Catalyst", prefix: "catalyst" },
    { name: "Project Phoenix", prefix: "phoenix" },
    { name: "Project Atlas", prefix: "atlas" },
    { name: "Project Nexus", prefix: "nexus" },
  ];

  const subNotes = ["Overview", "Requirements", "Architecture", "Tasks", "Notes"];

  for (const project of projects) {
    for (const sub of subNotes) {
      const tags: string[] = [];

      // Project tag with variants
      tags.push(rng.pick([
        `project/${project.prefix}`,
        `project-${project.prefix}`,
        project.prefix,
      ]));

      // Type tag
      if (sub === "Overview") {
        tags.push("type/reference");
      } else if (sub === "Tasks") {
        tags.push(rng.pick(["status/in-progress", "in-progress", "todo", "wip"]));
      }

      // Topic tags
      tags.push(rng.pick(VALID_TAGS));
      if (rng.next() > 0.5) {
        const tag = rng.pick(VALID_TAGS);
        if (FORMAT_VARIANTS[tag]) {
          tags.push(rng.pick(FORMAT_VARIANTS[tag]));
        }
      }

      const frontmatter = formatFrontmatter(tags);
      const body = PROJECT_NOTE_CONTENT(project.name)
        .replace("{status}", rng.pick(["Active", "Planning", "On Hold"]))
        .replace("{priority}", rng.pick(["High", "Medium", "Low"]))
        .replace("{owner}", rng.pick(["Alice", "Bob", "Carol"]))
        .replace(/{goal\d}/g, () => "Achieve milestone")
        .replace(/{milestone\d}/g, () => "Complete phase")
        .replace("{notes}", "Working on #" + rng.pick(VALID_TAGS) + " integration.");

      notes.push({
        path: `Projects/${project.name.replace(/ /g, "-")}/${sub}.md`,
        content: frontmatter + "\n" + body,
      });
    }
  }

  return notes;
}

function generateQuickNotes(): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const ideas = [
    "Idea for automating deployment pipeline",
    "Notes from podcast about productivity",
    "Snippet for parsing YAML in TypeScript",
    "Thoughts on team communication",
    "Link to interesting article about AI",
    "Book recommendation from colleague",
    "Config snippet for VS Code",
    "Meeting prep notes",
    "Quick thoughts on project direction",
    "Reference for API design patterns",
  ];

  for (let i = 0; i < ideas.length; i++) {
    const idea = ideas[i];

    // Some quick notes have no frontmatter (realistic)
    // Some have minimal frontmatter
    // Some have inline tags only
    const variant = rng.int(0, 3);

    let content = "";
    const inlineTags: string[] = [];

    if (variant === 0) {
      // No frontmatter, inline tags only
      const tag1 = rng.pick(VALID_TAGS);
      const tag2 = rng.pick(VALID_TAGS);
      inlineTags.push(tag1, tag2);
      content = `# ${idea}\n\n${QUICK_NOTE_CONTENT()
        .replace("{content}", `Quick note about this topic. #${tag1} #${tag2}`)
        .replace("{timestamp}", new Date().toISOString())}`;
    } else if (variant === 1) {
      // Frontmatter with format variants
      const tags = [
        rng.pick(FORMAT_VARIANTS["productivity"] || ["productivity"]),
        rng.pick(VALID_TAGS),
      ];
      content = formatFrontmatter(tags) + "\n# " + idea + "\n\n" +
        QUICK_NOTE_CONTENT()
          .replace("{content}", "Quick capture of this thought.")
          .replace("{timestamp}", new Date().toISOString());
    } else if (variant === 2) {
      // Mix of frontmatter and inline
      const fmTags = [rng.pick(VALID_TAGS)];
      const inlineTag = rng.pick(VALID_TAGS);
      content = formatFrontmatter(fmTags) + "\n# " + idea + "\n\n" +
        QUICK_NOTE_CONTENT()
          .replace("{content}", `Notes here with #${inlineTag} inline.`)
          .replace("{timestamp}", new Date().toISOString());
    } else {
      // Heavy tags (many tags for stress testing)
      const tags = rng.pickN([...VALID_TAGS, ...PREFIXED_TAGS], 8);
      content = formatFrontmatter(tags) + "\n# " + idea + "\n\n" +
        QUICK_NOTE_CONTENT()
          .replace("{content}", "Note with many tags for categorization.")
          .replace("{timestamp}", new Date().toISOString());
    }

    notes.push({
      path: `Quick/${idea.replace(/ /g, "-").replace(/[^a-zA-Z0-9-]/g, "")}.md`,
      content,
    });
  }

  return notes;
}

function generateImportedNotes(): GeneratedNote[] {
  const notes: GeneratedNote[] = [];

  // Simulated Google Docs imports with typical noise
  const imports = [
    { name: "Q4 Planning Doc", noiseLevel: "high" },
    { name: "Product Requirements", noiseLevel: "medium" },
    { name: "Meeting Minutes Dec", noiseLevel: "high" },
    { name: "Technical Spec Draft", noiseLevel: "low" },
    { name: "Team Retrospective", noiseLevel: "medium" },
  ];

  for (const doc of imports) {
    const tags: string[] = [];

    // Add legitimate tags
    tags.push(rng.pick(["type/reference", "type/resource", "documentation"]));
    tags.push(rng.pick(VALID_TAGS));

    // Add noise based on level
    if (doc.noiseLevel === "high") {
      tags.push(...rng.pickN(NOISE_TAGS, 3));
    } else if (doc.noiseLevel === "medium") {
      tags.push(...rng.pickN(NOISE_TAGS, 2));
    } else {
      tags.push(rng.pick(NOISE_TAGS));
    }

    // Add format variants
    if (rng.next() > 0.5) {
      const tag = rng.pick(Object.keys(FORMAT_VARIANTS));
      tags.push(rng.pick(FORMAT_VARIANTS[tag]));
    }

    const frontmatter = formatFrontmatter(tags, { imported: new Date().toISOString().split("T")[0] });
    const body = IMPORTED_NOTE_CONTENT()
      .replace("{content}", `Content imported from ${doc.name}.\n\nSee [section](#heading=h.${rng.int(100000, 999999)}) for details.`)
      .replace("{docId}", `${rng.int(10000, 99999)}`)
      .replace("{timestamp}", new Date().toISOString());

    notes.push({
      path: `Imported/${doc.name.replace(/ /g, "-")}.md`,
      content: frontmatter + "\n" + body,
    });
  }

  return notes;
}

function generateAreaNotes(): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const areas = [
    { name: "Career Goals", tags: ["career", "area/career"] },
    { name: "Health Tracker", tags: ["health", "area/health"] },
    { name: "Learning Log", tags: ["learning", "area/learning"] },
    { name: "Finance Overview", tags: ["area/finance", "productivity"] },
    { name: "Relationships", tags: ["area/relationships", "spirituality"] },
  ];

  for (const area of areas) {
    const tags: string[] = [];

    // Add area tags with format variants
    for (const tag of area.tags) {
      if (FORMAT_VARIANTS[tag] && rng.next() > 0.4) {
        tags.push(rng.pick(FORMAT_VARIANTS[tag]));
      } else {
        tags.push(tag);
      }
    }

    // Add status
    tags.push(rng.pick(["status/in-progress", "in-progress", "active"]));

    const frontmatter = formatFrontmatter(tags, { type: "area" });
    const body = `# ${area.name}\n\nTracking progress in this area of life.\n\n## Goals\n\n- Goal 1\n- Goal 2\n\n## Progress\n\nOngoing work with #${rng.pick(VALID_TAGS)} focus.\n`;

    notes.push({
      path: `Areas/${area.name.replace(/ /g, "-")}.md`,
      content: frontmatter + "\n" + body,
    });
  }

  return notes;
}

function generateEdgeCaseNotes(): GeneratedNote[] {
  const notes: GeneratedNote[] = [];

  // Note with duplicate tags
  notes.push({
    path: "Generated-Edge-Cases/duplicate-tags.md",
    content: formatFrontmatter([
      "ai-tools", "ai-tools", "AI-Tools", "blockchain", "blockchain"
    ]) + "\n# Duplicate Tags Test\n\nThis note has duplicate tags in frontmatter.\n",
  });

  // Note with empty tag array
  notes.push({
    path: "Generated-Edge-Cases/empty-tags.md",
    content: "---\ntags: []\n---\n# Empty Tags\n\nNo tags in frontmatter but #inline-tag here.\n",
  });

  // Note with only noise tags
  notes.push({
    path: "Generated-Edge-Cases/only-noise.md",
    content: formatFrontmatter([
      "heading", "123", "follow-up-required-weekly", "key=value"
    ]) + "\n# Only Noise Tags\n\nAll tags on this note should be removed.\n",
  });

  // Note with tags in code blocks (should not be extracted as inline)
  notes.push({
    path: "Generated-Edge-Cases/tags-in-code.md",
    content: formatFrontmatter(["type/research"]) + `
# Tags in Code Blocks

Real inline tag: #blockchain

\`\`\`python
# This #fake-tag should not be extracted
comment = "#another-fake-tag"
\`\`\`

Inline code: \`#not-a-tag\` should be ignored.

Another real tag: #ai-tools
`,
  });

  // Note with tags in URLs
  notes.push({
    path: "Generated-Edge-Cases/tags-in-urls.md",
    content: formatFrontmatter(["documentation"]) + `
# Tags in URLs

See [this doc](https://example.com/page#section) for details.
Also check [Google Doc](https://docs.google.com/doc#heading=h.abc123).

Real tag: #productivity
`,
  });

  // Note with very long tag list
  const manyTags = [...VALID_TAGS.slice(0, 15), ...PREFIXED_TAGS.slice(0, 10)];
  notes.push({
    path: "Generated-Edge-Cases/many-tags.md",
    content: formatFrontmatter(manyTags) + "\n# Many Tags\n\nThis note has 25 tags for stress testing.\n",
  });

  // Note with mixed valid and invalid in same note
  notes.push({
    path: "Generated-Edge-Cases/mixed-formats.md",
    content: formatFrontmatter([
      "ai-tools",           // valid
      "AI-Tools",           // uppercase variant
      "ai_tools",           // underscore variant
      "type/research",      // valid prefix
      "Research",           // uppercase
      "heading",            // noise
      "123",                // noise
    ]) + "\n# Mixed Format Tags\n\nThis note has valid, variant, and noise tags together.\n",
  });

  // Note with nested folder path
  notes.push({
    path: "Generated-Edge-Cases/Deeply/Nested/Folder/Structure/note.md",
    content: formatFrontmatter(["type/reference", "documentation"]) +
      "\n# Deeply Nested Note\n\nTesting deep folder structures.\n",
  });

  return notes;
}

// === Main Generator ===

async function generateVault() {
  const clean = process.argv.includes("--clean");

  console.log("Generating complex test vault...\n");

  // Check if Manual/ exists and preserve it
  let manualExists = false;
  try {
    await readdir(join(VAULT_PATH, MANUAL_DIR));
    manualExists = true;
    console.log("Found Manual/ directory - will preserve it.\n");
  } catch {
    // Manual dir doesn't exist
  }

  if (clean) {
    console.log("Cleaning existing vault (preserving Manual/)...");
    // Remove all directories except Manual
    try {
      const entries = await readdir(VAULT_PATH);
      for (const entry of entries) {
        if (entry !== MANUAL_DIR) {
          await rm(join(VAULT_PATH, entry), { recursive: true, force: true });
        }
      }
    } catch {
      // Vault doesn't exist yet
    }
  }

  // Generate all notes
  const allNotes: GeneratedNote[] = [
    ...generateDailyNotes(),
    ...generateMeetingNotes(),
    ...generateResearchNotes(),
    ...generateProjectNotes(),
    ...generateQuickNotes(),
    ...generateImportedNotes(),
    ...generateAreaNotes(),
    ...generateEdgeCaseNotes(),
  ];

  console.log(`Generating ${allNotes.length} notes...\n`);

  // Create directories and write files
  const folders = new Set<string>();
  for (const note of allNotes) {
    const dir = join(VAULT_PATH, note.path.split("/").slice(0, -1).join("/"));
    folders.add(dir);
  }

  for (const folder of Array.from(folders)) {
    await mkdir(folder, { recursive: true });
  }

  for (const note of allNotes) {
    await writeFile(join(VAULT_PATH, note.path), note.content, "utf-8");
  }

  // Create Manual/ placeholder if it doesn't exist
  if (!manualExists) {
    await mkdir(join(VAULT_PATH, MANUAL_DIR), { recursive: true });
    await writeFile(
      join(VAULT_PATH, MANUAL_DIR, "README.md"),
      `# Manual Edge Cases

This folder contains manually curated edge cases that the generator
script doesn't create. These are preserved when regenerating the vault.

Add notes here for specific scenarios you've encountered in real vaults.

## Suggested additions:

- Complex Templater files
- Notes with unusual YAML structures
- Real-world import artifacts
- Edge cases from your actual vault
`,
      "utf-8"
    );
  }

  // Create schema note
  await writeFile(
    join(VAULT_PATH, "Proposed Tagging System.md"),
    `---
tags:
  - type/reference
---

# Proposed Tagging System

## Prefixes

- **type/** - Note types: \`type/meeting\`, \`type/daily-note\`, \`type/research\`
- **status/** - Workflow status: \`status/pending\`, \`status/in-progress\`, \`status/completed\`
- **area/** - Life areas: \`area/career\`, \`area/health\`, \`area/learning\`
- **project/** - Projects: \`project/catalyst\`, \`project/phoenix\`
- **tool/** - Tools: \`tool/obsidian\`, \`tool/vscode\`

## Topic Tags (no prefix)

Flat tags for topics: \`ai-tools\`, \`blockchain\`, \`productivity\`

## Format Requirements

- Lowercase kebab-case only
- No underscores
- No uppercase letters

## Tags to Remove

- \`heading\` - Google Docs noise
- Tags containing \`=\` - Google Docs anchors
- \`follow-up-required-*\` - Obsolete workflow tags
- Pure numbers - Noise
`,
    "utf-8"
  );

  // Print summary
  console.log("=".repeat(60));
  console.log("Complex test vault generated!");
  console.log("=".repeat(60));
  console.log(`Location: ${VAULT_PATH}`);
  console.log(`Total notes: ${allNotes.length}`);
  console.log("");
  console.log("Breakdown:");
  console.log(`  Daily notes:     ${allNotes.filter(n => n.path.startsWith("Daily/")).length}`);
  console.log(`  Meeting notes:   ${allNotes.filter(n => n.path.startsWith("Meetings/")).length}`);
  console.log(`  Research notes:  ${allNotes.filter(n => n.path.startsWith("Research/")).length}`);
  console.log(`  Project notes:   ${allNotes.filter(n => n.path.startsWith("Projects/")).length}`);
  console.log(`  Quick notes:     ${allNotes.filter(n => n.path.startsWith("Quick/")).length}`);
  console.log(`  Imported notes:  ${allNotes.filter(n => n.path.startsWith("Imported/")).length}`);
  console.log(`  Area notes:      ${allNotes.filter(n => n.path.startsWith("Areas/")).length}`);
  console.log(`  Edge cases:      ${allNotes.filter(n => n.path.startsWith("Generated-Edge-Cases/")).length}`);
  console.log("");
  console.log("Manual edge cases: " + join(VAULT_PATH, MANUAL_DIR));
  console.log("");
  console.log("To test:");
  console.log(`  VAULT_PATH=${VAULT_PATH} bun run tagging-agent.ts generate-audit`);
}

generateVault().catch(console.error);
