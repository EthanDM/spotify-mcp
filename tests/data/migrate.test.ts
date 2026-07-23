import { execFile } from "node:child_process";
import {
  appendFile,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  stat,
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
    await mkdir(path.join(local, "artifacts", "empty"));
    await writeFile(
      path.join(local, "artifacts", "profile-context.md"),
      "durable artifact"
    );

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
    expect(
      (await stat(path.join(shared, "artifacts", "empty"))).isDirectory()
    ).toBe(true);
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
    expect(manifest.source_hashes["artifacts/profile-context.md"]).toBeTruthy();
    expect(manifest.source_hashes[`artifacts${path.sep}empty${path.sep}`]).toBe(
      "directory"
    );
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

    const laptopLocal = path.join(root, "laptop-local");
    await mkdir(path.join(laptopLocal, "personalization"), { recursive: true });
    await writeFile(
      path.join(laptopLocal, "personalization", "user-preferences.json"),
      JSON.stringify(preferences("Artist"))
    );
    const laptopDryRun = await runMigration(
      laptopLocal,
      shared,
      "laptop",
      false
    );
    expect(laptopDryRun.stdout).toContain(
      "WILL CREATE CONFLICT: personalization preferences"
    );
    await runMigration(laptopLocal, shared, "laptop", true);
    const afterAncestorImport = await execute(
      command,
      ["src/data/resolve.ts", "--document", "preferences"],
      { env: { ...environment, SPOTIFY_MCP_MACHINE_ID: "laptop" } }
    );
    const ancestorInspection = JSON.parse(
      afterAncestorImport.stdout.slice(
        0,
        afterAncestorImport.stdout.indexOf("\nNo files changed")
      )
    ) as { tips: Array<{ revision_id: string }> };
    expect(ancestorInspection.tips).toHaveLength(2);
  }, 15_000);

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

  it("does not mutate shared storage when snapshot validation fails", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-invalid-snapshot-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    await mkdir(path.join(local, "personalization"), { recursive: true });
    await writeFile(
      path.join(local, "personalization", "user-preferences.json"),
      JSON.stringify({ preferred_artists: null })
    );

    await expect(
      runMigration(local, shared, "desktop", true)
    ).rejects.toBeTruthy();
    await expect(readdir(shared)).resolves.toEqual([]);
  });

  it("rejects FIFO migration sources without blocking", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-source-fifo-"));
    const local = path.join(root, "local");
    const source = path.join(local, "personalization", "user-preferences.json");
    await mkdir(path.dirname(source), { recursive: true });
    await execute("mkfifo", [source]);

    await expect(
      runMigration(local, path.join(root, "shared"), "desktop")
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Migration source must be a regular file")
    });
  });

  it.each([
    { preferred_artists: null },
    { use_cases: false },
    { use_cases: { workout: null } }
  ])(
    "rejects malformed fields in legacy preferences: %j",
    async (malformed) => {
      const root = await mkdtemp(
        path.join(os.tmpdir(), "spotify-malformed-preferences-")
      );
      const local = path.join(root, "local");
      await mkdir(path.join(local, "personalization"), { recursive: true });
      await writeFile(
        path.join(local, "personalization", "user-preferences.json"),
        JSON.stringify({
          preferred_artists: [],
          avoided_artists: [],
          preferred_genres: [],
          avoided_genres: [],
          discovery_level: null,
          notes: [],
          updated_at: null,
          ...malformed
        })
      );

      await expect(
        runMigration(local, path.join(root, "shared"), "desktop")
      ).rejects.toBeTruthy();
    }
  );

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

  it("rejects file destinations for empty artifact directories during preflight", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-empty-artifact-destination-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    await mkdir(path.join(local, "artifacts", "empty"), { recursive: true });
    await mkdir(path.join(shared, "artifacts"), { recursive: true });
    await writeFile(path.join(shared, "artifacts", "empty"), "not a directory");

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Shared artifact destination is not a directory"
      )
    });
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

  it("rejects symlinked legacy state files during preflight", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-state-link-"));
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const outside = path.join(root, "outside.json");
    await mkdir(path.join(local, "personalization"), { recursive: true });
    await writeFile(outside, JSON.stringify(preferences("Outside")));
    await symlink(
      outside,
      path.join(local, "personalization", "user-preferences.json")
    );

    await expect(runMigration(local, shared, "desktop")).rejects.toBeTruthy();
  });

  it("rejects non-regular legacy artifacts during preflight", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-artifact-fifo-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const fifo = path.join(local, "artifacts", "stream");
    await mkdir(path.dirname(fifo), { recursive: true });
    await execute("mkfifo", [fifo]);

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining("requires regular files or directories")
    });
  });

  it("rejects symlinked legacy person directories during preflight", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-person-link-"));
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const outside = path.join(root, "outside");
    await mkdir(path.join(local, "people"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, path.join(local, "people", "friend"));

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "People migration does not allow symlinks"
      )
    });
  });

  it("rejects a symlinked legacy people root during preflight", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-people-root-link-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const outside = path.join(root, "outside");
    await mkdir(local);
    await mkdir(outside);
    await symlink(outside, path.join(local, "people"));

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "People migration does not allow symlinks"
      )
    });
  });

  it("rejects a dangling legacy personalization root", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-personalization-dangling-")
    );
    const local = path.join(root, "local");
    await mkdir(local);
    await symlink(
      path.join(root, "missing"),
      path.join(local, "personalization")
    );

    await expect(
      runMigration(local, path.join(root, "shared"), "desktop")
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Personalization migration does not allow symlinks"
      )
    });
  });

  it("rejects a symlinked legacy artifacts root", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-artifact-root-link-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const outside = path.join(root, "outside");
    await mkdir(local);
    await mkdir(outside);
    await writeFile(path.join(outside, "private.md"), "private");
    await symlink(outside, path.join(local, "artifacts"));

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

  it("rejects symlinked shared stream directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-stream-link-"));
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const outside = path.join(root, "outside");
    await mkdir(path.join(local, "personalization"), { recursive: true });
    await mkdir(path.join(shared, "personalization"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, path.join(shared, "personalization", "events"));
    await writeFile(
      path.join(local, "personalization", "interaction-log.ndjson"),
      `${JSON.stringify({
        ts: "2026-01-01T00:00:00.000Z",
        type: "event",
        details: {}
      })}\n`
    );

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining("must not contain symlinks")
    });
  });

  it("rejects symlinked NDJSON stream files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-stream-file-"));
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const outside = path.join(root, "outside.ndjson");
    await mkdir(path.join(local, "personalization"), { recursive: true });
    await mkdir(path.join(shared, "personalization", "events"), {
      recursive: true
    });
    await writeFile(outside, "");
    await symlink(
      outside,
      path.join(shared, "personalization", "events", "linked.ndjson")
    );
    await writeFile(
      path.join(local, "personalization", "interaction-log.ndjson"),
      `${JSON.stringify({
        ts: "2026-01-01T00:00:00.000Z",
        type: "event",
        details: {}
      })}\n`
    );

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining("must be a regular file")
    });
  });

  it("rejects symlinked revision directories during preflight", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-revision-link-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const outside = path.join(root, "outside");
    await mkdir(path.join(local, "personalization"), { recursive: true });
    await mkdir(path.join(shared, "personalization", "preferences"), {
      recursive: true
    });
    await mkdir(outside);
    await symlink(
      outside,
      path.join(shared, "personalization", "preferences", "revisions")
    );
    await writeFile(
      path.join(local, "personalization", "user-preferences.json"),
      JSON.stringify(preferences("Artist"))
    );

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

  it("rejects unportable relative playlist-history artifact paths", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-relative-artifact-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const record = {
      ...playlistRecord("entry"),
      artifact_paths: ["notes/review.md"]
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

  it("rejects missing playlist-history artifacts", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-missing-artifact-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const record = {
      ...playlistRecord("entry"),
      artifact_paths: [path.join(local, "artifacts", "missing.md")]
    };
    await mkdir(path.join(local, "people", "friend"), { recursive: true });
    await writeFile(
      path.join(local, "people", "friend", "playlist-history.ndjson"),
      `${JSON.stringify(record)}\n`
    );

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining("Referenced artifact does not exist")
    });
  });

  it("rejects missing portable playlist-history artifacts", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-missing-portable-artifact-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const record = {
      ...playlistRecord("entry"),
      artifact_paths: [path.join("artifacts", "missing.md")]
    };
    await mkdir(path.join(local, "people", "friend"), { recursive: true });
    await writeFile(
      path.join(local, "people", "friend", "playlist-history.ndjson"),
      `${JSON.stringify(record)}\n`
    );

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining("Referenced artifact does not exist")
    });
  });

  it("accepts portable references to local artifacts awaiting copy", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-portable-local-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const record = {
      ...playlistRecord("entry"),
      artifact_paths: [path.join("artifacts", "note.md")]
    };
    await mkdir(path.join(local, "people", "friend"), { recursive: true });
    await mkdir(path.join(local, "artifacts"), { recursive: true });
    await writeFile(path.join(local, "artifacts", "note.md"), "note");
    await writeFile(
      path.join(local, "people", "friend", "playlist-history.ndjson"),
      `${JSON.stringify(record)}\n`
    );

    await expect(runMigration(local, shared, "desktop")).resolves.toBeTruthy();
  });

  it("rejects portable references to shared symlinks", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-portable-link-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const outside = path.join(root, "outside.md");
    const record = {
      ...playlistRecord("entry"),
      artifact_paths: [path.join("artifacts", "linked.md")]
    };
    await mkdir(path.join(local, "people", "friend"), { recursive: true });
    await mkdir(path.join(shared, "artifacts"), { recursive: true });
    await writeFile(outside, "outside");
    await symlink(outside, path.join(shared, "artifacts", "linked.md"));
    await writeFile(
      path.join(local, "people", "friend", "playlist-history.ndjson"),
      `${JSON.stringify(record)}\n`
    );

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining("must not contain symlinks")
    });
  });

  it("does not satisfy sibling history from local artifacts", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "spotify-sibling-artifact-")
    );
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    const sibling = {
      ...playlistRecord("sibling"),
      artifact_paths: [path.join("artifacts", "note.md")]
    };
    await mkdir(path.join(local, "people", "friend"), { recursive: true });
    await mkdir(path.join(local, "artifacts"), { recursive: true });
    await mkdir(path.join(shared, "people", "friend", "playlist-history"), {
      recursive: true
    });
    await writeFile(path.join(local, "artifacts", "note.md"), "local note");
    await writeFile(
      path.join(local, "people", "friend", "playlist-history.ndjson"),
      `${JSON.stringify(playlistRecord("incoming"))}\n`
    );
    await writeFile(
      path.join(
        shared,
        "people",
        "friend",
        "playlist-history",
        "sibling.ndjson"
      ),
      `${JSON.stringify(sibling)}\n`
    );

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining("Referenced artifact does not exist")
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

  it.each([
    [
      "missing",
      {
        event_id: "existing",
        ts: "2026-01-01T00:00:00.000Z",
        type: "feedback",
        details: {}
      }
    ],
    [
      "mismatched",
      {
        event_id: "existing",
        machine_id: "laptop",
        schema_version: 1,
        ts: "2026-01-01T00:00:00.000Z",
        type: "feedback",
        details: {}
      }
    ]
  ])("rejects %s destination event identity metadata", async (_, event) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-event-meta-"));
    const local = path.join(root, "local");
    const shared = path.join(root, "shared");
    await mkdir(path.join(local, "personalization"), { recursive: true });
    await mkdir(path.join(shared, "personalization", "events"), {
      recursive: true
    });
    await writeFile(
      path.join(local, "personalization", "interaction-log.ndjson"),
      `${JSON.stringify({
        ts: "2026-01-02T00:00:00.000Z",
        type: "feedback",
        details: {}
      })}\n`
    );
    await writeFile(
      path.join(shared, "personalization", "events", "desktop.ndjson"),
      `${JSON.stringify(event)}\n`
    );

    await expect(runMigration(local, shared, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining("machine_id desktop and schema_version 1")
    });
  });

  it("rejects explicit unsupported event schema versions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spotify-event-schema-"));
    const local = path.join(root, "local");
    await mkdir(path.join(local, "personalization"), { recursive: true });
    await writeFile(
      path.join(local, "personalization", "interaction-log.ndjson"),
      `${JSON.stringify({
        schema_version: 2,
        ts: "2026-01-01T00:00:00.000Z",
        type: "event",
        details: {}
      })}\n`
    );

    await expect(
      runMigration(local, path.join(root, "shared"), "desktop")
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("schema_version must be 1")
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
