import fs from "node:fs/promises";
import path from "node:path";

import type {
  PersonPlaylistRecord,
  PersonProfile,
  PersonProfileContextResult
} from "./types.js";

const PROFILE_FILE = "profile.json";
const PLAYLIST_HISTORY_FILE = "playlist-history.ndjson";
const CONTEXT_FILE = "profile-context.md";

/**
 * Local file store for saved friend/family listener profiles.
 *
 * Each profile gets its own directory so the canonical profile, generated
 * context, and playlist history can evolve together without cross-profile drift.
 */
export class PeopleStore {
  constructor(private readonly directoryPath: string) {}

  /**
   * Absolute path to the root directory that contains all saved profiles.
   */
  get basePath(): string {
    return this.directoryPath;
  }

  /**
   * Absolute path to one profile directory.
   */
  getProfileDirectoryPath(profileId: string): string {
    return path.join(this.directoryPath, profileId);
  }

  /**
   * Absolute path to one canonical profile JSON file.
   */
  getProfilePath(profileId: string): string {
    return path.join(this.getProfileDirectoryPath(profileId), PROFILE_FILE);
  }

  /**
   * Absolute path to one append-only playlist history file.
   */
  getPlaylistHistoryPath(profileId: string): string {
    return path.join(
      this.getProfileDirectoryPath(profileId),
      PLAYLIST_HISTORY_FILE
    );
  }

  /**
   * Absolute path to one generated profile-facing context summary.
   */
  getContextPath(profileId: string): string {
    return path.join(this.getProfileDirectoryPath(profileId), CONTEXT_FILE);
  }

  async profileExists(profileId: string): Promise<boolean> {
    try {
      await fs.access(this.getProfilePath(profileId));
      return true;
    } catch (error) {
      if (isMissingFile(error)) {
        return false;
      }

      throw error;
    }
  }

  async listProfileIds(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.directoryPath, {
        withFileTypes: true
      });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }

      throw error;
    }
  }

  async readProfile(profileId: string): Promise<PersonProfile | null> {
    return this.readJsonFile<PersonProfile>(this.getProfilePath(profileId));
  }

  async readAllProfiles(): Promise<PersonProfile[]> {
    const ids = await this.listProfileIds();
    const profiles = await Promise.all(ids.map((id) => this.readProfile(id)));
    return profiles.filter(
      (profile): profile is PersonProfile => profile !== null
    );
  }

  async writeProfile(profile: PersonProfile): Promise<void> {
    await this.ensureProfileDirectory(profile.id);
    const filePath = this.getProfilePath(profile.id);
    await fs.writeFile(filePath, JSON.stringify(profile, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    await fs.chmod(filePath, 0o600);
  }

  async readPlaylistHistory(
    profileId: string
  ): Promise<PersonPlaylistRecord[]> {
    try {
      const raw = await fs.readFile(
        this.getPlaylistHistoryPath(profileId),
        "utf8"
      );
      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PersonPlaylistRecord);
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }

      throw error;
    }
  }

  async appendPlaylistRecord(
    profileId: string,
    record: PersonPlaylistRecord
  ): Promise<void> {
    await this.ensureProfileDirectory(profileId);
    const filePath = this.getPlaylistHistoryPath(profileId);
    await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
    await fs.chmod(filePath, 0o600).catch(() => undefined);
  }

  async countPlaylistHistory(profileId: string): Promise<number> {
    const history = await this.readPlaylistHistory(profileId);
    return history.length;
  }

  async readContext(
    profileId: string
  ): Promise<PersonProfileContextResult | null> {
    try {
      const context = await fs.readFile(this.getContextPath(profileId), "utf8");
      return {
        profile_id: profileId,
        context,
        context_path: this.getContextPath(profileId),
        rebuilt_at: readContextRebuiltAt(context)
      };
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }

      throw error;
    }
  }

  async writeContext(profileId: string, context: string): Promise<void> {
    await this.ensureProfileDirectory(profileId);
    const filePath = this.getContextPath(profileId);
    await fs.writeFile(filePath, context, {
      encoding: "utf8",
      mode: 0o600
    });
    await fs.chmod(filePath, 0o600);
  }

  private async ensureProfileDirectory(profileId: string): Promise<void> {
    await fs.mkdir(this.getProfileDirectoryPath(profileId), {
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
}

function readContextRebuiltAt(context: string): string | null {
  const match = context.match(/^Rebuilt: (.+)$/m);
  return match?.[1] ?? null;
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
