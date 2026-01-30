# PRD: Obsidian Vault Tagging Agent

## 1. Executive Summary

This project builds a proactive AI agent using the Claude Agent SDK that audits, plans, and executes a comprehensive tag migration across an Obsidian vault. The vault contains 884 markdown notes with inconsistent tagging — a mix of inline `#tags` and YAML frontmatter tags, redundant naming, no hierarchical structure, and noise tags from external sources like Google Docs anchor links.

A proposed tagging system already exists in the vault (`Proposed Tagging System.md`) defining five hierarchical categories: `status/`, `type/`, `area/`, `project/`, and flat topic tags. The agent's job is to analyze every existing tag in the vault, produce a complete mapping from old tags to the new scheme, and apply that mapping — moving all tags into YAML frontmatter, removing obsolete tags, and producing audit reports at each phase.

The MVP goal is a working agent that can run the full audit-plan-execute-verify lifecycle on the vault, with MCP tools for structured vault access, git-based rollback safety, and budget controls to manage API costs.

## 2. Mission

**Mission statement:** Bring order to a knowledge worker's Obsidian vault by intelligently migrating hundreds of inconsistent tags to a clean, hierarchical tagging system — safely, incrementally, and with full auditability.

**Core principles:**

1. **Safety first** — Every batch of changes is wrapped in git commits. No change is irreversible.
2. **Human-in-the-loop** — The agent produces plans and reports for review before executing destructive changes.
3. **Incremental execution** — Process notes in manageable batches to control costs and risk.
4. **Vault-native artifacts** — All reports, plans, and audit logs are written as Obsidian markdown notes so the user can review them in their normal workflow.
5. **Structured tool access** — The agent interacts with the vault through defined MCP tools, not raw filesystem access, ensuring predictable and auditable behavior.

## 3. Target Users

**Primary persona:** Joseph — a technical documentation professional who uses Obsidian as his primary knowledge management tool. He has a vault of ~884 notes spanning work projects (IOG/IOHK, Blockfrost, Plutus), career planning, personal growth, daily reflections, and AI/automation interests.

- **Technical comfort:** High. Comfortable with CLI tools, TypeScript, git, and AI agents.
- **Pain points:**
  - Tags are inconsistent across the vault (inline vs. frontmatter, casing variations, duplicate/synonym tags)
  - No hierarchical organization — flat tags make filtering difficult
  - Manual retagging of 884 notes is impractical
  - Existing proposed tagging system has not been implemented beyond a tiny fraction of notes
  - Noise tags (e.g., `#heading` from Google Docs links) pollute tag-based views
- **Key needs:**
  - Confidence that the proposed tagging scheme is comprehensive and correct for his vault
  - Automated migration with ability to review before changes are applied
  - Easy rollback if something goes wrong
  - Cost-controlled execution

## 4. MVP Scope

### In Scope — Core Functionality
- ✅ Full vault tag audit: scan all 884 notes, catalog every tag (inline and frontmatter), count frequencies
- ✅ Tag classification: map every existing tag to the proposed scheme (or flag as unmapped/noise)
- ✅ Gap analysis: identify tags not covered by the proposed scheme and suggest additions
- ✅ Migration plan generation: produce a per-note plan showing old tags → new tags
- ✅ Batch execution: apply tag changes to notes in configurable batch sizes
- ✅ Tag standardization: move all tags to YAML frontmatter format
- ✅ Noise tag removal: strip `#heading` (Google Docs anchors) and `#follow-up-required-*` workflow tags
- ✅ Verification report: post-migration audit confirming consistency

### In Scope — Technical
- ✅ Claude Agent SDK with streaming (`query()` with `for await`)
- ✅ Custom MCP tools for vault operations (`read_note`, `write_note`, `list_notes`, `read_tags`, `apply_tag_changes`, `search_notes`)
- ✅ YAML frontmatter parsing via `gray-matter`
- ✅ Git auto-commit before and after each batch
- ✅ Budget controls via `maxBudgetUsd`
- ✅ Configurable batch size
- ✅ Reports written as markdown notes in the vault

### In Scope — Integration
- ✅ Filesystem access to local Obsidian vault
- ✅ Git CLI for commit operations
- ✅ Bun runtime

### Out of Scope
- ❌ Real-time Obsidian plugin integration (agent runs as CLI, not inside Obsidian)
- ❌ Scheduled/cron execution (can be added later; MVP is manual invocation)
- ❌ Note content analysis beyond tags (no rewriting note bodies)
- ❌ Folder restructuring
- ❌ Tag-based link/backlink updates
- ❌ Multi-vault support
- ❌ Web UI or dashboard
- ❌ Obsidian REST API integration (filesystem only for MVP)

## 5. User Stories

### Primary User Stories

1. **As a vault owner, I want to see a complete audit of every tag in my vault**, so that I understand the current state before making changes.
   - *Example:* Agent produces `_Tag Audit Report.md` in the vault listing all 200+ unique tags, their frequencies, which notes use them, and whether they're inline or frontmatter.

2. **As a vault owner, I want the agent to classify every existing tag against my proposed scheme**, so that I can see which tags map cleanly and which need attention.
   - *Example:* `#daily-reflection` → `type/daily-note`, `#todo` → `status/pending`, `#heading` → REMOVE (noise), `#content-creation` → UNMAPPED (needs decision).

3. **As a vault owner, I want the agent to identify gaps in my proposed tagging scheme**, so that I can refine the scheme before migration.
   - *Example:* Agent flags that `#content-creation` (167 uses), `#productivity-tools` (153 uses), and `#strategic-breakthrough` (123 uses) have no mapping and suggests where they might fit.

4. **As a vault owner, I want to review a migration plan before any changes are made**, so that I can approve, reject, or modify the proposed changes.
   - *Example:* Agent writes `_Tag Migration Plan.md` showing each note and its planned tag changes. User reviews in Obsidian and either approves or edits.

5. **As a vault owner, I want changes applied in small batches with git commits**, so that I can easily revert any batch that doesn't look right.
   - *Example:* Agent processes 50 notes, commits with message "Tag migration batch 1/18: notes A-Z in Archive/", then pauses for next invocation.

6. **As a vault owner, I want all my tags moved to YAML frontmatter**, so that I have a single, consistent location for tags across all notes.
   - *Example:* A note with `#blockchain` inline and `tags: [cardano]` in frontmatter becomes `tags: [blockchain, cardano]` in frontmatter only.

7. **As a vault owner, I want a post-migration verification report**, so that I can confirm the migration completed correctly.
   - *Example:* Agent produces `_Tag Migration Verification.md` confirming: 884 notes processed, 0 notes with inline tags remaining, all tags conform to scheme.

### Technical User Stories

8. **As a developer, I want the agent's vault access limited to defined MCP tools**, so that the agent cannot make unexpected changes to my files.

9. **As a developer, I want configurable budget caps per run**, so that I don't accidentally incur excessive API costs.

## 6. Core Architecture & Patterns

### High-Level Architecture

```
┌─────────────────────────────────────────────┐
│              Tagging Agent (main)            │
│  Claude Agent SDK + query() streaming        │
│  Model: claude-sonnet-4                      │
│  permissionMode: bypassPermissions           │
│  maxBudgetUsd: configurable                  │
├─────────────────────────────────────────────┤
│              MCP Tool Server                 │
│  createSdkMcpServer() with Zod schemas      │
│                                              │
│  Tools:                                      │
│  ├── list_notes      (read vault index)      │
│  ├── read_note       (read single note)      │
│  ├── read_tags       (extract tags from note)│
│  ├── search_notes    (find notes by tag/text)│
│  ├── write_note      (write/update note)     │
│  ├── apply_tag_changes (structured retag)    │
│  └── git_commit      (commit with message)   │
├─────────────────────────────────────────────┤
│           Vault Filesystem Layer             │
│  gray-matter (YAML frontmatter parsing)      │
│  Direct .md file read/write                  │
│  Git CLI for commits                         │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│         Obsidian Vault (filesystem)          │
│  /Users/josephfajen/git/obsidian-jpf         │
│  884 .md files, git-tracked                  │
└─────────────────────────────────────────────┘
```

### Directory Structure

```
claude-agent-sdk-proactive-agent/
├── tagging-agent.ts          # Main entry point for tagging agent
├── tools/
│   ├── vault-tools.ts        # MCP tool definitions (list, read, write, search)
│   ├── tag-tools.ts          # Tag-specific tools (read_tags, apply_tag_changes)
│   └── git-tools.ts          # Git commit tool
├── lib/
│   ├── frontmatter.ts        # gray-matter wrapper for safe YAML parsing
│   ├── tag-parser.ts         # Extract inline tags and frontmatter tags
│   └── config.ts             # Configuration (vault path, batch size, budget)
├── tag-scheme.ts             # Proposed tagging scheme definition + mappings
├── agent.ts                  # Original research agent (unchanged)
├── advanced-agent.ts         # Original advanced agent (unchanged)
├── package.json
├── tsconfig.json
└── PRD.md
```

### Key Design Patterns

- **Phased execution model:** The agent operates in distinct modes (audit, plan, execute, verify) selected via CLI argument. Each phase is a separate invocation with its own budget cap.
- **MCP tool boundary:** All vault access goes through MCP tools. The agent's system prompt instructs it on which tools to use and in what order. The tools enforce safe operations (e.g., `apply_tag_changes` validates tag format before writing).
- **Vault-native reporting:** All intermediate and final artifacts are markdown notes written to the vault, prefixed with `_` to sort them to the top.
- **Git checkpoint pattern:** Before any write operation batch, the agent commits current state. After the batch, it commits again. This creates clean, revertable diffs.

## 7. Tools / Features

### MCP Tool Specifications

#### `list_notes`
- **Purpose:** Get an index of all markdown notes in the vault
- **Input:** `{ path?: string, recursive?: boolean }`
- **Output:** Array of `{ path: string, hasfrontmatter: boolean, tagCount: number }`
- **Key features:** Optionally filter by subdirectory. Returns metadata summary without reading full content.

#### `read_note`
- **Purpose:** Read a single note's full content
- **Input:** `{ path: string }`
- **Output:** `{ path: string, frontmatter: object, content: string, inlineTags: string[], frontmatterTags: string[] }`
- **Key features:** Parses frontmatter separately from body content. Extracts both tag types.

#### `read_tags`
- **Purpose:** Extract and classify all tags from a note
- **Input:** `{ path: string }`
- **Output:** `{ frontmatterTags: string[], inlineTags: string[], allTags: string[], noiseTags: string[] }`
- **Key features:** Identifies noise tags (Google Docs anchors, etc.) separately.

#### `search_notes`
- **Purpose:** Find notes matching a tag or text pattern
- **Input:** `{ tag?: string, text?: string, directory?: string }`
- **Output:** Array of matching note paths with match context
- **Key features:** Supports searching by tag name or body text. Useful for audit phase.

#### `write_note`
- **Purpose:** Write or update a note (used for report generation)
- **Input:** `{ path: string, content: string, frontmatter?: object }`
- **Output:** `{ success: boolean, path: string }`
- **Key features:** Safely serializes frontmatter. Creates parent directories if needed.

#### `apply_tag_changes`
- **Purpose:** Apply a set of tag changes to a specific note
- **Input:** `{ path: string, changes: Array<{ oldTag: string, newTag: string | null }> }`
  - `newTag: null` means remove the tag
- **Output:** `{ success: boolean, path: string, tagsAdded: string[], tagsRemoved: string[], warnings: string[] }`
- **Key features:**
  - Removes inline tags from body text
  - Adds new tags to YAML frontmatter
  - Validates new tags match the scheme format (lowercase, kebab-case, valid prefix)
  - Reports warnings for edge cases (tag not found, duplicate, etc.)

#### `git_commit`
- **Purpose:** Create a git commit in the vault repo
- **Input:** `{ message: string }`
- **Output:** `{ success: boolean, commitHash: string }`
- **Key features:** Stages all changes in vault, commits with provided message.

## 8. Technology Stack

### Runtime & Language
| Component | Choice | Notes |
|-----------|--------|-------|
| Runtime | Bun | Already in use for this project |
| Language | TypeScript (ESNext, strict) | Matches existing codebase |

### Core Dependencies
| Package | Purpose |
|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | Agent framework, MCP server, streaming query |
| `zod` | Schema validation for MCP tool inputs/outputs |
| `gray-matter` | YAML frontmatter parsing and serialization |

### Existing Dependencies (unchanged)
| Package | Purpose |
|---------|---------|
| `typescript` | Type checking |
| `@types/bun` | Bun type definitions |

### System Dependencies
| Tool | Purpose |
|------|---------|
| `git` | Version control for vault rollback safety |
| `bun` | Script execution |

## 9. Security & Configuration

### Configuration

Environment variables (`.env`):

```bash
# Path to Obsidian vault (required)
VAULT_PATH="/Users/josephfajen/git/obsidian-jpf"

# Agent execution mode
AGENT_MODE="audit"  # audit | plan | execute | verify

# Batch size for execute mode
BATCH_SIZE=50

# Maximum budget per run (USD)
MAX_BUDGET_USD=1.00

# Model to use
AGENT_MODEL="claude-sonnet-4-20250514"
```

### Security Scope

**In scope:**
- ✅ MCP tool boundary — agent cannot access files outside defined tools
- ✅ Tag format validation — `apply_tag_changes` rejects malformed tags
- ✅ Git commit safety — all changes are committed and revertable
- ✅ Budget caps per run
- ✅ Read-only modes (audit, verify) that cannot modify notes

**Out of scope:**
- ❌ Authentication (local CLI tool, single user)
- ❌ Network security (no network access beyond Claude API)
- ❌ Encryption of vault contents

### Safety Guardrails

- The `apply_tag_changes` tool validates that new tags conform to the scheme before writing
- The `write_note` tool only writes to the configured vault path — no path traversal
- Execute mode requires a migration plan note to exist in the vault (produced by plan mode)
- Git commits use descriptive messages identifying the batch and scope of changes

## 10. API Specification

Not applicable — this is a CLI tool, not a web service. The "API" is the MCP tool interface described in Section 7.

### CLI Interface

```bash
# Run audit phase
bun run tagging-agent.ts audit

# Run plan phase (requires audit report to exist)
bun run tagging-agent.ts plan

# Run execute phase (requires migration plan to exist)
bun run tagging-agent.ts execute [--batch-size=50] [--dry-run]

# Run verification phase
bun run tagging-agent.ts verify
```

## 11. Success Criteria

### MVP Success Definition

The agent can complete a full audit-plan-execute-verify lifecycle on the vault, migrating all tags to the proposed hierarchical scheme in YAML frontmatter, with git-based rollback and vault-native reporting.

### Functional Requirements
- ✅ Audit phase catalogs all unique tags across 884 notes with frequencies and locations
- ✅ Audit correctly identifies noise tags (`#heading` from Google Docs anchors)
- ✅ Plan phase produces a human-reviewable migration plan covering every note
- ✅ Plan flags unmapped tags and suggests scheme additions
- ✅ Execute phase applies tag changes in batches with git commits
- ✅ All tags end up in YAML frontmatter (no inline tags remaining)
- ✅ All tags conform to lowercase kebab-case format
- ✅ Hierarchical prefixes (`status/`, `type/`, `area/`, `project/`) applied correctly
- ✅ Obsolete tags (`#follow-up-required-*`) removed
- ✅ Noise tags (`#heading`) removed
- ✅ Verify phase confirms zero remaining inline tags and full scheme compliance
- ✅ No note content (body text) is corrupted by frontmatter operations

### Quality Indicators
- Zero data loss — no note content destroyed or corrupted
- Every change is revertable via `git revert`
- Reports are readable and useful in Obsidian
- Agent stays within budget cap on every run

### User Experience Goals
- User can run each phase independently with a single CLI command
- User reviews migration plan in Obsidian before approving execution
- Dry-run mode available for execute phase
- Clear, scannable reports that surface decisions needed from the user

## 12. Implementation Phases

### Phase 1: Foundation
**Goal:** MCP tools and vault access layer

**Deliverables:**
- ✅ `lib/frontmatter.ts` — gray-matter wrapper with safe parse/serialize
- ✅ `lib/tag-parser.ts` — extract inline and frontmatter tags, identify noise
- ✅ `lib/config.ts` — environment variable loading and validation
- ✅ `tools/vault-tools.ts` — `list_notes`, `read_note`, `search_notes`, `write_note`
- ✅ `tools/tag-tools.ts` — `read_tags`, `apply_tag_changes`
- ✅ `tools/git-tools.ts` — `git_commit`
- ✅ Unit tests for frontmatter parsing and tag extraction

**Validation:** Tools can read/write notes and tags correctly in isolation.

### Phase 2: Audit & Plan Agent
**Goal:** Agent can produce audit report and migration plan

**Deliverables:**
- ✅ `tag-scheme.ts` — proposed tagging scheme as structured data with mappings
- ✅ `tagging-agent.ts` — main agent with audit and plan modes
- ✅ System prompt engineering for audit behavior
- ✅ System prompt engineering for plan behavior
- ✅ Audit report note template
- ✅ Migration plan note template

**Validation:** Agent produces accurate audit report. Plan covers all notes and all tags. Unmapped tags are flagged.

### Phase 3: Execute & Verify
**Goal:** Agent can apply migration plan and verify results

**Deliverables:**
- ✅ Execute mode with batch processing and git commits
- ✅ Dry-run mode (logs changes without writing)
- ✅ Verify mode scanning for remaining inline tags and scheme violations
- ✅ Verification report note template

**Validation:** Execute mode correctly migrates a test batch. Verify confirms results. Git log shows clean, descriptive commits per batch.

### Phase 4: Polish & Edge Cases
**Goal:** Handle real-world vault edge cases

**Deliverables:**
- ✅ Handle notes with no frontmatter (create frontmatter block)
- ✅ Handle notes with complex frontmatter (aliases, cssclasses, etc. — preserve them)
- ✅ Handle edge-case inline tags (tags in code blocks should be ignored, tags in links, etc.)
- ✅ Handle duplicate tags after migration (e.g., note has both `#daily-reflection` and `#daily-notes` which both map to `type/daily-note`)
- ✅ End-to-end test on full vault

**Validation:** Full vault migration completes without errors. Verification report shows 100% compliance.

## 13. Future Considerations

### Post-MVP Enhancements
- **Scheduled runs:** Cron job that audits newly created/modified notes and auto-tags them per the scheme
- **Interactive mode:** Agent asks the user about unmapped tags in real-time rather than writing a report
- **Tag suggestions:** For new notes without tags, agent reads content and suggests appropriate tags
- **Obsidian REST API support:** Alternative vault access method when Obsidian is running

### Integration Opportunities
- **Existing Obsidian agent:** Share the MCP tools with the user's existing custom Obsidian agent
- **Daily note workflow:** Auto-tag daily notes as they're created
- **Template system:** Generate Obsidian templates with pre-populated tag frontmatter per note type

### Advanced Features
- **Semantic tag analysis:** Use embeddings to find notes that should share tags but don't
- **Tag health dashboard:** Periodic report on tag usage trends, orphan tags, etc.
- **Multi-vault support:** Run against multiple vaults with different schemes

## 14. Risks & Mitigations

### Risk 1: Frontmatter Corruption
**Risk:** `gray-matter` or the write logic corrupts existing frontmatter fields (aliases, cssclasses, custom fields).
**Mitigation:** Parse and re-serialize only the `tags` field. Preserve all other frontmatter fields as-is. Unit test with representative vault samples including complex frontmatter. Git commits enable instant rollback.

### Risk 2: Inline Tag Removal Damages Content
**Risk:** Removing inline `#tags` from note body could break sentences or remove intentional hashtags (e.g., in code blocks).
**Mitigation:** Tag parser skips code blocks (fenced and inline). Only remove tags that match the migration mapping. Dry-run mode lets user preview changes before applying.

### Risk 3: Agent Misclassifies Tags
**Risk:** The LLM maps tags to wrong categories in the proposed scheme.
**Mitigation:** Phased approach — the plan is written as a reviewable note before execution. User can edit the plan. Common mappings (from the proposed scheme doc) are hardcoded, not LLM-decided. Agent only uses LLM judgment for unmapped tags.

### Risk 4: Budget Overrun
**Risk:** Processing 884 notes exceeds expected costs.
**Mitigation:** `maxBudgetUsd` cap per run. Batch sizing limits notes processed per invocation. Audit and verify phases are read-heavy (cheaper). Execute phase does minimal LLM work (applies pre-computed plan).

### Risk 5: Google Docs Anchor Links Misidentified as Tags
**Risk:** The `#heading=h.xxxxx` pattern in URLs gets treated as a real tag.
**Mitigation:** Tag parser uses regex that excludes tags containing `=` and tags appearing inside URLs/links. Already identified this pattern during analysis.

## 15. Appendix

### Related Documents
- **Proposed Tagging System:** `/Users/josephfajen/git/obsidian-jpf/Proposed Tagging System.md`
- **Vault Tag Analysis:** Referenced in the proposed system note (linked note in vault)
- **Claude Agent SDK docs:** `@anthropic-ai/claude-agent-sdk` v0.2.22
- **Agent SDK demo files:** `demo/mcp-servers.ts`, `demo/hooks.ts`, `demo/sessions.ts`

### Vault Statistics (as of audit)
| Metric | Value |
|--------|-------|
| Total notes | 884 |
| Notes with YAML frontmatter | 610 (69%) |
| Notes without frontmatter | 274 (31%) |
| Unique tags (approx.) | 200+ |
| Most common tag (real) | `#technical-writing` (226) |
| Most common noise tag | `#heading` (444) |
| Tag format | Mixed inline + frontmatter |

### Key Tag Mappings (from Proposed System)
| Old Tag(s) | New Tag | Category |
|------------|---------|----------|
| `#todo`, `#to-do` | `status/pending` | Status |
| `#done`, `#finished`, `#completed` | `status/completed` | Status |
| `#meeting-notes` | `type/meeting` | Type |
| `#daily-journal`, `#daily-notes`, `#daily-reflection` | `type/daily-note` | Type |
| `#research`, `#research-notes` | `type/research` | Type |
| `#career` | `area/career` | Area |
| `#heading` (Google Docs anchors) | REMOVE | Noise |
| `#follow-up-required-weekly` | REMOVE | Obsolete |
| `#follow-up-required-monthly` | REMOVE | Obsolete |
