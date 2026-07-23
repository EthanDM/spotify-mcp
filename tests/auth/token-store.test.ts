import { execFile } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { TokenStore } from "../../src/auth/token-store.js";
import type { StoredTokens } from "../../src/types.js";

const execute = promisify(execFile);

describe("TokenStore", () => {
  it("writes and reads tokens from disk", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "spotify-mcp-token-store-")
    );
    const store = new TokenStore(path.join(tempDir, "auth.json"));
    const tokens: StoredTokens = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 123,
      scope: "playlist-read-private",
      tokenType: "Bearer"
    };

    await store.write(tokens);
    await expect(store.read()).resolves.toEqual(tokens);
  });

  it("returns null when tokens do not exist", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "spotify-mcp-token-store-missing-")
    );
    const store = new TokenStore(path.join(tempDir, "missing.json"));

    await expect(store.read()).resolves.toBeNull();
  });

  it("revalidates storage containment before reading tokens", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "spotify-mcp-token-guard-")
    );
    const unavailable = new Error("Local storage no longer physically local");
    const store = new TokenStore(path.join(tempDir, "auth.json"), async () => {
      throw unavailable;
    });

    await expect(store.read()).rejects.toBe(unavailable);
  });

  it("refuses to write through a symlinked token file", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "spotify-mcp-token-link-")
    );
    const outside = path.join(tempDir, "outside.json");
    const tokenFile = path.join(tempDir, "auth.json");
    await fs.writeFile(outside, "outside");
    await fs.symlink(outside, tokenFile);
    const store = new TokenStore(tokenFile);

    await expect(
      store.write({
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 123,
        scope: "playlist-read-private",
        tokenType: "Bearer"
      })
    ).rejects.toThrow("must not contain symlinks");
    await expect(fs.readFile(outside, "utf8")).resolves.toBe("outside");
  });

  it("rejects FIFO token destinations without blocking", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "spotify-mcp-token-fifo-")
    );
    const tokenFile = path.join(tempDir, "auth.json");
    await execute("mkfifo", [tokenFile]);
    const reader = await fs.open(
      tokenFile,
      constants.O_RDONLY | constants.O_NONBLOCK
    );
    const store = new TokenStore(tokenFile);

    try {
      await expect(
        store.write({
          accessToken: "access",
          refreshToken: "refresh",
          expiresAt: 123,
          scope: "playlist-read-private",
          tokenType: "Bearer"
        })
      ).rejects.toThrow("must be a regular file");
    } finally {
      await reader.close();
    }
  });
});
