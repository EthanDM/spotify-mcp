import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { RevisionStore } from "../storage/revisions.js";
import { ensureDirectoryWithinRoot } from "../storage/shared.js";
import type {
  PersonalizationContextResult,
  PersonalizationEvent,
  PersonalizationPreferences,
  PersonalizationSnapshot,
  PersonalizationUseCasePreferences
} from "./types.js";

type StoreOptions = {
  localDirectory: string;
  sharedDirectory: string;
  machineId: string;
  sharedMode: true;
  sharedRoot: string;
  assertSharedWriteAvailable: () => Promise<void>;
};

export class PersonalizationStore {
  private readonly localDirectory: string;
  private readonly sharedDirectory: string;
  private readonly machineId: string;
  private readonly sharedMode: boolean;
  private readonly sharedRoot: string | null;
  private readonly assertSharedWriteAvailable: (() => Promise<void>) | null;

  constructor(options: string | StoreOptions) {
    this.localDirectory =
      typeof options === "string" ? options : options.localDirectory;
    this.sharedDirectory =
      typeof options === "string" ? options : options.sharedDirectory;
    this.machineId = typeof options === "string" ? "local" : options.machineId;
    this.sharedMode = typeof options !== "string";
    this.sharedRoot = typeof options === "string" ? null : options.sharedRoot;
    this.assertSharedWriteAvailable =
      typeof options === "string" ? null : options.assertSharedWriteAvailable;
  }

  get snapshotPath(): string {
    return path.join(this.localDirectory, "profile-snapshot.json");
  }
  get preferencesPath(): string {
    return this.sharedMode
      ? path.join(this.sharedDirectory, "preferences", "revisions")
      : path.join(this.localDirectory, "user-preferences.json");
  }
  get interactionLogPath(): string {
    return this.sharedMode
      ? path.join(this.sharedDirectory, "events", `${this.machineId}.ndjson`)
      : path.join(this.localDirectory, "interaction-log.ndjson");
  }
  get contextPath(): string {
    return path.join(this.localDirectory, "personalization-context.md");
  }

  async getInteractionLogPaths(): Promise<string[]> {
    if (!this.sharedMode) return [this.interactionLogPath];
    return listFiles(path.join(this.sharedDirectory, "events"), ".ndjson");
  }

  async getPreferencesDocumentPath(): Promise<string> {
    if (!this.sharedMode) return this.preferencesPath;
    const state = await this.preferenceRevisions().read();
    return state?.revisionPath ?? this.preferencesPath;
  }

  async readSnapshot(): Promise<PersonalizationSnapshot | null> {
    return readJson(this.snapshotPath);
  }
  async writeSnapshot(snapshot: PersonalizationSnapshot): Promise<void> {
    await writePrivateJson(this.snapshotPath, snapshot);
  }

  async readPreferences(): Promise<PersonalizationPreferences> {
    return (await this.readPreferencesVersioned()).value;
  }

  async readPreferencesVersioned(): Promise<{
    value: PersonalizationPreferences;
    revisionId: string | null;
    revisionPath: string | null;
  }> {
    if (!this.sharedMode)
      return {
        value: normalizePreferences(await readJson(this.preferencesPath)),
        revisionId: null,
        revisionPath: this.preferencesPath
      };
    const state = await this.preferenceRevisions().read();
    return {
      value: normalizePreferences(state?.value ?? null),
      revisionId: state?.revisionId ?? null,
      revisionPath: state?.revisionPath ?? null
    };
  }

  async writePreferences(
    preferences: PersonalizationPreferences,
    expectedRevisionId: string | null = null
  ): Promise<void> {
    if (!this.sharedMode)
      return writePrivateJson(this.preferencesPath, preferences);
    await this.preferenceRevisions().write(preferences, expectedRevisionId);
  }

  async appendEvent(event: PersonalizationEvent): Promise<void> {
    const persisted = this.sharedMode
      ? {
          ...event,
          event_id: event.event_id ?? randomUUID(),
          machine_id: this.machineId,
          schema_version: 1 as const
        }
      : event;
    if (this.sharedMode) {
      await this.assertSharedWriteAvailable!();
      await ensureDirectoryWithinRoot(
        this.sharedRoot!,
        path.dirname(this.interactionLogPath)
      );
    } else {
      await fs.mkdir(path.dirname(this.interactionLogPath), {
        recursive: true,
        mode: 0o700
      });
    }
    await fs.appendFile(
      this.interactionLogPath,
      `${JSON.stringify(persisted)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
  }

  async countEvents(): Promise<number> {
    return (await this.readAllEvents()).length;
  }
  async readRecentEvents(limit: number): Promise<PersonalizationEvent[]> {
    return (await this.readAllEvents()).slice(-limit);
  }

  async readContext(): Promise<PersonalizationContextResult | null> {
    try {
      const context = await fs.readFile(this.contextPath, "utf8");
      return {
        context,
        context_path: this.contextPath,
        rebuilt_at: context.match(/^Rebuilt: (.+)$/m)?.[1] ?? null
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
  async writeContext(context: string): Promise<void> {
    await writePrivate(this.contextPath, context);
  }

  private preferenceRevisions(): RevisionStore<PersonalizationPreferences> {
    return new RevisionStore(
      this.preferencesPath,
      "personalization preferences",
      this.machineId,
      (value) =>
        normalizePreferences(value as PersonalizationPreferences | null),
      this.sharedMode
        ? {
            root: this.sharedRoot!,
            assertWritable: this.assertSharedWriteAvailable!
          }
        : null
    );
  }

  private async readAllEvents(): Promise<PersonalizationEvent[]> {
    const files = await this.getInteractionLogPaths();
    const byId = new Map<
      string,
      { event: PersonalizationEvent; raw: string }
    >();
    for (const file of files) {
      let raw: string;
      try {
        raw = await fs.readFile(file, "utf8");
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
      for (const [index, line] of raw.split("\n").entries()) {
        if (!line.trim()) continue;
        let event: PersonalizationEvent;
        try {
          event = JSON.parse(line) as PersonalizationEvent;
        } catch {
          throw new Error(
            `Malformed personalization event at ${file}:${index + 1}.`
          );
        }
        if (
          typeof event.ts !== "string" ||
          typeof event.type !== "string" ||
          typeof event.details !== "object"
        )
          throw new Error(
            `Invalid personalization event at ${file}:${index + 1}.`
          );
        const id = event.event_id ?? `legacy:${file}:${index + 1}`;
        const { machine_id: ignoredMachineId, ...semanticEvent } = event;
        void ignoredMachineId;
        const canonical = canonicalJson(semanticEvent);
        const existing = byId.get(id);
        if (existing && existing.raw !== canonical)
          throw new Error(`Conflicting personalization event ID ${id}.`);
        if (!existing) byId.set(id, { event, raw: canonical });
      }
    }
    return [...byId.values()]
      .map(({ event }) => event)
      .sort(
        (a, b) =>
          a.ts.localeCompare(b.ts) ||
          (a.event_id ?? "").localeCompare(b.event_id ?? "")
      );
  }
}

export function createEmptyUseCasePreferences(): PersonalizationUseCasePreferences {
  return {
    preferred_artists: [],
    avoided_artists: [],
    preferred_genres: [],
    avoided_genres: [],
    preferred_traits: [],
    avoided_traits: [],
    playback_mode: null,
    ideal_track_count_range: null,
    discovery_level: null,
    notes: [],
    updated_at: null
  };
}

export function normalizePreferences(
  preferences: PersonalizationPreferences | null
): PersonalizationPreferences {
  const use_cases = Object.fromEntries(
    Object.entries(preferences?.use_cases ?? {}).map(([name, value]) => [
      name,
      { ...createEmptyUseCasePreferences(), ...value }
    ])
  );
  return {
    preferred_artists: preferences?.preferred_artists ?? [],
    avoided_artists: preferences?.avoided_artists ?? [],
    preferred_genres: preferences?.preferred_genres ?? [],
    avoided_genres: preferences?.avoided_genres ?? [],
    preferred_traits: preferences?.preferred_traits ?? [],
    avoided_traits: preferences?.avoided_traits ?? [],
    discovery_level: preferences?.discovery_level ?? null,
    notes: preferences?.notes ?? [],
    use_cases,
    updated_at: preferences?.updated_at ?? null
  };
}

async function listFiles(directory: string, suffix: string): Promise<string[]> {
  try {
    return (await fs.readdir(directory))
      .filter((name) => name.endsWith(suffix))
      .sort()
      .map((name) => path.join(directory, name));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
async function writePrivateJson(file: string, value: unknown): Promise<void> {
  await writePrivate(file, JSON.stringify(value, null, 2));
}
async function writePrivate(file: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, value, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(file, 0o600);
}
function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
