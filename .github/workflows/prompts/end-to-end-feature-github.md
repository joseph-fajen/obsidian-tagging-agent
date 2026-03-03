# End-to-End Feature Development: GitHub Issue #$ISSUE_NUMBER

## GitHub Context

- **Repository**: $REPOSITORY
- **Issue Number**: $ISSUE_NUMBER
- **Issue Title**: $ISSUE_TITLE
- **Triggered By**: $TRIGGERED_BY
- **Branch Name**: $BRANCH_NAME

## Configuration

CREATE_BRANCH=$CREATE_BRANCH
CREATE_PR=$CREATE_PR
COMMENT_ON_ISSUE=$COMMENT_ON_ISSUE

## Feature Description

$ISSUE_BODY

## Overview

This workflow chains the 4 core commands for autonomous feature development in a GitHub Actions environment.

---

## Step 1: Prime - Load Codebase Context

Execute the priming workflow to understand the codebase.

**Reference**: `.github/workflows/prompts/prime-github.md`

**Action**: Read and execute all instructions from the prime workflow.

**Expected Output**: Comprehensive understanding of project structure, tech stack, patterns, and current state.

---

## Step 2: Planning - Create Implementation Plan

Create a detailed implementation plan for the feature.

**Reference**: `.github/workflows/prompts/plan-feature-github.md`

**Feature to Plan**: $ISSUE_BODY

**Action**: Read and execute all instructions from the plan-feature workflow, using the feature description above.

**Expected Output**:
- Plan file created at `.agents/plans/{feature-name}.md`
- Note the exact filename/path for Step 3

**IMPORTANT**: Capture the feature name and plan file path that the planning step creates. You'll need it for the next step.

---

## Step 3: Execute - Implement the Feature

Implement the feature from the plan document.

**Reference**: `.github/workflows/prompts/execute-github.md`

**Plan File**: `.agents/plans/{feature-name}.md` (from Step 2)

**Action**: Read and execute all instructions from the execute workflow, using the plan file path from Step 2.

**Expected Output**:
- All code implemented
- All tests passing
- All validations passing

---

## Step 4: GitHub Workflow Integration

Now handle the GitHub-specific actions based on configuration.

### Configure Git

Configure git for commits:

```bash
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
```

### Branch Management

**If CREATE_BRANCH = "true":**

Create and switch to the feature branch:

```bash
git checkout -b $BRANCH_NAME
```

### Commit Changes

Create a commit with all changes:

```bash
git add .
git commit -m "feat: $ISSUE_TITLE

Implemented feature from issue #$ISSUE_NUMBER

$ISSUE_BODY

Closes #$ISSUE_NUMBER"
```

**Note:** The `Closes #$ISSUE_NUMBER` in commit message will auto-close the issue when merged.

### Push Branch

**If CREATE_BRANCH = "true":**

Push the branch to remote:

```bash
git push origin $BRANCH_NAME
```

### Create Pull Request

**If CREATE_PR = "true":**

Create a pull request:

```bash
gh pr create \
  --title "Feature: $ISSUE_TITLE" \
  --body "$(cat <<EOF
## Summary

Implements #$ISSUE_NUMBER

$ISSUE_BODY

## Implementation Details

This feature was implemented using the autonomous end-to-end workflow:

1. **Prime**: Analyzed codebase structure and patterns
2. **Plan**: Created comprehensive implementation plan
3. **Execute**: Implemented all tasks with full validation
4. **Validate**: All tests passing, linters clean

## Plan Document

See \`.agents/plans/{feature-name}.md\` for detailed implementation plan.

## Testing

- ✅ All unit tests passing
- ✅ All integration tests passing
- ✅ Linters and type checkers clean
- ✅ Manual validation complete

## Closes

Closes #$ISSUE_NUMBER
EOF
)" \
  --base main \
  --head $BRANCH_NAME
```

### Comment on Issue

**If COMMENT_ON_ISSUE = "true":**

Post a summary comment on the issue:

```bash
gh issue comment $ISSUE_NUMBER --body "$(cat <<EOF
## Feature Implementation Complete

✅ Feature has been fully implemented and validated.

**Branch**: \`$BRANCH_NAME\`
**Implementation Plan**: \`.agents/plans/{feature-name}.md\`

### Workflow Executed

1. ✅ **Prime**: Codebase context loaded
2. ✅ **Plan**: Implementation plan created
3. ✅ **Execute**: Feature implemented and validated
4. ✅ **Commit**: Changes committed

### Validation

- ✅ All tests passing
- ✅ Linters clean
- ✅ Type checkers passing
- ✅ Manual verification complete

Pull request will be created automatically.
EOF
)"
```

---

## Final Summary

Provide comprehensive summary of the end-to-end execution:

### Feature Implementation Complete

**Original Request**: $ISSUE_BODY

**GitHub Issue**: #$ISSUE_NUMBER - $ISSUE_TITLE
**Repository**: $REPOSITORY

**Feature Name**: {feature-name from planning step}
**Plan Document**: `.agents/plans/{feature-name}.md`

### Steps Executed

1. ✅ **Prime** - Codebase context loaded
   - Project structure analyzed
   - Patterns and conventions identified
   - Tech stack documented

2. ✅ **Planning** - Plan created at `.agents/plans/{feature-name}.md`
   - Feature analyzed and decomposed
   - Implementation strategy designed
   - Testing approach defined

3. ✅ **Execute** - Feature implemented and validated
   - All tasks completed in order
   - All tests passing
   - All validations passing

4. ✅ **GitHub Integration** - Branch/PR/Comment handled
   - Branch: $BRANCH_NAME (created: $CREATE_BRANCH)
   - PR: (created: $CREATE_PR)
   - Issue comment: (posted: $COMMENT_ON_ISSUE)

### Outputs

- **Plan document**: `.agents/plans/{feature-name}.md`
- **Files created/modified**: [list key files]
- **Tests added**: [list test files]
- **Commit**: [commit hash if available]
- **Branch**: $BRANCH_NAME

### Validation Results

```bash
# All validation commands passed
# Linter: PASS
# Type check: PASS
# Unit tests: PASS
# Integration tests: PASS
```

### Next Steps

- PR is ready for review
- All validations passing
- No manual intervention needed
- Issue will auto-close when PR is merged

**End-to-end feature development complete.**
