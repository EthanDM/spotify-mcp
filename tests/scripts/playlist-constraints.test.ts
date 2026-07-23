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

  it("accepts an ordered build that starts after the opening phase", async () => {
    const tracks = [
      track("spotify:track:one", "development"),
      track("spotify:track:two", "close")
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
      ...track(`spotify:track:${index}`, "development"),
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
      { target_track_count: 1, tracks: [track("spotify:track:one", "close")] },
      false
    );
    await expect(
      execute("python3", [checker, missingMode])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("curation_mode is required")
    });

    const missingUris = await writeManifest({
      target_track_count: 1,
      tracks: [track("spotify:track:one", "close")],
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
