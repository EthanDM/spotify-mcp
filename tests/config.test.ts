import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getStorageConfig } from "../src/config.js";

describe("storage configuration", () => {
  it("preserves the legacy local-only paths by default", () => {
    const config = getStorageConfig({});
    const root = path.join(os.homedir(), ".config", "spotify-mcp");
    expect(config.localRoot).toBe(root);
    expect(config.sharedMode).toBe(false);
    expect(config.tokenFile).toBe(path.join(root, "auth.json"));
    expect(config.artifactsDirectory).toBe(path.join(root, "artifacts"));
  });

  it("expands home paths and keeps auth local in shared mode", () => {
    const config = getStorageConfig({
      SPOTIFY_MCP_DATA_DIR: "~/.config/spotify-mcp-test",
      SPOTIFY_MCP_SHARED_DATA_DIR: "~/Shared/spotify-mcp",
      SPOTIFY_MCP_MACHINE_ID: "neo"
    });
    expect(config.sharedMode).toBe(true);
    expect(config.tokenFile).toContain("/.config/spotify-mcp-test/auth.json");
    expect(config.sharedPeopleDirectory).toContain(
      "/Shared/spotify-mcp/people"
    );
    expect(config.artifactsDirectory).toContain(
      "/Shared/spotify-mcp/artifacts"
    );
  });

  it("rejects unsafe shared configuration", () => {
    expect(() => getStorageConfig({ SPOTIFY_MCP_DATA_DIR: " " })).toThrow(
      "must not be empty"
    );
    expect(() =>
      getStorageConfig({ SPOTIFY_MCP_SHARED_DATA_DIR: "/tmp/shared" })
    ).toThrow("SPOTIFY_MCP_MACHINE_ID");
    expect(() =>
      getStorageConfig({
        SPOTIFY_MCP_SHARED_DATA_DIR: "/tmp/shared",
        SPOTIFY_MCP_MACHINE_ID: "Neo Mac"
      })
    ).toThrow("lowercase slug");
    expect(() =>
      getStorageConfig({
        SPOTIFY_MCP_DATA_DIR: "/tmp/same",
        SPOTIFY_MCP_SHARED_DATA_DIR: "/tmp/same",
        SPOTIFY_MCP_MACHINE_ID: "neo"
      })
    ).toThrow("must differ");
  });
});
