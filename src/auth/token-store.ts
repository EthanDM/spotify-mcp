import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  assertNoSymlinksWithinRoot,
  readFileNoFollow
} from "../storage/shared.js";
import type { StoredTokens } from "../types.js";

export type TokenStoreLike = {
  read(): Promise<StoredTokens | null>;
  write(tokens: StoredTokens): Promise<void>;
};

/**
 * Persists Spotify tokens with restrictive permissions so the MCP server and
 * auth CLI can share a single user-scoped credential cache.
 */
export class TokenStore implements TokenStoreLike {
  /**
   * The store is path-based so tests can redirect persistence without mocking
   * the filesystem API itself.
   */
  constructor(
    private readonly filePath: string,
    private readonly assertStorageAvailable?: () => Promise<void>
  ) {}

  /**
   * Reads stored tokens if they exist. Missing files are treated as "not logged in".
   */
  async read(): Promise<StoredTokens | null> {
    await this.assertStorageAvailable?.();
    try {
      await assertNoSymlinksWithinRoot(
        path.dirname(this.filePath),
        this.filePath
      );
      const raw = await readFileNoFollow(this.filePath);
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
    await this.assertStorageAvailable?.();
    await fs.mkdir(path.dirname(this.filePath), {
      recursive: true,
      mode: 0o700
    });
    await assertNoSymlinksWithinRoot(
      path.dirname(this.filePath),
      this.filePath
    );
    const handle = await fs.open(
      this.filePath,
      constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_NONBLOCK |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600
    );
    try {
      if (!(await handle.stat()).isFile())
        throw new Error(
          `Token storage path must be a regular file: ${this.filePath}`
        );
      await handle.writeFile(JSON.stringify(tokens, null, 2), "utf8");
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
  }
}
