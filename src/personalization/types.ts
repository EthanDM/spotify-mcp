import type { PlaylistSummary, SpotifyProfile, TrackResult } from "../types.js";

/**
 * Compact saved-track entry persisted in the personalization snapshot.
 */
export type PersonalizationSavedTrack = {
  added_at: string | null;
  track: TrackResult;
};

/**
 * Saved-album shape kept in the snapshot. The summary only needs lightweight
 * display data, so it intentionally avoids Spotify's full album payload.
 */
export type PersonalizationSavedAlbum = {
  added_at: string | null;
  id: string;
  uri: string;
  name: string;
  artists: string[];
  total_tracks: number | null;
};

/**
 * Followed-artist fields that are useful for taste summaries.
 */
export type PersonalizationArtist = {
  id: string;
  uri: string;
  name: string;
  genres: string[];
  popularity: number | null;
};

/**
 * Small named-count helper used for top artists, genres, and similar rollups.
 */
export type NamedCount = {
  name: string;
  count: number;
};

/**
 * Refreshable Spotify-derived state used to rebuild future-agent context.
 *
 * The snapshot favors compact, inspectable data over perfect exhaustiveness.
 * It stores enough raw material to explain the user's taste and recent library
 * state without pulling the full Spotify library into every prompt.
 */
export type PersonalizationSnapshot = {
  refreshed_at: string;
  profile: SpotifyProfile;
  playlists: {
    total_available: number;
    owned_count: number;
    followed_count: number;
    items: PlaylistSummary[];
  };
  saved_tracks: {
    total_available: number;
    items: PersonalizationSavedTrack[];
    top_artists: NamedCount[];
    explicit_ratio: number | null;
  };
  saved_albums: {
    total_available: number;
    items: PersonalizationSavedAlbum[];
    top_artists: NamedCount[];
  };
  followed_artists: {
    fetched_count: number;
    has_more: boolean;
    items: PersonalizationArtist[];
    top_genres: NamedCount[];
  };
};

/**
 * Explicit long-lived preferences that should not be overwritten by Spotify refreshes.
 */
export type PersonalizationPreferences = {
  preferred_artists: string[];
  avoided_artists: string[];
  preferred_genres: string[];
  avoided_genres: string[];
  preferred_traits: string[];
  avoided_traits: string[];
  discovery_level: "low" | "medium" | "high" | null;
  notes: string[];
  use_cases: Record<string, PersonalizationUseCasePreferences>;
  updated_at: string | null;
};

/**
 * Scoped preferences for a specific listening job, mood, or environment.
 */
export type PersonalizationUseCasePreferences = {
  preferred_artists: string[];
  avoided_artists: string[];
  preferred_genres: string[];
  avoided_genres: string[];
  preferred_traits: string[];
  avoided_traits: string[];
  playback_mode: "shuffle" | "ordered" | "either" | null;
  ideal_track_count_range: {
    min: number;
    max: number;
  } | null;
  discovery_level: "low" | "medium" | "high" | null;
  notes: string[];
  updated_at: string | null;
};

/**
 * Structured evaluation of a concrete playlist for a specific use case.
 */
export type PlaylistEvaluationDetails = {
  playlistId: string;
  use_case: string;
  verdict: "default" | "secondary" | "reject";
  score?: number | null;
  winning_traits: string[];
  losing_traits?: string[];
  workflow_learning?: string;
};

/**
 * Append-only event format for MCP actions and explicit user feedback.
 *
 * The log is intentionally schema-light so new event types can be added
 * without a migration every time the tool surface grows.
 */
export type PersonalizationEvent = {
  event_id?: string;
  machine_id?: string;
  schema_version?: 1;
  ts: string;
  type: string;
  details: Record<
    string,
    string | number | boolean | null | Array<string | number | boolean>
  >;
};

/**
 * Result returned after rebuilding Spotify-derived personalization state.
 */
export type PersonalizationRefreshResult = {
  refreshed_at: string;
  snapshot_path: string;
  context_path: string;
  playlist_count: number;
  saved_track_count: number;
  saved_album_count: number;
  followed_artist_count: number;
};

/**
 * Agent-facing summary result. Future tools should consume this instead of the
 * raw event log unless they are doing explicit debugging or inspection.
 */
export type PersonalizationContextResult = {
  context: string;
  context_path: string;
  rebuilt_at: string | null;
};

/**
 * Inspection result for the current personalization files.
 */
export type PersonalizationStateResult = {
  snapshot_path: string;
  preferences_path: string;
  interaction_log_path: string;
  interaction_log_paths: string[];
  context_path: string;
  snapshot: PersonalizationSnapshot | null;
  preferences: PersonalizationPreferences;
  interaction_event_count: number;
  recent_events: PersonalizationEvent[];
  context: string | null;
};

/**
 * Result returned after recording explicit user feedback.
 */
export type PersonalizationFeedbackResult = {
  preferences: PersonalizationPreferences;
  context_path: string;
  rebuilt_at: string | null;
};

/**
 * Result returned after recording a playlist evaluation artifact.
 */
export type PersonalizationPlaylistEvaluationResult = {
  context_path: string;
  rebuilt_at: string | null;
};
