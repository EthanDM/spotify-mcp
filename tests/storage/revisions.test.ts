import fs from "node:fs/promises";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  RevisionConflictError,
  RevisionStore
} from "../../src/storage/revisions.js";

describe("RevisionStore", () => {
  it("rejects stale writes and resolves explicit forks", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "spotify-revisions-")
    );
    const first = new RevisionStore<{ value: string }>(
      directory,
      "test document",
      "desktop",
      normalize
    );
    const second = new RevisionStore<{ value: string }>(
      directory,
      "test document",
      "neo",
      normalize
    );
    const root = await first.write({ value: "root" }, null);
    await first.read();
    await second.read();
    const child = await first.write({ value: "desktop" }, root.revision_id);
    await expect(
      second.write({ value: "neo" }, root.revision_id)
    ).rejects.toThrow("changed after it was read");

    const fork = {
      schema_version: 1,
      revision_id: "fork",
      parent_revision_ids: [root.revision_id],
      written_at: new Date().toISOString(),
      written_by: "neo",
      value: { value: "neo" }
    };
    await writeFile(path.join(directory, "fork.json"), JSON.stringify(fork));
    await expect(first.read()).rejects.toBeInstanceOf(RevisionConflictError);
    const resolved = await first.resolve({ value: "merged" }, [
      child.revision_id,
      "fork"
    ]);
    expect((await first.read())?.revisionId).toBe(resolved.revision_id);
  });

  it("refuses symlinked revision files", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "spotify-revision-link-")
    );
    const outside = path.join(directory, "outside-revision.data");
    await writeFile(
      outside,
      JSON.stringify({
        schema_version: 1,
        revision_id: "outside",
        parent_revision_ids: [],
        written_at: new Date().toISOString(),
        written_by: "desktop",
        value: { value: "outside" }
      })
    );
    await symlink(outside, path.join(directory, "outside.json"));
    const store = new RevisionStore<{ value: string }>(
      directory,
      "test document",
      "desktop",
      normalize
    );

    await expect(store.read()).rejects.toBeTruthy();
  });

  it("refuses symlinked revision directory ancestors in shared storage", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-revision-directory-link-")
    );
    const outside = path.join(root, "outside");
    const sharedRoot = path.join(root, "shared");
    await mkdir(outside);
    await mkdir(sharedRoot);
    await symlink(outside, path.join(sharedRoot, "preferences"));
    const store = new RevisionStore<{ value: string }>(
      path.join(sharedRoot, "preferences", "revisions"),
      "test document",
      "desktop",
      normalize,
      { root: sharedRoot, assertAvailable: async () => undefined }
    );

    await expect(store.read()).rejects.toThrow("must not contain symlinks");
  });

  it("rejects an existing empty shared revision directory", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-revision-empty-directory-")
    );
    const sharedRoot = path.join(root, "shared");
    const revisions = path.join(sharedRoot, "preferences", "revisions");
    await mkdir(revisions, { recursive: true });
    const store = new RevisionStore<{ value: string }>(
      revisions,
      "test document",
      "desktop",
      normalize,
      { root: sharedRoot, assertAvailable: async () => undefined }
    );

    await expect(store.read()).rejects.toThrow(
      "empty shared revision directory"
    );
  });

  it("fails when shared revisions disappear after validation", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-revision-directory-gone-")
    );
    const sharedRoot = path.join(root, "shared");
    const revisions = path.join(sharedRoot, "preferences", "revisions");
    await mkdir(revisions, { recursive: true });
    await writeFile(
      path.join(revisions, "root.json"),
      JSON.stringify({
        schema_version: 1,
        revision_id: "root",
        parent_revision_ids: [],
        written_at: new Date().toISOString(),
        written_by: "desktop",
        value: { value: "root" }
      })
    );
    const store = new RevisionStore<{ value: string }>(
      revisions,
      "test document",
      "desktop",
      normalize,
      { root: sharedRoot, assertAvailable: async () => undefined }
    );
    const readDirectory = fs.readdir.bind(fs);
    const readdir = vi
      .spyOn(fs, "readdir")
      .mockImplementationOnce(async (...args) => {
        await fs.rm(revisions, { recursive: true });
        return readDirectory(...args);
      });

    await expect(store.read()).rejects.toThrow(
      "shared revisions disappeared after validation"
    );
    readdir.mockRestore();
  });

  it("rejects a revision directory replaced during enumeration", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-revision-directory-swap-")
    );
    const sharedRoot = path.join(root, "shared");
    const revisions = path.join(sharedRoot, "preferences", "revisions");
    const original = path.join(root, "original-revisions");
    const replacement = path.join(root, "replacement-revisions");
    await mkdir(revisions, { recursive: true });
    await mkdir(replacement);
    await writeFile(
      path.join(revisions, "root.json"),
      JSON.stringify({
        schema_version: 1,
        revision_id: "root",
        parent_revision_ids: [],
        written_at: new Date().toISOString(),
        written_by: "desktop",
        value: { value: "root" }
      })
    );
    const store = new RevisionStore<{ value: string }>(
      revisions,
      "test document",
      "desktop",
      normalize,
      { root: sharedRoot, assertAvailable: async () => undefined }
    );
    const readDirectory = fs.readdir.bind(fs);
    const readdir = vi
      .spyOn(fs, "readdir")
      .mockImplementationOnce(async (...args) => {
        const entries = await readDirectory(...args);
        await fs.rename(revisions, original);
        await fs.symlink(replacement, revisions);
        return entries;
      });

    await expect(store.read()).rejects.toThrow(
      "shared revisions path is not a directory"
    );
    readdir.mockRestore();
  });

  it("rejects revision graphs with no tips", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "spotify-revision-cycle-")
    );
    await writeFile(
      path.join(directory, "cycle.json"),
      JSON.stringify({
        schema_version: 1,
        revision_id: "cycle",
        parent_revision_ids: ["cycle"],
        written_at: new Date().toISOString(),
        written_by: "desktop",
        value: { value: "cycle" }
      })
    );
    const store = new RevisionStore<{ value: string }>(
      directory,
      "test document",
      "desktop",
      normalize
    );

    await expect(store.read()).rejects.toThrow("cyclic revision graph");
  });

  it("rejects empty revision identifiers", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "spotify-revision-empty-id-")
    );
    await writeFile(
      path.join(directory, "empty.json"),
      JSON.stringify({
        schema_version: 1,
        revision_id: "",
        parent_revision_ids: [],
        written_at: new Date().toISOString(),
        written_by: "desktop",
        value: { value: "invalid" }
      })
    );
    const store = new RevisionStore<{ value: string }>(
      directory,
      "test document",
      "desktop",
      normalize
    );

    await expect(store.read()).rejects.toThrow("Invalid revision envelope");
  });

  it("rejects revision identifiers that do not match their filenames", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "spotify-revision-mismatched-id-")
    );
    await writeFile(
      path.join(directory, "safe.json"),
      JSON.stringify({
        schema_version: 1,
        revision_id: "../auth",
        parent_revision_ids: [],
        written_at: new Date().toISOString(),
        written_by: "desktop",
        value: { value: "invalid" }
      })
    );
    const store = new RevisionStore<{ value: string }>(
      directory,
      "test document",
      "desktop",
      normalize
    );

    await expect(store.read()).rejects.toThrow("Invalid revision envelope");
  });
});

function normalize(value: unknown): { value: string } {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as { value?: unknown }).value !== "string"
  )
    throw new Error("invalid");
  return value as { value: string };
}
