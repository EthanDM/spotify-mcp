import "dotenv/config";
import { createHash } from "node:crypto";
import { constants as fsConstants, existsSync, lstatSync } from "node:fs";
import fs from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { getStorageConfig, type StorageConfig } from "../config.js";
import { normalizePreferences } from "../personalization/store.js";
import { RevisionStore } from "../storage/revisions.js";
import {
  appendPrivateFile,
  assertNoSymlinksWithinRoot,
  ensureDirectoryWithinRoot,
  readDirectoryIdentity,
  readFileNoFollow,
  SharedStorageGuard
} from "../storage/shared.js";
import {
  validatePersonPlaylistRecordDocument,
  validatePersonProfileDocument,
  validatePersonalizationEventDocument,
  validatePreferencesDocument
} from "./validation.js";

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes("--apply");
  const config = getStorageConfig();
  if (!config.sharedMode || !config.sharedRoot || !config.machineId)
    throw new Error(
      "Set SPOTIFY_MCP_SHARED_DATA_DIR and SPOTIFY_MCP_MACHINE_ID before migrating."
    );

  const plan = await buildPlan(config.localRoot, config.sharedRoot);
  if (!apply) {
    plan.lines.push(
      ...(await validateMigration(
        config.localRoot,
        config.sharedRoot,
        config.machineId
      ))
    );
    writePlan(plan.lines, false);
    process.stdout.write(
      "No files changed. Re-run with --apply after reviewing this plan.\n"
    );
    return;
  }

  const snapshot = await createMigrationSnapshot(config.localRoot);
  try {
    plan.lines.push(
      ...(await validateMigration(
        snapshot.root,
        config.sharedRoot,
        config.machineId,
        config.localRoot
      ))
    );
    writePlan(plan.lines, true);
    await applyMigration(
      {
        ...config,
        sharedRoot: config.sharedRoot,
        machineId: config.machineId
      },
      snapshot.root,
      snapshot.sourceHashes
    );
  } finally {
    await fs.rm(snapshot.root, { recursive: true, force: true });
  }
}

function writePlan(lines: string[], apply: boolean): void {
  process.stdout.write(
    `${apply ? "Applying" : "Dry run"} Spotify MCP shared-data migration\n${lines.join("\n")}\n`
  );
  process.stdout.write(
    "Local auth.json, snapshots, generated contexts, .env, and runtime configuration are excluded.\n"
  );
}

async function applyMigration(
  config: StorageConfig & { sharedRoot: string; machineId: string },
  sourceRoot: string,
  sourceHashes: Record<string, string>
): Promise<void> {
  const sharedStorage = new SharedStorageGuard(config);
  await sharedStorage.claimMachineId();
  const revisionGuard = {
    root: sharedStorage.sharedRoot,
    assertAvailable: () => sharedStorage.assertWritable()
  };
  const counts = {
    preferences: 0,
    profiles: 0,
    events: 0,
    playlist_history: 0,
    artifacts: 0
  };
  const preferencesSource = path.join(
    sourceRoot,
    "personalization",
    "user-preferences.json"
  );
  const preferencesDocument = await readJson<unknown>(preferencesSource);
  if (preferencesDocument !== undefined) {
    const preferences = normalizeMigratedPreferences(preferencesDocument);
    const store = new RevisionStore(
      path.join(
        config.sharedRoot,
        "personalization",
        "preferences",
        "revisions"
      ),
      "personalization preferences",
      config.machineId,
      (value) => validatePreferencesDocument(value),
      revisionGuard
    );
    await seedRevision(store, preferences, "preferences", config.machineId);
    counts.preferences = 1;
  }

  counts.artifacts = await copyArtifacts(
    path.join(sourceRoot, "artifacts"),
    path.join(config.sharedRoot, "artifacts"),
    sharedStorage
  );

  for (const profileId of await directoryNames(
    path.join(sourceRoot, "people")
  )) {
    const source = path.join(sourceRoot, "people", profileId, "profile.json");
    const profileDocument = await readJson<unknown>(source);
    if (profileDocument !== undefined) {
      const profile = validatePersonProfileDocument(profileDocument, profileId);
      const store = new RevisionStore(
        path.join(config.sharedRoot, "people", profileId, "revisions"),
        `person profile ${profileId}`,
        config.machineId,
        (value) => validatePersonProfileDocument(value, profileId),
        revisionGuard
      );
      await seedRevision(
        store,
        profile,
        `person profile ${profileId}`,
        config.machineId
      );
      counts.profiles += 1;
    }
    counts.playlist_history += await migrateNdjson(
      path.join(sourceRoot, "people", profileId, "playlist-history.ndjson"),
      path.join(
        config.sharedRoot,
        "people",
        profileId,
        "playlist-history",
        `${config.machineId}.ndjson`
      ),
      "entry_id",
      config.machineId,
      false,
      sharedStorage,
      (value) =>
        rewriteArtifactPaths(
          value,
          path.join(config.localRoot, "artifacts"),
          path.join(config.sharedRoot!, "artifacts"),
          path.join(sourceRoot, "artifacts")
        ),
      (value) =>
        rewriteSharedArtifactPaths(
          value,
          path.join(config.sharedRoot!, "artifacts")
        )
    );
  }
  counts.events = await migrateNdjson(
    path.join(sourceRoot, "personalization", "interaction-log.ndjson"),
    path.join(
      config.sharedRoot,
      "personalization",
      "events",
      `${config.machineId}.ndjson`
    ),
    "event_id",
    config.machineId,
    true,
    sharedStorage
  );
  const manifest = {
    schema_version: 1,
    migrated_at: new Date().toISOString(),
    machine_id: config.machineId,
    counts,
    source_hashes: sourceHashes
  };
  const manifestPath = path.join(
    config.sharedRoot,
    "migrations",
    `${config.machineId}.json`
  );
  await writeAtomic(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    sharedStorage
  );
  process.stdout.write(
    `Migration complete: ${JSON.stringify(counts)}\nManifest: ${manifestPath}\nOriginal local files were preserved.\n`
  );
}

async function createMigrationSnapshot(localRoot: string): Promise<{
  root: string;
  sourceHashes: Record<string, string>;
}> {
  const sourceHashes = await buildSourceHashes(localRoot);
  const snapshotRoot = await fs.mkdtemp(
    path.join(tmpdir(), "spotify-mcp-migration-")
  );
  try {
    for (const relative of ["personalization", "people", "artifacts"])
      await copySnapshotDirectory(
        path.join(localRoot, relative),
        path.join(snapshotRoot, relative),
        localRoot
      );
    const snapshotHashes = await buildSourceHashes(snapshotRoot);
    const sourceHashesAfter = await buildSourceHashes(localRoot);
    if (
      stable(sourceHashes) !== stable(snapshotHashes) ||
      stable(sourceHashes) !== stable(sourceHashesAfter)
    )
      throw new Error(
        "Local migration sources changed while preparing the migration snapshot. Stop the legacy server and retry."
      );
    return { root: snapshotRoot, sourceHashes };
  } catch (error) {
    await fs.rm(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

async function copySnapshotDirectory(
  source: string,
  destination: string,
  root: string
): Promise<void> {
  let stats;
  try {
    stats = await fs.lstat(source);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (stats.isSymbolicLink())
    throw new Error(`Migration source does not allow symlinks: ${source}`);
  if (!stats.isDirectory())
    throw new Error(`Migration source must be a directory: ${source}`);
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (isGeneratedLocalState(path.relative(root, from))) continue;
    if (entry.isDirectory()) await copySnapshotDirectory(from, to, root);
    else if (entry.isFile())
      await fs.writeFile(to, await readBytesNoFollow(from), {
        mode: 0o600,
        flag: "wx"
      });
    else
      throw new Error(
        `Migration source requires regular files or directories: ${from}`
      );
  }
}

async function buildSourceHashes(
  localRoot: string
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const relative of ["personalization", "people", "artifacts"]) {
    await collectHashes(path.join(localRoot, relative), localRoot, hashes);
  }
  return hashes;
}

async function collectHashes(
  target: string,
  root: string,
  hashes: Record<string, string>
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  const targetRelative = path.relative(root, target);
  if (targetRelative) hashes[`${targetRelative}${path.sep}`] = "directory";
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    const relative = path.relative(root, child);
    if (entry.isDirectory()) await collectHashes(child, root, hashes);
    else if (entry.isFile() && !isGeneratedLocalState(relative))
      hashes[relative] = hash(await readBytesNoFollow(child));
  }
}

function isGeneratedLocalState(relative: string): boolean {
  if (
    relative === path.join("personalization", "profile-snapshot.json") ||
    relative === path.join("personalization", "personalization-context.md")
  )
    return true;
  const parts = relative.split(path.sep);
  return (
    parts.length === 3 &&
    parts[0] === "people" &&
    parts[2] === "profile-context.md"
  );
}

async function buildPlan(
  localRoot: string,
  sharedRoot: string
): Promise<{ lines: string[] }> {
  const lines = [`Source: ${localRoot}`, `Destination: ${sharedRoot}`];
  for (const relative of [
    "personalization/user-preferences.json",
    "personalization/interaction-log.ndjson",
    "people",
    "artifacts"
  ]) {
    lines.push(
      `${(await exists(path.join(localRoot, relative))) ? "MIGRATE" : "SKIP missing"}: ${relative}`
    );
  }
  return { lines };
}

async function validateMigration(
  localRoot: string,
  sharedRoot: string,
  machineId: string,
  artifactReferenceRoot = localRoot
): Promise<string[]> {
  const warnings: string[] = [];
  const revisionGuard = {
    root: sharedRoot,
    assertAvailable: async () => undefined
  };
  const personalizationDirectory = path.join(localRoot, "personalization");
  if (
    (await exists(personalizationDirectory)) &&
    (await fs.lstat(personalizationDirectory)).isSymbolicLink()
  )
    throw new Error(
      `Personalization migration does not allow symlinks: ${personalizationDirectory}`
    );
  const preferencesDocument = await readJson<unknown>(
    path.join(localRoot, "personalization", "user-preferences.json")
  );
  if (preferencesDocument !== undefined) {
    const normalized = normalizeMigratedPreferences(preferencesDocument);
    const revisionsDirectory = path.join(
      sharedRoot,
      "personalization",
      "preferences",
      "revisions"
    );
    await assertNoSymlinksWithinRoot(sharedRoot, revisionsDirectory);
    const store = new RevisionStore(
      revisionsDirectory,
      "personalization preferences",
      machineId,
      (value) => validatePreferencesDocument(value),
      revisionGuard
    );
    if (await validateSeed(store, normalized, "preferences", machineId))
      warnings.push(
        "WILL CREATE CONFLICT: personalization preferences differ from the shared revision."
      );
  }

  for (const profileId of await directoryNames(
    path.join(localRoot, "people")
  )) {
    const profileDocument = await readJson<unknown>(
      path.join(localRoot, "people", profileId, "profile.json")
    );
    if (profileDocument !== undefined) {
      const profile = validatePersonProfileDocument(profileDocument, profileId);
      const revisionsDirectory = path.join(
        sharedRoot,
        "people",
        profileId,
        "revisions"
      );
      await assertNoSymlinksWithinRoot(sharedRoot, revisionsDirectory);
      const store = new RevisionStore(
        revisionsDirectory,
        `person profile ${profileId}`,
        machineId,
        (value) => validatePersonProfileDocument(value, profileId),
        revisionGuard
      );
      if (
        await validateSeed(
          store,
          profile,
          `person profile ${profileId}`,
          machineId
        )
      )
        warnings.push(
          `WILL CREATE CONFLICT: person profile ${profileId} differs from the shared revision.`
        );
    }
    await validateNdjson(
      path.join(localRoot, "people", profileId, "playlist-history.ndjson"),
      path.join(
        sharedRoot,
        "people",
        profileId,
        "playlist-history",
        `${machineId}.ndjson`
      ),
      "entry_id",
      false,
      machineId,
      sharedRoot,
      (value) =>
        rewriteArtifactPaths(
          value,
          path.join(artifactReferenceRoot, "artifacts"),
          path.join(sharedRoot, "artifacts"),
          path.join(localRoot, "artifacts")
        ),
      (value) =>
        rewriteSharedArtifactPaths(value, path.join(sharedRoot, "artifacts"))
    );
  }

  await validateNdjson(
    path.join(localRoot, "personalization", "interaction-log.ndjson"),
    path.join(sharedRoot, "personalization", "events", `${machineId}.ndjson`),
    "event_id",
    true,
    machineId,
    sharedRoot
  );
  await validateArtifactCollisions(
    path.join(localRoot, "artifacts"),
    path.join(sharedRoot, "artifacts"),
    sharedRoot
  );
  return warnings;
}

async function validateSeed<T>(
  store: RevisionStore<T>,
  value: T,
  name: string,
  machineId: string
): Promise<boolean> {
  const tips = await store.readTips();
  if (tips.some((revision) => stable(revision.value) === stable(value)))
    return false;
  const revisions = await store.readAll();
  if (
    revisions.some(
      (revision) =>
        revision.written_by === machineId &&
        stable(revision.value) === stable(value)
    )
  )
    return false;
  if (tips.length === 0) return false;
  if (tips.length === 1) return true;
  throw new Error(
    `Shared ${name} already has unresolved conflicts that do not include this machine's value. Resolve them before migrating.`
  );
}

async function validateNdjson(
  source: string,
  destination: string,
  idField: string,
  addEventMetadata = false,
  machineId = "local",
  sharedRoot: string,
  transform: (
    value: Record<string, unknown>
  ) => Record<string, unknown> = identityRecord,
  destinationTransform: (
    value: Record<string, unknown>
  ) => Record<string, unknown> = transform
): Promise<void> {
  if (!(await exists(source))) return;
  await assertNoSymlinksWithinRoot(sharedRoot, path.dirname(destination));
  const records = new Map<string, string>();
  await addDestinationRecords(
    records,
    destination,
    idField,
    destinationTransform
  );
  const sourceLines = ((await readText(source)) ?? "")
    .split("\n")
    .filter((line) => line.trim());
  const occurrences = new Map<string, number>();
  for (const [index, line] of sourceLines.entries()) {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`Malformed NDJSON at ${source}:${index + 1}.`);
    }
    if (addEventMetadata) {
      value = {
        ...value,
        event_id:
          typeof value.event_id === "string"
            ? value.event_id
            : deterministicId(value, occurrences),
        machine_id: machineId,
        schema_version: "schema_version" in value ? value.schema_version : 1
      };
    }
    value = transform(value);
    const id = String(value[idField] ?? "");
    if (!id) throw new Error(`Missing ${idField} at ${source}:${index + 1}.`);
    validateRecord(value, idField);
    const existing = records.get(id);
    const normalized = stable(comparisonValue(value, idField));
    if (existing && existing !== normalized)
      throw new Error(
        `Conflicting ${idField} ${id} while migrating ${source}.`
      );
    records.set(id, normalized);
  }
}

async function validateArtifactCollisions(
  source: string,
  destination: string,
  sharedRoot: string
): Promise<void> {
  if (!(await exists(source))) return;
  if ((await fs.lstat(source)).isSymbolicLink())
    throw new Error(`Artifact migration does not allow symlinks: ${source}`);
  try {
    if (!(await fs.lstat(destination)).isDirectory())
      throw new Error(
        `Shared artifact destination is not a directory: ${destination}`
      );
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Artifact migration does not allow symlinks: ${from}`);
    await assertNoSymlinksWithinRoot(sharedRoot, to);
    if (entry.isDirectory())
      await validateArtifactCollisions(from, to, sharedRoot);
    else if (entry.isFile()) {
      const target = await readBytes(to);
      if (target && hash(target) !== hash(await readBytesNoFollow(from)))
        throw new Error(`Artifact collision with different content: ${to}`);
    } else
      throw new Error(
        `Artifact migration requires regular files or directories: ${from}`
      );
  }
}

async function seedRevision<T>(
  store: RevisionStore<T>,
  value: T,
  name: string,
  machineId: string
): Promise<void> {
  const tips = await store.readTips();
  if (tips.some((revision) => stable(revision.value) === stable(value))) return;
  const revisions = await store.readAll();
  if (
    revisions.some(
      (revision) =>
        revision.written_by === machineId &&
        stable(revision.value) === stable(value)
    )
  )
    return;
  if (tips.length === 0) {
    await store.write(value, null);
    return;
  }
  if (tips.length === 1) {
    await store.importRoot(value);
    return;
  }
  throw new Error(
    `Shared ${name} already has unresolved conflicts that do not include this machine's value. Resolve them before migrating.`
  );
}

function normalizeMigratedPreferences(
  value: unknown
): ReturnType<typeof normalizePreferences> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return validatePreferencesDocument(value);
  const document = value as Record<string, unknown>;
  const defaults = normalizePreferences(null);
  let useCases: unknown = {};
  if (document.use_cases !== undefined) {
    if (
      !document.use_cases ||
      typeof document.use_cases !== "object" ||
      Array.isArray(document.use_cases)
    )
      useCases = document.use_cases;
    else
      useCases = Object.fromEntries(
        Object.entries(document.use_cases).map(([name, useCase]) => {
          if (!useCase || typeof useCase !== "object" || Array.isArray(useCase))
            return [name, useCase];
          const normalized = normalizePreferences({
            ...defaults,
            use_cases: { [name]: useCase }
          } as ReturnType<typeof normalizePreferences>);
          return [name, normalized.use_cases[name]];
        })
      );
  }
  return validatePreferencesDocument({
    ...defaults,
    ...document,
    use_cases: useCases
  });
}

async function migrateNdjson(
  source: string,
  destination: string,
  idField: string,
  machineId: string,
  addEventMetadata: boolean,
  sharedStorage: SharedStorageGuard,
  transform: (
    value: Record<string, unknown>
  ) => Record<string, unknown> = identityRecord,
  destinationTransform: (
    value: Record<string, unknown>
  ) => Record<string, unknown> = transform
): Promise<number> {
  if (!(await exists(source))) return 0;
  await assertNoSymlinksWithinRoot(
    sharedStorage.sharedRoot,
    path.dirname(destination)
  );
  const sourceLines = ((await readText(source)) ?? "")
    .split("\n")
    .filter((line) => line.trim());
  const records = new Map<string, string>();
  await addDestinationRecords(
    records,
    destination,
    idField,
    destinationTransform
  );
  let added = 0;
  const additions: string[] = [];
  const occurrences = new Map<string, number>();
  for (const [index, line] of sourceLines.entries()) {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`Malformed NDJSON at ${source}:${index + 1}.`);
    }
    if (addEventMetadata) {
      value = {
        ...value,
        event_id:
          typeof value.event_id === "string"
            ? value.event_id
            : deterministicId(value, occurrences),
        machine_id: machineId,
        schema_version: "schema_version" in value ? value.schema_version : 1
      };
    }
    value = transform(value);
    const normalized = stable(comparisonValue(value, idField));
    const id = String(value[idField] ?? "");
    if (!id) throw new Error(`Missing ${idField} at ${source}:${index + 1}.`);
    validateRecord(value, idField);
    const existing = records.get(id);
    if (existing && existing !== normalized)
      throw new Error(
        `Conflicting ${idField} ${id} while migrating ${source}.`
      );
    if (!existing) {
      records.set(id, normalized);
      additions.push(JSON.stringify(value));
      added += 1;
    }
  }
  if (additions.length > 0) {
    await sharedStorage.assertWritable();
    await ensureDirectoryWithinRoot(
      sharedStorage.sharedRoot,
      path.dirname(destination)
    );
    const directoryIdentity = await readDirectoryIdentity(
      path.dirname(destination)
    );
    await appendPrivateFile(
      destination,
      `${additions.join("\n")}\n`,
      directoryIdentity
    );
  }
  return added;
}

function addRecord(
  records: Map<string, string>,
  line: string,
  idField: string,
  file: string,
  lineNumber: number,
  transform: (
    value: Record<string, unknown>
  ) => Record<string, unknown> = identityRecord,
  expectedEventMachineId?: string
): void {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(line) as Record<string, unknown>;
  } catch {
    throw new Error(`Malformed NDJSON at ${file}:${lineNumber}.`);
  }
  value = transform(value);
  const id = String(value[idField] ?? "");
  if (!id) throw new Error(`Missing ${idField} at ${file}:${lineNumber}.`);
  validateRecord(value, idField);
  if (
    expectedEventMachineId !== undefined &&
    (value.machine_id !== expectedEventMachineId || value.schema_version !== 1)
  )
    throw new Error(
      `Shared event metadata must use machine_id ${expectedEventMachineId} and schema_version 1 at ${file}:${lineNumber}.`
    );
  const normalized = stable(comparisonValue(value, idField));
  const existing = records.get(id);
  if (existing && existing !== normalized)
    throw new Error(`Conflicting ${idField} ${id} in ${file}.`);
  records.set(id, normalized);
}

async function addDestinationRecords(
  records: Map<string, string>,
  destination: string,
  idField: string,
  transform: (value: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  const files = await ndjsonFiles(path.dirname(destination));
  for (const file of files) {
    const lines = (await readFileNoFollow(file))
      .split("\n")
      .filter((line) => line.trim());
    for (const [index, line] of lines.entries())
      addRecord(
        records,
        line,
        idField,
        file,
        index + 1,
        transform,
        idField === "event_id" ? path.basename(file, ".ndjson") : undefined
      );
  }
}

async function copyArtifacts(
  source: string,
  destination: string,
  sharedStorage: SharedStorageGuard
): Promise<number> {
  if (!(await exists(source))) return 0;
  if ((await fs.lstat(source)).isSymbolicLink())
    throw new Error(`Artifact migration does not allow symlinks: ${source}`);
  await sharedStorage.assertWritable();
  await ensureDirectoryWithinRoot(sharedStorage.sharedRoot, destination);
  let copied = 0;
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Artifact migration does not allow symlinks: ${from}`);
    await assertNoSymlinksWithinRoot(sharedStorage.sharedRoot, to);
    if (entry.isDirectory())
      copied += await copyArtifacts(from, to, sharedStorage);
    else if (entry.isFile()) {
      const sourceBytes = await readBytesNoFollow(from);
      const target = await readBytesNoFollowIfExists(to);
      if (target && hash(target) !== hash(sourceBytes))
        throw new Error(`Artifact collision with different content: ${to}`);
      if (!target) {
        await sharedStorage.assertWritable();
        await ensureDirectoryWithinRoot(
          sharedStorage.sharedRoot,
          path.dirname(to)
        );
        try {
          await fs.writeFile(to, sourceBytes, { mode: 0o600, flag: "wx" });
        } catch (error) {
          if (!hasCode(error, "EEXIST")) throw error;
          const concurrentTarget = await readBytesNoFollow(to);
          if (hash(concurrentTarget) !== hash(sourceBytes))
            throw new Error(`Artifact collision with different content: ${to}`);
          continue;
        }
        await fs.chmod(to, 0o600);
        copied += 1;
      }
    } else
      throw new Error(
        `Artifact migration requires regular files or directories: ${from}`
      );
  }
  return copied;
}

function rewriteArtifactPaths(
  value: Record<string, unknown>,
  sourceArtifactsRoot: string,
  sharedArtifactsRoot: string,
  sourceValidationRoot = sourceArtifactsRoot
): Record<string, unknown> {
  if (!Array.isArray(value.artifact_paths)) return value;
  return {
    ...value,
    artifact_paths: value.artifact_paths.map((artifactPath) => {
      if (typeof artifactPath !== "string") return artifactPath;
      const expandedPath =
        artifactPath === "~"
          ? homedir()
          : artifactPath.startsWith("~/")
            ? path.join(homedir(), artifactPath.slice(2))
            : artifactPath;
      if (!path.isAbsolute(expandedPath)) {
        const normalized = path.normalize(expandedPath);
        const relative = relativeWithin("artifacts", normalized);
        if (relative !== null) {
          const sourceValidationTarget = path.join(
            sourceValidationRoot,
            relative
          );
          const sharedTarget = path.join(sharedArtifactsRoot, relative);
          const existingTargets = [
            [path.dirname(sourceValidationRoot), sourceValidationTarget],
            [path.dirname(sharedArtifactsRoot), sharedTarget]
          ].filter(([, target]) => existsSync(target));
          if (existingTargets.length === 0)
            throw new Error(
              `Referenced artifact does not exist: ${artifactPath}`
            );
          for (const [root, target] of existingTargets) {
            assertNoSymlinkSegmentsSync(root, target);
            const stats = lstatSync(target);
            if (!stats.isFile() && !stats.isDirectory())
              throw new Error(
                `Referenced artifact must be a regular file or directory: ${artifactPath}`
              );
          }
          return normalized;
        }
        throw new Error(
          `Unportable artifact path in playlist history: ${artifactPath}`
        );
      }
      const relative =
        relativeWithin(sourceArtifactsRoot, expandedPath) ??
        relativeWithin(sharedArtifactsRoot, expandedPath);
      if (relative !== null) {
        const existingTargets = [
          [
            path.dirname(sourceValidationRoot),
            path.join(sourceValidationRoot, relative)
          ],
          [
            path.dirname(sharedArtifactsRoot),
            path.join(sharedArtifactsRoot, relative)
          ]
        ].filter(([, target]) => existsSync(target));
        if (existingTargets.length === 0)
          throw new Error(
            `Referenced artifact does not exist: ${artifactPath}`
          );
        for (const [root, target] of existingTargets) {
          assertNoSymlinkSegmentsSync(root, target);
          const stats = lstatSync(target);
          if (!stats.isFile() && !stats.isDirectory())
            throw new Error(
              `Referenced artifact must be a regular file or directory: ${artifactPath}`
            );
        }
        return path.join("artifacts", relative);
      }
      throw new Error(
        `Unportable artifact path in playlist history: ${artifactPath}`
      );
    })
  };
}

function rewriteSharedArtifactPaths(
  value: Record<string, unknown>,
  sharedArtifactsRoot: string
): Record<string, unknown> {
  return rewriteArtifactPaths(
    value,
    path.join(path.dirname(sharedArtifactsRoot), ".no-local-artifacts"),
    sharedArtifactsRoot
  );
}

function assertNoSymlinkSegmentsSync(root: string, target: string): void {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (lstatSync(current).isSymbolicLink())
      throw new Error(
        `Artifact references must not contain symlinks: ${current}`
      );
  }
}

function relativeWithin(root: string, candidate: string): string | null {
  const relative = path.relative(root, candidate);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
    ? relative
    : null;
}

function identityRecord(
  value: Record<string, unknown>
): Record<string, unknown> {
  return value;
}

function comparisonValue(
  value: Record<string, unknown>,
  idField: string
): Record<string, unknown> {
  if (idField !== "event_id") return value;
  const { machine_id, ...semanticValue } = value;
  void machine_id;
  return semanticValue;
}

function validateRecord(value: unknown, idField: string): void {
  if (idField === "event_id") validatePersonalizationEventDocument(value);
  else if (idField === "entry_id") validatePersonPlaylistRecordDocument(value);
}
function deterministicId(
  value: Record<string, unknown>,
  occurrences: Map<string, number>
): string {
  const { event_id, machine_id, schema_version, ...content } = value;
  void event_id;
  void machine_id;
  void schema_version;
  const digest = createHash("sha256")
    .update(stable(content))
    .digest("hex")
    .slice(0, 32);
  const occurrence = (occurrences.get(digest) ?? 0) + 1;
  occurrences.set(digest, occurrence);
  return `legacy-${digest}-${occurrence}`;
}
function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
async function directoryNames(directory: string): Promise<string[]> {
  try {
    if ((await fs.lstat(directory)).isSymbolicLink())
      throw new Error(`People migration does not allow symlinks: ${directory}`);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink())
        throw new Error(
          `People migration does not allow symlinks: ${path.join(directory, entry.name)}`
        );
      if (entry.isDirectory()) names.push(entry.name);
    }
    return names.sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
async function ndjsonFiles(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith(".ndjson")) continue;
      if (!entry.isFile())
        throw new Error(
          `Shared NDJSON stream must be a regular file: ${path.join(directory, entry.name)}`
        );
      files.push(path.join(directory, entry.name));
    }
    return files.sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
async function readJson<T>(file: string): Promise<T | undefined> {
  const raw = await readText(file);
  return raw === null ? undefined : (JSON.parse(raw) as T);
}
async function readBytes(file: string): Promise<Buffer | null> {
  return readBytesNoFollowIfExists(file);
}
async function readBytesNoFollow(file: string): Promise<Buffer> {
  const handle = await fs.open(
    file,
    fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW
  );
  try {
    const stats = await handle.stat();
    if (!stats.isFile())
      throw new Error(`Shared artifact destination is not a file: ${file}`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
async function readBytesNoFollowIfExists(file: string): Promise<Buffer | null> {
  try {
    return await readBytesNoFollow(file);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
async function readText(file: string): Promise<string | null> {
  try {
    const handle = await fs.open(
      file,
      fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW
    );
    try {
      if (!(await handle.stat()).isFile())
        throw new Error(`Migration source must be a regular file: ${file}`);
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
async function writeAtomic(
  file: string,
  value: string,
  sharedStorage: SharedStorageGuard
): Promise<void> {
  await sharedStorage.assertWritable();
  await ensureDirectoryWithinRoot(sharedStorage.sharedRoot, path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, value, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  await fs.rename(temporary, file);
}
function isMissing(error: unknown): boolean {
  return hasCode(error, "ENOENT");
}
function hasCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
