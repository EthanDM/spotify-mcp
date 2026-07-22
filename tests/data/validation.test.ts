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
});
