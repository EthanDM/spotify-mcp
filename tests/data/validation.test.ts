import { describe, expect, it } from "vitest";

import {
  validatePersonPlaylistRecordDocument,
  validatePersonProfileDocument,
  validatePersonalizationEventDocument,
  validatePreferencesDocument
} from "../../src/data/validation.js";

describe("conflict resolution document validation", () => {
  it("rejects incomplete preferences instead of normalizing them to empty", () => {
    expect(() => validatePreferencesDocument({})).toThrow("preferred_artists");
    expect(() => validatePreferencesDocument("invalid")).toThrow(
      "must be an object"
    );
  });

  it("rejects incomplete person profiles", () => {
    expect(() =>
      validatePersonProfileDocument({ id: "friend", name: "Friend" }, "friend")
    ).toThrow("created_at");
    expect(() =>
      validatePersonProfileDocument({ ...profile(), name: " " }, "friend")
    ).toThrow("non-empty string");
  });

  it("rejects incomplete history and event records", () => {
    expect(() =>
      validatePersonPlaylistRecordDocument({
        entry_id: "entry",
        recorded_at: "2026-01-01T00:00:00.000Z"
      })
    ).toThrow("playlist_name");
    expect(() =>
      validatePersonPlaylistRecordDocument({
        ...playlistRecord(),
        playlist_name: " "
      })
    ).toThrow("non-empty string");
    expect(() =>
      validatePersonPlaylistRecordDocument({
        ...playlistRecord(),
        recorded_at: "zzz"
      })
    ).toThrow("canonical ISO timestamp");
    expect(() =>
      validatePersonalizationEventDocument({
        ts: "2026-01-01T00:00:00.000Z",
        type: "event",
        details: null
      })
    ).toThrow("details");
    expect(() =>
      validatePersonalizationEventDocument({
        ts: "zzz",
        type: "event",
        details: {}
      })
    ).toThrow("canonical ISO timestamp");
    expect(() =>
      validatePersonProfileDocument(
        { ...profile(), updated_at: "zzz" },
        "friend"
      )
    ).toThrow("canonical ISO timestamp");
  });

  it("rejects unsupported fields and invalid playlist numbers", () => {
    expect(() =>
      validatePreferencesDocument({
        preferred_artists: [],
        avoided_artists: [],
        preferred_genres: [],
        avoided_genres: [],
        preferred_traits: [],
        avoided_traits: [],
        discovery_level: null,
        notes: [],
        use_cases: {},
        updated_at: null,
        token: "secret"
      })
    ).toThrow("token is not supported");
    expect(() =>
      validatePersonPlaylistRecordDocument({
        entry_id: "entry",
        recorded_at: "2026-01-01T00:00:00.000Z",
        playlist_id: null,
        playlist_name: "Playlist",
        playlist_url: null,
        brief: null,
        use_case: null,
        track_count: -1,
        runtime_minutes: 10.5,
        score: 100,
        verdict: null,
        winning_traits: [],
        losing_traits: [],
        workflow_learning: null,
        artifact_paths: [],
        notes: []
      })
    ).toThrow("positive integer");
    expect(() =>
      validatePreferencesDocument({
        ...preferences(),
        preferred_artists: [" "]
      })
    ).toThrow("non-empty strings");
  });

  it("rejects invalid ages and use-case track ranges", () => {
    for (const age of [-1, 1.5])
      expect(() =>
        validatePersonProfileDocument({ ...profile(), age }, "friend")
      ).toThrow("non-negative integer");

    for (const range of [
      { min: 0, max: 10 },
      { min: 10.5, max: 20 },
      { min: 20, max: 10 }
    ])
      expect(() =>
        validatePreferencesDocument({
          ...preferences(),
          use_cases: {
            workout: { ...useCase(), ideal_track_count_range: range }
          }
        })
      ).toThrow("positive integer min and max");
  });
});

function preferences() {
  return {
    preferred_artists: [],
    avoided_artists: [],
    preferred_genres: [],
    avoided_genres: [],
    preferred_traits: [],
    avoided_traits: [],
    discovery_level: null,
    notes: [],
    use_cases: {},
    updated_at: null
  };
}

function useCase() {
  return {
    preferred_artists: [],
    avoided_artists: [],
    preferred_genres: [],
    avoided_genres: [],
    preferred_traits: [],
    avoided_traits: [],
    playback_mode: null,
    ideal_track_count_range: null,
    discovery_level: null,
    notes: [],
    updated_at: null
  };
}

function profile() {
  return {
    id: "friend",
    name: "Friend",
    relationship: null,
    age: null,
    age_range: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    life_context: [],
    preferred_artists: [],
    avoided_artists: [],
    preferred_genres: [],
    avoided_genres: [],
    preferred_traits: [],
    avoided_traits: [],
    reference_playlists: [],
    reference_tracks: [],
    reference_artists: [],
    playlist_goals: [],
    notes: []
  };
}

function playlistRecord() {
  return {
    entry_id: "entry",
    recorded_at: "2026-01-01T00:00:00.000Z",
    playlist_id: null,
    playlist_name: "Playlist",
    playlist_url: null,
    brief: null,
    use_case: null,
    track_count: null,
    runtime_minutes: null,
    score: null,
    verdict: null,
    winning_traits: [],
    losing_traits: [],
    workflow_learning: null,
    artifact_paths: [],
    notes: []
  };
}
