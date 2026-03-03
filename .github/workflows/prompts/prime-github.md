# Prime: Load Project Context

## GitHub Context

- **Repository**: $REPOSITORY
- **Triggered By**: $TRIGGERED_BY

## Objective

Build comprehensive understanding of the codebase by analyzing structure, documentation, and key files.

## Process

### 1. Analyze Project Structure

List all tracked files:

```bash
git ls-files
```

Show directory structure:

```bash
# On Linux/Mac
tree -L 3 -I 'node_modules|__pycache__|.git|dist|build'

# On Windows or if tree not available
find . -type d -not -path '*/\.*' -not -path '*/node_modules/*' -not -path '*/__pycache__/*' | head -50
```

### 2. Read Core Documentation

Read these files to understand project standards:
- CLAUDE.md (or similar global rules file)
- README files at project root and major directories
- Any architecture documentation in docs/

### 3. Identify Key Files

Based on the structure, identify and read:
- Main entry points (main.py, index.ts, app.py, etc.)
- Core configuration files (pyproject.toml, package.json, tsconfig.json)
- Key model/schema definitions
- Important service or controller files

### 4. Understand Current State

Check recent activity:

```bash
git log -10 --oneline
```

Check current branch and status:

```bash
git status
```

## Output Report

Provide a concise summary:

### Project Overview
- Purpose and type of application
- Primary technologies and frameworks
- Current version/state

### Architecture
- Overall structure and organization
- Key architectural patterns identified
- Important directories and their purposes

### Tech Stack
- Languages and versions
- Frameworks and major libraries
- Build tools and package managers
- Testing frameworks

### Core Principles
- Code style and conventions observed
- Documentation standards
- Testing approach
- Logging patterns

### Current State
- Active branch
- Recent changes or development focus
- Any immediate observations or concerns

**Make this summary easy to scan - use bullet points and clear headers.**

## Priming Complete

Context loaded. Ready for planning or implementation tasks.
