import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore, checkPlaylistConstraints } from "../src/artifacts.js";
import { getStorageConfig } from "../src/config.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "spotify-artifacts-test-"));
  const storage = getStorageConfig({ SPOTIFY_MCP_DATA_DIR: root });
  return { root, storage, store: new ArtifactStore(storage) };
}

describe("artifact tools", () => {
  it("writes and reads sidecars with portable references and refuses collisions", async () => {
    const { store } = await fixture();
    expect(await store.write("reviews/example.md", "hello")).toEqual({
      artifact_path: "artifacts/reviews/example.md",
      bytes: 5
    });
    expect((await store.read("reviews/example.md")).content).toBe("hello");
    await expect(
      store.write("reviews/example.md", "replacement")
    ).rejects.toThrow("already exists");
    expect((await store.read("reviews/example.md")).content).toBe("hello");
    expect((await store.list("reviews", 0, 1)).entries).toEqual([
      { path: "reviews/example.md", type: "file" }
    ]);
  });
  it("rejects traversal and symlink reads or writes", async () => {
    const { root, storage, store } = await fixture();
    await store.prepare();
    await writeFile(path.join(root, "secret.txt"), "private");
    await symlink(
      path.join(root, "secret.txt"),
      path.join(storage.artifactsDirectory, "link.txt")
    );
    await symlink(root, path.join(storage.artifactsDirectory, "outside"));
    for (const target of [
      "../secret.txt",
      "/tmp/secret.txt",
      "a/../../secret.txt"
    ]) {
      await expect(store.read(target)).rejects.toThrow();
      await expect(store.write(target, "bad")).rejects.toThrow();
    }
    await expect(store.read("link.txt")).rejects.toThrow();
    await expect(store.write("outside/secret.txt", "bad")).rejects.toThrow();
    expect(await readFile(path.join(root, "secret.txt"), "utf8")).toBe(
      "private"
    );
  });
  it("fails closed when shared storage becomes unavailable", async () => {
    const { storage } = await fixture();
    const shared = await mkdtemp(
      path.join(os.tmpdir(), "spotify-shared-test-")
    );
    await mkdir(path.join(shared, "artifacts"));
    let available = true;
    const store = new ArtifactStore(
      {
        ...storage,
        sharedRoot: shared,
        sharedMode: true,
        artifactsDirectory: path.join(shared, "artifacts")
      },
      async () => {
        if (!available) throw new Error("shared unavailable");
      }
    );
    await store.write("shared.md", "sync");
    available = false;
    await expect(store.read("shared.md")).rejects.toThrow("shared unavailable");
    await expect(store.write("new.md", "bad")).rejects.toThrow(
      "shared unavailable"
    );
  });
  it("runs the actual bundled constraint checker without durable writes", async () => {
    const report = await checkPlaylistConstraints({
      target_track_count: 1,
      curation_mode: "recovered",
      audience_mode: "self_personalized",
      playback_mode: "shuffle",
      tracks: []
    });
    expect(report.passes_applicable_hard_checks).toBe(false);
    expect(report.violations).toContain("target_track_count");
  });
});
