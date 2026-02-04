import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

/**
 * Validate filename to prevent path traversal attacks.
 * Only allows simple filenames (no slashes, no .. sequences).
 */
function validateFilename(filename: string): boolean {
  // Reject empty filenames
  if (!filename || filename.trim().length === 0) return false;
  // Reject path traversal attempts
  if (filename.includes("..")) return false;
  // Reject absolute paths (Unix or Windows)
  if (filename.startsWith("/") || /^[a-zA-Z]:/.test(filename)) return false;
  // Reject any slashes (only simple filenames allowed)
  if (filename.includes("/") || filename.includes("\\")) return false;
  return true;
}

export function createDataTools(dataPath: string) {
  const readDataFile = tool(
    "read_data_file",
    `Read a JSON data file from the project's data/ directory.

Use this when:
- Reading migration worklist, progress, or batch files
- Loading audit data for processing
- Checking current migration state

Do NOT use this for:
- Reading vault notes (use read_note instead)
- Reading markdown reports (use read_note instead)
- Writing data (use write_data_file instead)

Performance notes:
- Fast file read (~5ms)
- Returns raw JSON string for LLM to parse
- Files are typically 1-100KB

Examples:
- read_data_file({ filename: "migration-worklist.json" })
- read_data_file({ filename: "migration-progress.json" })
- read_data_file({ filename: "next-batch.json" })`,
    {
      filename: z.string().describe("Filename to read from data/ directory (e.g., 'migration-worklist.json')"),
    },
    async ({ filename }) => {
      if (!validateFilename(filename)) {
        return errorResult(`Invalid filename: "${filename}". Only simple filenames allowed (no paths or path traversal).`);
      }

      try {
        const fullPath = join(dataPath, filename);
        const content = await readFile(fullPath, "utf-8");
        return { content: [{ type: "text" as const, text: content }] };
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === "ENOENT") {
          return errorResult(`File not found: ${filename}`);
        }
        return errorResult(String(err));
      }
    },
  );

  const writeDataFile = tool(
    "write_data_file",
    `Write a JSON data file to the project's data/ directory.

Use this when:
- Writing audit data after scanning vault
- Updating migration progress after processing a batch
- Saving structured data for later processing

Do NOT use this for:
- Writing vault notes (use write_note instead)
- Writing markdown reports (use write_note instead)
- Reading data (use read_data_file instead)

Performance notes:
- Fast file write (~10ms)
- Creates data/ directory if needed
- Overwrites existing file

Examples:
- write_data_file({ filename: "audit-data.json", content: JSON.stringify(auditData, null, 2) })
- write_data_file({ filename: "migration-progress.json", content: JSON.stringify(progress, null, 2) })`,
    {
      filename: z.string().describe("Filename to write to data/ directory (e.g., 'audit-data.json')"),
      content: z.string().describe("Content to write to the file (typically JSON string)"),
    },
    async ({ filename, content }) => {
      if (!validateFilename(filename)) {
        return errorResult(`Invalid filename: "${filename}". Only simple filenames allowed (no paths or path traversal).`);
      }

      try {
        // Ensure data directory exists
        await mkdir(dataPath, { recursive: true });
        const fullPath = join(dataPath, filename);
        await writeFile(fullPath, content, "utf-8");
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, filename }) }] };
      } catch (err) {
        return errorResult(String(err));
      }
    },
  );

  return [readDataFile, writeDataFile];
}
