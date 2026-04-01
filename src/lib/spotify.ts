import {
  SPOTIFY_API_BASE_URL,
  getSpotifyClientId,
  getSpotifyRedirectUri
} from "../config.js";
import { SpotifyApiError, SpotifyMcpError } from "../errors.js";
import { SpotifyOAuthClient } from "../auth/oauth.js";
import { TokenStore } from "../auth/token-store.js";
import type {
  MutationResult,
  PlaylistItem,
  PlaylistItemsResult,
  PlaylistListResult,
  PlaylistSummary,
  SpotifyProfile,
  StoredTokens,
  TrackResult,
  TrackSearchResult
} from "../types.js";

type FetchLike = typeof fetch;

type SpotifyPage<T> = {
  items: T[];
  limit: number;
  offset: number;
  total: number;
  next: string | null;
};

type SpotifyPlaylistObject = {
  id: string;
  uri: string;
  name: string;
  description: string | null;
  public: boolean | null;
  collaborative: boolean;
  owner: {
    id: string;
    display_name: string | null;
  };
  tracks: {
    total: number;
  };
  snapshot_id?: string;
};

type SpotifyTrackObject = {
  id: string | null;
  uri: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  album?: {
    name: string;
  } | null;
  artists: Array<{ name: string }>;
};

type SpotifyPlaylistItemObject = {
  added_at: string | null;
  track: SpotifyTrackObject | null;
};

/**
 * Thin Spotify Web API client with token refresh, retry, normalization, and
 * playlist-specific guardrails for the local MCP workflow.
 */
export class SpotifyClient {
  /**
   * Shared OAuth helper used only for refreshes after the initial CLI login.
   */
  private readonly oauthClient: SpotifyOAuthClient;
  /**
   * Profile cache avoids paying an extra `/me` request on every ownership check.
   */
  private profileCache: SpotifyProfile | null = null;

  /**
   * The token store is the runtime credential source, while `fetchImpl` stays
   * injectable so request behavior can be verified without live Spotify calls.
   */
  constructor(
    private readonly tokenStore: TokenStore,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.oauthClient = new SpotifyOAuthClient(
      getSpotifyClientId(),
      getSpotifyRedirectUri(),
      fetchImpl
    );
  }

  /**
   * Returns the authenticated user's basic Spotify profile.
   *
   * The result is cached in-memory for the life of the process because the MCP
   * server only needs this data for ownership checks and lightweight identity.
   */
  async getMyProfile(): Promise<SpotifyProfile> {
    if (this.profileCache) {
      return this.profileCache;
    }

    const response = await this.request<{
      id: string;
      display_name: string | null;
      uri: string;
      product: string | null;
    }>("/me");

    this.profileCache = {
      id: response.id,
      display_name: response.display_name,
      uri: response.uri,
      product: response.product
    };

    return this.profileCache;
  }

  /**
   * Lists the current user's playlists.
   *
   * Pagination is passed through explicitly so Codex can control how much data
   * to read instead of the client silently traversing the whole library.
   */
  async listPlaylists(limit: number, offset: number): Promise<PlaylistListResult> {
    const page = await this.request<SpotifyPage<SpotifyPlaylistObject>>(
      `/me/playlists?${new URLSearchParams({
        limit: String(limit),
        offset: String(offset)
      }).toString()}`
    );

    return {
      items: page.items.map(normalizePlaylist),
      limit: page.limit,
      offset: page.offset,
      total: page.total,
      next_offset: page.next ? page.offset + page.limit : null
    };
  }

  /**
   * Returns normalized metadata for a single playlist.
   *
   * This method does not imply write permission; callers that mutate must still
   * pass through `ensureCanModifyPlaylist`.
   */
  async getPlaylist(playlistId: string): Promise<PlaylistSummary> {
    const playlist = await this.request<SpotifyPlaylistObject>(`/playlists/${encodeURIComponent(playlistId)}`);
    return normalizePlaylist(playlist);
  }

  /**
   * Returns normalized playlist items and computes their positions from the page offset.
   *
   * Spotify item pages do not carry absolute positions per row, so the client
   * computes them once here to keep reorder/remove call sites simple.
   */
  async getPlaylistItems(playlistId: string, limit: number, offset: number): Promise<PlaylistItemsResult> {
    const page = await this.request<SpotifyPage<SpotifyPlaylistItemObject>>(
      `/playlists/${encodeURIComponent(playlistId)}/items?${new URLSearchParams({
        limit: String(limit),
        offset: String(offset)
      }).toString()}`
    );

    const items: PlaylistItem[] = page.items.map((item, index) => ({
      position: page.offset + index,
      added_at: item.added_at,
      track: item.track ? normalizeTrack(item.track) : null
    }));

    return {
      items,
      limit: page.limit,
      offset: page.offset,
      total: page.total,
      next_offset: page.next ? page.offset + page.limit : null
    };
  }

  /**
   * Searches Spotify tracks and returns a compact result shape suitable for playlist tools.
   *
   * This is intentionally track-only in v1 so playlist assembly does not depend
   * on a broader search abstraction.
   */
  async searchTracks(query: string, limit: number): Promise<TrackSearchResult> {
    const response = await this.request<{
      tracks: SpotifyPage<SpotifyTrackObject>;
    }>(
      `/search?${new URLSearchParams({
        q: query,
        type: "track",
        limit: String(limit)
      }).toString()}`
    );

    return {
      items: response.tracks.items.map(normalizeTrack),
      limit: response.tracks.limit,
      total: response.tracks.total
    };
  }

  /**
   * Creates a playlist for the authenticated user. New playlists default to private.
   *
   * Callers may opt into `public`, but the default stays private so accidental
   * tool calls do not publish playlists by surprise.
   */
  async createPlaylist(input: {
    name: string;
    description?: string;
    public?: boolean;
    collaborative?: boolean;
  }): Promise<PlaylistSummary> {
    const playlist = await this.request<SpotifyPlaylistObject>("/me/playlists", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        description: input.description ?? "",
        public: input.public ?? false,
        collaborative: input.collaborative ?? false
      })
    });

    return normalizePlaylist(playlist);
  }

  /**
   * Updates playlist metadata after verifying the current user can modify it.
   *
   * The updated playlist is re-read and returned so callers can rely on one
   * normalized response shape for both reads and writes.
   */
  async changePlaylistDetails(input: {
    playlistId: string;
    name?: string;
    description?: string;
    public?: boolean;
    collaborative?: boolean;
  }): Promise<PlaylistSummary> {
    await this.ensureCanModifyPlaylist(input.playlistId, {
      allowCollaborative: false
    });
    await this.validatePlaylistDetailChange(input);

    await this.requestEmpty(`/playlists/${encodeURIComponent(input.playlistId)}`, {
      method: "PUT",
      body: JSON.stringify({
        name: input.name,
        description: input.description,
        public: input.public,
        collaborative: input.collaborative
      })
    });

    return this.getPlaylist(input.playlistId);
  }

  /**
   * Adds playlist items in Spotify-sized batches while preserving the caller's insertion order.
   *
   * Spotify limits each add request to 100 URIs. When a fixed `position` is
   * provided, the position is advanced between batches so the final ordering
   * matches the original input list.
   */
  async addPlaylistItems(input: {
    playlistId: string;
    uris: string[];
    position?: number;
  }): Promise<MutationResult> {
    await this.ensureCanModifyPlaylist(input.playlistId, {
      allowCollaborative: true
    });

    let snapshotId = "";
    let batchPosition = input.position;

    for (const chunk of chunkUris(input.uris, 100)) {
      const response = await this.request<{ snapshot_id: string }>(
        `/playlists/${encodeURIComponent(input.playlistId)}/items`,
        {
          method: "POST",
          body: JSON.stringify({
            uris: chunk,
            position: batchPosition
          })
        }
      );

      snapshotId = response.snapshot_id;

      if (typeof batchPosition === "number") {
        batchPosition += chunk.length;
      }
    }

    return {
      playlist_id: input.playlistId,
      snapshot_id: snapshotId,
      added_count: input.uris.length
    };
  }

  /**
   * Removes items by URI only. This favors a small, predictable API over the
   * more complex position-specific delete variant.
   *
   * The latest playlist snapshot is read first and threaded through the delete
   * calls so concurrent edits fail clearly instead of silently stomping changes.
   */
  async removePlaylistItems(input: {
    playlistId: string;
    uris: string[];
  }): Promise<MutationResult> {
    await this.ensureCanModifyPlaylist(input.playlistId, {
      allowCollaborative: true
    });
    rejectLocalPlaylistUris(input.uris, "remove");

    const playlist = await this.getPlaylist(input.playlistId);
    let snapshotId = playlist.snapshot_id ?? undefined;
    let removedCount = 0;

    for (const chunk of chunkUris(input.uris, 100)) {
      try {
        const response = await this.request<{ snapshot_id: string }>(
          `/playlists/${encodeURIComponent(input.playlistId)}/items`,
          {
            method: "DELETE",
            body: JSON.stringify({
              tracks: chunk.map((uri) => ({ uri })),
              snapshot_id: snapshotId
            })
          }
        );

        snapshotId = response.snapshot_id;
        removedCount += chunk.length;
      } catch (error) {
        if (isSnapshotConflict(error)) {
          throw new SpotifyMcpError(
            "Spotify rejected the removal against the latest playlist snapshot. Re-read the playlist and try again.",
            "playlist_snapshot_conflict"
          );
        }

        throw error;
      }
    }

    if (!snapshotId) {
      throw new SpotifyMcpError("Spotify did not return a snapshot ID after removing items.", "playlist_remove_failed");
    }

    return {
      playlist_id: input.playlistId,
      snapshot_id: snapshotId,
      removed_count: removedCount
    };
  }

  /**
   * Reorders one contiguous range inside a playlist.
   *
   * v1 intentionally exposes only Spotify's contiguous-range move primitive; it
   * is enough for flow tuning without inventing a higher-level reorder DSL.
   */
  async reorderPlaylistItems(input: {
    playlistId: string;
    rangeStart: number;
    insertBefore: number;
    rangeLength?: number;
  }): Promise<MutationResult> {
    await this.ensureCanModifyPlaylist(input.playlistId, {
      allowCollaborative: true
    });
    const playlist = await this.getPlaylist(input.playlistId);

    try {
      const response = await this.request<{ snapshot_id: string }>(
        `/playlists/${encodeURIComponent(input.playlistId)}/items`,
        {
          method: "PUT",
          body: JSON.stringify({
            range_start: input.rangeStart,
            insert_before: input.insertBefore,
            range_length: input.rangeLength ?? 1,
            snapshot_id: playlist.snapshot_id ?? undefined
          })
        }
      );

      return {
        playlist_id: input.playlistId,
        snapshot_id: response.snapshot_id
      };
    } catch (error) {
      if (isSnapshotConflict(error)) {
        throw new SpotifyMcpError(
          "Spotify rejected the reorder against the latest playlist snapshot. Re-read the playlist and try again.",
          "playlist_snapshot_conflict"
        );
      }

      throw error;
    }
  }

  /**
   * Clones a source playlist into a new playlist owned by the authenticated user.
   *
   * The source playlist may belong to someone else; only the destination must
   * be writable by the current user.
   */
  async clonePlaylist(input: {
    sourcePlaylistId: string;
    name?: string;
    description?: string;
    public?: boolean;
  }): Promise<PlaylistSummary> {
    const source = await this.getPlaylist(input.sourcePlaylistId);
    const cloneableUris = await this.collectCloneablePlaylistUris(input.sourcePlaylistId);
    const clone = await this.createPlaylist({
      name: input.name ?? `${source.name} (Copy)`,
      description: input.description ?? source.description ?? "",
      public: input.public ?? false,
      collaborative: false
    });

    for (const chunk of chunkUris(cloneableUris, 100)) {
      await this.addPlaylistItems({
        playlistId: clone.id,
        uris: chunk
      });
    }

    return this.getPlaylist(clone.id);
  }

  /**
   * Reads the full source playlist once so clone can fail before creating a
   * destination playlist when the source contains unsupported local-file items.
   */
  private async collectCloneablePlaylistUris(sourcePlaylistId: string): Promise<string[]> {
    const uris: string[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const page = await this.getPlaylistItems(sourcePlaylistId, limit, offset);
      const pageUris = page.items.flatMap((item) => (item.track ? [item.track.uri] : []));

      rejectLocalPlaylistUris(pageUris, "clone");
      uris.push(...pageUris);

      if (page.next_offset === null) {
        return uris;
      }

      offset = page.next_offset;
    }
  }

  /**
   * Enforces the local write contract before any playlist mutation runs.
   *
   * Collaborative playlists are treated as writable even when they are not
   * owned by the current user.
   */
  private async ensureCanModifyPlaylist(
    playlistId: string,
    options: {
      allowCollaborative: boolean;
    }
  ): Promise<void> {
    const [playlist, me] = await Promise.all([this.getPlaylist(playlistId), this.getMyProfile()]);

    if (playlist.owner.id === me.id) {
      return;
    }

    if (options.allowCollaborative && playlist.collaborative) {
      return;
    }

    throw new SpotifyMcpError(
      "The authenticated user cannot modify this playlist.",
      "playlist_not_modifiable"
    );
  }

  /**
   * Rejects metadata combinations that Spotify would refuse after a network round trip.
   *
   * The main special case is enabling collaboration on an existing public
   * playlist: callers must also make the playlist private in the same update.
   */
  private async validatePlaylistDetailChange(input: {
    playlistId: string;
    public?: boolean;
    collaborative?: boolean;
  }): Promise<void> {
    if (input.collaborative !== true) {
      return;
    }

    const playlist = await this.getPlaylist(input.playlistId);
    const effectivePublic = input.public ?? playlist.public ?? false;

    if (effectivePublic) {
      throw new SpotifyMcpError(
        "Collaborative playlists must not be public. Set `public` to `false` in the same request.",
        "playlist_invalid_visibility"
      );
    }
  }

  /**
   * Executes a Spotify JSON request with automatic token refresh and basic
   * Spotify-directed backoff on `429`.
   *
   * Only one refresh retry is attempted for a given request path so auth errors
   * do not recurse indefinitely.
   */
  private async request<T>(
    path: string,
    init: RequestInit = {},
    hasRetried = false,
    rateLimitRetriesRemaining = 2
  ): Promise<T> {
    const tokens = await this.getValidTokens();

    const response = await this.fetchImpl(`${SPOTIFY_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });

    if (response.status === 401 && !hasRetried) {
      await this.refreshTokens(tokens);
      return this.request<T>(path, init, true, rateLimitRetriesRemaining);
    }

    if (response.status === 429) {
      if (rateLimitRetriesRemaining <= 0) {
        const message = await readSpotifyError(response);
        throw new SpotifyApiError(message, response.status, readRetryAfter(response));
      }

      const retryAfterSeconds = Number(response.headers.get("retry-after") || "1");
      await delay(retryAfterSeconds * 1000);
      return this.request<T>(path, init, hasRetried, rateLimitRetriesRemaining - 1);
    }

    if (!response.ok) {
      const message = await readSpotifyError(response);
      throw new SpotifyApiError(message, response.status, readRetryAfter(response));
    }

    return (await response.json()) as T;
  }

  /**
   * Variant of `request` for endpoints that return no body on success.
   */
  private async requestEmpty(
    path: string,
    init: RequestInit = {},
    hasRetried = false,
    rateLimitRetriesRemaining = 2
  ): Promise<void> {
    const tokens = await this.getValidTokens();

    const response = await this.fetchImpl(`${SPOTIFY_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });

    if (response.status === 401 && !hasRetried) {
      await this.refreshTokens(tokens);
      return this.requestEmpty(path, init, true, rateLimitRetriesRemaining);
    }

    if (response.status === 429) {
      if (rateLimitRetriesRemaining <= 0) {
        const message = await readSpotifyError(response);
        throw new SpotifyApiError(message, response.status, readRetryAfter(response));
      }

      const retryAfterSeconds = Number(response.headers.get("retry-after") || "1");
      await delay(retryAfterSeconds * 1000);
      return this.requestEmpty(path, init, hasRetried, rateLimitRetriesRemaining - 1);
    }

    if (!response.ok) {
      const message = await readSpotifyError(response);
      throw new SpotifyApiError(message, response.status, readRetryAfter(response));
    }
  }

  /**
   * Returns currently usable tokens, refreshing them shortly before expiration.
   *
   * The one-minute buffer prevents a request from starting with a token that is
   * likely to expire while the call is in flight.
   */
  private async getValidTokens(): Promise<StoredTokens> {
    const tokens = await this.tokenStore.read();

    if (!tokens) {
      throw new SpotifyMcpError(
        "Spotify is not authenticated. Run `pnpm auth` first.",
        "auth_missing_tokens"
      );
    }

    if (Date.now() < tokens.expiresAt - 60_000) {
      return tokens;
    }

    return this.refreshTokens(tokens);
  }

  /**
   * Refreshes and persists tokens so the next request path sees the same state.
   */
  private async refreshTokens(tokens: StoredTokens): Promise<StoredTokens> {
    const refreshed = await this.oauthClient.refreshAccessToken(tokens);
    await this.tokenStore.write(refreshed);
    return refreshed;
  }
}

/**
 * Normalizes Spotify's playlist object into the smaller MCP response shape.
 */
function normalizePlaylist(playlist: SpotifyPlaylistObject): PlaylistSummary {
  return {
    id: playlist.id,
    uri: playlist.uri,
    name: playlist.name,
    description: playlist.description,
    public: playlist.public,
    collaborative: playlist.collaborative,
    owner: {
      id: playlist.owner.id,
      display_name: playlist.owner.display_name
    },
    tracks_total: playlist.tracks.total,
    snapshot_id: playlist.snapshot_id ?? null
  };
}

/**
 * Normalizes a Spotify track object for playlist-building use cases.
 */
function normalizeTrack(track: SpotifyTrackObject): TrackResult {
  return {
    id: track.id ?? track.uri,
    uri: track.uri,
    name: track.name,
    artists: track.artists.map((artist) => artist.name),
    album: track.album?.name ?? null,
    duration_ms: track.duration_ms,
    explicit: track.explicit
  };
}

/**
 * Splits URI lists to Spotify's per-request playlist mutation limits.
 */
function chunkUris(uris: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];

  for (let index = 0; index < uris.length; index += chunkSize) {
    chunks.push(uris.slice(index, index + chunkSize));
  }

  return chunks;
}

function rejectLocalPlaylistUris(uris: string[], action: "clone" | "remove"): void {
  const hasLocalFile = uris.some((uri) => uri.startsWith("spotify:local:"));

  if (!hasLocalFile) {
    return;
  }

  const message =
    action === "clone"
      ? "Clone cannot copy Spotify local-file playlist items through the Web API."
      : "Remove does not support Spotify local-file playlist items by URI.";

  throw new SpotifyMcpError(
    `${message} Remove or replace the local files in Spotify first, then retry.`,
    "playlist_local_file_unsupported"
  );
}

function isSnapshotConflict(error: unknown): error is SpotifyApiError {
  return (
    error instanceof SpotifyApiError &&
    error.status === 400 &&
    error.message.toLowerCase().includes("snapshot")
  );
}

/**
 * Extracts a useful message from Spotify's JSON error payload when present.
 */
async function readSpotifyError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: {
        message?: string;
      };
    };
    return payload.error?.message || `Spotify API request failed with status ${response.status}.`;
  } catch {
    return `Spotify API request failed with status ${response.status}.`;
  }
}

/**
 * Reads Spotify's optional backoff header as seconds.
 */
function readRetryAfter(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  return retryAfter ? Number(retryAfter) : undefined;
}

/**
 * Small async delay helper used for Spotify-directed retry backoff.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
