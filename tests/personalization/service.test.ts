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
    expect(context).toContain("Artist A");
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
});
