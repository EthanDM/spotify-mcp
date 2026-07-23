import "dotenv/config";
import { createHash } from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { getStorageConfig } from "../config.js";
import { normalizePreferences } from "../personalization/store.js";
import { RevisionStore } from "../storage/revisions.js";
import {
  appendPrivateFile,
  assertNoSymlinksWithinRoot,
  ensureDirectoryWithinRoot,
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
  plan.lines.push(
    ...(await validateMigration(
      config.localRoot,
      config.sharedRoot,
      config.machineId
    ))
  );
  process.stdout.write(
    `${apply ? "Applying" : "Dry run"} Spotify MCP shared-data migration\n${plan.lines.join("\n")}\n`
  );
  process.stdout.write(
    "Local auth.json, snapshots, generated contexts, .env, and runtime configuration are excluded.\n"
  );
  if (!apply) {
    process.stdout.write(
      "No files changed. Re-run with --apply after reviewing this plan.\n"
    );
    return;
  }

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
    config.localRoot,
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
    await seedRevision(store, preferences, "preferences");
    counts.preferences = 1;
  }

  for (const profileId of await directoryNames(
    path.join(config.localRoot, "people")
  )) {
    const source = path.join(
      config.localRoot,
      "people",
      profileId,
      "profile.json"
    );
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
      await seedRevision(store, profile, `person profile ${profileId}`);
      counts.profiles += 1;
    }
    counts.playlist_history += await migrateNdjson(
      path.join(
        config.localRoot,
        "people",
        profileId,
        "playlist-history.ndjson"
      ),
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
          path.join(config.sharedRoot!, "artifacts")
        )
    );
  }
  counts.events = await migrateNdjson(
    path.join(config.localRoot, "personalization", "interaction-log.ndjson"),
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
  counts.artifacts = await copyArtifacts(
    path.join(config.localRoot, "artifacts"),
    path.join(config.sharedRoot, "artifacts"),
    sharedStorage
  );

  const manifest = {
    schema_version: 1,
    migrated_at: new Date().toISOString(),
    machine_id: config.machineId,
    counts,
    source_hashes: await buildSourceHashes(config.localRoot)
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
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) await collectHashes(child, root, hashes);
    else if (
      entry.isFile() &&
      !entry.name.endsWith("context.md") &&
      entry.name !== "profile-snapshot.json"
    ) {
      hashes[path.relative(root, child)] = hash(await fs.readFile(child));
    }
  }
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
  machineId: string
): Promise<string[]> {
  const warnings: string[] = [];
  const preferencesDocument = await readJson<unknown>(
    path.join(localRoot, "personalization", "user-preferences.json")
  );
  if (preferencesDocument !== undefined) {
    const normalized = normalizeMigratedPreferences(preferencesDocument);
    const store = new RevisionStore(
      path.join(sharedRoot, "personalization", "preferences", "revisions"),
      "personalization preferences",
      machineId,
      (value) => validatePreferencesDocument(value)
    );
    if (await validateSeed(store, normalized, "preferences"))
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
      const store = new RevisionStore(
        path.join(sharedRoot, "people", profileId, "revisions"),
        `person profile ${profileId}`,
        machineId,
        (value) => validatePersonProfileDocument(value, profileId)
      );
      if (await validateSeed(store, profile, `person profile ${profileId}`))
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
      (value) =>
        rewriteArtifactPaths(
          value,
          path.join(localRoot, "artifacts"),
          path.join(sharedRoot, "artifacts")
        )
    );
  }

  await validateNdjson(
    path.join(localRoot, "personalization", "interaction-log.ndjson"),
    path.join(sharedRoot, "personalization", "events", `${machineId}.ndjson`),
    "event_id",
    true,
    machineId
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
  name: string
): Promise<boolean> {
  const revisions = await store.readAll();
  if (revisions.some((revision) => stable(revision.value) === stable(value)))
    return false;
  const tips = await store.readTips();
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
  transform: (
    value: Record<string, unknown>
  ) => Record<string, unknown> = identityRecord
): Promise<void> {
  if (!(await exists(source))) return;
  const records = new Map<string, string>();
  await addDestinationRecords(records, destination, idField, transform);
  const sourceLines = (await fs.readFile(source, "utf8"))
    .split("\n")
    .filter((line) => line.trim());
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
            : deterministicId(value),
        machine_id:
          typeof value.machine_id === "string" ? value.machine_id : machineId,
        schema_version: 1
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
      if (target && hash(target) !== hash(await fs.readFile(from)))
        throw new Error(`Artifact collision with different content: ${to}`);
    }
  }
}

async function seedRevision<T>(
  store: RevisionStore<T>,
  value: T,
  name: string
): Promise<void> {
  const revisions = await store.readAll();
  if (revisions.some((revision) => stable(revision.value) === stable(value)))
    return;
  const tips = await store.readTips();
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
  ) => Record<string, unknown> = identityRecord
): Promise<number> {
  if (!(await exists(source))) return 0;
  const sourceLines = (await fs.readFile(source, "utf8"))
    .split("\n")
    .filter((line) => line.trim());
  const records = new Map<string, string>();
  await addDestinationRecords(records, destination, idField, transform);
  let added = 0;
  const additions: string[] = [];
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
            : deterministicId(value),
        machine_id:
          typeof value.machine_id === "string" ? value.machine_id : machineId,
        schema_version: 1
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
    await appendPrivateFile(destination, `${additions.join("\n")}\n`);
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
  ) => Record<string, unknown> = identityRecord
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
    const lines = (await fs.readFile(file, "utf8"))
      .split("\n")
      .filter((line) => line.trim());
    for (const [index, line] of lines.entries())
      addRecord(records, line, idField, file, index + 1, transform);
  }
}

async function copyArtifacts(
  source: string,
  destination: string,
  sharedStorage: SharedStorageGuard
): Promise<number> {
  if (!(await exists(source))) return 0;
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
      const sourceBytes = await fs.readFile(from);
      const target = await readBytes(to);
      if (target && hash(target) !== hash(sourceBytes))
        throw new Error(`Artifact collision with different content: ${to}`);
      if (!target) {
        await sharedStorage.assertWritable();
        await ensureDirectoryWithinRoot(
          sharedStorage.sharedRoot,
          path.dirname(to)
        );
        try {
          await fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);
        } catch (error) {
          if (!hasCode(error, "EEXIST")) throw error;
          const concurrentTarget = await fs.readFile(to);
          if (hash(concurrentTarget) !== hash(sourceBytes))
            throw new Error(`Artifact collision with different content: ${to}`);
          continue;
        }
        await fs.chmod(to, 0o600);
        copied += 1;
      }
    }
  }
  return copied;
}

function rewriteArtifactPaths(
  value: Record<string, unknown>,
  sourceArtifactsRoot: string,
  sharedArtifactsRoot: string
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
        if (relativeWithin("artifacts", normalized) !== null) return normalized;
        throw new Error(
          `Unportable artifact path in playlist history: ${artifactPath}`
        );
      }
      const relative =
        relativeWithin(sourceArtifactsRoot, expandedPath) ??
        relativeWithin(sharedArtifactsRoot, expandedPath);
      if (relative !== null) {
        if (
          !existsSync(path.join(sourceArtifactsRoot, relative)) &&
          !existsSync(path.join(sharedArtifactsRoot, relative))
        )
          throw new Error(
            `Referenced artifact does not exist: ${artifactPath}`
          );
        return path.join("artifacts", relative);
      }
      throw new Error(
        `Unportable artifact path in playlist history: ${artifactPath}`
      );
    })
  };
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
function deterministicId(value: Record<string, unknown>): string {
  const { event_id, machine_id, schema_version, ...content } = value;
  void event_id;
  void machine_id;
  void schema_version;
  return `legacy-${createHash("sha256").update(stable(content)).digest("hex").slice(0, 32)}`;
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
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
async function ndjsonFiles(directory: string): Promise<string[]> {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ndjson"))
      .map((entry) => path.join(directory, entry.name))
      .sort();
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
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
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
  await fs.writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
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
