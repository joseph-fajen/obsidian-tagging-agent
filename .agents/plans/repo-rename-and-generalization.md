---
status: EVALUATION
created: 2026-02-05
---

# Repo Rename and Generalization Evaluation

This document captures analysis and recommendations for renaming the repository and making it shareable with other Obsidian users.

---

## Context

The project has reached a breakthrough in functionality (see CHANGELOG.md 2026-02-05 entries). The current repo name `claude-agent-sdk-proactive-agent` is residual from the workshop template and doesn't reflect the project's purpose. Additionally, the implementation may be overly coupled to the original author's vault.

---

## 1. Repo Naming Options

The current name `claude-agent-sdk-proactive-agent` is workshop residue and should be changed.

### Candidates

| Name | Pros | Cons | Recommendation |
|------|------|------|----------------|
| **`obsidian-tag-migrator`** | Clear purpose, searchable, matches Obsidian ecosystem naming (`obsidian-linter`, `obsidian-git`) | Doesn't convey AI/agent nature | **Recommended** |
| **`obsidian-tagging-agent`** | Matches internal docs, conveys autonomous behavior | Slightly longer | Strong alternative |
| **`vault-tag-agent`** | Short, memorable | Less discoverable for Obsidian users | Acceptable |
| **`ai-vault-tagger`** | Highlights AI aspect | Generic, less Obsidian-specific | Not recommended |
| **`obsidian-tag-migration-agent`** | Very specific about function | Verbose | Not recommended |

### Recommendation

**Primary choice:** `obsidian-tag-migrator`
- Follows Obsidian community naming conventions
- Clearly describes function
- Searchable and discoverable

**Alternative:** `obsidian-tagging-agent`
- Better conveys autonomous/agentic nature
- Useful if positioning as an "AI agent" product

---

## 2. Vault-Specific vs. Generalizable Assessment

### Already Generalizable (Works for Anyone) ✅

| Component | Location | Why It's Universal |
|-----------|----------|-------------------|
| **Phased architecture** | `tagging-agent.ts` | audit→plan→execute→verify works for any vault |
| **Supervisor/Worker pattern** | `lib/batch-executor.ts` | No vault-specific assumptions |
| **MCP tools** | `tools/*.ts` | Generic vault operations |
| **Configuration via `.env`** | `.env.example` | `VAULT_PATH`, `BATCH_SIZE`, models externalized |
| **Valid tag prefixes** | `lib/tag-parser.ts:1` | `area/`, `project/`, `status/`, `type/`, `tool/`, `skill/`, `topic/` are reasonable universal categories |
| **Core tag parsing** | `lib/tag-parser.ts` | Inline extraction, code block handling, kebab-case normalization |
| **Common status mappings** | `tag-scheme.ts:49-57` | `todo`→`status/pending`, `done`→`status/completed` |
| **Common type mappings** | `tag-scheme.ts:59-71` | `meeting-notes`→`type/meeting`, `daily-journal`→`type/daily-note` |
| **Frontmatter handling** | `lib/frontmatter.ts` | Standard gray-matter usage |
| **Git safety** | `tools/git-tools.ts` | Universal commit/rollback pattern |
| **Interactive mode** | `lib/interactive-agent.ts` | Generic conversation flow |
| **Session persistence** | `lib/session-state.ts` | Works for any user |

### Vault-Specific Coupling (Needs Changes) ⚠️

| Item | Location | What's Specific | Impact |
|------|----------|-----------------|--------|
| **`SCHEME_NOTE_PATH`** | `tag-scheme.ts:35` | Hardcoded `"Proposed Tagging System.md"` | **Blocker**: Other users don't have this file |
| **Project-specific mappings** | `tag-scheme.ts:79-81` | `"project-catalyst"`, `"copilot-conversation"`, `"video-library"` | Irrelevant to other users |
| **Topic tags as "KEEP"** | `tag-scheme.ts:86-93` | `"ai-tools"`, `"technical-writing"`, `"blockchain"`, `"meditation"`, `"spirituality"` | Author's personal interests |
| **Noise pattern: `heading`** | `tag-parser.ts:28` | Google Docs import artifact | Not everyone imports from Google Docs |
| **Noise pattern: `follow-up-required-*`** | `tag-parser.ts:30` | Author's workflow tags | Other users have different workflow tags |

### Assessment Summary

**~70% generalizable today**, but the remaining 30% creates friction:

1. Users would hit errors trying to read `Proposed Tagging System.md` that doesn't exist
2. Hardcoded mappings are irrelevant — other users don't have `#project-catalyst`
3. Noise patterns are author-specific — not universal

---

## 3. Path to Full Generalization

### Tier 1: Minimum Viable (Removes Blockers)

These changes are required before sharing publicly:

| Change | Effort | Files Affected | Description |
|--------|--------|----------------|-------------|
| Make `SCHEME_NOTE_PATH` optional | Low | `tag-scheme.ts`, `tagging-agent.ts` | If file doesn't exist, skip reading it; audit discovers tags without reference |
| Split `TAG_MAPPINGS` | Medium | `tag-scheme.ts`, new config file | Separate "common universal" mappings from "user-specific" mappings |
| Externalize noise patterns | Medium | `lib/tag-parser.ts`, config file | Move `isNoiseTag()` patterns to user-configurable file |
| Create `tag-config.yaml` schema | Medium | New file | User-defined mappings, noise patterns, custom prefixes |

### Tier 2: Better UX (Recommended for Public Release)

| Change | Effort | Description |
|--------|--------|-------------|
| **Config file for user mappings** | Medium | `tag-config.yaml` with custom mappings, noise patterns, scheme reference |
| **"Discovery mode" in audit** | Medium | When no scheme file exists, audit proposes categories based on existing tags |
| **Interactive setup wizard** | Higher | First-run flow: "Do you have a tagging scheme? [Y/N]" → guides setup |
| **Improved README** | Low | Clear "Getting Started" for new users with different vaults |

### Tier 3: Polish (Nice-to-Have)

| Change | Effort | Description |
|--------|--------|-------------|
| Obsidian plugin wrapper | High | Run directly from Obsidian instead of CLI |
| Web-based config builder | High | GUI for building tag schemes |
| Published npm package | Medium | `npx obsidian-tag-migrator` for easy installation |
| Example configs | Low | Sample `tag-config.yaml` files for common use cases |

---

## 4. Proposed Configuration Schema

For Tier 1/2, a user config file could look like:

```yaml
# tag-config.yaml

# Optional: Path to your tagging scheme note (relative to vault root)
schemeNotePath: "Meta/Tagging System.md"

# Custom tag mappings (merged with common mappings)
mappings:
  # Your project-specific mappings
  "my-project": "project/my-project"
  "old-workflow-tag": null  # null = remove

  # Override common mappings if needed
  "todo": "status/todo"  # Override default "status/pending"

# Noise patterns to remove
noisePatterns:
  exact:
    - "heading"
    - "imported"
  prefixes:
    - "follow-up-required-"
    - "temp-"
  containsChars:
    - "="

# Additional valid prefixes beyond the defaults
additionalPrefixes:
  - "client/"
  - "team/"
```

---

## 5. Recommended Sequence

### Phase A: Rename (Can Do Immediately)

1. Choose new name: `obsidian-tag-migrator` (recommended)
2. Rename GitHub repo
3. Update `package.json` name field
4. Update all documentation references
5. Update internal references (CLAUDE.md, README.md, etc.)

### Phase B: Generalization (Before Public Sharing)

1. Implement Tier 1 changes (config file, optional scheme path)
2. Move author's personal mappings to `tag-config.example.yaml`
3. Create `.gitignore` entry for `tag-config.yaml` (user's actual config)
4. Update README with "Getting Started" for new users
5. Test with a fresh vault to verify no author-specific assumptions remain

### Phase C: Polish (Before Wider Promotion)

1. Implement discovery mode
2. Add interactive setup
3. Create example configs for common scenarios
4. Consider npm publishing

---

## 6. Files That Would Change

### For Tier 1 Generalization

| File | Changes Needed |
|------|----------------|
| `tag-scheme.ts` | Extract user mappings, make `SCHEME_NOTE_PATH` configurable |
| `lib/tag-parser.ts` | Load noise patterns from config |
| `lib/config.ts` | Add config file loading |
| `tagging-agent.ts` | Handle missing scheme file gracefully |
| `.gitignore` | Add `tag-config.yaml` |
| `tag-config.example.yaml` | New file with author's current mappings as example |
| `README.md` | Add setup instructions for new users |

---

## 7. Open Questions

1. **Config format**: YAML vs JSON vs TypeScript?
   - YAML: Human-friendly, comments allowed
   - JSON: Universal, no extra dependency
   - TypeScript: Type-safe, but requires compilation

2. **Merge strategy**: How to combine common + user mappings?
   - User overrides common (current thinking)
   - Explicit "override" vs "extend" modes

3. **Validation**: How strict on config errors?
   - Fail fast with clear error
   - Warn and continue with defaults

4. **Backward compatibility**: Support users who already have `audit-data.json` with current format?

---

## 8. Next Steps

When ready to proceed:

1. [ ] Decide on final repo name
2. [ ] Decide on config file format (YAML recommended)
3. [ ] Implement Tier 1 changes
4. [ ] Test with a fresh/empty vault
5. [ ] Update documentation
6. [ ] Rename repo on GitHub

---

## References

- `PROJECT_STATUS.md` — Current implementation state
- `CHANGELOG.md` — Development history showing breakthrough on 2026-02-05
- `PRD.md` — Original requirements (some may need updating for generalization)
- `.agents/retrospectives/` — Lessons learned from real usage
