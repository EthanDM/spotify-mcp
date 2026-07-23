import {
  access,
  chmod,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { StorageConfig } from "../../src/config.js";
import { PersonalizationStore } from "../../src/personalization/store.js";
import {
  appendPrivateFile,
  assertNoSymlinksWithinRoot,
  ensureDirectoryWithinRoot,
  SharedStorageGuard
} from "../../src/storage/shared.js";

describe("shared storage guard", () => {
  it("prevents two installations from claiming the same machine ID", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-claims-"));
    const sharedRoot = path.join(root, "shared");
    await mkdir(sharedRoot);
    const desktop = new SharedStorageGuard(
      config(path.join(root, "desktop"), sharedRoot, "desktop")
    );
    const duplicate = new SharedStorageGuard(
      config(path.join(root, "other"), sharedRoot, "desktop")
    );
    const neo = new SharedStorageGuard(
      config(path.join(root, "neo"), sharedRoot, "neo")
    );

    await desktop.claimMachineId();
    await expect(duplicate.claimMachineId()).rejects.toThrow(
      "already claimed by another installation"
    );
    await expect(neo.claimMachineId()).resolves.toBeUndefined();

    const installationId = (
      await readFile(path.join(root, "desktop", "installation-id"), "utf8")
    ).trim();
    const claim = JSON.parse(
      await readFile(path.join(sharedRoot, "machines", "desktop.json"), "utf8")
    ) as { installation_id: string };
    expect(claim.installation_id).toBe(installationId);
  });

  it("rejects reads and writes when the shared root disappears", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-unmounted-"));
    const sharedRoot = path.join(root, "shared");
    const localRoot = path.join(root, "local");
    await mkdir(sharedRoot);
    const guard = new SharedStorageGuard(
      config(localRoot, sharedRoot, "desktop")
    );
    await guard.claimMachineId();
    const store = new PersonalizationStore({
      localDirectory: path.join(localRoot, "personalization"),
      sharedDirectory: path.join(sharedRoot, "personalization"),
      machineId: "desktop",
      sharedMode: true,
      sharedRoot,
      assertSharedStorageAvailable: () => guard.assertWritable()
    });

    await rm(sharedRoot, { recursive: true });
    await expect(store.readPreferences()).rejects.toThrow(
      "Configured shared storage is unavailable"
    );
    await expect(store.readRecentEvents(10)).rejects.toThrow(
      "Configured shared storage is unavailable"
    );
    await expect(
      store.appendEvent({
        ts: "2026-01-01T00:00:00.000Z",
        type: "feedback",
        details: {}
      })
    ).rejects.toThrow("Configured shared storage is unavailable");
    await expect(access(sharedRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects symlinked directories beneath the shared root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-shared-link-"));
    const sharedRoot = path.join(root, "shared");
    const outside = path.join(root, "outside");
    await mkdir(sharedRoot);
    await mkdir(outside);
    await symlink(outside, path.join(sharedRoot, "people"));

    await expect(
      ensureDirectoryWithinRoot(
        sharedRoot,
        path.join(sharedRoot, "people", "friend")
      )
    ).rejects.toThrow("must not contain symlinks");
  });

  it("rejects a symlinked root itself", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-root-link-"));
    const outside = path.join(root, "outside");
    const linkedRoot = path.join(root, "linked");
    await mkdir(outside);
    await symlink(outside, linkedRoot);

    await expect(
      assertNoSymlinksWithinRoot(linkedRoot, path.join(linkedRoot, "file"))
    ).rejects.toThrow("must not contain symlinks");
  });

  it("rejects a symlinked machine-claim directory after startup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-claim-link-"));
    const sharedRoot = path.join(root, "shared");
    const localRoot = path.join(root, "local");
    const outside = path.join(root, "outside");
    await mkdir(sharedRoot);
    const guard = new SharedStorageGuard(
      config(localRoot, sharedRoot, "desktop")
    );
    await guard.claimMachineId();
    await mkdir(outside);
    await rm(path.join(sharedRoot, "machines"), { recursive: true });
    await symlink(outside, path.join(sharedRoot, "machines"));

    await expect(guard.assertWritable()).rejects.toThrow(
      "must not contain symlinks"
    );
  });

  it("appends without following symlinks and restores private permissions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-append-"));
    const file = path.join(root, "history.ndjson");
    await writeFile(file, "first\n");
    await chmod(file, 0o644);
    await appendPrivateFile(file, "second\n");
    expect(await readFile(file, "utf8")).toBe("first\nsecond\n");
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    const outside = path.join(root, "outside.ndjson");
    const linked = path.join(root, "linked.ndjson");
    await writeFile(outside, "outside\n");
    await symlink(outside, linked);
    await expect(appendPrivateFile(linked, "escaped\n")).rejects.toBeTruthy();
    expect(await readFile(outside, "utf8")).toBe("outside\n");
  });
});

function config(
  localRoot: string,
  sharedRoot: string,
  machineId: string
): StorageConfig {
  return {
    localRoot,
    sharedRoot,
    machineId,
    tokenFile: path.join(localRoot, "auth.json"),
    localPersonalizationDirectory: path.join(localRoot, "personalization"),
    sharedPersonalizationDirectory: path.join(sharedRoot, "personalization"),
    localPeopleDirectory: path.join(localRoot, "people"),
    sharedPeopleDirectory: path.join(sharedRoot, "people"),
    artifactsDirectory: path.join(sharedRoot, "artifacts"),
    sharedMode: true
  };
}
