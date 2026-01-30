# CLAUDE.md — Project Rules

Obsidian vault tagging agent built with Claude Agent SDK and Bun. Audits, plans, executes, and verifies tag migration across ~884 markdown notes. See `PRD.md` for full requirements and tool specifications.

## Tech Stack & Runtime

- **Runtime:** Bun — use `bun run`, `bun test`, `bun install` (never Node/npm)
- **Language:** TypeScript, strict mode, ESNext target, no build step (Bun runs .ts directly)
- **Core deps:** `@anthropic-ai/claude-agent-sdk`, `zod` (schema validation), `gray-matter` (YAML frontmatter)

## Architecture Rules

- All vault access goes through MCP tools — never raw `fs` calls from agent code
- Phased execution: `audit` → `plan` → `execute` → `verify` (separate CLI invocations with separate budgets)
- Reports are vault-native markdown notes prefixed with `_` (e.g., `_Tag Audit Report.md`)
- Git checkpoint pattern: commit before and after every batch of changes
- Entry point: `tagging-agent.ts` with mode passed as CLI arg

## Tool Implementation

- Follow `reference/adding_tools_guide.md` for all MCP tool docstrings
- Every tool must include: "Use this when", "Do NOT use this for", performance notes, realistic examples
- Prefer consolidated tools over fragmented ones (e.g., one `read_note` with `detail` param, not separate read + read_tags)
- Validate all tool inputs with Zod schemas
- Tool definitions go in `tools/` directory, one file per domain (vault, tag, git)

## Code Conventions

- No default exports
- Kebab-case filenames (e.g., `vault-tools.ts`, `tag-parser.ts`)
- Use `gray-matter` for all frontmatter parsing — never hand-roll YAML serialization
- Tag format: lowercase kebab-case with hierarchical prefixes (`status/`, `type/`, `area/`, `project/`)
- Inline tag parser must skip fenced and inline code blocks

## Safety

- Never write outside the configured `VAULT_PATH`
- Validate tag format before writing (lowercase, kebab-case, valid prefix)
- All git operations go through the `git_commit` MCP tool
- Enforce `maxBudgetUsd` on every `query()` call
- Execute mode requires a migration plan note to exist (produced by plan mode)

## Testing

- Run: `bun test`
- Tests live in `tests/`, named `test-*.ts`
- Test frontmatter parsing and tag extraction with representative vault samples including complex frontmatter

## Key References

- `PRD.md` — requirements, tool specs, architecture, success criteria
- `reference/adding_tools_guide.md` — required template for tool docstrings
- `reference/workshop/agent.ts` — basic Claude Agent SDK usage pattern
- `reference/workshop/advanced-agent.ts` — MCP tools, subagents, hooks pattern
- `.env.example` — environment variable reference
