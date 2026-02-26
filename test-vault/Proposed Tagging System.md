---
tags:
  - type/reference
date: 2026-02-25
---

# Proposed Tagging System

This note defines the tagging schema for my Obsidian vault. The tagging agent will use this to migrate my existing tags into a clean, hierarchical system.

## Tag Categories

### status/ — Workflow state
Tracks where a note is in my workflow.

- `status/pending` — Not yet started, in the queue
- `status/in-progress` — Currently working on
- `status/completed` — Done, no further action needed
- `status/archived` — No longer relevant, kept for reference

### type/ — Note classification
What kind of note is this?

- `type/daily-note` — Daily journal or reflection
- `type/meeting` — Meeting notes, 1:1s, standups
- `type/research` — Deep dives, explorations, comparisons
- `type/summary` — Weekly/monthly rollups
- `type/reference` — Documentation, guides, how-tos
- `type/idea` — Quick captures, brainstorms

### area/ — Life domains
Broad areas of responsibility or interest.

- `area/career` — Work, professional development
- `area/health` — Physical and mental wellness
- `area/learning` — Education, skill building
- `area/finance` — Money, investments
- `area/relationships` — Family, friends, networking

### project/ — Active projects
Specific initiatives with defined outcomes.

- `project/catalyst` — Project Catalyst work
- (Add more as projects emerge)

## Topic Tags

Topic tags are **flat** (no prefix) and use **lowercase kebab-case**.

Examples: `ai-tools`, `blockchain`, `productivity`, `meditation`

Any lowercase kebab-case tag without a prefix is considered a valid topic tag. These represent subjects or themes that cut across areas and projects.

## Tags to Remove (Noise)

These tags should be deleted during migration:

- `heading` — Artifact from Google Docs imports
- Any tag containing `=` — Google Docs anchor links
- Tags starting with `follow-up-required-` — Old workflow system
- Purely numeric tags like `123` — Meaningless noise

## Migration Rules

Map these legacy tags to the new schema:

| Old Tag | New Tag | Reason |
|---------|---------|--------|
| `learning` | `area/learning` | Promote to area |
| `career` | `area/career` | Promote to area |
| `health` | `area/health` | Promote to area |
| `research` | `type/research` | Classify as type |
| `research-notes` | `type/research` | Consolidate variant |
| `daily-reflection` | `type/daily-note` | Classify as type |
| `daily-notes` | `type/daily-note` | Consolidate variant |
| `meeting-notes` | `type/meeting` | Classify as type |
| `meeting` | `type/meeting` | Consolidate variant |
| `weekly-summary` | `type/summary` | Classify as type |
| `weekly_summary` | `type/summary` | Fix underscore |
| `todo` | `status/pending` | Standardize status |
| `wip` | `status/in-progress` | Standardize status |
| `done` | `status/completed` | Standardize status |

## Inline Tag Policy

All tags should live in YAML frontmatter, not inline in the body. The migration will move any `#inline-tags` to frontmatter.
