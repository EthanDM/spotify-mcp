import { describe, expect, it, vi } from "vitest";

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
      addPlaylistItems: vi.fn(),
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
});
