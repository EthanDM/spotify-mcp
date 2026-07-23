import { execFile } from "node:child_process";
import {
  appendFile,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execute = promisify(execFile);

describe("shared data migration", () => {
  it("is dry-run-first, excludes local-only files, and is idempotent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-migration-"));
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    await mkdir(path.join(local, "personalization"), { recursive: true });
    await mkdir(path.join(local, "people", "friend"), { recursive: true });
    await mkdir(path.join(local, "artifacts"), { recursive: true });
    await writeFile(path.join(local, "auth.json"), "secret");
    await writeFile(
      path.join(local, "personalization", "profile-snapshot.json"),
      "{}"
    );
    await writeFile(
      path.join(local, "personalization", "user-preferences.json"),
      JSON.stringify(preferences("Artist"))
    );
    await writeFile(
      path.join(local, "personalization", "interaction-log.ndjson"),
      `${JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", type: "test", details: {} })}\n`
    );
    await writeFile(
      path.join(local, "people", "friend", "profile.json"),
      JSON.stringify(profile("friend"))
    );
    const playlist = {
      ...playlistRecord("entry"),
      artifact_paths: [
        `~/${path.relative(
          os.homedir(),
          path.join(local, "artifacts", "note.md")
        )}`
      ]
    };
    await writeFile(
      path.join(local, "people", "friend", "playlist-history.ndjson"),
      `${JSON.stringify(playlist)}\n`
    );
    await writeFile(path.join(local, "artifacts", "note.md"), "artifact");

    const environment = {
      ...process.env,
      SPOTIFY_MCP_DATA_DIR: local,
      SPOTIFY_MCP_SHARED_DATA_DIR: shared,
      SPOTIFY_MCP_MACHINE_ID: "desktop"
    };
    const command = path.resolve("node_modules/.bin/tsx");
    const dryRun = await execute(command, ["src/data/migrate.ts"], {
      env: environment
    });
    expect(dryRun.stdout).toContain("No files changed");
    await expect(readFile(shared)).rejects.toThrow();

    await mkdir(shared);
    await execute(command, ["src/data/migrate.ts", "--apply"], {
      env: environment
    });
    const firstEvents = await readFile(
      path.join(shared, "personalization", "events", "desktop.ndjson"),
      "utf8"
    );
    const liveEvent = JSON.stringify({
      event_id: "live-event",
      machine_id: "desktop",
      schema_version: 1,
      ts: "2026-01-02T00:00:00.000Z",
      type: "live",
      details: {}
    });
    await appendFile(
      path.join(shared, "personalization", "events", "desktop.ndjson"),
      `${liveEvent}\n`
    );
    await execute(command, ["src/data/migrate.ts", "--apply"], {
      env: environment
    });
    const rerunEvents = await readFile(
      path.join(shared, "personalization", "events", "desktop.ndjson"),
      "utf8"
    );
    expect(rerunEvents).toContain(firstEvents.trim());
    expect(rerunEvents).toContain(liveEvent);
    expect(
      await readFile(path.join(shared, "artifacts", "note.md"), "utf8")
    ).toBe("artifact");
    const migratedPlaylist = JSON.parse(
      await readFile(
        path.join(
          shared,
          "people",
          "friend",
          "playlist-history",
          "desktop.ndjson"
        ),
        "utf8"
      )
    ) as { artifact_paths: string[] };
    expect(migratedPlaylist.artifact_paths).toEqual([
      path.join("artifacts", "note.md")
    ]);
    await expect(readFile(path.join(shared, "auth.json"))).rejects.toThrow();
    await expect(
      readFile(path.join(shared, "personalization", "profile-snapshot.json"))
    ).rejects.toThrow();
    const manifest = JSON.parse(
      await readFile(path.join(shared, "migrations", "desktop.json"), "utf8")
    ) as {
      source_hashes: Record<string, string>;
      source_root?: string;
      destination_root?: string;
    };
    expect(
      manifest.source_hashes["personalization/user-preferences.json"]
    ).toBeTruthy();
    expect(Object.keys(manifest.source_hashes)).not.toContain("auth.json");
    expect(manifest.source_root).toBeUndefined();
    expect(manifest.destination_root).toBeUndefined();

    const neoLocal = path.join(root, "neo-local");
    await mkdir(path.join(neoLocal, "personalization"), { recursive: true });
    await writeFile(
      path.join(neoLocal, "personalization", "user-preferences.json"),
      JSON.stringify(preferences("Different Artist"))
    );
    const neoEnvironment = {
      ...environment,
      SPOTIFY_MCP_DATA_DIR: neoLocal,
      SPOTIFY_MCP_MACHINE_ID: "neo"
    };
    const neoDryRun = await execute(command, ["src/data/migrate.ts"], {
      env: neoEnvironment
    });
    expect(neoDryRun.stdout).toContain(
      "WILL CREATE CONFLICT: personalization preferences"
    );
    await execute(command, ["src/data/migrate.ts", "--apply"], {
      env: neoEnvironment
    });
    const resolution = await execute(
      command,
      ["src/data/resolve.ts", "--document", "preferences"],
      { env: neoEnvironment }
    );
    const inspection = JSON.parse(
      resolution.stdout.slice(
        0,
        resolution.stdout.indexOf("\nNo files changed")
      )
    ) as { tips: Array<{ revision_id: string; written_by: string }> };
    expect(inspection.tips).toHaveLength(2);
    const neoRevision = inspection.tips.find(
      (tip) => tip.written_by === "neo"
    )?.revision_id;
    expect(neoRevision).toBeTruthy();
    await execute(
      command,
      [
        "src/data/resolve.ts",
        "--document",
        "preferences",
        "--from-revision",
        neoRevision!,
        "--apply"
      ],
      { env: neoEnvironment }
    );
    await execute(command, ["src/data/migrate.ts", "--apply"], {
      env: neoEnvironment
    });
    const afterRerun = await execute(
      command,
      ["src/data/resolve.ts", "--document", "preferences"],
      { env: neoEnvironment }
    );
    const resolvedInspection = JSON.parse(
      afterRerun.stdout.slice(
        0,
        afterRerun.stdout.indexOf("\nNo files changed")
      )
    ) as { tips: Array<{ revision_id: string }> };
    expect(resolvedInspection.tips).toHaveLength(1);
  });

  it("normalizes legacy preference documents before migrating", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-legacy-preferences-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    await mkdir(path.join(local, "personalization"), { recursive: true });
    await writeFile(
      path.join(local, "personalization", "user-preferences.json"),
      JSON.stringify({
        preferred_artists: ["Artist"],
        avoided_artists: [],
        preferred_genres: [],
        avoided_genres: [],
        discovery_level: null,
        notes: [],
        updated_at: null
      })
    );

    await runMigration(local, shared, "desktop", true);
    const revisionNames = await readdir(
      path.join(shared, "personalization", "preferences", "revisions")
    );
    const revision = JSON.parse(
      await readFile(
        path.join(
          shared,
          "personalization",
          "preferences",
          "revisions",
          revisionNames[0]
        ),
        "utf8"
      )
    ) as { value: Record<string, unknown> };
    expect(revision.value).toMatchObject({
      preferred_traits: [],
      avoided_traits: [],
      use_cases: {}
    });
  });

  it("rejects malformed canonical migration inputs", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-invalid-migration-")
    );
    const local = path.join(root, "local");
    await mkdir(path.join(local, "people", "friend"), { recursive: true });
    await writeFile(
      path.join(local, "people", "friend", "profile.json"),
      JSON.stringify({ id: "friend", name: "Incomplete" })
    );
    await expect(
      execute(path.resolve("node_modules/.bin/tsx"), ["src/data/migrate.ts"], {
        env: {
          ...process.env,
          SPOTIFY_MCP_DATA_DIR: local,
          SPOTIFY_MCP_SHARED_DATA_DIR: path.join(root, "shared"),
          SPOTIFY_MCP_MACHINE_ID: "desktop"
        }
      })
    ).rejects.toMatchObject({ stderr: expect.stringContaining("created_at") });
  });

  it("rejects present falsy JSON documents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-falsy-"));
    const local = path.join(root, "local");
    await mkdir(path.join(local, "personalization"), { recursive: true });
    await writeFile(
      path.join(local, "personalization", "user-preferences.json"),
      "null"
    );
    await expect(
      runMigration(local, path.join(root, "shared"), "desktop")
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("must be an object")
    });
  });

  it("uses content-stable event IDs across local roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-event-ids-"));
    const shared = path.join(root, "shared");
    const event = JSON.stringify({
      ts: "2026-01-01T00:00:00.000Z",
      type: "test",
      details: { source: "legacy" }
    });
    for (const machineId of ["desktop", "neo"]) {
      const local = path.join(root, `${machineId}-local`);
      await mkdir(path.join(local, "personalization"), { recursive: true });
      await writeFile(
        path.join(local, "personalization", "interaction-log.ndjson"),
        `${event}\n`
      );
      await runMigration(local, shared, machineId, true);
    }
    const eventFiles = await readdir(
      path.join(shared, "personalization", "events")
    );
    const ids = await Promise.all(
      eventFiles.map(async (file) => {
        const record = JSON.parse(
          await readFile(
            path.join(shared, "personalization", "events", file),
            "utf8"
          )
        ) as { event_id: string };
        return record.event_id;
      })
    );
    expect(eventFiles).toHaveLength(1);
    expect(new Set(ids)).toHaveLength(1);
  });

  it("compares equivalent revision values independent of object key order", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-order-"));
    const shared = path.join(root, "shared");
    const first = preferences("Artist");
    first.use_cases = {
      focus: useCase("steady"),
      workout: useCase("driving")
    };
    const second = preferences("Artist");
    second.use_cases = {
      workout: useCase("driving"),
      focus: useCase("steady")
    };
    for (const [machineId, document] of [
      ["desktop", first],
      ["neo", second]
    ] as const) {
      const local = path.join(root, `${machineId}-local`);
      await mkdir(path.join(local, "personalization"), { recursive: true });
      await writeFile(
        path.join(local, "personalization", "user-preferences.json"),
        JSON.stringify(document)
      );
      const result = await runMigration(local, shared, machineId, true);
      expect(result.stdout).not.toContain("WILL CREATE CONFLICT");
    }
  });

  it("propagates artifact destination read errors during preflight", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-artifact-"));
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    await mkdir(path.join(local, "artifacts"), { recursive: true });
    await writeFile(path.join(local, "artifacts", "note.md"), "artifact");
    await mkdir(path.join(shared, "artifacts", "note.md"), {
      recursive: true
    });
    await expect(runMigration(local, shared, "desktop")).rejects.toBeTruthy();
  });

  it("rejects symlinked legacy artifacts during preflight", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-artifact-link-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const outside = path.join(root, "outside.md");
    await mkdir(path.join(local, "artifacts"), { recursive: true });
    await writeFile(outside, "outside");
    await symlink(outside, path.join(local, "artifacts", "linked.md"));

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Artifact migration does not allow symlinks"
      )
    });
  });

  it("rejects symlinked shared artifact destinations", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-artifact-destination-link-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const outside = path.join(root, "outside.md");
    await mkdir(path.join(local, "artifacts"), { recursive: true });
    await mkdir(path.join(shared, "artifacts"), { recursive: true });
    await writeFile(path.join(local, "artifacts", "note.md"), "artifact");
    await writeFile(outside, "artifact");
    await symlink(outside, path.join(shared, "artifacts", "note.md"));

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining("must not contain symlinks")
    });
  });

  it("does not overwrite an artifact created by a concurrent migration", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-artifact-race-")
    );
    const shared = path.join(root, "shared");
    const locals = ["first", "second"].map((name) =>
      path.join(root, `${name}-local`)
    );
    await Promise.all(
      locals.map(async (local, index) => {
        await mkdir(path.join(local, "artifacts"), { recursive: true });
        await writeFile(
          path.join(local, "artifacts", "note.md"),
          `artifact-${index}`
        );
      })
    );
    await mkdir(shared);

    const results = await Promise.allSettled(
      locals.map((local, index) =>
        runMigration(local, shared, `machine-${index}`, true)
      )
    );

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    expect(
      ["artifact-0", "artifact-1"].includes(
        await readFile(path.join(shared, "artifacts", "note.md"), "utf8")
      )
    ).toBe(true);
  });

  it("treats equivalent NDJSON records as equal across key order", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-record-order-"));
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const source = playlistRecord("entry");
    const reordered = Object.fromEntries(Object.entries(source).reverse());
    await mkdir(path.join(local, "people", "friend"), { recursive: true });
    await mkdir(path.join(shared, "people", "friend", "playlist-history"), {
      recursive: true
    });
    await writeFile(
      path.join(local, "people", "friend", "playlist-history.ndjson"),
      `${JSON.stringify(source)}\n`
    );
    await writeFile(
      path.join(
        shared,
        "people",
        "friend",
        "playlist-history",
        "desktop.ndjson"
      ),
      `${JSON.stringify(reordered)}\n`
    );

    await expect(
      runMigration(local, shared, "desktop", true)
    ).resolves.toBeTruthy();
  });

  it("rejects conflicting IDs from another machine stream", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-record-id-"));
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const source = playlistRecord("entry");
    const conflicting = { ...source, playlist_name: "Different" };
    await mkdir(path.join(local, "people", "friend"), { recursive: true });
    await mkdir(path.join(shared, "people", "friend", "playlist-history"), {
      recursive: true
    });
    await writeFile(
      path.join(local, "people", "friend", "playlist-history.ndjson"),
      `${JSON.stringify(source)}\n`
    );
    await writeFile(
      path.join(
        shared,
        "people",
        "friend",
        "playlist-history",
        "other-machine.ndjson"
      ),
      `${JSON.stringify(conflicting)}\n`
    );

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining("Conflicting entry_id entry")
    });
  });

  it("rejects unportable playlist-history artifact paths", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-unportable-artifact-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const record = {
      ...playlistRecord("entry"),
      artifact_paths: [path.join(root, "outside.md")]
    };
    await mkdir(path.join(local, "people", "friend"), { recursive: true });
    await writeFile(
      path.join(local, "people", "friend", "playlist-history.ndjson"),
      `${JSON.stringify(record)}\n`
    );

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining("Unportable artifact path")
    });
  });

  it("rejects conflicting event IDs from another machine stream", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-event-id-"));
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const source = {
      event_id: "shared-id",
      ts: "2026-01-01T00:00:00.000Z",
      type: "feedback",
      details: { value: "source" }
    };
    const conflicting = {
      ...source,
      machine_id: "other",
      schema_version: 1,
      details: { value: "different" }
    };
    await mkdir(path.join(local, "personalization"), { recursive: true });
    await mkdir(path.join(shared, "personalization", "events"), {
      recursive: true
    });
    await writeFile(
      path.join(local, "personalization", "interaction-log.ndjson"),
      `${JSON.stringify(source)}\n`
    );
    await writeFile(
      path.join(shared, "personalization", "events", "other.ndjson"),
      `${JSON.stringify(conflicting)}\n`
    );

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining("Conflicting event_id shared-id")
    });
  });

  it("inspects resolutions without claiming a machine ID", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-resolve-"));
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    await mkdir(shared);

    const result = await execute(
      path.resolve("node_modules/.bin/tsx"),
      ["src/data/resolve.ts", "--document", "preferences"],
      {
        env: {
          ...process.env,
          SPOTIFY_MCP_DATA_DIR: local,
          SPOTIFY_MCP_SHARED_DATA_DIR: shared,
          SPOTIFY_MCP_MACHINE_ID: "desktop"
        }
      }
    );

    expect(result.stdout).toContain("No files changed");
    await expect(
      readFile(path.join(local, "installation-id"))
    ).rejects.toThrow();
    await expect(
      readFile(path.join(shared, "machines", "desktop.json"))
    ).rejects.toThrow();
  });
});

async function runMigration(
  local: string,
  shared: string,
  machineId: string,
  apply = false
) {
  if (apply) await mkdir(shared, { recursive: true });
  return execute(
    path.resolve("node_modules/.bin/tsx"),
    ["src/data/migrate.ts", ...(apply ? ["--apply"] : [])],
    {
      env: {
        ...process.env,
        SPOTIFY_MCP_DATA_DIR: local,
        SPOTIFY_MCP_SHARED_DATA_DIR: shared,
        SPOTIFY_MCP_MACHINE_ID: machineId
      }
    }
  );
}

function preferences(artist: string) {
  return {
    preferred_artists: [artist],
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

function useCase(trait: string) {
  return {
    preferred_artists: [],
    avoided_artists: [],
    preferred_genres: [],
    avoided_genres: [],
    preferred_traits: [trait],
    avoided_traits: [],
    playback_mode: null,
    ideal_track_count_range: null,
    discovery_level: null,
    notes: [],
    updated_at: null
  };
}

function profile(id: string) {
  return {
    id,
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

function playlistRecord(entry_id: string) {
  return {
    entry_id,
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
