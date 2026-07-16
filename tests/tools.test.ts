import { describe, expect, it, vi } from "vitest";

import { SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT } from "../src/lib/spotify-shared.js";
import { createToolHandlers } from "../src/tools.js";

describe("tool handlers", () => {
  it("maps validation errors into MCP error results", async () => {
    const handlers = createToolHandlers({
      getMyProfile: vi.fn(),
      listPlaylists: vi.fn(),
      getPlaylist: vi.fn(),
      getPlaylistItems: vi.fn(),
      searchTracks: vi.fn(),
      createPlaylist: vi.fn(),
      changePlaylistDetails: vi.fn(),
      unfollowPlaylist: vi.fn(),
      archivePlaylist: vi.fn(),
      addPlaylistItems: vi.fn(),
      mergePlaylists: vi.fn(),
      dedupePlaylist: vi.fn(),
      replacePlaylistItems: vi.fn(),
      removePlaylistItems: vi.fn(),
      reorderPlaylistItems: vi.fn(),
      clonePlaylist: vi.fn()
    } as never);

    const result = await handlers.removePlaylistItems({
      playlistId: "playlist",
      uris: ["spotify:track:1"]
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Invalid literal value");
  });

  it("returns structured content for successful calls", async () => {
    const handlers = createToolHandlers({
      getMyProfile: vi.fn(async () => ({ id: "me" }))
    } as never);

    const result = await handlers.getMyProfile();

    expect(result.structuredContent).toEqual({ id: "me" });
  });

  it("rejects incomplete artist feedback before recording personalization state", async () => {
    const handlers = createToolHandlers(
      {} as never,
      {
        recordFeedback: vi.fn()
      } as never
    );

    const result = await handlers.recordPersonalizationFeedback({
      kind: "artist",
      value: "Artist A"
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("require a sentiment");
  });

  it("rejects incomplete trait feedback before recording personalization state", async () => {
    const handlers = createToolHandlers(
      {} as never,
      {
        recordFeedback: vi.fn()
      } as never
    );

    const result = await handlers.recordPersonalizationFeedback({
      kind: "trait",
      value: "steady instrumental electronic",
      use_case: "focused work"
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("require a sentiment");
  });

  it("rejects playback mode feedback without a use case", async () => {
    const handlers = createToolHandlers(
      {} as never,
      {
        recordFeedback: vi.fn()
      } as never
    );

    const result = await handlers.recordPersonalizationFeedback({
      kind: "playback_mode",
      playback_mode: "shuffle"
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("requires a use_case");
  });

  it("rejects invalid ideal track count ranges", async () => {
    const handlers = createToolHandlers(
      {} as never,
      {
        recordFeedback: vi.fn()
      } as never
    );

    const result = await handlers.recordPersonalizationFeedback({
      kind: "ideal_track_count_range",
      use_case: "focused work",
      min_count: 70,
      max_count: 60
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "less than or equal to max_count"
    );
  });

  it("passes valid playlist evaluations through to the service", async () => {
    const recordPlaylistEvaluation = vi.fn(async () => ({
      context_path: "/tmp/context.md",
      rebuilt_at: "2026-04-02T00:00:00.000Z"
    }));
    const handlers = createToolHandlers(
      {} as never,
      {
        recordPlaylistEvaluation
      } as never
    );

    const result = await handlers.recordPlaylistEvaluation({
      playlistId: "playlist-1",
      use_case: "focused work",
      verdict: "default",
      score: 9.2,
      winning_traits: ["steady instrumental electronic"],
      workflow_learning:
        "A broad draft followed by a focused trim improves consistency"
    });

    expect(result.isError).toBeUndefined();
    expect(recordPlaylistEvaluation).toHaveBeenCalledWith({
      playlistId: "playlist-1",
      use_case: "focused work",
      verdict: "default",
      score: 9.2,
      winning_traits: ["steady instrumental electronic"],
      workflow_learning:
        "A broad draft followed by a focused trim improves consistency"
    });
  });

  it("passes valid personalization refresh input through to the service", async () => {
    const refreshState = vi.fn(async () => ({
      refreshed_at: "2026-04-02T00:00:00.000Z",
      snapshot_path: "/tmp/snapshot.json",
      context_path: "/tmp/context.md",
      playlist_count: 1,
      saved_track_count: 2,
      saved_album_count: 3,
      followed_artist_count: 4
    }));
    const handlers = createToolHandlers(
      {} as never,
      {
        refreshState
      } as never
    );

    const result = await handlers.refreshPersonalizationState({
      playlistLimit: 100
    });

    expect(result.isError).toBeUndefined();
    expect(refreshState).toHaveBeenCalledWith({
      playlistLimit: 100,
      savedTracksLimit: 200,
      savedAlbumsLimit: 100,
      followedArtistsLimit: 100
    });
  });

  it("rejects search limits above Spotify's current cap", async () => {
    const handlers = createToolHandlers({
      searchTracks: vi.fn()
    } as never);

    const result = await handlers.searchTracks({
      query: "odesza",
      limit: 11
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("less than or equal to 10");
  });

  it("rejects playlist item page sizes above Spotify's current cap", async () => {
    const handlers = createToolHandlers({
      getPlaylistItems: vi.fn()
    } as never);

    const result = await handlers.getPlaylistItems({
      playlistId: "playlist",
      limit: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT + 1
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      `less than or equal to ${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}`
    );
  });

  it("rejects public collaborative playlist creation at validation time", async () => {
    const handlers = createToolHandlers({
      createPlaylist: vi.fn()
    } as never);

    const result = await handlers.createPlaylist({
      name: "Bad Input",
      public: true,
      collaborative: true
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("must not be public");
  });

  it("requires confirm=true when replacing playlist items", async () => {
    const handlers = createToolHandlers({
      replacePlaylistItems: vi.fn()
    } as never);

    const result = await handlers.replacePlaylistItems({
      playlistId: "playlist",
      uris: ["spotify:track:1"]
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Invalid literal value");
  });

  it("requires confirm=true when unfollowing a playlist", async () => {
    const handlers = createToolHandlers({
      unfollowPlaylist: vi.fn()
    } as never);

    const result = await handlers.unfollowPlaylist({
      playlistId: "playlist"
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Invalid literal value");
  });

  it("calls unfollow with the playlist id when confirm=true", async () => {
    const unfollowPlaylist = vi.fn(async () => ({
      playlist_id: "playlist",
      unfollowed: true as const
    }));
    const handlers = createToolHandlers({
      unfollowPlaylist
    } as never);

    const result = await handlers.unfollowPlaylist({
      playlistId: "playlist",
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(unfollowPlaylist).toHaveBeenCalledWith("playlist");
  });

  it("requires confirm=true when archiving a playlist", async () => {
    const handlers = createToolHandlers({
      archivePlaylist: vi.fn()
    } as never);

    const result = await handlers.archivePlaylist({
      playlistId: "playlist"
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Invalid literal value");
  });

  it("passes archive options through when confirm=true", async () => {
    const archivePlaylist = vi.fn(async () => ({
      playlist: {
        id: "playlist",
        uri: "spotify:playlist:playlist",
        name: "[Archived] Existing",
        description: "desc",
        public: false,
        collaborative: false,
        owner: {
          id: "me",
          display_name: "Ethan"
        },
        tracks_total: 0,
        snapshot_id: "snap"
      },
      original_count: 2,
      final_count: 0,
      cleared_count: 2
    }));
    const handlers = createToolHandlers({
      archivePlaylist
    } as never);

    const result = await handlers.archivePlaylist({
      playlistId: "playlist",
      clearItems: true,
      prefix: "[Archived] ",
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(archivePlaylist).toHaveBeenCalledWith({
      playlistId: "playlist",
      clearItems: true,
      prefix: "[Archived] "
    });
  });

  it("allows replacing a playlist with an empty list when confirm=true", async () => {
    const replacePlaylistItems = vi.fn(async () => ({
      playlist_id: "playlist",
      snapshot_id: "snap",
      replaced_count: 0,
      original_count: 3,
      final_count: 0
    }));
    const handlers = createToolHandlers({
      replacePlaylistItems
    } as never);

    const result = await handlers.replacePlaylistItems({
      playlistId: "playlist",
      uris: [],
      confirm: true
    });

    expect(result.isError).toBeUndefined();
    expect(replacePlaylistItems).toHaveBeenCalledWith({
      playlistId: "playlist",
      uris: []
    });
  });

  it("requires confirm=true when merging playlists", async () => {
    const handlers = createToolHandlers({
      mergePlaylists: vi.fn()
    } as never);

    const result = await handlers.mergePlaylists({
      targetPlaylistId: "target",
      sourcePlaylistIds: ["source-a"]
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Invalid literal value");
  });

  it("requires confirm=true when deduping a playlist", async () => {
    const handlers = createToolHandlers({
      dedupePlaylist: vi.fn()
    } as never);

    const result = await handlers.dedupePlaylist({
      playlistId: "playlist"
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Invalid literal value");
  });

  it("rejects incomplete person trait feedback before recording profile state", async () => {
    const handlers = createToolHandlers({} as never, undefined, {
      recordFeedback: vi.fn()
    } as never);

    const result = await handlers.recordPersonFeedback({
      profileId: "sample-listener",
      kind: "trait",
      value: "bright"
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("require a sentiment");
  });

  it("passes valid person playlist history input through to the service", async () => {
    const recordPlaylist = vi.fn(async () => ({
      profile_id: "sample-listener",
      entry: {
        entry_id: "entry-1"
      },
      playlist_history_count: 1,
      playlist_history_path: "/tmp/playlist-history.ndjson",
      context_path: "/tmp/profile-context.md",
      artifacts_directory_path: "/tmp/artifacts/sample-listener",
      rebuilt_at: "2026-04-02T00:00:00.000Z"
    }));
    const handlers = createToolHandlers({} as never, undefined, {
      recordPlaylist
    } as never);

    const result = await handlers.recordPersonPlaylist({
      profileId: "sample-listener",
      playlist_name: "Sample Listener - Upbeat Background",
      use_case: "upbeat background music",
      track_count: 22,
      score: 9
    });

    expect(result.isError).toBeUndefined();
    expect(recordPlaylist).toHaveBeenCalledWith({
      profileId: "sample-listener",
      playlist_name: "Sample Listener - Upbeat Background",
      use_case: "upbeat background music",
      track_count: 22,
      score: 9
    });
  });

  it("creates and updates people profiles through the people service", async () => {
    const createProfile = vi.fn(async () => ({
      profile: {
        id: "sample-listener"
      }
    }));
    const updateProfile = vi.fn(async () => ({
      profile: {
        id: "sample-listener",
        age: 30
      }
    }));
    const handlers = createToolHandlers({} as never, undefined, {
      createProfile,
      updateProfile
    } as never);

    const createResult = await handlers.createPersonProfile({
      name: "Sample Listener",
      relationship: "friend"
    });
    const updateResult = await handlers.updatePersonProfile({
      profileId: "sample-listener",
      age: 30
    });

    expect(createResult.isError).toBeUndefined();
    expect(updateResult.isError).toBeUndefined();
    expect(createProfile).toHaveBeenCalledWith({
      name: "Sample Listener",
      relationship: "friend"
    });
    expect(updateProfile).toHaveBeenCalledWith("sample-listener", {
      age: 30
    });
  });
});
