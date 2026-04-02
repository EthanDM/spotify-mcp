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
      replaced_count: 0
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
});
