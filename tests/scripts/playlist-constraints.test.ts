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
});

async function writeManifest(value: unknown): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "spotify-constraints-")
  );
  const manifest = path.join(directory, "manifest.json");
  await writeFile(manifest, JSON.stringify(value));
  return manifest;
}
