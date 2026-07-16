/**
 * Lightweight named reference stored on a person profile.
 *
 * References stay manual-context-first: callers can include Spotify ids and
 * URLs when they have them, but a stable human-readable name is always enough.
 */
export type PersonTasteReference = {
  name: string;
  spotify_id: string | null;
  spotify_uri: string | null;
  url: string | null;
  note: string | null;
};

/**
 * Durable profile for a friend or family member the user builds playlists for.
 *
 * The profile stores stable taste cues and life context, not one-off workflow
 * notes that belong in playlist history or separate artifacts.
 */
export type PersonProfile = {
  id: string;
  name: string;
  relationship: string | null;
  age: number | null;
  age_range: string | null;
  created_at: string;
  updated_at: string;
  life_context: string[];
  preferred_artists: string[];
  avoided_artists: string[];
  preferred_genres: string[];
  avoided_genres: string[];
  preferred_traits: string[];
  avoided_traits: string[];
  reference_playlists: PersonTasteReference[];
  reference_tracks: PersonTasteReference[];
  reference_artists: PersonTasteReference[];
  playlist_goals: string[];
  notes: string[];
};

/**
 * Structured record of one playlist made for a saved person profile.
 *
 * Artifact paths are optional sidecars. They can point to markdown or JSON
 * writeups, but they never replace the structured evaluation stored here.
 */
export type PersonPlaylistRecord = {
  entry_id: string;
  recorded_at: string;
  playlist_id: string | null;
  playlist_name: string;
  playlist_url: string | null;
  brief: string | null;
  use_case: string | null;
  track_count: number | null;
  runtime_minutes: number | null;
  score: number | null;
  verdict: "success" | "mixed" | "reject" | null;
  winning_traits: string[];
  losing_traits: string[];
  workflow_learning: string | null;
  artifact_paths: string[];
  notes: string[];
};

/**
 * Compact list view for future agents choosing which saved profile to use.
 */
export type PersonProfileSummary = {
  id: string;
  name: string;
  relationship: string | null;
  age: number | null;
  age_range: string | null;
  playlist_goals: string[];
  updated_at: string;
  playlist_history_count: number;
};

/**
 * Result returned when a caller lists all saved people profiles.
 */
export type PersonProfileListResult = {
  items: PersonProfileSummary[];
  total: number;
};

/**
 * Result returned for profile reads and writes.
 */
export type PersonProfileResult = {
  profile: PersonProfile;
  profile_path: string;
  playlist_history_path: string;
  context_path: string;
  artifacts_directory_path: string;
  playlist_history_count: number;
};

/**
 * Result returned after reading or rebuilding one profile-facing summary.
 */
export type PersonProfileContextResult = {
  profile_id: string;
  context: string;
  context_path: string;
  rebuilt_at: string | null;
};

/**
 * Result returned after recording one playlist against a saved person.
 */
export type PersonPlaylistRecordResult = {
  profile_id: string;
  entry: PersonPlaylistRecord;
  playlist_history_count: number;
  playlist_history_path: string;
  context_path: string;
  artifacts_directory_path: string;
  rebuilt_at: string | null;
};
