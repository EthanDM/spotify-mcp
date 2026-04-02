import fs from "node:fs/promises";
import path from "node:path";

import type {
  PersonalizationContextResult,
  PersonalizationEvent,
  PersonalizationPreferences,
  PersonalizationSnapshot
} from "./types.js";

const SNAPSHOT_FILE = "profile-snapshot.json";
const PREFERENCES_FILE = "user-preferences.json";
const INTERACTION_LOG_FILE = "interaction-log.ndjson";
const CONTEXT_FILE = "personalization-context.md";

/**
 * Local file store for personalization state.
 *
 * All files live under one user-scoped directory so refreshes, feedback, and
 * agent reads can share the same state without mixing it into the repo.
 */
export class PersonalizationStore {
  constructor(private readonly directoryPath: string) {}

  /**
   * Absolute path to the persisted Spotify-derived snapshot file.
   */
  get snapshotPath(): string {
    return path.join(this.directoryPath, SNAPSHOT_FILE);
  }

  /**
   * Absolute path to the persisted explicit-preferences file.
   */
  get preferencesPath(): string {
    return path.join(this.directoryPath, PREFERENCES_FILE);
  }

  /**
   * Absolute path to the append-only interaction log.
   */
  get interactionLogPath(): string {
    return path.join(this.directoryPath, INTERACTION_LOG_FILE);
  }

  /**
   * Absolute path to the generated agent-facing summary.
   */
  get contextPath(): string {
    return path.join(this.directoryPath, CONTEXT_FILE);
  }

  async readSnapshot(): Promise<PersonalizationSnapshot | null> {
    return this.readJsonFile<PersonalizationSnapshot>(this.snapshotPath);
  }

  async writeSnapshot(snapshot: PersonalizationSnapshot): Promise<void> {
    await this.ensureDirectory();
    await fs.writeFile(this.snapshotPath, JSON.stringify(snapshot, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    await fs.chmod(this.snapshotPath, 0o600);
  }

  /**
   * Preferences default to a valid empty state so callers do not need a first-run branch.
   */
  async readPreferences(): Promise<PersonalizationPreferences> {
    return (
      (await this.readJsonFile<PersonalizationPreferences>(
        this.preferencesPath
      )) ?? {
        preferred_artists: [],
        avoided_artists: [],
        preferred_genres: [],
        avoided_genres: [],
        discovery_level: null,
        notes: [],
        updated_at: null
      }
    );
  }

  async writePreferences(
    preferences: PersonalizationPreferences
  ): Promise<void> {
    await this.ensureDirectory();
    await fs.writeFile(
      this.preferencesPath,
      JSON.stringify(preferences, null, 2),
      {
        encoding: "utf8",
        mode: 0o600
      }
    );
    await fs.chmod(this.preferencesPath, 0o600);
  }

  async appendEvent(event: PersonalizationEvent): Promise<void> {
    await this.ensureDirectory();
    await fs.appendFile(
      this.interactionLogPath,
      `${JSON.stringify(event)}\n`,
      "utf8"
    );
    await fs.chmod(this.interactionLogPath, 0o600).catch(() => undefined);
  }

  async countEvents(): Promise<number> {
    const events = await this.readAllEvents();
    return events.length;
  }

  async readRecentEvents(limit: number): Promise<PersonalizationEvent[]> {
    const events = await this.readAllEvents();
    return events.slice(-limit);
  }

  async readContext(): Promise<PersonalizationContextResult | null> {
    try {
      const context = await fs.readFile(this.contextPath, "utf8");
      return {
        context,
        context_path: this.contextPath,
        rebuilt_at: await this.readContextRebuiltAt(context)
      };
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }

      throw error;
    }
  }

  async writeContext(context: string): Promise<void> {
    await this.ensureDirectory();
    await fs.writeFile(this.contextPath, context, {
      encoding: "utf8",
      mode: 0o600
    });
    await fs.chmod(this.contextPath, 0o600);
  }

  private async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.directoryPath, {
      recursive: true,
      mode: 0o700
    });
  }

  private async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as T;
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }

      throw error;
    }
  }

  private async readAllEvents(): Promise<PersonalizationEvent[]> {
    try {
      const raw = await fs.readFile(this.interactionLogPath, "utf8");
      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PersonalizationEvent);
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }

      throw error;
    }
  }

  /**
   * The summary file includes its rebuild timestamp in the second line.
   */
  private async readContextRebuiltAt(context: string): Promise<string | null> {
    const match = context.match(/^Rebuilt: (.+)$/m);
    return match?.[1] ?? null;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
