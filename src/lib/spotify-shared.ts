import { SpotifyApiError, SpotifyMcpError } from "../errors.js";
import type {
  FollowedArtistResult,
  PlaylistSummary,
  SavedAlbumResult,
  TrackResult
} from "../types.js";

export type FetchLike = typeof fetch;

export type SpotifyPage<T> = {
  items: T[];
  limit: number;
  offset: number;
  total: number;
  next: string | null;
};

export type SpotifyCursorPage<T> = {
  items: T[];
  limit: number;
  next: string | null;
  cursors: {
    after: string | null;
  };
};

export type SpotifyPlaylistObject = {
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
  items?: {
    total: number;
  };
  tracks?: {
    total: number;
  };
  snapshot_id?: string;
};

export type SpotifyTrackObject = {
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

export type SpotifyAlbumObject = {
  id: string;
  uri: string;
  name: string;
  total_tracks?: number | null;
  artists: Array<{ name: string }>;
};

export type SpotifyArtistObject = {
  id: string;
  uri: string;
  name: string;
  genres?: string[];
  popularity?: number | null;
};

export type SpotifySavedTrackObject = {
  added_at: string | null;
  item?: SpotifyTrackObject | null;
  track?: SpotifyTrackObject | null;
};

export type SpotifySavedAlbumObject = {
  added_at: string | null;
  item?: SpotifyAlbumObject | null;
  album?: SpotifyAlbumObject | null;
};

export type SpotifyPlaylistItemObject = {
  added_at: string | null;
  item?: SpotifyTrackObject | null;
  track: SpotifyTrackObject | null;
};

export const SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT = 50;
export const SPOTIFY_PLAYLIST_MUTATION_BATCH_LIMIT = 100;

/**
 * Normalizes Spotify's playlist object into the smaller MCP response shape.
 */
export function normalizePlaylist(
  playlist: SpotifyPlaylistObject
): PlaylistSummary {
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
    tracks_total: readPlaylistItemsTotal(playlist),
    snapshot_id: playlist.snapshot_id ?? null
  };
}

/**
 * Spotify's playlist list endpoints now expose item counts under `items.total`,
 * while some single-playlist responses still include the older `tracks.total`.
 * The MCP shape only needs the count, so normalization accepts either field.
 */
function readPlaylistItemsTotal(playlist: SpotifyPlaylistObject): number {
  return playlist.items?.total ?? playlist.tracks?.total ?? 0;
}

/**
 * Normalizes a Spotify track object for playlist-building use cases.
 */
export function normalizeTrack(track: SpotifyTrackObject): TrackResult {
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
 * Normalizes a saved album entry into the compact summary shape used by the
 * personalization refresh.
 */
export function normalizeSavedAlbum(
  album: SpotifyAlbumObject,
  addedAt: string | null
): SavedAlbumResult {
  return {
    added_at: addedAt,
    id: album.id,
    uri: album.uri,
    name: album.name,
    artists: album.artists.map((artist) => artist.name),
    total_tracks: album.total_tracks ?? null
  };
}

/**
 * Normalizes a followed artist into the fields used by future-agent summaries.
 */
export function normalizeArtist(
  artist: SpotifyArtistObject
): FollowedArtistResult {
  return {
    id: artist.id,
    uri: artist.uri,
    name: artist.name,
    genres: artist.genres ?? [],
    popularity: artist.popularity ?? null
  };
}

/**
 * Splits URI lists to Spotify's per-request playlist mutation limits.
 */
export function chunkUris(uris: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];

  for (let index = 0; index < uris.length; index += chunkSize) {
    chunks.push(uris.slice(index, index + chunkSize));
  }

  return chunks;
}

export function rejectLocalPlaylistUris(
  uris: string[],
  action: "clone" | "remove" | "replace"
): void {
  const hasLocalFile = uris.some((uri) => uri.startsWith("spotify:local:"));

  if (!hasLocalFile) {
    return;
  }

  const message =
    action === "clone"
      ? "Clone cannot copy Spotify local-file playlist items through the Web API."
      : action === "replace"
        ? "Replace does not support Spotify local-file playlist items."
        : "Remove does not support Spotify local-file playlist items by URI.";

  throw new SpotifyMcpError(
    `${message} Remove or replace the local files in Spotify first, then retry.`,
    "playlist_local_file_unsupported"
  );
}

export function isSnapshotConflict(error: unknown): error is SpotifyApiError {
  return (
    error instanceof SpotifyApiError &&
    error.status === 400 &&
    error.message.toLowerCase().includes("snapshot")
  );
}
