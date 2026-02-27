# Retrospective: Test Vault Validation (2026-02-26)

This retrospective captures observations from running the tagging agent against a 50-note test vault, plus reflections on sharing this project publicly.

---

## Test Run Summary

**Vault:** 50 notes, 68 unique tags (per audit), 44 notes with tags
**Total Cost:** ~$0.77
**Outcome:** 98.1% compliance (51/52 processable notes migrated successfully)

| Phase | Cost | Duration | Tool Calls |
|-------|------|----------|------------|
| Audit | $0.2476 | ~60s | 47 |
| Plan | $0.1767 | ~30s | 4 |
| Generate Worklist | $0.00 | <1s | 0 (code) |
| Execute (2 batches) | $0.0997 | ~5s | 2 |
| Verify | $0.3174 | ~45s | 18 |

---

## Technical Observations

### What Worked Well

1. **Supervisor/Worker Architecture Validated**
   - Execute phase: $0.10 for 51 notes = ~$0.002/note
   - Single `execute_batch` tool call per batch (no autonomous discovery)
   - Prompt injection pattern successfully constrains agent behavior

2. **Code-Driven Phases Are Reliable**
   - `generate-worklist`: Extracted 53 mappings from markdown table
   - Correctly skipped Templater file with clear warning
   - Zero cost, instant execution, deterministic output

3. **Interactive Flow Works Smoothly**
   - State machine progression through all phases
   - Clear user prompts at each checkpoint
   - Appropriate phase transitions

4. **Git Integration Solid**
   - Commits at audit, plan, each execute batch, and verify
   - Clean audit trail for rollback if needed

### Issues Discovered

#### 1. Audit Data Inconsistency

```
Header says: 68 unique tags
Actual data: 55 tags in tagFrequencies
```

**Root cause:** The audit LLM counted tags while reading notes, reported 68 in its summary, but only wrote 55 to the `tagFrequencies` object. This is classic LLM reliability — it "knows" the answer but doesn't consistently serialize it.

**Impact:** 13 tags potentially missing from downstream phases.

**Potential fixes:**
- Post-audit validation: code checks `uniqueTags === Object.keys(tagFrequencies).length`
- If mismatch, either fail loudly or re-derive count from actual data
- Consider code-driven audit (like worklist) for tag counting

#### 2. Plan Table Incomplete

```
Mapping count mismatch: extracted 53, audit found 55
2 tags may not have been included in the plan table
```

**Root cause:** Plan LLM didn't include every tag in the mapping table.

**Impact:** 2 tags weren't explicitly mapped (though they may have been valid format).

**Potential fixes:**
- Inject tag list into plan prompt so LLM must address each one
- Post-plan validation: compare extracted mappings to audit tag list
- Consider hybrid approach: code generates initial table, LLM reviews/adjusts

#### 3. Verify Phase Sampled Instead of Scanning

The verify prompt says "For each note... call read_note" but the agent read ~15 notes ("representative sample") out of 50. This is LLM autonomy overriding instructions — it decided sampling was sufficient.

**Impact:** Could miss compliance issues in unscanned notes.

**Potential fixes:**
- Inject note list into prompt (like execute phase)
- Code-driven verification with LLM only for edge case analysis
- Accept sampling for large vaults, require full scan for small ones

#### 4. Templater File Flagged as Failure

Verify flagged `templater-note.md` as needing remediation, not knowing it was intentionally skipped. This creates a confusing user experience — the report says "fix this" for something that can't be fixed.

**Potential fixes:**
- Pass list of skipped files to verify phase
- Add "Expected Skips" section to verification report
- Have worklist generator write a `skipped-files.json` for downstream phases

---

## Reflections for Public Sharing

### What This Project Demonstrates

1. **Iterative Architecture Evolution**
   - Started with naive "LLM does everything" approach
   - Discovered limits through real usage (maiden voyage, interactive validation)
   - Evolved to Supervisor/Worker pattern through principled refactoring
   - Each iteration documented with reasoning in CHANGELOG

2. **Pragmatic Engineering Decisions**
   - Accepted SDK limitations (`allowedTools` not enforced) rather than fighting them
   - Moved reliability-critical work to code when LLM proved unreliable
   - Chose "good enough" (98% compliance) over perfect (would require manual edge case handling)

3. **Cost Awareness**
   - Phase-specific models (Haiku for execute, Sonnet for reasoning)
   - Budget controls per invocation
   - Measured and optimized (from $1.50/batch to $0.06/batch)

4. **Production-Minded Practices**
   - Git commits as safety net
   - Session persistence for resume
   - Error recovery with self-reflection
   - 290 tests covering core functionality

### Strengths to Highlight

- **The journey matters more than the destination.** The CHANGELOG tells a story of learning — prompt engineering limits, when to use code vs LLM, how to design for reliability. This is more valuable than showing a polished final product.

- **Technical writing skills applied to code.** The documentation (CLAUDE.md, ARCHITECTURE.md, CHANGELOG.md) shows how clear communication practices transfer to software engineering. The codebase is readable and maintainable because it's well-documented.

- **Real problem, real constraints.** This isn't a toy demo — it's solving an actual productivity problem (vault tag chaos) with real cost constraints ($10 budget for 884 notes).

### Honest Limitations to Acknowledge

1. **LLM reliability remains a challenge.** The audit/plan phases still have data consistency issues. A production-grade tool would need validation layers or code-driven alternatives.

2. **Single-vault tested.** The "generalization" work made it configurable, but it's only been validated on two vaults (original 884-note vault and this 50-note test vault).

3. **No error recovery for user-facing edge cases.** If someone's vault has unusual structures (deeply nested folders, non-standard frontmatter), the agent may fail ungracefully.

4. **Interactive mode is synchronous.** Long-running phases block the terminal. A production tool might want async execution with progress callbacks.

### Framing for LinkedIn

**Narrative angle:** "What I learned building an autonomous agent that actually works"

Key themes:
- Prompt engineering has limits — when to pivot to code
- The Supervisor/Worker pattern for cost control
- Why documentation matters even (especially) for AI-assisted code
- Measuring what matters (cost per batch, not lines of code)

**Authenticity points:**
- Show the $10.34 maiden voyage cost and the journey to $0.77
- Include a bug or limitation honestly
- Link to the actual codebase so people can see the real code

**Differentiation:**
- Most "I built an AI agent" posts are toy demos or wrappers
- This is a multi-phase, resumable, git-integrated tool with real usage
- The iteration history shows engineering judgment, not just coding ability

---

## Action Items

### Before Public Release

- [ ] Decide: Add audit data validation (code checks LLM output consistency)?
- [ ] Decide: Add verify phase "expected skips" awareness?
- [ ] Review: Any hardcoded paths or personal vault references in code?
- [ ] Review: Any sensitive data in test-vault/ notes?
- [ ] Add: LICENSE file (MIT? Apache 2.0?)
- [ ] Add: Contributing guidelines if accepting PRs?

### For Blog Post

- [ ] Write draft focusing on lessons learned, not feature list
- [ ] Include cost journey graphic ($10.34 → $0.77 for similar work)
- [ ] Screenshot of terminal output showing phases
- [ ] Link to specific files (CHANGELOG, ARCHITECTURE) as evidence of methodology

### Future Improvements (Not Blocking Release)

- Code-driven audit for tag counting (hybrid: code counts, LLM classifies)
- Comprehensive verify option (inject note list like execute)
- Async execution with progress events
- Multi-vault support (namespace data files by vault hash)

---

## Key Insight

> "The most valuable thing about this project isn't that it migrates tags — it's the documented journey of discovering when LLMs are reliable tools and when they need guardrails."

This positions the work as demonstrating engineering judgment, not just coding ability. Anyone can prompt an LLM to do something; the skill is knowing when prompting isn't enough.
