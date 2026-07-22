import "dotenv/config";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { getStorageConfig } from "../config.js";
import { normalizePreferences } from "../personalization/store.js";
import { RevisionStore } from "../storage/revisions.js";
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
  if (preferencesDocument) {
    const preferences = validatePreferencesDocument(preferencesDocument);
    const store = new RevisionStore(
      path.join(
        config.sharedRoot,
        "personalization",
        "preferences",
        "revisions"
      ),
      "personalization preferences",
      config.machineId,
      (value) => normalizePreferences(validatePreferencesDocument(value))
    );
    await seedRevision(store, normalizePreferences(preferences), "preferences");
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
    if (profileDocument) {
      const profile = validatePersonProfileDocument(profileDocument, profileId);
      const store = new RevisionStore(
        path.join(config.sharedRoot, "people", profileId, "revisions"),
        `person profile ${profileId}`,
        config.machineId,
        (value) => validatePersonProfileDocument(value, profileId)
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
      config.machineId
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
    true
  );
  counts.artifacts = await copyArtifacts(
    path.join(config.localRoot, "artifacts"),
    path.join(config.sharedRoot, "artifacts")
  );

  const manifest = {
    schema_version: 1,
    migrated_at: new Date().toISOString(),
    machine_id: config.machineId,
    source_root: config.localRoot,
    destination_root: config.sharedRoot,
    counts,
    source_hashes: await buildSourceHashes(config.localRoot)
  };
  const manifestPath = path.join(
    config.sharedRoot,
    "migrations",
    `${config.machineId}.json`
  );
  await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
  if (preferencesDocument) {
    const preferences = validatePreferencesDocument(preferencesDocument);
    const normalized = normalizePreferences(preferences);
    const store = new RevisionStore(
      path.join(sharedRoot, "personalization", "preferences", "revisions"),
      "personalization preferences",
      machineId,
      (value) => normalizePreferences(validatePreferencesDocument(value))
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
    if (profileDocument) {
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
      "entry_id"
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
    path.join(sharedRoot, "artifacts")
  );
  return warnings;
}

async function validateSeed<T>(
  store: RevisionStore<T>,
  value: T,
  name: string
): Promise<boolean> {
  const tips = await store.readTips();
  if (tips.length === 0) return false;
  if (tips.some((tip) => stable(tip.value) === stable(value))) return false;
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
  machineId = "local"
): Promise<void> {
  if (!(await exists(source))) return;
  const records = new Map<string, string>();
  const destinationLines =
    (await readText(destination))?.split("\n").filter((line) => line.trim()) ??
    [];
  for (const [index, line] of destinationLines.entries())
    addRecord(records, line, idField, destination, index + 1);
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
            : deterministicId(source, index + 1, line),
        machine_id:
          typeof value.machine_id === "string" ? value.machine_id : machineId,
        schema_version: 1
      };
    }
    const id = String(value[idField] ?? "");
    if (!id) throw new Error(`Missing ${idField} at ${source}:${index + 1}.`);
    validateRecord(value, idField);
    const existing = records.get(id);
    const normalized = JSON.stringify(value);
    if (existing && existing !== normalized)
      throw new Error(
        `Conflicting ${idField} ${id} while migrating ${source}.`
      );
    records.set(id, normalized);
  }
}

async function validateArtifactCollisions(
  source: string,
  destination: string
): Promise<void> {
  if (!(await exists(source))) return;
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await validateArtifactCollisions(from, to);
    else if (entry.isFile()) {
      const target = await fs.readFile(to).catch(() => null);
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
  const tips = await store.readTips();
  if (tips.length === 0) {
    await store.write(value, null);
    return;
  }
  if (tips.some((tip) => stable(tip.value) === stable(value))) return;
  if (tips.length === 1) {
    await store.importRoot(value);
    return;
  }
  throw new Error(
    `Shared ${name} already has unresolved conflicts that do not include this machine's value. Resolve them before migrating.`
  );
}

async function migrateNdjson(
  source: string,
  destination: string,
  idField: string,
  machineId: string,
  addEventMetadata = false
): Promise<number> {
  if (!(await exists(source))) return 0;
  const sourceLines = (await fs.readFile(source, "utf8"))
    .split("\n")
    .filter((line) => line.trim());
  const destinationLines =
    (await readText(destination))?.split("\n").filter((line) => line.trim()) ??
    [];
  const records = new Map<string, string>();
  for (const [index, line] of destinationLines.entries())
    addRecord(records, line, idField, destination, index + 1);
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
            : deterministicId(source, index + 1, line),
        machine_id:
          typeof value.machine_id === "string" ? value.machine_id : machineId,
        schema_version: 1
      };
    }
    const normalized = JSON.stringify(value);
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
      additions.push(normalized);
      added += 1;
    }
  }
  if (additions.length > 0) {
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.appendFile(destination, `${additions.join("\n")}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  }
  return added;
}

function addRecord(
  records: Map<string, string>,
  line: string,
  idField: string,
  file: string,
  lineNumber: number
): void {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(line) as Record<string, unknown>;
  } catch {
    throw new Error(`Malformed NDJSON at ${file}:${lineNumber}.`);
  }
  const id = String(value[idField] ?? "");
  if (!id) throw new Error(`Missing ${idField} at ${file}:${lineNumber}.`);
  validateRecord(value, idField);
  const normalized = JSON.stringify(value);
  const existing = records.get(id);
  if (existing && existing !== normalized)
    throw new Error(`Conflicting ${idField} ${id} in ${file}.`);
  records.set(id, normalized);
}

async function copyArtifacts(
  source: string,
  destination: string
): Promise<number> {
  if (!(await exists(source))) return 0;
  let copied = 0;
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copied += await copyArtifacts(from, to);
    else if (entry.isFile()) {
      const sourceBytes = await fs.readFile(from);
      const target = await fs.readFile(to).catch(() => null);
      if (target && hash(target) !== hash(sourceBytes))
        throw new Error(`Artifact collision with different content: ${to}`);
      if (!target) {
        await fs.mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
        await fs.copyFile(from, to);
        await fs.chmod(to, 0o600);
        copied += 1;
      }
    }
  }
  return copied;
}

function validateRecord(value: unknown, idField: string): void {
  if (idField === "event_id") validatePersonalizationEventDocument(value);
  else if (idField === "entry_id") validatePersonPlaylistRecordDocument(value);
}
function deterministicId(file: string, line: number, content: string): string {
  return `legacy-${createHash("sha256").update(`${file}\0${line}\0${content}`).digest("hex").slice(0, 32)}`;
}
function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function stable(value: unknown): string {
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
async function readJson<T>(file: string): Promise<T | null> {
  const raw = await readText(file);
  return raw === null ? null : (JSON.parse(raw) as T);
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
async function writeAtomic(file: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, file);
}
function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
