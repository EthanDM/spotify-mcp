import fs from "node:fs/promises";
import path from "node:path";

import { RevisionStore } from "../storage/revisions.js";
import {
  validatePersonPlaylistRecordDocument,
  validatePersonProfileDocument
} from "../data/validation.js";
import {
  appendPrivateFile,
  assertNoSymlinksWithinRoot,
  ensureDirectoryWithinRoot,
  readFileNoFollow
} from "../storage/shared.js";
import type {
  PersonPlaylistRecord,
  PersonProfile,
  PersonProfileContextResult
} from "./types.js";

type StoreOptions = {
  localDirectory: string;
  sharedDirectory: string;
  machineId: string;
  sharedMode: true;
  sharedRoot: string;
  assertSharedStorageAvailable: () => Promise<void>;
};

export class PeopleStore {
  private readonly localDirectory: string;
  private readonly sharedDirectory: string;
  private readonly machineId: string;
  private readonly sharedMode: boolean;
  private readonly sharedRoot: string | null;
  private readonly assertSharedStorageAvailable: (() => Promise<void>) | null;

  constructor(options: string | StoreOptions) {
    this.localDirectory =
      typeof options === "string" ? options : options.localDirectory;
    this.sharedDirectory =
      typeof options === "string" ? options : options.sharedDirectory;
    this.machineId = typeof options === "string" ? "local" : options.machineId;
    this.sharedMode = typeof options !== "string";
    this.sharedRoot = typeof options === "string" ? null : options.sharedRoot;
    this.assertSharedStorageAvailable =
      typeof options === "string" ? null : options.assertSharedStorageAvailable;
  }

  get basePath(): string {
    return this.sharedDirectory;
  }
  getProfileDirectoryPath(profileId: string): string {
    return path.join(this.sharedDirectory, profileId);
  }
  getProfilePath(profileId: string): string {
    return this.sharedMode
      ? path.join(this.getProfileDirectoryPath(profileId), "revisions")
      : path.join(this.getProfileDirectoryPath(profileId), "profile.json");
  }
  getPlaylistHistoryPath(profileId: string): string {
    return this.sharedMode
      ? path.join(
          this.getProfileDirectoryPath(profileId),
          "playlist-history",
          `${this.machineId}.ndjson`
        )
      : path.join(
          this.getProfileDirectoryPath(profileId),
          "playlist-history.ndjson"
        );
  }
  getContextPath(profileId: string): string {
    return path.join(this.localDirectory, profileId, "profile-context.md");
  }

  async getPlaylistHistoryPaths(profileId: string): Promise<string[]> {
    if (!this.sharedMode) return [this.getPlaylistHistoryPath(profileId)];
    await this.assertSharedStorageAvailable!();
    const directoryObserved = await assertNoSymlinksWithinRoot(
      this.sharedRoot!,
      path.join(this.getProfileDirectoryPath(profileId), "playlist-history")
    );
    return listFiles(
      path.join(this.getProfileDirectoryPath(profileId), "playlist-history"),
      ".ndjson",
      this.assertSharedStorageAvailable!,
      directoryObserved
    );
  }

  async getProfileDocumentPath(profileId: string): Promise<string> {
    if (!this.sharedMode) return this.getProfilePath(profileId);
    const state = await this.profileRevisions(profileId).read();
    return state?.revisionPath ?? this.getProfilePath(profileId);
  }

  async profileExists(profileId: string): Promise<boolean> {
    return (await this.readProfile(profileId)) !== null;
  }
  async listProfileIds(): Promise<string[]> {
    return (await this.listProfileEntries()).map(({ id }) => id);
  }

  private async listProfileEntries(): Promise<
    Array<{ id: string; hadRevisionsPath: boolean }>
  > {
    if (this.sharedMode) {
      await this.assertSharedStorageAvailable!();
      await assertNoSymlinksWithinRoot(this.sharedRoot!, this.sharedDirectory);
    }
    try {
      const entries = await fs.readdir(this.sharedDirectory, {
        withFileTypes: true
      });
      const profiles: Array<{ id: string; hadRevisionsPath: boolean }> = [];
      for (const entry of entries) {
        if (entry.isSymbolicLink())
          throw new Error(
            `Shared people directory must not contain symlinks: ${path.join(this.sharedDirectory, entry.name)}`
          );
        if (!entry.isDirectory()) continue;
        let hadRevisionsPath = false;
        if (this.sharedMode) {
          try {
            await fs.lstat(this.getProfilePath(entry.name));
            hadRevisionsPath = true;
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
        }
        profiles.push({ id: entry.name, hadRevisionsPath });
      }
      return profiles.sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      if (isMissing(error)) {
        await this.assertSharedStorageAvailable?.();
        return [];
      }
      throw error;
    }
  }

  async readProfile(profileId: string): Promise<PersonProfile | null> {
    return (await this.readProfileVersioned(profileId)).value;
  }

  async readProfileVersioned(profileId: string): Promise<{
    value: PersonProfile | null;
    revisionId: string | null;
    revisionPath: string | null;
  }> {
    if (!this.sharedMode)
      return {
        value: await readJson(this.getProfilePath(profileId)),
        revisionId: null,
        revisionPath: this.getProfilePath(profileId)
      };
    const state = await this.profileRevisions(profileId).read();
    return {
      value: state?.value ?? null,
      revisionId: state?.revisionId ?? null,
      revisionPath: state?.revisionPath ?? null
    };
  }

  async readAllProfiles(): Promise<PersonProfile[]> {
    const profiles = await Promise.all(
      (await this.listProfileEntries()).map(
        async ({ id, hadRevisionsPath }) => {
          const profile = await this.readProfile(id);
          if (profile === null && this.sharedMode) {
            try {
              await fs.lstat(this.getProfileDirectoryPath(id));
            } catch (error) {
              if (isMissing(error)) {
                await this.assertSharedStorageAvailable!();
                throw new Error(
                  `Shared profile disappeared after enumeration: ${id}`
                );
              }
              throw error;
            }
            if (hadRevisionsPath) {
              await this.assertSharedStorageAvailable!();
              throw new Error(
                `Shared profile revisions disappeared after enumeration: ${id}`
              );
            }
          }
          return profile;
        }
      )
    );
    return profiles.filter(
      (profile): profile is PersonProfile => profile !== null
    );
  }

  async writeProfile(
    profile: PersonProfile,
    expectedRevisionId: string | null = null
  ): Promise<void> {
    if (!this.sharedMode) {
      await writePrivateJson(this.getProfilePath(profile.id), profile);
      return;
    }
    await this.profileRevisions(profile.id).write(profile, expectedRevisionId);
  }

  async readPlaylistHistory(
    profileId: string
  ): Promise<PersonPlaylistRecord[]> {
    const files = await this.getPlaylistHistoryPaths(profileId);
    const records = new Map<
      string,
      { value: PersonPlaylistRecord; raw: string }
    >();
    for (const file of files) {
      let raw: string;
      try {
        raw = await readFileNoFollow(file);
      } catch (error) {
        if (isMissing(error)) {
          await this.assertSharedStorageAvailable?.();
          if (!this.sharedMode) continue;
          throw new Error(
            `Shared playlist history disappeared after enumeration: ${file}`
          );
        }
        throw error;
      }
      for (const [index, line] of raw.split("\n").entries()) {
        if (!line.trim()) continue;
        let value: PersonPlaylistRecord;
        try {
          value = validatePersonPlaylistRecordDocument(JSON.parse(line));
        } catch {
          throw new Error(`Invalid playlist history at ${file}:${index + 1}.`);
        }
        const canonical = canonicalJson(value);
        const existing = records.get(value.entry_id);
        if (existing && existing.raw !== canonical)
          throw new Error(
            `Conflicting playlist history entry ID ${value.entry_id}.`
          );
        records.set(value.entry_id, { value, raw: canonical });
      }
    }
    return [...records.values()]
      .map(({ value }) => value)
      .sort(
        (a, b) =>
          a.recorded_at.localeCompare(b.recorded_at) ||
          a.entry_id.localeCompare(b.entry_id)
      );
  }

  async appendPlaylistRecord(
    profileId: string,
    record: PersonPlaylistRecord
  ): Promise<void> {
    const file = this.getPlaylistHistoryPath(profileId);
    if (this.sharedMode) {
      await this.assertSharedStorageAvailable!();
      await ensureDirectoryWithinRoot(this.sharedRoot!, path.dirname(file));
    } else {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    }
    await appendPrivateFile(file, `${JSON.stringify(record)}\n`);
  }
  async countPlaylistHistory(profileId: string): Promise<number> {
    return (await this.readPlaylistHistory(profileId)).length;
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
        rebuilt_at: context.match(/^Rebuilt: (.+)$/m)?.[1] ?? null
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
  async writeContext(profileId: string, context: string): Promise<void> {
    const contextPath = this.getContextPath(profileId);
    await this.assertSharedStorageAvailable?.();
    await assertNoSymlinksWithinRoot(this.localDirectory, contextPath);
    await writePrivate(contextPath, context);
  }

  private profileRevisions(profileId: string): RevisionStore<PersonProfile> {
    return new RevisionStore(
      this.getProfilePath(profileId),
      `person profile ${profileId}`,
      this.machineId,
      (value) => validatePersonProfileDocument(value, profileId),
      this.sharedMode
        ? {
            root: this.sharedRoot!,
            assertAvailable: this.assertSharedStorageAvailable!
          }
        : null
    );
  }
}

async function listFiles(
  directory: string,
  suffix: string,
  assertSharedStorageAvailable?: () => Promise<void>,
  directoryObserved = false
): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith(suffix)) continue;
      if (!entry.isFile())
        throw new Error(
          `Shared stream must be a regular file: ${path.join(directory, entry.name)}`
        );
      files.push(path.join(directory, entry.name));
    }
    return files.sort();
  } catch (error) {
    if (isMissing(error)) {
      await assertSharedStorageAvailable?.();
      if (directoryObserved)
        throw new Error(
          `Shared stream directory disappeared after validation: ${directory}`
        );
      return [];
    }
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
