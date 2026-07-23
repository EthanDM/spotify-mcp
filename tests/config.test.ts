import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertSharedStorageAvailable,
  getStorageConfig,
  getTokenFilePath,
  toPortableArtifactPath
} from "../src/config.js";

describe("storage configuration", () => {
  afterEach(() => vi.unstubAllEnvs());
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
    ).toThrow("non-nested");
    expect(() =>
      getStorageConfig({
        SPOTIFY_MCP_DATA_DIR: "/tmp/local",
        SPOTIFY_MCP_SHARED_DATA_DIR: "/tmp/local/shared",
        SPOTIFY_MCP_MACHINE_ID: "neo"
      })
    ).toThrow("non-nested");
    expect(() =>
      getStorageConfig({
        SPOTIFY_MCP_DATA_DIR: "/tmp/shared/local",
        SPOTIFY_MCP_SHARED_DATA_DIR: "/tmp/shared",
        SPOTIFY_MCP_MACHINE_ID: "neo"
      })
    ).toThrow("non-nested");
  });

  it("requires the configured shared root to be available", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-config-"));
    const shared = path.join(root, "shared");
    const config = getStorageConfig({
      SPOTIFY_MCP_DATA_DIR: path.join(root, "local"),
      SPOTIFY_MCP_SHARED_DATA_DIR: shared,
      SPOTIFY_MCP_MACHINE_ID: "neo"
    });
    await expect(assertSharedStorageAvailable(config)).rejects.toThrow(
      "shared storage is unavailable"
    );
    await mkdir(shared);
    await expect(assertSharedStorageAvailable(config)).resolves.toBeUndefined();
  });

  it("rejects roots that become nested after resolving symlinks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-config-link-"));
    const local = path.join(root, "local");
    const sharedLink = path.join(root, "shared-link");
    await mkdir(local);
    await symlink(local, sharedLink);
    const config = getStorageConfig({
      SPOTIFY_MCP_DATA_DIR: local,
      SPOTIFY_MCP_SHARED_DATA_DIR: sharedLink,
      SPOTIFY_MCP_MACHINE_ID: "neo"
    });
    await expect(assertSharedStorageAvailable(config)).rejects.toThrow(
      "resolve to nested directories"
    );
  });

  it("refuses token paths when local storage resolves into shared storage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-token-link-"));
    const shared = path.join(root, "shared");
    const localLink = path.join(root, "local-link");
    await mkdir(shared);
    await symlink(shared, localLink);
    vi.stubEnv("SPOTIFY_MCP_DATA_DIR", localLink);
    vi.stubEnv("SPOTIFY_MCP_SHARED_DATA_DIR", shared);
    vi.stubEnv("SPOTIFY_MCP_MACHINE_ID", "desktop");

    expect(() => getTokenFilePath()).toThrow(
      "refusing to expose the token path"
    );
    vi.stubEnv("SPOTIFY_MCP_DATA_DIR", path.join(localLink, "missing"));
    expect(() => getTokenFilePath()).toThrow(
      "refusing to expose the token path"
    );
  });

  it("stores shared artifact paths relative to the shared root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-portable-"));
    const sharedRoot = path.join(root, "shared");
    const artifactPath = path.join(
      sharedRoot,
      "artifacts",
      "people",
      "friend",
      "review.md"
    );
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, "review");
    const config = getStorageConfig({
      SPOTIFY_MCP_DATA_DIR: "/tmp/local",
      SPOTIFY_MCP_SHARED_DATA_DIR: sharedRoot,
      SPOTIFY_MCP_MACHINE_ID: "neo"
    });
    expect(toPortableArtifactPath(artifactPath, config)).toBe(
      path.join("artifacts", "people", "friend", "review.md")
    );
    expect(() => toPortableArtifactPath("/tmp/unrelated.md", config)).toThrow(
      "Shared artifact paths must be inside"
    );

    const outside = path.join(root, "outside.md");
    await writeFile(outside, "outside");
    await symlink(outside, path.join(sharedRoot, "artifacts", "linked.md"));
    expect(() =>
      toPortableArtifactPath(
        path.join(sharedRoot, "artifacts", "linked.md"),
        config
      )
    ).toThrow("must not contain symlinks");

    const inside = path.join(sharedRoot, "artifacts", "inside.md");
    await writeFile(inside, "inside");
    await symlink(inside, path.join(sharedRoot, "artifacts", "inside-link.md"));
    expect(() =>
      toPortableArtifactPath(
        path.join(sharedRoot, "artifacts", "inside-link.md"),
        config
      )
    ).toThrow("must not contain symlinks");
  });

  it("rejects an artifacts directory linked outside the shared root", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-artifacts-link-")
    );
    const sharedRoot = path.join(root, "shared");
    const outsideArtifacts = path.join(root, "outside-artifacts");
    await mkdir(sharedRoot);
    await mkdir(outsideArtifacts);
    await writeFile(path.join(outsideArtifacts, "review.md"), "review");
    await symlink(outsideArtifacts, path.join(sharedRoot, "artifacts"));
    const config = getStorageConfig({
      SPOTIFY_MCP_DATA_DIR: "/tmp/local",
      SPOTIFY_MCP_SHARED_DATA_DIR: sharedRoot,
      SPOTIFY_MCP_MACHINE_ID: "neo"
    });

    expect(() =>
      toPortableArtifactPath(
        path.join(sharedRoot, "artifacts", "review.md"),
        config
      )
    ).toThrow("artifacts directory must not traverse outside");
  });
});
