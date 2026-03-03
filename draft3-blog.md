# I Had 884 Notes in Obsidian — and a Tagging System That Had Quietly Collapsed.

Over two years, my vault grew to 884 notes — journals, research, project documents.

My tagging system started clean.

It didn’t stay that way.

Inline `#tags` mixed with YAML frontmatter.
Three tags for the same concept.
Underscores vs. hyphens.
Case inconsistencies.
Noise from imports.

Manually fixing it wasn’t realistic.

So I built an autonomous tagging agent.

But the real project wasn’t about tags.

It was about understanding where an LLM belongs in a system — and where it absolutely doesn’t.

---

## The Engineering Tension

A deterministic script could handle about 80%:

* Move inline tags to frontmatter
* Normalize formats
* Remove obvious noise

The remaining 20% required judgment:

* Synonym resolution
* Schema consolidation
* Edge cases like Templater syntax breaking YAML parsing

That’s where I wanted reasoning.

What emerged was a hybrid architecture:

* LLM for analysis and planning
* Deterministic TypeScript for execution
* Explicit boundaries between the two

And those boundaries turned out to be the whole challenge.

---

## Where Things Broke (and What That Taught Me)

### 1. LLMs Shouldn’t Do Mechanical Iteration

My first version asked the model to generate a worklist across 800+ notes.

It sampled ~15.

That failure wasn’t subtle — it was architectural.

Worklist generation moved to pure TypeScript.
No LLM.
No sampling.
$0.00 cost.
100% coverage.

That decision alone stabilized the system.

---

### 2. When Instructions Fail, Remove the Choice

The execute phase was supposed to process a precomputed batch file.

Instead, it kept “helpfully” searching for notes on its own.

I tried stronger wording.
Examples.
Even a “PROHIBITED TOOLS” section.

None of it worked.

Watching the agent confidently process the wrong notes clarified something for me:
the problem wasn’t the prompt — it was the architecture.

Injecting the batch JSON directly into the prompt removed the decision entirely.

Tool calls per batch: 6–20 → 1
Cost per batch: $1.50 → $0.06
Execution: unpredictable → deterministic

That shift felt less like prompt engineering and more like system design.

---

### 3. Parse Defensively

The model wrote `**MAP**` instead of `MAP`.

My regex skipped rows silently.

LLMs format for humans. Parsers need to tolerate that.

The extraction layer became intentionally lenient — because probabilistic systems will drift in small ways you don’t anticipate.

---

### 4. Tool Docstrings Matter More Than System Prompts

One subtle discovery: when the agent chooses a tool, it reads the tool’s description at that moment.

Detailed “Use this when / Do NOT use this for” guidance shaped behavior more than top-level system instructions ever did.

That changed how I think about agent design.

---

### 5. An Agent Experience Requires Orchestration

Originally this was five CLI commands.

It became:

* A Supervisor/Worker architecture
* Deterministic batch execution
* A state machine
* Session persistence
* Phase-specific model selection
* 325+ passing tests

An agentic experience isn’t just LLM calls. It’s coordination.

---

## What This Project Really Reinforced for Me

Agentic coding isn’t a shortcut.

You still own the architecture, the testing discipline, the cost model, and the failure modes. The model changes how you work, but it doesn’t remove engineering responsibility.

If anything, it makes architectural boundaries more important.

The hardest question isn’t “What should the prompt say?”

It’s:

* What must be deterministic?
* What can be probabilistic?
* Where does autonomy stop?
* Where does code take control?

That boundary is where most of the real thinking lives.

---

The project is open source:
🔗 [https://github.com/joseph-fajen/obsidian-tagging-agent](https://github.com/joseph-fajen/obsidian-tagging-agent)

Built with:

* Claude Agent SDK
* Bun + TypeScript
* Deterministic data pipeline
* Interactive state machine
* Full audit → plan → execute → verify lifecycle

---

I’m currently exploring senior technical writing and AI tooling roles focused on LLM-integrated systems, agent architecture, and developer tooling.

If you’re building at the LLM/code boundary, I’d be glad to connect.

