import { beforeEach, describe, expect, it, vi } from "vitest";

import { SpotifyClient } from "../../src/lib/spotify.js";
import { SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT } from "../../src/lib/spotify-shared.js";
import type { StoredTokens } from "../../src/types.js";

const originalEnv = process.env;

describe("SpotifyClient", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SPOTIFY_CLIENT_ID: "client-id",
      SPOTIFY_REDIRECT_URI: "http://127.0.0.1:8787/callback"
    };
  });

  it("constructs the expected list playlists request", async () => {
    const store = createTokenStore();
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://api.spotify.com/v1/me/playlists?limit=20&offset=10"
      );

      return jsonResponse({
        items: [],
        limit: 20,
        offset: 10,
        total: 0,
        next: null
      });
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const result = await client.listPlaylists(20, 10);

    expect(result.offset).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes playlist counts from Spotify's current items.total field", async () => {
    const store = createTokenStore();
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "playlist-1",
            uri: "spotify:playlist:playlist-1",
            name: "Playlist 1",
            description: "desc",
            public: false,
            collaborative: false,
            owner: {
              id: "me",
              display_name: "Ethan"
            },
            items: {
              total: 42
            },
            snapshot_id: "snap-1"
          }
        ],
        limit: 20,
        offset: 0,
        total: 1,
        next: null
      })
    );
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const result = await client.listPlaylists(20, 0);

    expect(result.items[0]?.tracks_total).toBe(42);
  });

  it("refreshes and retries after a 401", async () => {
    const store = createTokenStore();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-access",
          token_type: "Bearer",
          scope: "playlist-read-private",
          expires_in: 3600,
          refresh_token: "new-refresh"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "user",
          display_name: "Ethan",
          uri: "spotify:user:user",
          product: "premium"
        })
      );
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const profile = await client.getMyProfile();

    expect(profile.id).toBe("user");
    expect(store.write).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "new-access",
        refreshToken: "new-refresh"
      })
    );
  });

  it("surfaces revoked refresh tokens as a re-authentication error", async () => {
    const store = createTokenStore(
      createTokens({
        expiresAt: Date.now() - 1_000
      })
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://accounts.spotify.com/api/token") {
        return new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Refresh token revoked"
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    await expect(client.getMyProfile()).rejects.toThrow(
      "Run `pnpm auth` again"
    );
    expect(store.write).not.toHaveBeenCalled();
  });

  it("retries after a 429 response", async () => {
    const store = createTokenStore();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "0" }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          tracks: {
            items: [],
            limit: 10,
            offset: 0,
            total: 0,
            next: null
          }
        })
      );
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    await client.searchTracks("odesza", 10);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requests personalization source pages from the expected Spotify endpoints", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/me/tracks?limit=50&offset=0": () =>
        jsonResponse({
          items: [
            {
              added_at: "2026-04-02T00:00:00.000Z",
              item: playlistItemResponse("spotify:track:1").item
            }
          ],
          limit: 50,
          offset: 0,
          total: 1,
          next: null
        }),
      "GET https://api.spotify.com/v1/me/albums?limit=50&offset=0": () =>
        jsonResponse({
          items: [
            {
              added_at: "2026-04-02T00:00:00.000Z",
              item: {
                id: "album-1",
                uri: "spotify:album:album-1",
                name: "Album 1",
                total_tracks: 8,
                artists: [{ name: "Artist 1" }]
              }
            }
          ],
          limit: 50,
          offset: 0,
          total: 1,
          next: null
        }),
      "GET https://api.spotify.com/v1/me/following?type=artist&limit=50": () =>
        jsonResponse({
          artists: {
            items: [
              {
                id: "artist-1",
                uri: "spotify:artist:artist-1",
                name: "Artist 1",
                genres: ["electronic"],
                popularity: 75
              }
            ],
            limit: 50,
            next: null,
            cursors: {
              after: null
            }
          }
        })
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const [tracks, albums, artists] = await Promise.all([
      client.getSavedTracks(50, 0),
      client.getSavedAlbums(50, 0),
      client.getFollowedArtists(50)
    ]);

    expect(tracks.items[0]?.track.uri).toBe("spotify:track:1");
    expect(albums.items[0]?.name).toBe("Album 1");
    expect(artists.items[0]?.name).toBe("Artist 1");
  });

  it("fails after bounded 429 retries instead of looping forever", async () => {
    const store = createTokenStore();
    const fetchMock = vi.fn(async () => {
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "0" }
      });
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    await expect(client.searchTracks("odesza", 10)).rejects.toThrow(
      "status 429"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reads playlist items from Spotify's current /items endpoint", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      [`GET https://api.spotify.com/v1/playlists/playlist/items?limit=${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}&offset=0`]:
        () =>
          jsonResponse({
            items: [playlistItemResponse("spotify:track:1")],
            limit: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT,
            offset: 0,
            total: 1,
            next: null
          })
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const page = await client.getPlaylistItems(
      "playlist",
      SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT,
      0
    );

    expect(page.items[0]?.track?.uri).toBe("spotify:track:1");
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.spotify.com/v1/playlists/playlist/items?limit=${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}&offset=0`,
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer access"
        })
      })
    );
  });

  it("sends the expected payloads for playlist mutation requests", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/playlist": () =>
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "old"
          })
        ),
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        }),
      "POST https://api.spotify.com/v1/playlists/playlist/items": (
        _url,
        init
      ) => {
        expect(init?.body).toBe(
          JSON.stringify({
            uris: ["spotify:track:1", "spotify:track:2"],
            position: undefined
          })
        );
        return jsonResponse({ snapshot_id: "snap-2" });
      },
      "PUT https://api.spotify.com/v1/playlists/playlist": (_url, init) => {
        expect(init?.body).toBe(
          JSON.stringify({
            name: "Renamed",
            description: "new",
            public: undefined,
            collaborative: undefined
          })
        );
        return new Response(null, { status: 200 });
      }
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    await client.addPlaylistItems({
      playlistId: "playlist",
      uris: ["spotify:track:1", "spotify:track:2"]
    });
    const updated = await client.changePlaylistDetails({
      playlistId: "playlist",
      name: "Renamed",
      description: "new"
    });

    expect(updated.name).toBe("Existing");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.spotify.com/v1/playlists/playlist/items",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.spotify.com/v1/playlists/playlist",
      expect.objectContaining({
        method: "PUT"
      })
    );
  });

  it("unfollows a playlist through Spotify's playlist followers endpoint", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "DELETE https://api.spotify.com/v1/playlists/playlist/followers": () =>
        new Response(null, { status: 200 })
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const result = await client.unfollowPlaylist("playlist");

    expect(result).toEqual({
      playlist_id: "playlist",
      unfollowed: true
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.spotify.com/v1/playlists/playlist/followers",
      expect.objectContaining({
        method: "DELETE"
      })
    );
  });

  it("archives a playlist by making it private, prefixing its name, and clearing items", async () => {
    const store = createTokenStore();
    const getPlaylistMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            tracksTotal: 2,
            name: "Existing",
            public: true,
            collaborative: true
          })
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            tracksTotal: 2,
            name: "Existing",
            public: true,
            collaborative: true
          })
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            tracksTotal: 2,
            name: "Existing",
            public: true,
            collaborative: true
          })
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            tracksTotal: 2,
            name: "[Archived] Existing",
            public: false,
            collaborative: false
          })
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            tracksTotal: 0,
            name: "[Archived] Existing",
            public: false,
            collaborative: false
          })
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            tracksTotal: 0,
            name: "[Archived] Existing",
            public: false,
            collaborative: false
          })
        )
      );
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/playlist": getPlaylistMock,
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        }),
      "PUT https://api.spotify.com/v1/playlists/playlist": (_url, init) => {
        expect(init?.body).toBe(
          JSON.stringify({
            name: "[Archived] Existing",
            description: undefined,
            public: false,
            collaborative: false
          })
        );
        return new Response(null, { status: 200 });
      },
      "PUT https://api.spotify.com/v1/playlists/playlist/items": (
        _url,
        init
      ) => {
        expect(init?.body).toBe(
          JSON.stringify({
            uris: []
          })
        );
        return jsonResponse({ snapshot_id: "snap-cleared" });
      }
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const result = await client.archivePlaylist({
      playlistId: "playlist",
      clearItems: true
    });

    expect(result).toEqual({
      playlist: {
        id: "playlist",
        uri: "spotify:playlist:playlist",
        name: "[Archived] Existing",
        description: "desc",
        public: false,
        collaborative: false,
        owner: {
          id: "me",
          display_name: "Owner"
        },
        tracks_total: 0,
        snapshot_id: "playlist-snapshot"
      },
      original_count: 2,
      final_count: 0,
      cleared_count: 2
    });
  });

  it("does not double-prefix an already archived playlist name", async () => {
    const store = createTokenStore();
    const getPlaylistMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            name: "[Archived] Existing",
            public: false,
            collaborative: false
          })
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            name: "[Archived] Existing",
            public: false,
            collaborative: false
          })
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            name: "[Archived] Existing",
            public: false,
            collaborative: false
          })
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            name: "[Archived] Existing",
            public: false,
            collaborative: false
          })
        )
      );
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/playlist": getPlaylistMock,
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        }),
      "PUT https://api.spotify.com/v1/playlists/playlist": (_url, init) => {
        expect(init?.body).toBe(
          JSON.stringify({
            name: "[Archived] Existing",
            description: undefined,
            public: false,
            collaborative: false
          })
        );
        return new Response(null, { status: 200 });
      }
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const result = await client.archivePlaylist({
      playlistId: "playlist"
    });

    expect(result.cleared_count).toBeUndefined();
    expect(result.original_count).toBe(2);
    expect(result.final_count).toBe(2);
    expect(result.playlist.name).toBe("[Archived] Existing");
  });

  it("replaces playlist items exactly and appends overflow batches in order", async () => {
    const store = createTokenStore();
    const uris = Array.from(
      { length: 101 },
      (_, index) => `spotify:track:${index}`
    );
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/playlist": () =>
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            tracksTotal: 10
          })
        ),
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        }),
      "PUT https://api.spotify.com/v1/playlists/playlist/items": (
        _url,
        init
      ) => {
        const body = JSON.parse(String(init?.body));
        expect(body.uris).toEqual(uris.slice(0, 100));
        return jsonResponse({ snapshot_id: "snap-replace" });
      },
      "POST https://api.spotify.com/v1/playlists/playlist/items": (
        _url,
        init
      ) => {
        const body = JSON.parse(String(init?.body));
        expect(body.uris).toEqual(uris.slice(100));
        expect(body.position).toBeUndefined();
        return jsonResponse({ snapshot_id: "snap-add" });
      }
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const result = await client.replacePlaylistItems({
      playlistId: "playlist",
      uris
    });

    expect(result).toEqual({
      playlist_id: "playlist",
      snapshot_id: "snap-add",
      replaced_count: 101,
      original_count: 10,
      final_count: 101
    });
  });

  it("clears a playlist when replacing with an empty URI list", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/playlist": () =>
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            tracksTotal: 3
          })
        ),
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        }),
      "PUT https://api.spotify.com/v1/playlists/playlist/items": (
        _url,
        init
      ) => {
        const body = JSON.parse(String(init?.body));
        expect(body.uris).toEqual([]);
        return jsonResponse({ snapshot_id: "snap-clear" });
      }
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const result = await client.replacePlaylistItems({
      playlistId: "playlist",
      uris: []
    });

    expect(result).toEqual({
      playlist_id: "playlist",
      snapshot_id: "snap-clear",
      replaced_count: 0,
      original_count: 3,
      final_count: 0
    });
  });

  it("merges source playlists into the target in order", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/target": () =>
        jsonResponse(
          playlistResponse({
            id: "target",
            ownerId: "me",
            description: "desc",
            tracksTotal: 2
          })
        ),
      "GET https://api.spotify.com/v1/playlists/source-a": () =>
        jsonResponse(
          playlistResponse({
            id: "source-a",
            ownerId: "owner",
            description: "desc",
            tracksTotal: 2
          })
        ),
      "GET https://api.spotify.com/v1/playlists/source-b": () =>
        jsonResponse(
          playlistResponse({
            id: "source-b",
            ownerId: "owner",
            description: "desc",
            tracksTotal: 1
          })
        ),
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        }),
      [`GET https://api.spotify.com/v1/playlists/target/items?limit=${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}&offset=0`]:
        () =>
          jsonResponse({
            items: [
              playlistItemResponse("spotify:track:1"),
              playlistItemResponse("spotify:track:2")
            ],
            limit: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT,
            offset: 0,
            total: 2,
            next: null
          }),
      [`GET https://api.spotify.com/v1/playlists/source-a/items?limit=${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}&offset=0`]:
        () =>
          jsonResponse({
            items: [
              playlistItemResponse("spotify:track:3"),
              playlistItemResponse("spotify:track:4")
            ],
            limit: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT,
            offset: 0,
            total: 2,
            next: null
          }),
      [`GET https://api.spotify.com/v1/playlists/source-b/items?limit=${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}&offset=0`]:
        () =>
          jsonResponse({
            items: [playlistItemResponse("spotify:track:5")],
            limit: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT,
            offset: 0,
            total: 1,
            next: null
          }),
      "PUT https://api.spotify.com/v1/playlists/target/items": (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.uris).toEqual([
          "spotify:track:1",
          "spotify:track:2",
          "spotify:track:3",
          "spotify:track:4",
          "spotify:track:5"
        ]);
        return jsonResponse({ snapshot_id: "snap-merge" });
      }
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const result = await client.mergePlaylists({
      targetPlaylistId: "target",
      sourcePlaylistIds: ["source-a", "source-b"]
    });

    expect(result).toEqual({
      playlist_id: "target",
      snapshot_id: "snap-merge",
      replaced_count: 5,
      original_count: 2,
      final_count: 5,
      duplicate_count_removed: 0,
      source_playlist_count: 2,
      source_item_count: 3
    });
  });

  it("dedupes a playlist while preserving the first occurrence order", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/playlist": () =>
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc",
            tracksTotal: 4
          })
        ),
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        }),
      [`GET https://api.spotify.com/v1/playlists/playlist/items?limit=${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}&offset=0`]:
        () =>
          jsonResponse({
            items: [
              playlistItemResponse("spotify:track:1"),
              playlistItemResponse("spotify:track:2"),
              playlistItemResponse("spotify:track:1"),
              playlistItemResponse("spotify:track:3")
            ],
            limit: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT,
            offset: 0,
            total: 4,
            next: null
          }),
      "PUT https://api.spotify.com/v1/playlists/playlist/items": (
        _url,
        init
      ) => {
        const body = JSON.parse(String(init?.body));
        expect(body.uris).toEqual([
          "spotify:track:1",
          "spotify:track:2",
          "spotify:track:3"
        ]);
        return jsonResponse({ snapshot_id: "snap-dedupe" });
      }
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const result = await client.dedupePlaylist({
      playlistId: "playlist"
    });

    expect(result).toEqual({
      playlist_id: "playlist",
      snapshot_id: "snap-dedupe",
      replaced_count: 3,
      original_count: 4,
      final_count: 3,
      duplicate_count_removed: 1
    });
  });

  it("rejects metadata changes for collaborative playlists not owned by the current user", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/playlist": () =>
        jsonResponse({
          ...playlistResponse({
            id: "playlist",
            ownerId: "owner",
            description: "shared"
          }),
          collaborative: true
        }),
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        })
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    await expect(
      client.changePlaylistDetails({
        playlistId: "playlist",
        name: "Renamed"
      })
    ).rejects.toThrow("cannot modify");

    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://api.spotify.com/v1/playlists/playlist",
      expect.objectContaining({
        method: "PUT"
      })
    );
  });

  it("rejects making an existing public playlist collaborative without also making it private", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/playlist": () =>
        jsonResponse({
          ...playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "public playlist"
          }),
          public: true,
          collaborative: false
        }),
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        })
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    await expect(
      client.changePlaylistDetails({
        playlistId: "playlist",
        collaborative: true
      })
    ).rejects.toThrow("must not be public");

    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://api.spotify.com/v1/playlists/playlist",
      expect.objectContaining({
        method: "PUT"
      })
    );
  });

  it("rejects removing local-file playlist items by URI before calling Spotify", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/playlist": () =>
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc"
          })
        ),
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        })
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    await expect(
      client.removePlaylistItems({
        playlistId: "playlist",
        uris: ["spotify:local:artist:album:track:1"]
      })
    ).rejects.toThrow("local-file");

    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://api.spotify.com/v1/playlists/playlist/items",
      expect.objectContaining({
        method: "DELETE"
      })
    );
  });

  it("sends current remove-item payloads using items arrays", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/playlist": () =>
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc"
          })
        ),
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        }),
      "DELETE https://api.spotify.com/v1/playlists/playlist/items": (
        _url,
        init
      ) => {
        expect(init?.body).toBe(
          JSON.stringify({
            items: [{ uri: "spotify:track:1" }],
            snapshot_id: "playlist-snapshot"
          })
        );
        return jsonResponse({ snapshot_id: "snap-remove" });
      }
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const result = await client.removePlaylistItems({
      playlistId: "playlist",
      uris: ["spotify:track:1"]
    });

    expect(result).toEqual({
      playlist_id: "playlist",
      snapshot_id: "snap-remove",
      removed_count: 1,
      original_count: 2,
      final_count: 1
    });
  });

  it("fails clone before creating a playlist when source contains local files", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/source": () =>
        jsonResponse(
          playlistResponse({
            id: "source",
            ownerId: "owner",
            description: "desc",
            tracksTotal: 2
          })
        ),
      [`GET https://api.spotify.com/v1/playlists/source/items?limit=${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}&offset=0`]:
        () =>
          jsonResponse({
            items: [
              playlistItemResponse("spotify:track:1"),
              playlistItemResponse("spotify:local:artist:album:track:1")
            ],
            limit: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT,
            offset: 0,
            total: 2,
            next: null
          })
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    await expect(
      client.clonePlaylist({ sourcePlaylistId: "source" })
    ).rejects.toThrow("local-file");

    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://api.spotify.com/v1/me/playlists",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("preserves non-snapshot 400 errors from reorder operations", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/playlist": () =>
        jsonResponse(
          playlistResponse({
            id: "playlist",
            ownerId: "me",
            description: "desc"
          })
        ),
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        }),
      "PUT https://api.spotify.com/v1/playlists/playlist/items": () =>
        new Response(
          JSON.stringify({
            error: {
              status: 400,
              message: "range_start must be less than playlist length"
            }
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json"
            }
          }
        )
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    await expect(
      client.reorderPlaylistItems({
        playlistId: "playlist",
        rangeStart: 99,
        insertBefore: 0
      })
    ).rejects.toThrow("range_start must be less than playlist length");
  });

  it("clones a playlist across paginated playlist item pages and add batches", async () => {
    const store = createTokenStore();
    const fetchMock = createRouterFetchMock({
      "GET https://api.spotify.com/v1/playlists/source": () =>
        jsonResponse(
          playlistResponse({
            id: "source",
            ownerId: "owner",
            description: "desc",
            tracksTotal: 101
          })
        ),
      "POST https://api.spotify.com/v1/me/playlists": (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.name).toBe("Source (Copy)");
        expect(body.public).toBe(false);
        return jsonResponse(
          playlistResponse({
            id: "clone",
            ownerId: "me",
            description: "desc",
            tracksTotal: 0
          })
        );
      },
      [`GET https://api.spotify.com/v1/playlists/source/items?limit=${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}&offset=0`]:
        () =>
          jsonResponse({
            items: Array.from(
              { length: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT },
              (_, index) => playlistItemResponse(`spotify:track:${index}`)
            ),
            limit: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT,
            offset: 0,
            total: 101,
            next: "next"
          }),
      "GET https://api.spotify.com/v1/me": () =>
        jsonResponse({
          id: "me",
          display_name: "Ethan",
          uri: "spotify:user:me",
          product: "premium"
        }),
      "GET https://api.spotify.com/v1/playlists/clone": () =>
        jsonResponse(
          playlistResponse({
            id: "clone",
            ownerId: "me",
            description: "desc",
            tracksTotal: 101
          })
        ),
      "POST https://api.spotify.com/v1/playlists/clone/items": (_url, init) => {
        const body = JSON.parse(String(init?.body));
        return jsonResponse({
          snapshot_id: body.uris.length === 100 ? "snap-2" : "snap-3"
        });
      },
      [`GET https://api.spotify.com/v1/playlists/source/items?limit=${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}&offset=${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}`]:
        () =>
          jsonResponse({
            items: Array.from(
              { length: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT },
              (_, index) =>
                playlistItemResponse(
                  `spotify:track:${index + SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}`
                )
            ),
            limit: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT,
            offset: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT,
            total: 101,
            next: "next"
          }),
      [`GET https://api.spotify.com/v1/playlists/source/items?limit=${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT}&offset=${SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT * 2}`]:
        () =>
          jsonResponse({
            items: [playlistItemResponse("spotify:track:100")],
            limit: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT,
            offset: SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT * 2,
            total: 101,
            next: null
          })
    });
    const client = new SpotifyClient(store, fetchMock as typeof fetch);

    const result = await client.clonePlaylist({ sourcePlaylistId: "source" });

    expect(result.id).toBe("clone");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.spotify.com/v1/playlists/clone/items",
      expect.objectContaining({ method: "POST" })
    );
    const cloneItemCalls = fetchMock.mock.calls.filter(
      ([url]) => url === "https://api.spotify.com/v1/playlists/clone/items"
    );
    expect(cloneItemCalls).toHaveLength(2);
  });
});

function createTokens(overrides: Partial<StoredTokens> = {}): StoredTokens {
  return {
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() + 3_600_000,
    scope: "playlist-read-private",
    tokenType: "Bearer",
    ...overrides
  };
}

function createTokenStore(tokens: StoredTokens = createTokens()) {
  return {
    read: vi.fn(async () => tokens),
    write: vi.fn(async () => undefined)
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function playlistResponse(input: {
  id: string;
  ownerId: string;
  description?: string;
  tracksTotal?: number;
  name?: string;
  public?: boolean | null;
  collaborative?: boolean;
}) {
  return {
    id: input.id,
    uri: `spotify:playlist:${input.id}`,
    name: input.name ?? (input.id === "source" ? "Source" : "Existing"),
    description: input.description ?? null,
    public: input.public ?? false,
    collaborative: input.collaborative ?? false,
    owner: { id: input.ownerId, display_name: "Owner" },
    tracks: { total: input.tracksTotal ?? 2 },
    snapshot_id: `${input.id}-snapshot`
  };
}

function playlistItemResponse(uri: string) {
  return {
    added_at: null,
    item: {
      id: uri.split(":").at(-1),
      uri,
      name: `Track ${uri}`,
      duration_ms: 1000,
      explicit: false,
      album: { name: "Album" },
      artists: [{ name: "Artist" }]
    },
    track: null
  };
}

function createRouterFetchMock(
  routes: Record<
    string,
    (url: string, init?: RequestInit) => Promise<Response> | Response
  >
) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;
    const handler = routes[key];

    if (!handler) {
      throw new Error(`Unhandled fetch: ${key}`);
    }

    return handler(url, init);
  });
}
