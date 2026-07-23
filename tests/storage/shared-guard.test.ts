import { access, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { StorageConfig } from "../../src/config.js";
import { PersonalizationStore } from "../../src/personalization/store.js";
import {
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
