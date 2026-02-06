---
tags:
  - research-notes
  - ai-tools
date: 2026-01-28
---

# Pydantic AI Agent Architecture

## Why Pydantic?
Strong typing for agent inputs/outputs. Makes tool definitions robust.

## Core Concepts

### Agent Class
The main orchestrator. Defines system prompt, tools, and model.

### Tool Definitions
Functions decorated with @tool. Pydantic validates inputs automatically.

### Structured Outputs
Use Pydantic models as return types for reliable parsing.

## Comparison with Claude Agent SDK
Both use tool-based architecture, but Pydantic's approach is more Python-native while Claude SDK is TypeScript-first.

#prompting #learning
