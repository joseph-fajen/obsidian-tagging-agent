---
status: IMPLEMENTED
created_date: 2026-02-04
implemented_date: 2026-02-04
confidence_score: 8/10
---

# Feature: Interactive Agent Experience

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Transform the Obsidian Vault Tagging Agent from a CLI tool requiring 5 discrete command invocations (`audit`, `plan`, `generate-worklist`, `execute`, `verify`) into a true interactive agent experience where:

- User launches the agent with a single command
- Agent introduces itself and explains the tag migration workflow
- Agent guides user conversationally through each phase
- After each phase, agent pauses for user review and input
- Session persists via Claude Agent SDK's `resume: sessionId` mechanism
- User can exit at any checkpoint and resume later (state persisted to disk)
- Experience is analogous to Claude Code — conversational, guiding, supportive

The agent should speak the language of someone who appreciates a well-tagged Obsidian vault, understanding the value of visibility and organization. It should be supportive and guide users who may not understand the technical details, without being condescending.

## User Story

As an Obsidian vault owner
I want the tagging agent to guide me through the entire migration workflow in a single interactive session
So that I have a conversational, supportive experience rather than manually orchestrating discrete CLI commands

## Problem Statement

The current agent requires users to:
1. Manually invoke 5 separate CLI commands in the correct order
2. Know when to run each command and what to review between them
3. Lose conversational context between invocations
4. Remember where they left off if they exit mid-migration

This creates a "CLI tool experience" rather than an "agentic experience."

## Solution Statement

Implement an interactive REPL loop with:
1. A state machine controlling conversation flow through phases
2. Session persistence via SDK's `resume: sessionId` for context continuity
3. User input handling via `readline/promises` for prompts between agent turns
4. Hybrid prompt architecture: stable personality + dynamic phase instructions
5. Disk-based state persistence for resuming across terminal sessions

## Feature Metadata

**Feature Type**: Enhancement / Architectural Refactor
**Estimated Complexity**: High
**Primary Systems Affected**: `tagging-agent.ts` (entry point), prompt architecture, session management
**Dependencies**: Claude Agent SDK session support, Node.js readline/promises

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING!

| File | Lines | Why Read This |
|------|-------|---------------|
| `tagging-agent.ts` | 1-973 | Main entry point — understand current architecture before refactoring |
| `tagging-agent.ts` | 16-351 | System prompts — these become helper functions for phase instructions |
| `tagging-agent.ts` | 376-388 | `buildMcpServer()` — stateless, reusable across queries |
| `tagging-agent.ts` | 588-768 | `runAgent()` — current execution flow to transform |
| `tagging-agent.ts` | 781-876 | Recovery agent pattern — extend for interactive error handling |
| `tagging-agent.ts` | 712-722 | `streamPrompt()` generator — needs session_id integration |
| `reference/workshop/demo/sessions.ts` | 46-115 | Session capture pattern — critical for implementation |
| `reference/workshop/demo/sessions.ts` | 136-179 | Session resume pattern — use `options: { resume: sessionId }` |
| `lib/config.ts` | all | Config loading — extend for interactive mode |
| `lib/worklist-generator.ts` | all | Deterministic worklist — called directly, no LLM |
| `tools/vault-tools.ts` | all | MCP tools — unchanged, reused |
| `tools/data-tools.ts` | all | Data persistence tools — unchanged, reused |

### New Files to Create

| File | Purpose |
|------|---------|
| `lib/interactive-agent.ts` | Main interactive loop, state machine, user input handling |
| `lib/agent-personality.ts` | Base personality prompt and phase instruction builders |
| `lib/session-state.ts` | Session state interface and disk persistence |

### Files to Modify

| File | Changes |
|------|---------|
| `tagging-agent.ts` | Add interactive mode entry, refactor prompts to be importable |
| `lib/config.ts` | Add `interactive` mode, session state path |

### Relevant Documentation — READ BEFORE IMPLEMENTING!

- [Session Management - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/sessions)
  - Section: "Getting the Session ID", "Resuming Sessions"
  - Why: Core pattern for multi-turn conversation persistence

- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
  - Section: `query()` function, `Options` type, `SDKMessage` types
  - Why: API details for session handling and message processing

- [Node.js Readline Promises](https://nodejs.org/api/readline.html#readline-promises-api)
  - Section: `createInterface()`, `question()`
  - Why: User input handling pattern

### Patterns to Follow

**Session Capture Pattern** (from `reference/workshop/demo/sessions.ts:77-84`):
```typescript
let sessionId: string | undefined;

for await (const message of query({ prompt, options })) {
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id;
  }
  // ... handle other messages
}
```

**Session Resume Pattern** (from `reference/workshop/demo/sessions.ts:136-149`):
```typescript
for await (const message of query({
  prompt: userInput,
  options: {
    resume: sessionId,  // Continue conversation context
    // ... other options
  },
})) {
  // ... handle messages
}
```

**User Input Pattern** (Node.js readline/promises):
```typescript
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

const rl = createInterface({ input, output });
const answer = await rl.question('Your choice: ');
rl.close();
```

**State Machine Pattern** (TypeScript discriminated union):
```typescript
type AgentState =
  | { phase: 'WELCOME' }
  | { phase: 'AUDIT'; status: 'running' | 'complete' }
  | { phase: 'REVIEW_AUDIT' }
  | { phase: 'PLAN'; status: 'running' | 'complete' }
  | { phase: 'REVIEW_PLAN' }
  | { phase: 'GENERATE_WORKLIST' }
  | { phase: 'REVIEW_WORKLIST' }
  | { phase: 'EXECUTE'; batchNumber: number; totalBatches: number }
  | { phase: 'VERIFY'; status: 'running' | 'complete' }
  | { phase: 'COMPLETE' }
  | { phase: 'EXIT' };
```

**Naming Conventions** (from CLAUDE.md):
- Filenames: kebab-case (`interactive-agent.ts`)
- Named exports only (no default exports)
- Types: PascalCase (`AgentState`, `SessionState`)
- Functions: camelCase (`runInteractiveAgent`, `captureSessionId`)

**Error Handling** (from existing recovery agent pattern):
- Wrap main execution in try/catch
- On error, present options to user rather than crashing
- Log errors clearly with context

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — Session State and Types

Create the foundational types and session state management before modifying the main agent.

**Tasks:**
- Define `AgentState` discriminated union type
- Define `SessionState` interface for disk persistence
- Implement load/save functions for session state
- Add interactive mode to config

### Phase 2: Personality and Prompts

Refactor existing prompts into a modular architecture with a stable personality layer.

**Tasks:**
- Create base personality prompt (friendly vault organization guide)
- Extract phase-specific instructions from existing `build*SystemPrompt` functions
- Create `buildInteractiveSystemPrompt()` that combines personality + phase instructions
- Ensure backward compatibility — existing CLI modes still work

### Phase 3: Interactive Loop Core

Implement the main interactive loop with session management.

**Tasks:**
- Create `runInteractiveAgent()` function
- Implement session ID capture from init message
- Implement session resume for subsequent queries
- Add user input handling between phases
- Implement state machine transitions

### Phase 4: Phase Integration

Connect the interactive loop to existing phase logic.

**Tasks:**
- Integrate audit phase execution
- Integrate plan phase execution
- Integrate generate-worklist (direct code call, no LLM)
- Integrate execute phase with batch progress display
- Integrate verify phase execution

### Phase 5: Polish and Edge Cases

Handle interrupts, resumption, and edge cases.

**Tasks:**
- Implement graceful Ctrl+C handling
- Implement session resumption on startup (detect existing state)
- Add clear exit point messaging
- Handle errors gracefully with user options

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task 1: CREATE `lib/session-state.ts`

- **IMPLEMENT**: Session state types and persistence
- **PATTERN**: Follow existing `data/` file patterns from `tagging-agent.ts:422-454`
- **IMPORTS**: `fs/promises`, `path`

```typescript
// Types to implement:
export type AgentPhase =
  | 'WELCOME'
  | 'AUDIT'
  | 'REVIEW_AUDIT'
  | 'PLAN'
  | 'REVIEW_PLAN'
  | 'GENERATE_WORKLIST'
  | 'REVIEW_WORKLIST'
  | 'EXECUTE'
  | 'REVIEW_EXECUTE'
  | 'VERIFY'
  | 'REVIEW_VERIFY'
  | 'COMPLETE';

export interface SessionState {
  sessionId: string | null;
  currentPhase: AgentPhase;
  startedAt: string;
  lastUpdatedAt: string;
  vaultPath: string;
  // Phase-specific state
  auditComplete: boolean;
  planComplete: boolean;
  worklistGenerated: boolean;
  executeBatchNumber: number;
  executeTotalBatches: number;
  verifyComplete: boolean;
}

export function createInitialState(vaultPath: string): SessionState;
export async function loadSessionState(dataPath: string): Promise<SessionState | null>;
export async function saveSessionState(dataPath: string, state: SessionState): Promise<void>;
export async function clearSessionState(dataPath: string): Promise<void>;
```

- **GOTCHA**: Handle file not found gracefully (return null, not throw)
- **VALIDATE**: `bun test tests/session-state.test.ts`

---

### Task 2: CREATE `tests/session-state.test.ts`

- **IMPLEMENT**: Unit tests for session state persistence
- **PATTERN**: Follow existing test patterns from `tests/frontmatter.test.ts`
- **IMPORTS**: `bun:test`, session-state functions

```typescript
// Test cases to implement:
// - createInitialState returns valid state
// - saveSessionState writes JSON file
// - loadSessionState reads JSON file
// - loadSessionState returns null when file doesn't exist
// - clearSessionState removes file
// - Round-trip: save then load preserves all fields
```

- **VALIDATE**: `bun test tests/session-state.test.ts`

---

### Task 3: UPDATE `lib/config.ts`

- **IMPLEMENT**: Add `interactive` mode and session state path to config
- **PATTERN**: Follow existing mode validation pattern
- **IMPORTS**: No new imports needed

Changes:
1. Add `'interactive'` to `AgentMode` type
2. Add `sessionStatePath` to `Config` interface (defaults to `data/interactive-session.json`)
3. Update `loadConfig()` to handle interactive mode

- **GOTCHA**: Keep backward compatibility — existing modes still work
- **VALIDATE**: `bun test tests/configurations.test.ts`

---

### Task 4: UPDATE `tests/configurations.test.ts`

- **IMPLEMENT**: Add tests for interactive mode
- **PATTERN**: Follow existing mode validation tests

```typescript
// Add test cases:
// - 'interactive' is a valid mode
// - Config includes sessionStatePath
// - Default sessionStatePath is correct
```

- **VALIDATE**: `bun test tests/configurations.test.ts`

---

### Task 5: CREATE `lib/agent-personality.ts`

- **IMPLEMENT**: Base personality prompt and phase instruction builders
- **PATTERN**: Extract from existing `build*SystemPrompt` functions in `tagging-agent.ts:16-351`
- **IMPORTS**: `Config` from `./config.js`

```typescript
// Functions to implement:

/**
 * Base personality prompt (~300 tokens) — stable across all phases.
 * Friendly guide who appreciates well-tagged vaults.
 */
export function buildPersonalityPrompt(): string;

/**
 * Phase-specific instructions extracted from existing prompts.
 * These are appended to the personality prompt based on current phase.
 */
export function buildAuditInstructions(config: Config): string;
export function buildPlanInstructions(config: Config): string;
export function buildExecuteInstructions(config: Config): string;
export function buildVerifyInstructions(config: Config): string;

/**
 * Combine personality + phase instructions for interactive mode.
 */
export function buildInteractiveSystemPrompt(
  phase: AgentPhase,
  config: Config
): string;

/**
 * Build conversational prompts for transitions between phases.
 */
export function buildPhaseTransitionPrompt(
  fromPhase: AgentPhase,
  toPhase: AgentPhase,
  context?: { batchNumber?: number; totalBatches?: number }
): string;
```

Personality prompt should convey:
- Appreciation for well-organized knowledge
- Understanding of why users value a clean tagging system
- Supportive guidance without condescension
- Awareness that user may not understand technical details

- **GOTCHA**: Keep instructions concise — we're paying per token
- **VALIDATE**: `bun test tests/agent-personality.test.ts`

---

### Task 6: CREATE `tests/agent-personality.test.ts`

- **IMPLEMENT**: Tests for personality and instruction builders
- **PATTERN**: Follow existing prompt test patterns from `tests/agent-prompts.test.ts`

```typescript
// Test cases:
// - buildPersonalityPrompt returns non-empty string
// - buildPersonalityPrompt mentions vault organization
// - buildAuditInstructions includes key audit steps
// - buildPlanInstructions includes mapping table guidance
// - buildExecuteInstructions includes batch processing
// - buildVerifyInstructions includes compliance checks
// - buildInteractiveSystemPrompt combines personality + phase
// - buildPhaseTransitionPrompt returns appropriate message
```

- **VALIDATE**: `bun test tests/agent-personality.test.ts`

---

### Task 7: CREATE `lib/interactive-agent.ts`

- **IMPLEMENT**: Main interactive loop with state machine and session management
- **PATTERN**: Session handling from `reference/workshop/demo/sessions.ts`
- **IMPORTS**:
  - `query`, `createSdkMcpServer` from `@anthropic-ai/claude-agent-sdk`
  - `createInterface` from `readline/promises`
  - `stdin`, `stdout` from `process`
  - Types and functions from local modules

```typescript
// Core function signature:
export async function runInteractiveAgent(config: Config): Promise<void>;

// Internal helpers:
async function captureSessionId(
  response: AsyncIterable<SDKMessage>
): Promise<string>;

async function promptUser(
  rl: readline.Interface,
  message: string,
  options?: string[]
): Promise<string>;

function transitionState(
  currentState: SessionState,
  userInput: string,
  phaseResult: 'success' | 'error'
): SessionState;

async function runPhase(
  phase: AgentPhase,
  sessionId: string | undefined,
  config: Config,
  mcpServer: McpSdkServerConfigWithInstance
): Promise<{ sessionId: string; result: string; success: boolean }>;

async function displayWelcome(): Promise<void>;

async function handlePhaseComplete(
  phase: AgentPhase,
  result: string,
  rl: readline.Interface
): Promise<'continue' | 'exit' | 'review'>;
```

Key implementation details:

1. **Welcome flow**: Check for existing session state, offer to resume or start fresh
2. **Main loop**: While not EXIT, run current phase, prompt user, transition state
3. **Session management**: Capture ID on first query, pass `resume` on subsequent
4. **User prompts**: Clear options at each checkpoint (continue/review/exit)
5. **State persistence**: Save after each state transition
6. **Graceful exit**: Clear messaging about what's saved and how to resume

- **GOTCHA**: Don't forget to close readline interface on exit
- **GOTCHA**: Handle Ctrl+C gracefully (save state before exit)
- **VALIDATE**: Manual testing (interactive mode is hard to unit test)

---

### Task 8: UPDATE `tagging-agent.ts`

- **IMPLEMENT**: Add interactive mode entry point, refactor for imports
- **PATTERN**: Keep existing CLI modes working
- **IMPORTS**: Add `runInteractiveAgent` from `./lib/interactive-agent.js`

Changes:

1. **Export existing prompt builders** (lines 16-351) — add `export` keyword so they can be imported by `agent-personality.ts`

2. **Update main entry logic** (bottom of file):
```typescript
// If no mode argument or mode is 'interactive', run interactive mode
const modeArg = process.argv[2];
if (!modeArg || modeArg === 'interactive') {
  runInteractiveAgent(loadConfig()).catch((err) => {
    console.error("Unhandled error:", err);
    process.exit(1);
  });
} else {
  // Existing CLI mode logic
  runWithRecovery(loadConfig()).catch((err) => {
    console.error("Unhandled fatal error:", err);
    process.exit(1);
  });
}
```

3. **Keep backward compatibility**: All existing modes (`audit`, `plan`, `generate-worklist`, `execute`, `verify`) work exactly as before

- **GOTCHA**: Test all existing modes still work after changes
- **VALIDATE**:
  - `bun run tagging-agent.ts audit --help` (or similar) still works
  - `bun run tagging-agent.ts` launches interactive mode

---

### Task 9: CREATE `tests/interactive-agent.test.ts`

- **IMPLEMENT**: Unit tests for interactive agent helpers (not the full loop)
- **PATTERN**: Test individual functions, mock readline for input tests

```typescript
// Testable units:
// - transitionState correctly moves between phases
// - transitionState handles 'exit' input
// - Phase transitions follow expected order
// - State persistence integration (save/load round trip with transitions)
```

Note: Full interactive loop testing requires manual testing or complex mocking. Focus unit tests on the state machine logic.

- **VALIDATE**: `bun test tests/interactive-agent.test.ts`

---

### Task 10: UPDATE `README.md`

- **IMPLEMENT**: Document interactive mode usage
- **PATTERN**: Follow existing documentation style

Add new section after "Usage":

```markdown
## Interactive Mode (Recommended)

Launch the agent without arguments for a guided interactive experience:

\`\`\`bash
bun run tagging-agent.ts
\`\`\`

The agent will:
1. Introduce itself and explain the migration workflow
2. Guide you through each phase (audit → plan → generate-worklist → execute → verify)
3. Pause after each phase for you to review results
4. Allow you to exit at any checkpoint and resume later

### Resuming a Session

If you exit mid-migration, the agent saves your progress. Simply run the command again:

\`\`\`bash
bun run tagging-agent.ts
\`\`\`

The agent will detect your saved session and offer to resume where you left off.

### CLI Mode (Advanced)

For scripted or non-interactive use, you can still run individual phases:

\`\`\`bash
bun run tagging-agent.ts audit
bun run tagging-agent.ts plan
# ... etc
\`\`\`
```

- **VALIDATE**: Review rendered markdown

---

### Task 11: UPDATE `PROJECT_STATUS.md`

- **IMPLEMENT**: Document interactive mode implementation
- **PATTERN**: Follow existing status update format

Add to "Implementation Status" section and update "Next Actions".

- **VALIDATE**: Review file content

---

### Task 12: UPDATE `CHANGELOG.md`

- **IMPLEMENT**: Document the interactive agent feature
- **PATTERN**: Follow existing changelog entry format with session context, solutions, files changed

- **VALIDATE**: Review file content

---

## TESTING STRATEGY

### Unit Tests

| Test File | Coverage |
|-----------|----------|
| `tests/session-state.test.ts` | State persistence, load/save, clear |
| `tests/agent-personality.test.ts` | Prompt builders, phase instructions |
| `tests/interactive-agent.test.ts` | State machine transitions |
| `tests/configurations.test.ts` | Interactive mode config |

### Integration Tests

The full interactive loop is difficult to unit test due to:
- User input (stdin)
- Session ID from live API calls
- Multi-turn conversation flow

**Manual integration testing checklist:**
- [ ] Fresh start: No existing session, agent welcomes user
- [ ] Resume: Existing session detected, agent offers to resume
- [ ] Full flow: Complete audit → plan → worklist → execute → verify
- [ ] Exit and resume: Exit at each checkpoint, resume successfully
- [ ] Ctrl+C handling: State saved on interrupt
- [ ] Error recovery: Agent handles errors gracefully

### Edge Cases

- [ ] Empty vault (no notes to process)
- [ ] Already-migrated vault (verify shows 100% compliance)
- [ ] Unmapped tags (agent pauses for user decision)
- [ ] Large batch (execute shows progress)
- [ ] API timeout/error mid-phase

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
# Type check entire project
bunx tsc --noEmit
```

Expected: No errors (pre-existing workshop errors are acceptable)

### Level 2: Unit Tests

```bash
# Run all tests
bun test

# Run specific new tests
bun test tests/session-state.test.ts
bun test tests/agent-personality.test.ts
bun test tests/interactive-agent.test.ts
bun test tests/configurations.test.ts
```

Expected: All 141+ tests pass

### Level 3: Backward Compatibility

```bash
# Verify existing CLI modes still work
bun run tagging-agent.ts audit 2>&1 | head -20
bun run tagging-agent.ts plan 2>&1 | head -20
bun run tagging-agent.ts generate-worklist 2>&1 | head -20
```

Expected: Each mode starts correctly (may fail due to missing files, but should not crash on startup)

### Level 4: Interactive Mode Launch

```bash
# Launch interactive mode (manual verification)
bun run tagging-agent.ts
```

Expected: Agent displays welcome message and prompts for input

### Level 5: Manual Walkthrough

Perform a complete manual test:
1. Launch interactive mode
2. Proceed through audit phase
3. Review audit results
4. Continue to plan phase
5. Exit mid-plan
6. Relaunch and verify resume works
7. Complete remaining phases

---

## ACCEPTANCE CRITERIA

- [ ] Running `bun run tagging-agent.ts` (no args) launches interactive mode
- [ ] Agent introduces itself with friendly, vault-appreciating personality
- [ ] Agent guides user through audit → plan → generate-worklist → execute → verify
- [ ] User can review results after each phase before continuing
- [ ] User can exit at any checkpoint with clear messaging
- [ ] Session state persists to `data/interactive-session.json`
- [ ] Relaunching after exit offers to resume from saved state
- [ ] All existing CLI modes (`audit`, `plan`, etc.) still work unchanged
- [ ] All existing tests pass (141+ tests)
- [ ] Type checking passes (`bunx tsc --noEmit`)
- [ ] README documents interactive mode usage
- [ ] PROJECT_STATUS.md and CHANGELOG.md updated

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works
- [ ] Backward compatibility verified
- [ ] Documentation updated
- [ ] Acceptance criteria all met

---

## NOTES

### Design Decisions

1. **Hybrid prompt architecture chosen** over single mega-prompt because:
   - Keeps phase-specific instructions focused
   - Allows personality to remain consistent
   - Easier to maintain and test individual components

2. **State machine with discriminated union** chosen over XState because:
   - Simpler, no external dependency
   - Sufficient for linear workflow with known states
   - Type-safe transitions enforced by TypeScript

3. **Session ID from SDK** used instead of custom session management because:
   - SDK handles context automatically
   - Proven pattern from workshop demos
   - Reduces complexity

4. **`readline/promises`** used instead of callback-based readline because:
   - Cleaner async/await integration
   - Native to Node.js 17+ (Bun compatible)
   - Simpler control flow

### Trade-offs

1. **Interactive loop is hard to unit test** — Accepted trade-off; state machine logic is unit tested, full flow requires manual testing

2. **Additional file I/O for state persistence** — Acceptable overhead for resumption capability

3. **Longer initial prompt due to personality** — Worth it for better UX; cost is covered by Claude Code subscription

### Future Enhancements

1. **Menu-driven input** — Could add numbered options for clearer choices
2. **Progress bars** — Visual feedback during long operations
3. **Color output** — Improve terminal UX with colored text
4. **Web UI** — Future consideration for non-CLI users
