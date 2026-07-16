import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PeopleProfileService } from "../../src/people/service.js";
import { PeopleStore } from "../../src/people/store.js";

describe("PeopleProfileService", () => {
  it("creates stable slug ids and disambiguates duplicate names", async () => {
    const service = new PeopleProfileService(
      new PeopleStore(
        await mkdtemp(path.join(os.tmpdir(), "spotify-mcp-people-"))
      )
    );

    const first = await service.createProfile({
      name: "Taylor Q. Example"
    });
    const second = await service.createProfile({
      name: "Taylor Q. Example"
    });

    expect(first.profile.id).toBe("taylor-q-example");
    expect(second.profile.id).toBe("taylor-q-example-2");
  });

  it("updates one field without dropping existing structured preferences", async () => {
    const service = new PeopleProfileService(
      new PeopleStore(
        await mkdtemp(path.join(os.tmpdir(), "spotify-mcp-people-"))
      )
    );
    const created = await service.createProfile({
      name: "Sample Listener",
      relationship: "friend",
      preferred_traits: ["bright", "warm"],
      life_context: ["prefers morning listening"],
      playlist_goals: ["upbeat background music"]
    });

    const updated = await service.updateProfile(created.profile.id, {
      age: 30
    });

    expect(updated.profile.relationship).toBe("friend");
    expect(updated.profile.age).toBe(30);
    expect(updated.profile.preferred_traits).toEqual(["bright", "warm"]);
    expect(updated.profile.life_context).toEqual(["prefers morning listening"]);
    expect(updated.profile.playlist_goals).toEqual(["upbeat background music"]);
  });

  it("records playlist history, retains artifact paths, and rebuilds context", async () => {
    const service = new PeopleProfileService(
      new PeopleStore(
        await mkdtemp(path.join(os.tmpdir(), "spotify-mcp-people-"))
      )
    );
    const created = await service.createProfile({
      name: "Sample Listener",
      life_context: [
        "prefers morning listening",
        "often listens while cooking"
      ],
      preferred_traits: ["bright", "warm"],
      avoided_traits: ["harsh drops"],
      playlist_goals: ["upbeat background music"]
    });
    const artifactPath = path.join(
      os.tmpdir(),
      "spotify-mcp-artifacts",
      "people",
      created.profile.id,
      "review.md"
    );

    const recorded = await service.recordPlaylist({
      profileId: created.profile.id,
      playlist_id: "playlist-1",
      playlist_name: "Sample Listener - Upbeat Background",
      playlist_url: "https://open.spotify.com/playlist/playlist-1",
      use_case: "upbeat background music",
      track_count: 22,
      runtime_minutes: 78,
      score: 9,
      verdict: "success",
      winning_traits: ["bright", "warm", "comforting"],
      losing_traits: ["glossy middle"],
      workflow_learning: "Trim to 22 tracks for better replayability",
      artifact_paths: [artifactPath]
    });
    const context = await service.getProfileContext(created.profile.id);
    const profile = await service.getProfile(created.profile.id);

    expect(recorded.playlist_history_count).toBe(1);
    expect(recorded.entry.artifact_paths).toEqual([artifactPath]);
    expect(profile.playlist_history_count).toBe(1);
    expect(profile.artifacts_directory_path).toContain("/artifacts/people/");
    expect(context.context).toContain("prefers morning listening");
    expect(context.context).toContain("harsh drops");
    expect(context.context).toContain("Recorded playlists: 1.");
    expect(context.context).toContain(
      "Trim to 22 tracks for better replayability"
    );
  });

  it("records lightweight profile feedback into the durable profile", async () => {
    const service = new PeopleProfileService(
      new PeopleStore(
        await mkdtemp(path.join(os.tmpdir(), "spotify-mcp-people-"))
      )
    );
    const created = await service.createProfile({
      name: "Sample Listener"
    });

    const updated = await service.recordFeedback({
      profileId: created.profile.id,
      kind: "trait",
      sentiment: "avoid",
      value: "festival emotional"
    });

    expect(updated.profile.avoided_traits).toEqual(["festival emotional"]);
  });
});
