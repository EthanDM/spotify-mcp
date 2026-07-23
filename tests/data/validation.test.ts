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
  });

  it("rejects incomplete history and event records", () => {
    expect(() =>
      validatePersonPlaylistRecordDocument({
        entry_id: "entry",
        recorded_at: "2026-01-01T00:00:00.000Z"
      })
    ).toThrow("playlist_name");
    expect(() =>
      validatePersonalizationEventDocument({
        ts: "2026-01-01T00:00:00.000Z",
        type: "event",
        details: null
      })
    ).toThrow("details");
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
  });
});
