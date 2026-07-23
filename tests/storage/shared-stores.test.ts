import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
});

function personalization(
  root: string,
  machineId: string
): PersonalizationStore {
  return new PersonalizationStore({
    localDirectory: path.join(root, machineId, "local"),
    sharedDirectory: path.join(root, "shared", "personalization"),
    machineId,
    sharedMode: true
  });
}
function people(root: string, machineId: string): PeopleStore {
  return new PeopleStore({
    localDirectory: path.join(root, machineId, "local-people"),
    sharedDirectory: path.join(root, "shared", "people"),
    machineId,
    sharedMode: true
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
