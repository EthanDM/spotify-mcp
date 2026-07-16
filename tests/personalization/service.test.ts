import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { PersonalizationService } from "../../src/personalization/service.js";
import { PersonalizationStore } from "../../src/personalization/store.js";

describe("PersonalizationService", () => {
  it("refreshes snapshot state and generates an agent-facing context file", async () => {
    const store = new PersonalizationStore(
      await mkdtemp(path.join(os.tmpdir(), "spotify-mcp-personalization-"))
    );
    const spotify = {
      getMyProfile: vi.fn(async () => ({
        id: "me",
        display_name: "Ethan",
        uri: "spotify:user:me",
        product: "premium"
      })),
      listPlaylists: vi.fn(async () => ({
        items: [
          {
            id: "playlist-1",
            uri: "spotify:playlist:playlist-1",
            name: "Focus",
            description: null,
            public: false,
            collaborative: false,
            owner: {
              id: "me",
              display_name: "Ethan"
            },
            tracks_total: 12,
            snapshot_id: "snap"
          }
        ],
        limit: 1,
        offset: 0,
        total: 1,
        next_offset: null
      })),
      getSavedTracks: vi.fn(async () => ({
        items: [
          {
            added_at: "2026-04-02T00:00:00.000Z",
            track: {
              id: "track-1",
              uri: "spotify:track:track-1",
              name: "Track 1",
              artists: ["Artist A"],
              album: "Album 1",
              duration_ms: 1000,
              explicit: false
            }
          },
          {
            added_at: "2026-04-02T00:00:01.000Z",
            track: {
              id: "track-2",
              uri: "spotify:track:track-2",
              name: "Track 2",
              artists: ["Artist A", "Artist B"],
              album: "Album 2",
              duration_ms: 1000,
              explicit: true
            }
          }
        ],
        limit: 2,
        offset: 0,
        total: 2,
        next_offset: null
      })),
      getSavedAlbums: vi.fn(async () => ({
        items: [
          {
            added_at: "2026-04-02T00:00:00.000Z",
            id: "album-1",
            uri: "spotify:album:album-1",
            name: "Album 1",
            artists: ["Artist A"],
            total_tracks: 10
          }
        ],
        limit: 1,
        offset: 0,
        total: 1,
        next_offset: null
      })),
      getFollowedArtists: vi.fn(async () => ({
        items: [
          {
            id: "artist-a",
            uri: "spotify:artist:artist-a",
            name: "Artist A",
            genres: ["electronic", "ambient"],
            popularity: 80
          }
        ],
        limit: 1,
        next_after: null
      }))
    } as never;
    const service = new PersonalizationService(spotify, store);

    const result = await service.refreshState({
      playlistLimit: 10,
      savedTracksLimit: 10,
      savedAlbumsLimit: 10,
      followedArtistsLimit: 10
    });
    const context = await readFile(store.contextPath, "utf8");

    expect(result.playlist_count).toBe(1);
    expect(result.saved_track_count).toBe(2);
    expect(result.followed_artist_count).toBe(1);
    expect(context).toContain(
      "No strong inferred artist signals yet beyond explicit preferences and recent behavior"
    );
    expect(context).toContain("Saved-track explicit ratio");
  });

  it("records explicit feedback and persists it into the generated context", async () => {
    const store = new PersonalizationStore(
      await mkdtemp(path.join(os.tmpdir(), "spotify-mcp-personalization-"))
    );
    const spotify = {
      getMyProfile: vi.fn(),
      listPlaylists: vi.fn(),
      getSavedTracks: vi.fn(),
      getSavedAlbums: vi.fn(),
      getFollowedArtists: vi.fn()
    } as never;
    const service = new PersonalizationService(spotify, store);

    await service.recordFeedback({
      kind: "artist",
      sentiment: "prefer",
      value: "Artist A"
    });
    await service.recordFeedback({
      kind: "discovery_level",
      value: "medium"
    });

    const state = await service.getState({ recentEventLimit: 10 });

    expect(state.preferences.preferred_artists).toEqual(["Artist A"]);
    expect(state.preferences.discovery_level).toBe("medium");
    expect(state.context).toContain("Preferred artists: Artist A.");
    expect(state.interaction_event_count).toBe(2);
  });

  it("persists scoped use-case learnings into preferences and context", async () => {
    const store = new PersonalizationStore(
      await mkdtemp(path.join(os.tmpdir(), "spotify-mcp-personalization-"))
    );
    const spotify = {
      getMyProfile: vi.fn(),
      listPlaylists: vi.fn(),
      getSavedTracks: vi.fn(),
      getSavedAlbums: vi.fn(),
      getFollowedArtists: vi.fn()
    } as never;
    const service = new PersonalizationService(spotify, store);

    await service.recordFeedback({
      kind: "trait",
      sentiment: "prefer",
      value: "steady instrumental electronic",
      use_case: "focused work"
    });
    await service.recordFeedback({
      kind: "trait",
      sentiment: "avoid",
      value: "abrupt vocals",
      use_case: "focused work"
    });
    await service.recordFeedback({
      kind: "note",
      value: "Prefer a broad draft followed by a focused trim",
      use_case: "focused work"
    });
    await service.recordFeedback({
      kind: "playback_mode",
      playback_mode: "shuffle",
      use_case: "focused work"
    });
    await service.recordFeedback({
      kind: "ideal_track_count_range",
      min_count: 55,
      max_count: 65,
      use_case: "focused work"
    });
    await service.recordPlaylistEvaluation({
      playlistId: "playlist-1",
      use_case: "focused work",
      verdict: "default",
      score: 9.2,
      winning_traits: ["steady instrumental electronic", "consistent tempo"],
      losing_traits: ["abrupt vocals"],
      workflow_learning:
        "A broad draft followed by a focused trim improves consistency"
    });

    const state = await service.getState({ recentEventLimit: 10 });
    const useCase = state.preferences.use_cases["focused work"];

    expect(useCase?.preferred_traits).toEqual([
      "steady instrumental electronic"
    ]);
    expect(useCase?.avoided_traits).toEqual(["abrupt vocals"]);
    expect(useCase?.notes).toEqual([
      "Prefer a broad draft followed by a focused trim"
    ]);
    expect(useCase?.playback_mode).toBe("shuffle");
    expect(useCase?.ideal_track_count_range).toEqual({
      min: 55,
      max: 65
    });
    expect(state.context).toContain("## Use-Case Preferences");
    expect(state.context).toContain("focused work");
    expect(state.context).toContain("steady instrumental electronic");
    expect(state.context).toContain("abrupt vocals");
    expect(state.context).toContain("playback=shuffle");
    expect(state.context).toContain("track_count=55-65");
    expect(state.context).toContain("Playlist evaluations recorded: 1.");
  });

  it("downweights partial library snapshots and prefers repeated behavior signals", async () => {
    const store = new PersonalizationStore(
      await mkdtemp(path.join(os.tmpdir(), "spotify-mcp-personalization-"))
    );
    const spotify = {
      getMyProfile: vi.fn(async () => ({
        id: "me",
        display_name: "Ethan",
        uri: "spotify:user:me",
        product: "premium"
      })),
      listPlaylists: vi.fn(async () => ({
        items: [],
        limit: 1,
        offset: 0,
        total: 0,
        next_offset: null
      })),
      getSavedTracks: vi.fn(async () => ({
        items: Array.from({ length: 2 }, (_, index) => ({
          added_at: `2026-04-02T00:00:0${index}.000Z`,
          track: {
            id: `track-${index}`,
            uri: `spotify:track:${index}`,
            name: `Track ${index}`,
            artists: ["Artist A"],
            album: "Album",
            duration_ms: 1000,
            explicit: false
          }
        })),
        limit: 2,
        offset: 0,
        total: 100,
        next_offset: null
      })),
      getSavedAlbums: vi.fn(async () => ({
        items: [],
        limit: 0,
        offset: 0,
        total: 0,
        next_offset: null
      })),
      getFollowedArtists: vi.fn(async () => ({
        items: [],
        limit: 0,
        next_after: null
      }))
    } as never;
    const service = new PersonalizationService(spotify, store);

    await service.refreshState({
      playlistLimit: 10,
      savedTracksLimit: 10,
      savedAlbumsLimit: 10,
      followedArtistsLimit: 10
    });
    await service.recordEvent("playlist_deduped", { playlistId: "a" });
    await service.recordEvent("playlist_deduped", { playlistId: "b" });
    await service.recordEvent("playlist_items_removed", {
      playlistId: "a",
      removedCount: 3
    });
    await service.recordEvent("playlist_items_removed", {
      playlistId: "b",
      removedCount: 2
    });

    const state = await service.getState({ recentEventLimit: 10 });

    expect(state.context).toContain("weak evidence");
    expect(state.context).toContain("Repeated dedupe behavior");
    expect(state.context).toContain("iterative pruning");
  });
});
