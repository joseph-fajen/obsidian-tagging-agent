# My Obsidian Vault Had 884 Notes and a Tagging Problem. I Built an Agent to Fix It. 

## Subhead option 1: The line between what LLMs should do and what code should do.

## Subhead option 2: Agentic coding isn't a shortcut. It's a different kind of engineering discipline.

# Building an Autonomous Tagging Agent with Claude Agent SDK

*My [obsidian-tagging-agent](https://github.com/joseph-fajen/obsidian-tagging-agent) is open source on GitHub. Built with Claude Code, the Claude Agent SDK, Bun, and TypeScript.*

## The Problem I Was Solving

I started using Obsidian about two years ago, excited about building a personal knowledge base — a place where I could reliably find my notes weeks, months, or years later. My vault now has more than 800 notes: daily journals, meeting notes, research, and project documents. Tagging seemed like the key to making it all navigable.

It didn't go exactly as planned. Over time my tagging scheme became increasingly inconsistent: inline `#tags` mixed with YAML frontmatter tags, three different tags for the same concept, overly granular tags, noise from Google Docs imports. I designed a new hierarchical scheme with prefixes like `status/`, `type/`, `area/`, and `project/` — clean, consistent, with everything in frontmatter. But I realized that applying it to 884 notes by hand wasn't realistic.

A script could handle about 80% of it — `#todo` maps to `status/pending`, inline tags move to frontmatter, noise gets removed. But the other 20% required judgment: synonym resolution, unmapped tags, edge cases like Templater syntax breaking YAML parsing. I needed something that could reason about the messy cases while being precise about the straightforward ones.

I'd been looking for the right project to build a custom agent — specifically to get hands-on with the Claude Agent SDK. My tagging situation was a natural fit: messy enough to require reasoning, structured enough to execute deterministically.

That tension — *reason during some phases, execute deterministically during others* — ended up shaping the entire architecture of what I built.

## The Engineering Log: Key Decisions and What Drove Them

Each decision in the log below was forced by something that didn't work the way I expected. And several of those lessons appear more than once in different forms. That repetition turned out to be the most important insight of the whole project.

**LLM worklist generation is unreliable at scale**
The plan phase sampled roughly 15 notes instead of iterating all 800+, producing a truncated worklist. I learned that asking an LLM to do mechanical file iteration at scale is the wrong tool for the job. I moved worklist generation to deterministic TypeScript — pure code, no LLM call, zero cost.

**The agent was doing real work — just not the right work**
At $1.50 per batch, the execute phase was confidently processing notes — just not the ones in the worklist. Despite explicit instructions, it ignored the pre-computed batch file and searched for its own notes, processing 278 different notes than what I'd specified. Watching that happen clarified something important: the problem wasn't the prompt, it was the architecture. Working through the problem with Claude Code, the Supervisor/Worker pattern emerged as the solution — LLM handles reasoning, code handles execution.

**When instructions fail, remove the choice**
"⛔ STOP — READ THIS FIRST ⛔" headers, WRONG vs. RIGHT examples, a PROHIBITED TOOLS list — none of it stopped the LLM from going rogue during the execute phase. The key insight: when a model persistently ignores instructions, remove the opportunity for deviation instead of adding more constraints. Injecting the batch data directly into the prompt eliminated the choice entirely, dropping cost from $1.50 to $0.06 per batch. The same pattern surfaced twice more. The plan phase was making 100+ tool calls re-scanning notes the audit had already cataloged — removing those tools from the prompt cut cost 70%. And when I asked the plan phase to write a machine-readable JSON file, it didn't, consistently — so code now parses the LLM's human-readable markdown table and extracts the JSON itself. Three different problems, one solution: stop asking the model to behave, and take the decision away from it entirely.

**LLM output formatting is unpredictable in ways I didn't anticipate**
The plan extractor regex matched `MAP`, `KEEP`, `REMOVE` — but the LLM wrote `**MAP**`, `**KEEP**`, `**REMOVE**`. It also wrote "Fix Format" where the spec said "MAP." Both times the consequence was the same: rows the regex didn't recognize were silently skipped, and tags that should have been migrated weren't. The model prioritizes how things look, not how they parse — parsers for LLM-generated content must account for that.

**Tool docstrings shape agent behavior more than system prompts**
The system prompt sets overall intent, but when the agent is choosing which tool to call, it reads the description embedded in each tool definition — and that's the moment that matters. Detailed descriptions with "Use this when" and "Do NOT use this for" guidance, along with token cost estimates, produced better decisions than elaborate top-level instructions about what not to do.

**A sequence of CLI commands isn't an agentic experience**
Five separate invocations with manual review steps felt like operating a tool, not working with an agent. I built an interactive mode with a state machine, session persistence, and a conversational loop — so the agent guides the user through the entire migration, resuming where it left off if interrupted.

## What This Project Taught Me

Building this agent taught me something I didn't expect: agentic coding isn't a shortcut, it's a different kind of engineering discipline. Yes, I wasn't writing code line by line — but that was only one layer of the work. The architectural decisions, the testing and evaluating, the iterating, the failures — all of it still fell to me. So did the judgment calls: when to stop, what tradeoffs to accept, whether the agent was actually delivering the value that launched the project in the first place. The unexpected errors, the sessions that went sideways, the moments of genuine frustration — managing all of that still requires patience, methodical observation, and a clear sense of what I'm trying to build. What agentic coding changes is the nature of the problems you're solving, not whether you have to solve them.

The project is open source, and the architecture is ready to generalize — the next step is making the plan phase collaborative, so the agent can audit any vault, identify natural tag clusters, and work with the user to design a schema that fits their content rather than mine. If you're working on something similar or just want to dig into the code, my [obsidian-tagging-agent](https://github.com/joseph-fajen/obsidian-tagging-agent) is on GitHub.
