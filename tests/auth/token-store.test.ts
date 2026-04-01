import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TokenStore } from "../../src/auth/token-store.js";
import type { StoredTokens } from "../../src/types.js";

describe("TokenStore", () => {
  it("writes and reads tokens from disk", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spotify-mcp-token-store-"));
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
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spotify-mcp-token-store-missing-"));
    const store = new TokenStore(path.join(tempDir, "missing.json"));

    await expect(store.read()).resolves.toBeNull();
  });
});
