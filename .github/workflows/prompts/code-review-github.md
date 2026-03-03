# Code Review: GitHub Pull Request

## GitHub Context

- **Repository**: $REPOSITORY
- **PR Number**: $PR_NUMBER
- **Triggered By**: $TRIGGERED_BY

## Review Instructions

Perform technical code review on changed files in this pull request.

### Core Principles

- Simplicity is the ultimate sophistication - every line should justify its existence
- Code is read far more often than it's written - optimize for readability
- The best code is often the code you don't write
- Elegance emerges from clarity of intent and economy of expression

### Gather Context

Read these files to understand codebase standards:
- CLAUDE.md (project rules and conventions)
- README.md (project overview)
- Key files in /core or similar directories
- Documentation in /docs directory

### Examine Changes

Run these commands to see what changed:

```bash
git status
git diff HEAD
git diff --stat HEAD
git ls-files --others --exclude-standard
```

**Read each changed file COMPLETELY** (not just the diff) to understand full context.

### Review Checklist

For each changed or new file, analyze for:

**1. Logic Errors**
- Off-by-one errors
- Incorrect conditionals
- Missing error handling
- Race conditions

**2. Security Issues**
- SQL injection vulnerabilities
- XSS vulnerabilities
- Insecure data handling
- Exposed secrets or API keys

**3. Performance Problems**
- N+1 queries
- Inefficient algorithms
- Memory leaks
- Unnecessary computations

**4. Code Quality**
- Violations of DRY principle
- Overly complex functions
- Poor naming
- Missing type hints/annotations

**5. Standards Adherence**
- Documentation standards
- Linting, typing, formatting standards
- Logging standards
- Testing standards

### Verify Issues Are Real

- Run specific tests for issues found
- Confirm type errors are legitimate
- Validate security concerns with context

### Output Review Comment

Post a structured review comment directly on the PR with the following format:

```markdown
## Code Review: PR #$PR_NUMBER

**Repository**: $REPOSITORY
**Reviewed By**: $TRIGGERED_BY
**Date**: [current date]

### Stats

- Files Modified: X
- Files Added: Y
- Files Deleted: Z
- Lines Added: A
- Lines Deleted: B

### Issues Found

[For each issue:]

**Severity**: critical|high|medium|low
**File**: path/to/file.py:42
**Issue**: [one-line description]
**Detail**: [explanation of why this is a problem]
**Suggestion**: [how to fix it]

---

### Summary

[If no issues]: ✅ Code review passed. No technical issues detected.
[If issues found]: Found X issues (Y critical, Z high, W medium, V low). See details above.
```

$IF_COMMENT_ON_PR

Post this review directly as a comment on the PR:

```bash
gh pr comment $PR_NUMBER --body "$(cat <<'EOF'
[Your formatted review from above]
EOF
)"
```

$ENDIF_COMMENT_ON_PR

## Important Notes

- Be specific (include line numbers, not vague complaints)
- Focus on real bugs, not just style preferences
- Suggest fixes, don't just complain
- Flag security issues as CRITICAL
- Consider project context before flagging violations
