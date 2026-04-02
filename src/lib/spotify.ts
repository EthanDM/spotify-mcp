import { SpotifyMcpError } from "../errors.js";
import type { TokenStoreLike } from "../auth/token-store.js";
import type {
  ArchivePlaylistResult,
  FollowedArtistsPageResult,
  MutationResult,
  PlaylistItem,
  PlaylistItemsResult,
  PlaylistListResult,
  PlaylistSummary,
  SavedAlbumsPageResult,
  SavedTracksPageResult,
  SpotifyProfile,
  TrackSearchResult,
  UnfollowPlaylistResult
} from "../types.js";
import { SpotifyRequestClient } from "./spotify-request-client.js";
import {
  SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT,
  SPOTIFY_PLAYLIST_MUTATION_BATCH_LIMIT,
  chunkUris,
  normalizeArtist,
  isSnapshotConflict,
  normalizeSavedAlbum,
  normalizePlaylist,
  normalizeTrack,
  rejectLocalPlaylistUris,
  type FetchLike,
  type SpotifyAlbumObject,
  type SpotifyArtistObject,
  type SpotifyCursorPage,
  type SpotifyPage,
  type SpotifyPlaylistItemObject,
  type SpotifyPlaylistObject,
  type SpotifySavedAlbumObject,
  type SpotifySavedTrackObject,
  type SpotifyTrackObject
} from "./spotify-shared.js";

/**
 * Thin Spotify Web API client with token refresh, retry, normalization, and
 * playlist-specific guardrails for the local MCP workflow.
 */
export class SpotifyClient {
  private readonly requests: SpotifyRequestClient;
  /**
   * Profile cache avoids paying an extra `/me` request on every ownership check.
   */
  private profileCache: SpotifyProfile | null = null;

  /**
   * `fetchImpl` stays injectable so request behavior can be verified without
   * live Spotify calls.
   */
  constructor(tokenStore: TokenStoreLike, fetchImpl: FetchLike = fetch) {
    this.requests = new SpotifyRequestClient(tokenStore, fetchImpl);
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

    const response = await this.requests.request<{
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
  async listPlaylists(
    limit: number,
    offset: number
  ): Promise<PlaylistListResult> {
    const page = await this.requests.request<
      SpotifyPage<SpotifyPlaylistObject>
    >(
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
    const playlist = await this.requests.request<SpotifyPlaylistObject>(
      `/playlists/${encodeURIComponent(playlistId)}`
    );
    return normalizePlaylist(playlist);
  }

  /**
   * Returns normalized playlist items and computes their positions from the page offset.
   *
   * Spotify item pages do not carry absolute positions per row, so the client
   * computes them once here to keep reorder/remove call sites simple.
   */
  async getPlaylistItems(
    playlistId: string,
    limit: number,
    offset: number
  ): Promise<PlaylistItemsResult> {
    const page = await this.requests.request<
      SpotifyPage<SpotifyPlaylistItemObject>
    >(
      `/playlists/${encodeURIComponent(playlistId)}/items?${new URLSearchParams(
        {
          limit: String(limit),
          offset: String(offset)
        }
      ).toString()}`
    );

    const items: PlaylistItem[] = page.items.map((item, index) => ({
      position: page.offset + index,
      added_at: item.added_at,
      track: item.item
        ? normalizeTrack(item.item)
        : item.track
          ? normalizeTrack(item.track)
          : null
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
    const response = await this.requests.request<{
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
   * Returns one page of the current user's saved tracks for personalization refreshes.
   */
  async getSavedTracks(
    limit: number,
    offset: number
  ): Promise<SavedTracksPageResult> {
    const page = await this.requests.request<
      SpotifyPage<SpotifySavedTrackObject>
    >(
      `/me/tracks?${new URLSearchParams({
        limit: String(limit),
        offset: String(offset)
      }).toString()}`
    );

    return {
      items: page.items.flatMap((item) => {
        const track = item.item ?? item.track;

        if (!track) {
          return [];
        }

        return [
          {
            added_at: item.added_at,
            track: normalizeTrack(track)
          }
        ];
      }),
      limit: page.limit,
      offset: page.offset,
      total: page.total,
      next_offset: page.next ? page.offset + page.limit : null
    };
  }

  /**
   * Returns one page of the current user's saved albums for personalization refreshes.
   */
  async getSavedAlbums(
    limit: number,
    offset: number
  ): Promise<SavedAlbumsPageResult> {
    const page = await this.requests.request<
      SpotifyPage<SpotifySavedAlbumObject>
    >(
      `/me/albums?${new URLSearchParams({
        limit: String(limit),
        offset: String(offset)
      }).toString()}`
    );

    return {
      items: page.items.flatMap((item) => {
        const album = item.item ?? item.album;

        if (!album) {
          return [];
        }

        return [
          normalizeSavedAlbum(album as SpotifyAlbumObject, item.added_at)
        ];
      }),
      limit: page.limit,
      offset: page.offset,
      total: page.total,
      next_offset: page.next ? page.offset + page.limit : null
    };
  }

  /**
   * Returns one cursor page of followed artists for personalization refreshes.
   */
  async getFollowedArtists(
    limit: number,
    after?: string
  ): Promise<FollowedArtistsPageResult> {
    const response = await this.requests.request<{
      artists: SpotifyCursorPage<SpotifyArtistObject>;
    }>(
      `/me/following?${new URLSearchParams({
        type: "artist",
        limit: String(limit),
        ...(after ? { after } : {})
      }).toString()}`
    );

    return {
      items: response.artists.items.map(normalizeArtist),
      limit: response.artists.limit,
      next_after: response.artists.next ? response.artists.cursors.after : null
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
    const playlist = await this.requests.request<SpotifyPlaylistObject>(
      "/me/playlists",
      {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          description: input.description ?? "",
          public: input.public ?? false,
          collaborative: input.collaborative ?? false
        })
      }
    );

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

    await this.requests.requestEmpty(
      `/playlists/${encodeURIComponent(input.playlistId)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          name: input.name,
          description: input.description,
          public: input.public,
          collaborative: input.collaborative
        })
      }
    );

    return this.getPlaylist(input.playlistId);
  }

  /**
   * Removes a playlist from the current user's library.
   *
   * Spotify does not support true playlist deletion through the Web API. This
   * endpoint only unfollows the playlist for the current user.
   */
  async unfollowPlaylist(playlistId: string): Promise<UnfollowPlaylistResult> {
    await this.requests.requestEmpty(
      `/playlists/${encodeURIComponent(playlistId)}/followers`,
      {
        method: "DELETE"
      }
    );

    return {
      playlist_id: playlistId,
      unfollowed: true
    };
  }

  /**
   * Archives a playlist in place for the current user.
   *
   * This is an opinionated cleanup workflow: it makes the playlist private,
   * disables collaboration, prefixes the name once, and can optionally clear
   * every playlist item.
   */
  async archivePlaylist(input: {
    playlistId: string;
    clearItems?: boolean;
    prefix?: string;
  }): Promise<ArchivePlaylistResult> {
    const current = await this.ensureCanModifyPlaylist(input.playlistId, {
      allowCollaborative: false
    });
    const prefix = input.prefix ?? "[Archived] ";
    const archivedName = current.name.startsWith(prefix)
      ? current.name
      : `${prefix}${current.name}`;

    const archivedPlaylist = await this.changePlaylistDetails({
      playlistId: input.playlistId,
      name: archivedName,
      public: false,
      collaborative: false
    });

    let clearedCount: number | undefined;

    if (input.clearItems) {
      clearedCount = current.tracks_total;
      await this.replacePlaylistItems({
        playlistId: input.playlistId,
        uris: []
      });
    }

    const finalPlaylist = input.clearItems
      ? await this.getPlaylist(input.playlistId)
      : archivedPlaylist;

    return {
      playlist: finalPlaylist,
      original_count: current.tracks_total,
      final_count: finalPlaylist.tracks_total,
      ...(typeof clearedCount === "number"
        ? { cleared_count: clearedCount }
        : {})
    };
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

    for (const chunk of chunkUris(
      input.uris,
      SPOTIFY_PLAYLIST_MUTATION_BATCH_LIMIT
    )) {
      const response = await this.requests.request<{ snapshot_id: string }>(
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
   * Replaces a playlist with the exact ordered URI list provided by the caller.
   *
   * Spotify's replace endpoint accepts only one batch, so larger playlists are
   * seeded with the first batch and then appended in order using add calls.
   */
  async replacePlaylistItems(input: {
    playlistId: string;
    uris: string[];
  }): Promise<MutationResult> {
    const playlist = await this.ensureCanModifyPlaylist(input.playlistId, {
      allowCollaborative: true
    });
    rejectLocalPlaylistUris(input.uris, "replace");

    const chunks = chunkUris(input.uris, SPOTIFY_PLAYLIST_MUTATION_BATCH_LIMIT);
    const firstChunk = chunks[0];
    const response = await this.requests.request<{ snapshot_id: string }>(
      `/playlists/${encodeURIComponent(input.playlistId)}/items`,
      {
        method: "PUT",
        body: JSON.stringify({
          uris: firstChunk ?? []
        })
      }
    );

    let snapshotId = response.snapshot_id;

    for (const chunk of chunks.slice(1)) {
      const addResult = await this.addPlaylistItems({
        playlistId: input.playlistId,
        uris: chunk
      });
      snapshotId = addResult.snapshot_id;
    }

    return {
      playlist_id: input.playlistId,
      snapshot_id: snapshotId,
      replaced_count: input.uris.length,
      original_count: playlist.tracks_total,
      final_count: input.uris.length
    };
  }

  /**
   * Merges one or more source playlists into a target playlist.
   *
   * The target's current contents stay first, then each source contributes its
   * items in order. Optional dedupe removes later duplicates by URI.
   */
  async mergePlaylists(input: {
    targetPlaylistId: string;
    sourcePlaylistIds: string[];
    dedupe?: boolean;
  }): Promise<MutationResult> {
    const mergedUris = await this.collectPlaylistUris(input.targetPlaylistId, {
      localAction: "replace"
    });
    const originalCount = mergedUris.length;
    let sourceItemCount = 0;

    for (const sourcePlaylistId of input.sourcePlaylistIds) {
      const sourceUris = await this.collectPlaylistUris(sourcePlaylistId, {
        localAction: "replace"
      });
      mergedUris.push(...sourceUris);
      sourceItemCount += sourceUris.length;
    }

    const finalUris = input.dedupe ? dedupeUris(mergedUris) : mergedUris;
    const result = await this.replacePlaylistItems({
      playlistId: input.targetPlaylistId,
      uris: finalUris
    });

    return {
      ...result,
      original_count: originalCount,
      final_count: finalUris.length,
      duplicate_count_removed: mergedUris.length - finalUris.length,
      source_playlist_count: input.sourcePlaylistIds.length,
      source_item_count: sourceItemCount
    };
  }

  /**
   * Removes duplicate track URIs from a playlist while preserving the first
   * occurrence of each URI.
   */
  async dedupePlaylist(input: { playlistId: string }): Promise<MutationResult> {
    const uris = await this.collectPlaylistUris(input.playlistId, {
      localAction: "replace"
    });
    const dedupedUris = dedupeUris(uris);

    const result = await this.replacePlaylistItems({
      playlistId: input.playlistId,
      uris: dedupedUris
    });

    return {
      ...result,
      original_count: uris.length,
      final_count: dedupedUris.length,
      duplicate_count_removed: uris.length - dedupedUris.length
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
    const playlist = await this.ensureCanModifyPlaylist(input.playlistId, {
      allowCollaborative: true
    });
    rejectLocalPlaylistUris(input.uris, "remove");

    let snapshotId = playlist.snapshot_id ?? undefined;
    let removedCount = 0;

    for (const chunk of chunkUris(
      input.uris,
      SPOTIFY_PLAYLIST_MUTATION_BATCH_LIMIT
    )) {
      try {
        const response = await this.requests.request<{ snapshot_id: string }>(
          `/playlists/${encodeURIComponent(input.playlistId)}/items`,
          {
            method: "DELETE",
            body: JSON.stringify({
              items: chunk.map((uri) => ({ uri })),
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
      throw new SpotifyMcpError(
        "Spotify did not return a snapshot ID after removing items.",
        "playlist_remove_failed"
      );
    }

    return {
      playlist_id: input.playlistId,
      snapshot_id: snapshotId,
      removed_count: removedCount,
      original_count: playlist.tracks_total,
      final_count: Math.max(playlist.tracks_total - removedCount, 0)
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
      const response = await this.requests.request<{ snapshot_id: string }>(
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
    const cloneableUris = await this.collectCloneablePlaylistUris(
      input.sourcePlaylistId
    );
    const clone = await this.createPlaylist({
      name: input.name ?? `${source.name} (Copy)`,
      description: input.description ?? source.description ?? "",
      public: input.public ?? false,
      collaborative: false
    });

    for (const chunk of chunkUris(
      cloneableUris,
      SPOTIFY_PLAYLIST_MUTATION_BATCH_LIMIT
    )) {
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
  private async collectCloneablePlaylistUris(
    sourcePlaylistId: string
  ): Promise<string[]> {
    return this.collectPlaylistUris(sourcePlaylistId, {
      localAction: "clone"
    });
  }

  /**
   * Reads the full URI list for a playlist so higher-level workflows can reuse
   * one page traversal path.
   */
  private async collectPlaylistUris(
    playlistId: string,
    options: {
      localAction: "clone" | "replace";
    }
  ): Promise<string[]> {
    let lastAttempt: {
      uris: string[];
      unresolvedCount: number;
      totalCount: number;
    } | null = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await this.readPlaylistUris(playlistId, options);
      lastAttempt = result;

      if (
        result.unresolvedCount === 0 ||
        result.uris.length === result.totalCount
      ) {
        return result.uris;
      }

      await delay(500);
    }

    if (lastAttempt && lastAttempt.unresolvedCount > 0) {
      throw new SpotifyMcpError(
        "Spotify playlist items are not fully materialized yet. Retry in a moment.",
        "playlist_items_not_ready"
      );
    }

    return lastAttempt?.uris ?? [];
  }

  /**
   * Reads one full playlist traversal and keeps track of rows whose track data
   * has not materialized yet.
   */
  private async readPlaylistUris(
    playlistId: string,
    options: {
      localAction: "clone" | "replace";
    }
  ): Promise<{
    uris: string[];
    unresolvedCount: number;
    totalCount: number;
  }> {
    const uris: string[] = [];
    let unresolvedCount = 0;
    let totalCount = 0;
    let offset = 0;
    const limit = SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT;

    while (true) {
      const page = await this.getPlaylistItems(playlistId, limit, offset);
      totalCount = page.total;
      const pageUris = page.items.flatMap((item) => {
        if (!item.track?.uri) {
          unresolvedCount += 1;
          return [];
        }

        return [item.track.uri];
      });

      rejectLocalPlaylistUris(pageUris, options.localAction);
      uris.push(...pageUris);

      if (page.next_offset === null) {
        return {
          uris,
          unresolvedCount,
          totalCount
        };
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
  ): Promise<PlaylistSummary> {
    const [playlist, me] = await Promise.all([
      this.getPlaylist(playlistId),
      this.getMyProfile()
    ]);

    if (playlist.owner.id === me.id) {
      return playlist;
    }

    if (options.allowCollaborative && playlist.collaborative) {
      return playlist;
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
}

function dedupeUris(uris: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const uri of uris) {
    if (seen.has(uri)) {
      continue;
    }

    seen.add(uri);
    deduped.push(uri);
  }

  return deduped;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
