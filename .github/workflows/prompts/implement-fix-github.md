# Implement Fix: GitHub Issue #$ISSUE_NUMBER

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

## Issue Description

$ISSUE_BODY

## Prerequisites

- RCA document exists at: `docs/rca/issue-$ISSUE_NUMBER.md`
- Working in repository: $REPOSITORY

## Implementation Instructions

### 1. Read and Understand RCA

Read the complete RCA document:

```bash
cat docs/rca/issue-$ISSUE_NUMBER.md
```

Review:
- Root cause analysis
- Proposed fix strategy
- Files to modify
- Testing requirements
- Validation commands

Optional - view the GitHub issue for additional context:

```bash
gh issue view $ISSUE_NUMBER
```

### 2. Verify Current State

Before making changes:
- Confirm the issue still exists
- Check current state of affected files
- Review any recent changes to those files

### 3. Implement the Fix

Follow the "Proposed Fix" section from the RCA:

**For each file to modify:**

a. **Read the existing file**
   - Understand current implementation
   - Locate the specific code mentioned in RCA

b. **Make the fix**
   - Implement the change as described in RCA
   - Follow the fix strategy exactly
   - Maintain code style and conventions
   - Add comments if the fix is non-obvious

c. **Handle related changes**
   - Update any related code affected by the fix
   - Ensure consistency across the codebase
   - Update imports if needed

### 4. Add/Update Tests

Follow the "Testing Requirements" from RCA:

Create test cases for:
1. Verify the fix resolves the issue
2. Test edge cases related to the bug
3. Ensure no regression in related functionality
4. Test any new code paths introduced

**Test implementation:**
```python
def test_issue_$ISSUE_NUMBER_fix():
    """Test that issue #$ISSUE_NUMBER is fixed."""
    # Arrange - set up the scenario that caused the bug
    # Act - execute the code that previously failed
    # Assert - verify it now works correctly
```

### 5. Run Validation

Execute validation commands from RCA:

```bash
# Run linters
[from RCA validation commands]

# Run type checking
[from RCA validation commands]

# Run tests
[from RCA validation commands]
```

**If validation fails:**
- Fix the issues
- Re-run validation
- Don't proceed until all pass

### 6. Verify Fix

Manually verify:
- Follow reproduction steps from RCA
- Confirm issue no longer occurs
- Test edge cases
- Check for unintended side effects

### 7. Update Documentation (if needed)

- Update code comments
- Update API documentation
- Update README if user-facing
- Add notes about the fix

## GitHub Workflow Integration

### Branch Management

**If $CREATE_BRANCH is true:**

Configure git and create branch:

```bash
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git checkout -b $BRANCH_NAME
```

### Commit Changes

Commit all changes:

```bash
git add .
git commit -m "fix: resolve issue #$ISSUE_NUMBER - $ISSUE_TITLE

[Summary of what was fixed and how, based on RCA]

Fixes #$ISSUE_NUMBER"
```

**Note:** The `Fixes #$ISSUE_NUMBER` in commit message will auto-close the issue when merged.

### Push Branch

**If $CREATE_BRANCH is true:**

```bash
git push origin $BRANCH_NAME
```

### Create Pull Request

**If $CREATE_PR is true:**

Create PR with proper formatting:

```bash
gh pr create \
  --title "Fix: $ISSUE_TITLE" \
  --body "$(cat <<EOF
## Summary

Fixes #$ISSUE_NUMBER

[Summary from RCA - what was broken and how it was fixed]

## Root Cause

[Brief explanation from RCA]

## Changes Made

- [List key changes]

## Testing

- ✅ All tests pass
- ✅ Manual verification complete
- ✅ No regressions detected

## RCA Document

See \`docs/rca/issue-$ISSUE_NUMBER.md\` for detailed analysis.
EOF
)" \
  --base main \
  --head $BRANCH_NAME
```

### Comment on Issue

**If $COMMENT_ON_ISSUE is true:**

```bash
gh issue comment $ISSUE_NUMBER --body "$(cat <<EOF
## Fix Implemented

✅ Fix has been implemented and tested.

**Branch**: \`$BRANCH_NAME\`
**PR**: [Link will be auto-generated if PR created]

**Changes**:
- [Brief list of changes]

**Validation**: All tests passing, linters clean, manual verification complete.

**RCA Document**: \`docs/rca/issue-$ISSUE_NUMBER.md\`
EOF
)"
```

## Implementation Summary

Provide final summary:

### Fix Implementation Complete

**GitHub Issue**: #$ISSUE_NUMBER - $ISSUE_TITLE
**Issue URL**: https://github.com/$REPOSITORY/issues/$ISSUE_NUMBER

**Root Cause** (from RCA):
[One-line summary]

### Changes Made

**Files Modified:**
1. **[file-path]** - [What was changed] (lines X-Y)
2. **[file-path]** - [What was changed] (lines X-Y)

### Tests Added

**Test Files:**
1. **[test-file]** - [Test cases added]

**Coverage:**
- ✅ Fix verification test
- ✅ Edge case tests
- ✅ Regression prevention tests

### Validation Results

```bash
# Linter: PASS
# Type check: PASS
# Tests: PASS (X tests, Y new)
```

### Verification

- ✅ Followed reproduction steps - issue resolved
- ✅ Tested edge cases - all pass
- ✅ No new issues introduced
- ✅ Original functionality preserved

### GitHub Actions

- Branch: $BRANCH_NAME (created: $CREATE_BRANCH)
- PR: (created: $CREATE_PR)
- Issue comment: (posted: $COMMENT_ON_ISSUE)

**Implementation complete and ready for review.**
