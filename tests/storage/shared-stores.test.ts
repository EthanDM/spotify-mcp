import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { PeopleStore } from "../../src/people/store.js";
import type { PersonPlaylistRecord } from "../../src/people/types.js";
import { PeopleProfileService } from "../../src/people/service.js";
import { PersonalizationStore } from "../../src/personalization/store.js";
import { PersonalizationService } from "../../src/personalization/service.js";

describe("shared stores", () => {
  it("merges deterministic per-machine personalization streams", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-shared-"));
    const desktop = personalization(root, "desktop");
    const neo = personalization(root, "neo");
    await neo.appendEvent({
      ts: "2026-01-02T00:00:00.000Z",
      type: "neo",
      details: {}
    });
    await desktop.appendEvent({
      ts: "2026-01-01T00:00:00.000Z",
      type: "desktop",
      details: {}
    });
    expect(
      (await desktop.readRecentEvents(10)).map((event) => event.type)
    ).toEqual(["desktop", "neo"]);
    expect(await neo.countEvents()).toBe(2);
    expect(await desktop.getInteractionLogPaths()).toHaveLength(2);
  });

  it("rejects a personalization directory replaced before append", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-event-append-"));
    const store = personalization(root, "desktop");
    const directory = path.dirname(store.interactionLogPath);
    const original = path.join(root, "original-events");
    const replacement = path.join(root, "replacement-events");
    await mkdir(directory, { recursive: true });
    await mkdir(replacement);
    const openFile = fs.open.bind(fs);
    const open = vi
      .spyOn(fs, "open")
      .mockImplementationOnce(async (...args) => {
        await rename(directory, original);
        await rename(replacement, directory);
        return openFile(...args);
      });

    await expect(
      store.appendEvent({
        ts: "2026-01-01T00:00:00.000Z",
        type: "desktop",
        details: {}
      })
    ).rejects.toThrow("Shared storage directory changed");
    expect(await readFile(store.interactionLogPath, "utf8")).toBe("");
    open.mockRestore();
  });

  it("fails when an enumerated personalization stream disappears", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-event-gone-"));
    const store = personalization(root, "desktop");
    await store.appendEvent({
      ts: "2026-01-01T00:00:00.000Z",
      type: "desktop",
      details: {}
    });
    const files = await store.getInteractionLogPaths();
    vi.spyOn(store, "getInteractionLogPaths").mockImplementation(async () => {
      await rm(files[0]);
      return files;
    });

    await expect(store.readAllEvents()).rejects.toThrow(
      "Shared personalization stream disappeared after enumeration"
    );
  });

  it("fails when an observed personalization directory disappears", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-event-directory-gone-")
    );
    const store = personalization(root, "desktop");
    await store.appendEvent({
      ts: "2026-01-01T00:00:00.000Z",
      type: "desktop",
      details: {}
    });
    const directory = path.dirname(store.interactionLogPath);
    const readDirectory = fs.readdir.bind(fs);
    const readdir = vi
      .spyOn(fs, "readdir")
      .mockImplementationOnce(async (...args) => {
        await rm(directory, { recursive: true });
        return readDirectory(...args);
      });

    await expect(store.getInteractionLogPaths()).rejects.toThrow(
      "Shared stream directory disappeared after validation"
    );
    readdir.mockRestore();
  });

  it("rejects a personalization directory replaced during enumeration", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-event-directory-swap-")
    );
    const store = personalization(root, "desktop");
    await store.appendEvent({
      ts: "2026-01-01T00:00:00.000Z",
      type: "desktop",
      details: {}
    });
    const directory = path.dirname(store.interactionLogPath);
    const original = path.join(root, "original-events");
    const replacement = path.join(root, "replacement-events");
    await mkdir(replacement);
    const readDirectory = fs.readdir.bind(fs);
    const readdir = vi
      .spyOn(fs, "readdir")
      .mockImplementationOnce(async (...args) => {
        const entries = await readDirectory(...args);
        await fs.rename(directory, original);
        await fs.symlink(replacement, directory);
        return entries;
      });

    await expect(store.getInteractionLogPaths()).rejects.toThrow(
      "Shared stream path is not a directory"
    );
    readdir.mockRestore();
  });

  it("rejects symlinked personalization stream directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-event-link-"));
    const sharedRoot = path.join(root, "shared");
    const outside = path.join(root, "outside");
    await mkdir(path.join(sharedRoot, "personalization"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, path.join(sharedRoot, "personalization", "events"));

    await expect(
      personalization(root, "desktop").getInteractionLogPaths()
    ).rejects.toThrow("must not contain symlinks");
  });

  it("rejects malformed shared personalization events", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-event-invalid-")
    );
    const events = path.join(root, "shared", "personalization", "events");
    await mkdir(events, { recursive: true });
    await writeFile(
      path.join(events, "desktop.ndjson"),
      `${JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", type: "test", details: null })}\n`
    );

    await expect(
      personalization(root, "desktop").readRecentEvents(10)
    ).rejects.toThrow("Invalid personalization event");
  });

  it("requires identity metadata on shared personalization events", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-event-metadata-")
    );
    const events = path.join(root, "shared", "personalization", "events");
    await mkdir(events, { recursive: true });
    await writeFile(
      path.join(events, "desktop.ndjson"),
      `${JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", type: "test", details: {} })}\n`
    );

    await expect(
      personalization(root, "desktop").readRecentEvents(10)
    ).rejects.toThrow("Invalid shared personalization event metadata");
  });

  it("deduplicates migrated events whose only difference is machine provenance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-deduped-"));
    const desktop = personalization(root, "desktop");
    const neo = personalization(root, "neo");
    const event = {
      event_id: "legacy-event",
      schema_version: 1 as const,
      ts: "2026-01-01T00:00:00.000Z",
      type: "legacy",
      details: {}
    };
    await desktop.appendEvent(event);
    await neo.appendEvent(event);
    expect(await desktop.countEvents()).toBe(1);
  });

  it("rejects stale updates made through the same store instance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-stale-"));
    const store = personalization(root, "desktop");
    const first = await store.readPreferencesVersioned();
    const second = await store.readPreferencesVersioned();
    await store.writePreferences(
      { ...first.value, preferred_artists: ["First"] },
      first.revisionId
    );
    expect(
      JSON.parse(
        await readFile(await store.getPreferencesDocumentPath(), "utf8")
      ).value.preferred_artists
    ).toEqual(["First"]);
    await expect(
      store.writePreferences(
        { ...second.value, preferred_artists: ["Second"] },
        second.revisionId
      )
    ).rejects.toThrow("changed after it was read");
  });

  it("rebuilds a cached local context after another machine changes shared state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-context-"));
    const desktop = personalization(root, "desktop");
    const neo = personalization(root, "neo");
    const service = new PersonalizationService({} as never, neo);
    await service.getContext();

    const current = await desktop.readPreferencesVersioned();
    await desktop.writePreferences(
      { ...current.value, preferred_artists: ["Shared Artist"] },
      current.revisionId
    );

    expect((await service.getContext()).context).toContain("Shared Artist");
    const changedAgain = await desktop.readPreferencesVersioned();
    await desktop.writePreferences(
      { ...changedAgain.value, preferred_artists: ["Newer Shared Artist"] },
      changedAgain.revisionId
    );
    expect(
      (await service.getState({ recentEventLimit: 10 })).context
    ).toContain("Newer Shared Artist");
  });

  it("merges person playlist histories across machines", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-people-shared-")
    );
    const desktop = people(root, "desktop");
    const neo = people(root, "neo");
    await desktop.appendPlaylistRecord(
      "friend",
      record("one", "2026-01-01T00:00:00.000Z")
    );
    await neo.appendPlaylistRecord(
      "friend",
      record("two", "2026-01-02T00:00:00.000Z")
    );
    expect(
      (await desktop.readPlaylistHistory("friend")).map((item) => item.entry_id)
    ).toEqual(["one", "two"]);
    expect(await desktop.getPlaylistHistoryPaths("friend")).toHaveLength(2);
  });

  it("rejects a playlist-history directory replaced before append", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-history-append-")
    );
    const store = people(root, "desktop");
    const file = store.getPlaylistHistoryPath("friend");
    const directory = path.dirname(file);
    const original = path.join(root, "original-history");
    const replacement = path.join(root, "replacement-history");
    await mkdir(directory, { recursive: true });
    await mkdir(replacement);
    const openFile = fs.open.bind(fs);
    const open = vi
      .spyOn(fs, "open")
      .mockImplementationOnce(async (...args) => {
        await rename(directory, original);
        await rename(replacement, directory);
        return openFile(...args);
      });

    await expect(
      store.appendPlaylistRecord(
        "friend",
        record("one", "2026-01-01T00:00:00.000Z")
      )
    ).rejects.toThrow("Shared storage directory changed");
    expect(await readFile(file, "utf8")).toBe("");
    open.mockRestore();
  });

  it("fails when an enumerated playlist-history stream disappears", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-history-gone-"));
    const store = people(root, "desktop");
    await store.appendPlaylistRecord(
      "friend",
      record("one", "2026-01-01T00:00:00.000Z")
    );
    const files = await store.getPlaylistHistoryPaths("friend");
    vi.spyOn(store, "getPlaylistHistoryPaths").mockImplementation(async () => {
      await rm(files[0]);
      return files;
    });

    await expect(store.readPlaylistHistory("friend")).rejects.toThrow(
      "Shared playlist history disappeared after enumeration"
    );
  });

  it("fails when an observed playlist-history directory disappears", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-history-directory-gone-")
    );
    const store = people(root, "desktop");
    await store.appendPlaylistRecord(
      "friend",
      record("one", "2026-01-01T00:00:00.000Z")
    );
    const directory = path.dirname(store.getPlaylistHistoryPath("friend"));
    const readDirectory = fs.readdir.bind(fs);
    const readdir = vi
      .spyOn(fs, "readdir")
      .mockImplementationOnce(async (...args) => {
        await rm(directory, { recursive: true });
        return readDirectory(...args);
      });

    await expect(store.getPlaylistHistoryPaths("friend")).rejects.toThrow(
      "Shared stream directory disappeared after validation"
    );
    readdir.mockRestore();
  });

  it("rejects a playlist-history directory replaced during enumeration", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-history-directory-swap-")
    );
    const store = people(root, "desktop");
    await store.appendPlaylistRecord(
      "friend",
      record("one", "2026-01-01T00:00:00.000Z")
    );
    const directory = path.dirname(store.getPlaylistHistoryPath("friend"));
    const original = path.join(root, "original-history");
    const replacement = path.join(root, "replacement-history");
    await mkdir(replacement);
    const readDirectory = fs.readdir.bind(fs);
    const readdir = vi
      .spyOn(fs, "readdir")
      .mockImplementationOnce(async (...args) => {
        const entries = await readDirectory(...args);
        await fs.rename(directory, original);
        await fs.symlink(replacement, directory);
        return entries;
      });

    await expect(store.getPlaylistHistoryPaths("friend")).rejects.toThrow(
      "Shared stream path is not a directory"
    );
    readdir.mockRestore();
  });

  it("rejects incomplete shared playlist-history records", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-history-invalid-")
    );
    const history = path.join(
      root,
      "shared",
      "people",
      "friend",
      "playlist-history"
    );
    await mkdir(history, { recursive: true });
    await writeFile(
      path.join(history, "desktop.ndjson"),
      `${JSON.stringify({ entry_id: "entry", recorded_at: "2026-01-01T00:00:00.000Z" })}\n`
    );

    await expect(
      people(root, "desktop").readPlaylistHistory("friend")
    ).rejects.toThrow("Invalid playlist history");
  });

  it("rejects symlinked playlist-history directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-history-link-"));
    const sharedRoot = path.join(root, "shared");
    const outside = path.join(root, "outside");
    await mkdir(path.join(sharedRoot, "people", "friend"), { recursive: true });
    await mkdir(outside);
    await symlink(
      outside,
      path.join(sharedRoot, "people", "friend", "playlist-history")
    );

    await expect(
      people(root, "desktop").getPlaylistHistoryPaths("friend")
    ).rejects.toThrow("must not contain symlinks");
  });

  it("rejects a symlinked shared people directory before listing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-people-link-"));
    const sharedRoot = path.join(root, "shared");
    const outside = path.join(root, "outside");
    await mkdir(sharedRoot);
    await mkdir(outside);
    await symlink(outside, path.join(sharedRoot, "people"));

    await expect(people(root, "desktop").listProfileIds()).rejects.toThrow(
      "must not contain symlinks"
    );
  });

  it("fails when the observed shared people directory disappears", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-people-directory-gone-")
    );
    const store = people(root, "desktop");
    await new PeopleProfileService(store).createProfile({ name: "Friend" });
    const directory = store.basePath;
    const readDirectory = fs.readdir.bind(fs);
    const readdir = vi
      .spyOn(fs, "readdir")
      .mockImplementationOnce(async (...args) => {
        await rm(directory, { recursive: true });
        return readDirectory(...args);
      });

    await expect(store.listProfileIds()).rejects.toThrow(
      "Shared people directory disappeared after validation"
    );
    readdir.mockRestore();
  });

  it("rejects a shared people directory replaced during enumeration", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-people-directory-swap-")
    );
    const store = people(root, "desktop");
    await new PeopleProfileService(store).createProfile({ name: "Friend" });
    const directory = store.basePath;
    const original = path.join(root, "original-people");
    const replacement = path.join(root, "replacement-people");
    await mkdir(replacement);
    const readDirectory = fs.readdir.bind(fs);
    const readdir = vi
      .spyOn(fs, "readdir")
      .mockImplementationOnce(async (...args) => {
        const entries = await readDirectory(...args);
        await rename(directory, original);
        await rename(replacement, directory);
        return entries;
      });

    await expect(store.listProfileIds()).rejects.toThrow(
      "Shared stream directory changed during read"
    );
    readdir.mockRestore();
  });

  it("rejects a shared people directory replaced after a profile read", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-people-read-swap-")
    );
    const store = people(root, "desktop");
    await new PeopleProfileService(store).createProfile({ name: "Friend" });
    const directory = store.basePath;
    const original = path.join(root, "original-people");
    const replacement = path.join(root, "replacement-people");
    await mkdir(replacement);
    const readProfile = store.readProfile.bind(store);
    vi.spyOn(store, "readProfile").mockImplementationOnce(async (profileId) => {
      const profile = await readProfile(profileId);
      await rename(directory, original);
      await rename(replacement, directory);
      return profile;
    });

    await expect(store.readAllProfiles()).rejects.toThrow(
      "Shared stream directory changed during read"
    );
  });

  it("rejects symlinked profile entries while listing people", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-profile-link-"));
    const sharedPeople = path.join(root, "shared", "people");
    const outside = path.join(root, "outside");
    await mkdir(sharedPeople, { recursive: true });
    await mkdir(outside);
    await symlink(outside, path.join(sharedPeople, "friend"));

    await expect(people(root, "desktop").listProfileIds()).rejects.toThrow(
      "must not contain symlinks"
    );
  });

  it("reserves profile IDs used only by playlist history", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-profile-id-"));
    const store = people(root, "desktop");
    await mkdir(
      path.join(root, "shared", "people", "friend", "playlist-history"),
      { recursive: true }
    );

    const created = await new PeopleProfileService(store).createProfile({
      name: "Friend"
    });

    expect(created.profile.id).toBe("friend-2");
  });

  it("rejects stale person-profile updates through the same store", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-profile-stale-")
    );
    const store = people(root, "desktop");
    await new PeopleProfileService(store).createProfile({ name: "Friend" });
    const first = await store.readProfileVersioned("friend");
    const second = await store.readProfileVersioned("friend");
    await store.writeProfile(
      { ...first.value!, name: "First" },
      first.revisionId
    );
    expect(
      JSON.parse(
        await readFile(await store.getProfileDocumentPath("friend"), "utf8")
      ).value.name
    ).toBe("First");
    await expect(
      store.writeProfile(
        { ...second.value!, name: "Second" },
        second.revisionId
      )
    ).rejects.toThrow("changed after it was read");
  });

  it("rejects a shared profile whose id differs from its directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-profile-id-"));
    const store = people(root, "desktop");
    await new PeopleProfileService(store).createProfile({ name: "Alice" });
    await rename(
      path.join(root, "shared", "people", "alice"),
      path.join(root, "shared", "people", "bob")
    );

    await expect(store.readProfile("bob")).rejects.toThrow(
      "Person profile id must be bob"
    );
  });

  it("fails when an enumerated shared profile disappears", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-profile-gone-"));
    const store = people(root, "desktop");
    await new PeopleProfileService(store).createProfile({ name: "Friend" });
    const readProfile = store.readProfile.bind(store);
    vi.spyOn(store, "readProfile").mockImplementation(async (profileId) => {
      await rm(store.getProfileDirectoryPath(profileId), {
        recursive: true
      });
      return readProfile(profileId);
    });

    await expect(store.readAllProfiles()).rejects.toThrow(
      "Shared profile disappeared after enumeration: friend"
    );
  });

  it("fails when an enumerated profile's revisions disappear", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-profile-revisions-gone-")
    );
    const store = people(root, "desktop");
    await new PeopleProfileService(store).createProfile({ name: "Friend" });
    const readProfile = store.readProfile.bind(store);
    vi.spyOn(store, "readProfile").mockImplementation(async (profileId) => {
      await rm(store.getProfilePath(profileId), { recursive: true });
      return readProfile(profileId);
    });

    await expect(store.readAllProfiles()).rejects.toThrow(
      "Shared profile revisions disappeared after enumeration: friend"
    );
  });
});

function personalization(
  root: string,
  machineId: string
): PersonalizationStore {
  mkdirSync(path.join(root, "shared"), { recursive: true });
  return new PersonalizationStore({
    localDirectory: path.join(root, machineId, "local"),
    sharedDirectory: path.join(root, "shared", "personalization"),
    machineId,
    sharedMode: true,
    sharedRoot: path.join(root, "shared"),
    assertSharedStorageAvailable: async () => {}
  });
}
function people(root: string, machineId: string): PeopleStore {
  mkdirSync(path.join(root, "shared"), { recursive: true });
  return new PeopleStore({
    localDirectory: path.join(root, machineId, "local-people"),
    sharedDirectory: path.join(root, "shared", "people"),
    machineId,
    sharedMode: true,
    sharedRoot: path.join(root, "shared"),
    assertSharedStorageAvailable: async () => {}
  });
}
function record(entry_id: string, recorded_at: string): PersonPlaylistRecord {
  return {
    entry_id,
    recorded_at,
    playlist_id: null,
    playlist_name: entry_id,
    playlist_url: null,
    brief: null,
    use_case: null,
    track_count: null,
    runtime_minutes: null,
    score: null,
    verdict: null,
    winning_traits: [],
    losing_traits: [],
    workflow_learning: null,
    artifact_paths: [],
    notes: []
  };
}
