import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const checker = path.resolve(
  "skills/playlist-builder-from-context/scripts/check_playlist_constraints.py"
);

describe("playlist constraint checker", () => {
  it("rejects a final body outside the requested size", async () => {
    const manifest = await writeManifest({ target_track_count: 1, tracks: [] });
    const result = await execute("python3", [checker, manifest]);
    const report = JSON.parse(result.stdout) as {
      passes_applicable_hard_checks: boolean;
      violations: string[];
    };

    expect(report.passes_applicable_hard_checks).toBe(false);
    expect(report.violations).toContain("target_track_count");
  });

  it("requires an intended count or range", async () => {
    const manifest = await writeManifest({ tracks: [] });
    await expect(execute("python3", [checker, manifest])).rejects.toMatchObject(
      {
        stderr: expect.stringContaining(
          "target_track_count or target_track_count_range is required"
        )
      }
    );
  });

  it("rejects unsupported playlist item URIs", async () => {
    for (const uri of [
      "spotify:local:artist:album:track",
      "spotify:album:one",
      "spotify:track:notarealid"
    ]) {
      const manifest = await writeManifest({
        target_track_count: 1,
        tracks: [track(uri, "close")]
      });
      await expect(
        execute("python3", [checker, manifest])
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "tracks[1].uri must be a supported Spotify track URI"
        )
      });
    }
  });

  it("rejects whitespace-only selected-track metadata", async () => {
    for (const [field, value] of [
      ["name", "   "],
      ["primary_artist", "\t"]
    ] as const) {
      const invalidTrack = {
        ...track("spotify:track:0000000000000000000001", "close"),
        [field]: value
      };
      const manifest = await writeManifest({
        target_track_count: 1,
        tracks: [invalidTrack]
      });
      await expect(
        execute("python3", [checker, manifest])
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(`tracks[1].${field} is required`)
      });
    }
  });

  it("normalizes artist metadata before applying artist limits", async () => {
    const tracks = ["Same", "same ", " SAME", "SaMe  "].map(
      (primaryArtist, index) => ({
        ...track(
          `spotify:track:${String(index + 1).padStart(22, "0")}`,
          "development"
        ),
        primary_artist: primaryArtist
      })
    );
    const manifest = await writeManifest({
      target_track_count: 4,
      tracks,
      curation_mode: "general",
      recent_comparable_builds: [
        {
          id: "prior",
          track_uris: ["spotify:track:0000000000000000000099"],
          primary_artists: [" SAME "]
        }
      ]
    });
    const result = await execute("python3", [checker, manifest]);
    const report = JSON.parse(result.stdout) as {
      new_primary_artist_track_count: number;
      passes_applicable_hard_checks: boolean;
      primary_artist_counts: Record<string, number>;
      violations: string[];
    };

    expect(report.primary_artist_counts).toEqual({ same: 4 });
    expect(report.new_primary_artist_track_count).toBe(0);
    expect(report.violations).toContain("primary_artist_cap");
    expect(report.passes_applicable_hard_checks).toBe(false);
  });

  it("accepts an ordered build that starts after the opening phase", async () => {
    const tracks = [
      track("spotify:track:0000000000000000000001", "development"),
      track("spotify:track:0000000000000000000002", "close")
    ];
    const manifest = await writeManifest({
      target_track_count: 2,
      tracks,
      curation_mode: "recovered",
      playback_mode: "ordered"
    });
    const result = await execute("python3", [checker, manifest]);
    const report = JSON.parse(result.stdout) as {
      passes_applicable_hard_checks: boolean;
      ordered_phase_progression_valid: boolean;
    };

    expect(report.ordered_phase_progression_valid).toBe(true);
    expect(report.passes_applicable_hard_checks).toBe(true);
  });

  it("validates and applies the artist-specific derivative flag", async () => {
    const tracks = [1, 2, 3, 4].map((index) => ({
      ...track(
        `spotify:track:${String(index).padStart(22, "0")}`,
        "development"
      ),
      primary_artist: "Artist"
    }));
    const manifest = await writeManifest({
      target_track_count: 4,
      tracks,
      curation_mode: "derivative",
      artist_specific: true
    });
    const result = await execute("python3", [checker, manifest]);
    const report = JSON.parse(result.stdout) as {
      passes_applicable_hard_checks: boolean;
    };
    expect(report.passes_applicable_hard_checks).toBe(true);

    const invalid = await writeManifest({
      target_track_count: 1,
      tracks: [tracks[0]],
      artist_specific: "yes"
    });
    await expect(execute("python3", [checker, invalid])).rejects.toMatchObject({
      stderr: expect.stringContaining("artist_specific must be a boolean")
    });
  });

  it("requires mode fields and complete historical references", async () => {
    const missingMode = await writeManifest(
      {
        target_track_count: 1,
        tracks: [track("spotify:track:0000000000000000000001", "close")]
      },
      false
    );
    await expect(
      execute("python3", [checker, missingMode])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("curation_mode is required")
    });

    const missingUris = await writeManifest({
      target_track_count: 1,
      tracks: [track("spotify:track:0000000000000000000001", "close")],
      historical_references: [{ id: "reference" }]
    });
    await expect(
      execute("python3", [checker, missingUris])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "historical_references[1].track_uris must be a list"
      )
    });
  });

  it("rejects non-string comparison-history values", async () => {
    const invalidUris = await writeManifest({
      target_track_count: 1,
      tracks: [track("spotify:track:0000000000000000000001", "close")],
      recent_comparable_builds: [
        { track_uris: [null], primary_artists: ["Artist"] }
      ]
    });
    await expect(
      execute("python3", [checker, invalidUris])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "recent_comparable_builds[1].track_uris must contain non-empty strings"
      )
    });

    const invalidArtists = await writeManifest({
      target_track_count: 1,
      tracks: [track("spotify:track:0000000000000000000001", "close")],
      recent_comparable_builds: [
        {
          track_uris: ["spotify:track:0000000000000000000002"],
          primary_artists: [null]
        }
      ]
    });
    await expect(
      execute("python3", [checker, invalidArtists])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "recent_comparable_builds[1].primary_artists must contain non-empty strings"
      )
    });

    const malformedUris = await writeManifest({
      target_track_count: 1,
      tracks: [track("spotify:track:0000000000000000000001", "close")],
      recent_comparable_builds: [
        { track_uris: ["not-a-uri"], primary_artists: ["Artist"] }
      ]
    });
    await expect(
      execute("python3", [checker, malformedUris])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "recent_comparable_builds[1].track_uris must contain supported Spotify track URIs"
      )
    });

    const blankArtists = await writeManifest({
      target_track_count: 1,
      tracks: [track("spotify:track:0000000000000000000001", "close")],
      recent_comparable_builds: [
        {
          track_uris: ["spotify:track:0000000000000000000002"],
          primary_artists: ["   "]
        }
      ]
    });
    await expect(
      execute("python3", [checker, blankArtists])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "recent_comparable_builds[1].primary_artists must contain non-empty strings"
      )
    });
  });
});

async function writeManifest(
  value: unknown,
  includeModes = true
): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "spotify-constraints-")
  );
  const manifest = path.join(directory, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify(
      includeModes
        ? {
            curation_mode: "recovered",
            audience_mode: "self_personalized",
            playback_mode: "shuffle",
            ...(value as Record<string, unknown>)
          }
        : value
    )
  );
  return manifest;
}

function track(uri: string, phase: string): Record<string, string> {
  return {
    uri,
    name: uri,
    primary_artist: uri,
    bucket: "familiar",
    evidence_tier: "anchor",
    prompt_fit: "strong",
    functional_fit: "strong",
    phase
  };
}
