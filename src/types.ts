/**
 * Compact owner metadata surfaced in normalized playlist responses.
 */
export type SpotifyOwner = {
  id: string;
  display_name: string | null;
};

/**
 * Track shape returned to MCP callers.
 *
 * Album is flattened to the album name because playlist-management tools only
 * need lightweight display context, not the full Spotify album payload.
 */
export type TrackResult = {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: string | null;
  duration_ms: number;
  explicit: boolean;
};

/**
 * Playlist metadata normalized from Spotify's richer playlist object.
 *
 * `snapshot_id` is exposed because callers may need to reason about optimistic
 * concurrency after mutating a playlist.
 */
export type PlaylistSummary = {
  id: string;
  uri: string;
  name: string;
  description: string | null;
  public: boolean | null;
  collaborative: boolean;
  owner: SpotifyOwner;
  tracks_total: number;
  snapshot_id: string | null;
};

/**
 * Playlist item representation with the absolute position already computed.
 *
 * Spotify pages return the page offset and an item list separately; callers of
 * this MCP server do not need to reconstruct absolute positions themselves.
 */
export type PlaylistItem = {
  position: number;
  added_at: string | null;
  track: TrackResult | null;
};

/**
 * Page result for list-playlists calls.
 */
export type PlaylistListResult = {
  items: PlaylistSummary[];
  limit: number;
  offset: number;
  total: number;
  next_offset: number | null;
};

/**
 * Page result for playlist item reads.
 */
export type PlaylistItemsResult = {
  items: PlaylistItem[];
  limit: number;
  offset: number;
  total: number;
  next_offset: number | null;
};

/**
 * Track search results reduced to the fields that matter for playlist assembly.
 */
export type TrackSearchResult = {
  items: TrackResult[];
  limit: number;
  total: number;
};

/**
 * Standard mutation response for playlist writes.
 *
 * The optional counts let callers confirm how much work was applied without
 * reading the playlist again immediately.
 */
export type MutationResult = {
  playlist_id: string;
  snapshot_id: string;
  added_count?: number;
  removed_count?: number;
};

/**
 * Persisted OAuth token state shared by the auth CLI and runtime server.
 *
 * `expiresAt` is stored as epoch milliseconds so expiration checks do not need
 * to reconstruct wall-clock semantics from Spotify's relative `expires_in`.
 */
export type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
};

/**
 * Minimal profile data needed for ownership checks and basic identity display.
 */
export type SpotifyProfile = {
  id: string;
  display_name: string | null;
  uri: string;
  product: string | null;
};
