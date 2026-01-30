import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

export function createGitTools(vaultPath: string) {
  const gitCommit = tool(
    "git_commit",
    `Create a git commit in the vault repo for rollback safety.

Use this when:
- Before starting a batch of tag changes (checkpoint)
- After completing a batch of tag changes (save point)
- After writing a report or plan note

Do NOT use this for:
- Reading git history or status (not supported)
- Reverting changes (manual operation, outside agent scope)

Performance notes:
- ~200ms execution time
- Stages all changes in the vault directory before committing
- Commit messages should be descriptive, e.g., "Tag migration batch 3/18: Archive/Projects notes"

Examples:
- git_commit({ message: "Pre-migration checkpoint: audit complete" })
- git_commit({ message: "Tag migration batch 1/18: daily journal notes (50 notes)" })`,
    {
      message: z.string().describe("Descriptive commit message for the git commit."),
    },
    async ({ message }) => {
      try {
        const addProc = Bun.spawn(["git", "-C", vaultPath, "add", "-A"], {
          stdout: "pipe",
          stderr: "pipe",
        });
        await addProc.exited;

        const commitProc = Bun.spawn(["git", "-C", vaultPath, "commit", "-m", message], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const exitCode = await commitProc.exited;
        const stdout = await new Response(commitProc.stdout).text();
        const stderr = await new Response(commitProc.stderr).text();

        if (exitCode !== 0) {
          if (stderr.includes("nothing to commit") || stdout.includes("nothing to commit")) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ success: true, commitHash: null, warning: "Nothing to commit" }),
                },
              ],
            };
          }
          return errorResult(`git commit failed: ${stderr}`);
        }

        const hashMatch = stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
        const commitHash = hashMatch ? hashMatch[1] : "unknown";

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true, commitHash }) }],
        };
      } catch (err) {
        return errorResult(String(err));
      }
    },
  );

  return [gitCommit];
}
