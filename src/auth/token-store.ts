import fs from "node:fs/promises";
import path from "node:path";

import type { StoredTokens } from "../types.js";

/**
 * Persists Spotify tokens with restrictive permissions so the MCP server and
 * auth CLI can share a single user-scoped credential cache.
 */
export class TokenStore {
  /**
   * The store is path-based so tests can redirect persistence without mocking
   * the filesystem API itself.
   */
  constructor(private readonly filePath: string) {}

  /**
   * Reads stored tokens if they exist. Missing files are treated as "not logged in".
   */
  async read(): Promise<StoredTokens | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as StoredTokens;
    } catch (error) {
      const isMissingFile =
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT";

      if (isMissingFile) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Writes tokens atomically enough for a local single-user workflow and keeps
   * both the directory and file private to the current user.
   */
  async write(tokens: StoredTokens): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(this.filePath, JSON.stringify(tokens, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    await fs.chmod(this.filePath, 0o600);
  }
}
