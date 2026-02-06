---
tags:
  - copilot-conversation
  - ai-tools
date: 2026-01-25
---

# Copilot Session — Agent Architecture

## Context
Working through the tagging agent design with Claude.

## Key Decisions
- Use phased execution (audit > plan > execute > verify)
- Deterministic worklist generation (no LLM needed)
- Supervisor/Worker pattern for execution

## Insight
The most expensive part isn't the execution — it's the LLM deciding what to do. Moving decisions into code saved 75% on costs.

#prompting #productivity #career
