import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  assertNoSymlinksWithinRoot,
  ensureDirectoryWithinRoot,
  readFileNoFollow
} from "./shared.js";

type SharedAccessGuard = {
  root: string;
  assertAvailable: () => Promise<void>;
};

type DirectoryIdentity = {
  device: number;
  inode: number;
};

const INITIALIZATION_MARKER = ".spotify-mcp-initializing";

class EmptySharedRevisionDirectoryError extends Error {}

export type RevisionEnvelope<T> = {
  schema_version: 1;
  revision_id: string;
  parent_revision_ids: string[];
  written_at: string;
  written_by: string;
  value: T;
};

export type RevisionState<T> = {
  value: T;
  revisionId: string | null;
  revisionPath: string | null;
};

export class RevisionConflictError extends Error {
  constructor(
    documentName: string,
    readonly revisionIds: string[]
  ) {
    super(
      `${documentName} has conflicting revisions: ${revisionIds.join(", ")}. Resolve them with pnpm data:resolve.`
    );
  }
}

export class RevisionStore<T> {
  private readonly failedInitializationIds = new Set<string>();

  constructor(
    readonly revisionsDirectory: string,
    private readonly documentName: string,
    private readonly machineId: string,
    private readonly normalize: (value: unknown) => T,
    private readonly sharedAccessGuard: SharedAccessGuard | null = null
  ) {}

  async read(): Promise<RevisionState<T> | null> {
    const tips = await this.readTips();
    if (tips.length === 0) return null;
    if (tips.length > 1)
      throw new RevisionConflictError(
        this.documentName,
        tips.map((tip) => tip.revision_id)
      );
    return {
      value: tips[0].value,
      revisionId: tips[0].revision_id,
      revisionPath: this.getRevisionPath(tips[0].revision_id)
    };
  }

  getRevisionPath(revisionId: string): string {
    return path.join(this.revisionsDirectory, `${revisionId}.json`);
  }

  async readAll(): Promise<Array<RevisionEnvelope<T>>> {
    await this.sharedAccessGuard?.assertAvailable();
    return this.loadAll();
  }

  async readTips(): Promise<Array<RevisionEnvelope<T>>> {
    const revisions = await this.readAll();
    assertAcyclic(revisions, this.documentName);
    const parents = new Set(
      revisions.flatMap((revision) => revision.parent_revision_ids)
    );
    const tips = revisions
      .filter((revision) => !parents.has(revision.revision_id))
      .sort((a, b) => a.revision_id.localeCompare(b.revision_id));
    if (revisions.length > 0 && tips.length === 0)
      throw new Error(`${this.documentName} contains a cyclic revision graph.`);
    return tips;
  }

  async write(
    value: T,
    expectedRevisionId: string | null
  ): Promise<RevisionEnvelope<T>> {
    const tips = await this.readTipsForWrite(expectedRevisionId === null);
    const current = tips.length === 1 ? tips[0].revision_id : null;
    if (tips.length > 1)
      throw new RevisionConflictError(
        this.documentName,
        tips.map((tip) => tip.revision_id)
      );
    if (current !== expectedRevisionId)
      throw new Error(
        `${this.documentName} changed after it was read. Retry the operation before writing.`
      );
    return this.writeRevision(
      value,
      expectedRevisionId ? [expectedRevisionId] : []
    );
  }

  async resolve(
    value: T,
    parentRevisionIds: string[]
  ): Promise<RevisionEnvelope<T>> {
    const tips = await this.readTips();
    const currentIds = tips.map((tip) => tip.revision_id).sort();
    if (currentIds.join("\0") !== [...parentRevisionIds].sort().join("\0")) {
      throw new Error(
        `${this.documentName} revisions changed during conflict resolution. Run the command again.`
      );
    }
    return this.writeRevision(value, currentIds);
  }

  async importRoot(value: T): Promise<RevisionEnvelope<T>> {
    const tips = await this.readTipsForWrite(true);
    if (
      tips.some((tip) => JSON.stringify(tip.value) === JSON.stringify(value))
    ) {
      throw new Error(
        `${this.documentName} already contains this imported value.`
      );
    }
    return this.writeRevision(value, []);
  }

  private async readTipsForWrite(
    allowInitialRecovery: boolean
  ): Promise<Array<RevisionEnvelope<T>>> {
    try {
      return await this.readTips();
    } catch (error) {
      if (
        !allowInitialRecovery ||
        !(error instanceof EmptySharedRevisionDirectoryError) ||
        !(await this.recoverIncompleteInitialPublication())
      )
        throw error;
      return [];
    }
  }

  private async writeRevision(
    value: T,
    parentRevisionIds: string[]
  ): Promise<RevisionEnvelope<T>> {
    const envelope: RevisionEnvelope<T> = {
      schema_version: 1,
      revision_id: randomUUID(),
      parent_revision_ids: parentRevisionIds,
      written_at: new Date().toISOString(),
      written_by: this.machineId,
      value: this.normalize(value)
    };
    let initializing = false;
    if (this.sharedAccessGuard) {
      await this.sharedAccessGuard.assertAvailable();
      const directoryCreated = await ensureDirectoryWithinRoot(
        this.sharedAccessGuard.root,
        this.revisionsDirectory
      );
      if (directoryCreated) {
        await fs.writeFile(
          path.join(this.revisionsDirectory, INITIALIZATION_MARKER),
          `${JSON.stringify({
            machine_id: this.machineId,
            pid: process.pid,
            revision_id: envelope.revision_id
          })}\n`,
          { encoding: "utf8", mode: 0o600, flag: "wx" }
        );
        initializing = true;
      }
    } else {
      await fs.mkdir(this.revisionsDirectory, { recursive: true, mode: 0o700 });
    }
    try {
      const destination = path.join(
        this.revisionsDirectory,
        `${envelope.revision_id}.json`
      );
      const temporary = `${destination}.${process.pid}.tmp`;
      const directoryIdentity = this.sharedAccessGuard
        ? await readDirectoryIdentity(
            this.revisionsDirectory,
            this.documentName
          )
        : null;
      if (directoryIdentity)
        await assertDirectoryIdentity(
          this.revisionsDirectory,
          this.documentName,
          directoryIdentity
        );
      await fs.writeFile(temporary, JSON.stringify(envelope, null, 2), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
      if (directoryIdentity)
        await assertDirectoryIdentity(
          this.revisionsDirectory,
          this.documentName,
          directoryIdentity
        );
      await fs.rename(temporary, destination);
      if (directoryIdentity)
        await assertDirectoryIdentity(
          this.revisionsDirectory,
          this.documentName,
          directoryIdentity
        );
      if (initializing)
        await fs.unlink(
          path.join(this.revisionsDirectory, INITIALIZATION_MARKER)
        );
      return envelope;
    } catch (error) {
      if (initializing) this.failedInitializationIds.add(envelope.revision_id);
      throw error;
    }
  }

  private async recoverIncompleteInitialPublication(): Promise<boolean> {
    if (!this.sharedAccessGuard) return false;
    await this.sharedAccessGuard.assertAvailable();
    const observed = await assertNoSymlinksWithinRoot(
      this.sharedAccessGuard.root,
      this.revisionsDirectory
    );
    if (!observed) return false;
    const identity = await readDirectoryIdentity(
      this.revisionsDirectory,
      this.documentName
    );
    const entries = await fs.readdir(this.revisionsDirectory, {
      withFileTypes: true
    });
    await assertDirectoryIdentity(
      this.revisionsDirectory,
      this.documentName,
      identity
    );
    const markerEntry = entries.find(
      (entry) => entry.name === INITIALIZATION_MARKER
    );
    if (
      !markerEntry ||
      entries.some(
        (entry) =>
          !entry.isFile() ||
          (entry.name !== INITIALIZATION_MARKER && !entry.name.endsWith(".tmp"))
      )
    )
      return false;
    let marker: {
      machine_id?: unknown;
      pid?: unknown;
      revision_id?: unknown;
    };
    try {
      marker = JSON.parse(
        await readFileNoFollow(
          path.join(this.revisionsDirectory, INITIALIZATION_MARKER)
        )
      ) as typeof marker;
    } catch {
      return false;
    }
    if (
      marker.machine_id !== this.machineId ||
      typeof marker.pid !== "number" ||
      typeof marker.revision_id !== "string" ||
      (marker.pid === process.pid
        ? !this.failedInitializationIds.has(marker.revision_id)
        : isProcessAlive(marker.pid))
    )
      return false;
    for (const entry of entries) {
      await assertDirectoryIdentity(
        this.revisionsDirectory,
        this.documentName,
        identity
      );
      await fs.unlink(path.join(this.revisionsDirectory, entry.name));
    }
    await assertDirectoryIdentity(
      this.revisionsDirectory,
      this.documentName,
      identity
    );
    await fs.rmdir(this.revisionsDirectory);
    this.failedInitializationIds.delete(marker.revision_id);
    return true;
  }

  private async loadAll(): Promise<Array<RevisionEnvelope<T>>> {
    const revisionsDirectoryObserved = this.sharedAccessGuard
      ? await assertNoSymlinksWithinRoot(
          this.sharedAccessGuard.root,
          this.revisionsDirectory
        )
      : false;
    const directoryIdentity = revisionsDirectoryObserved
      ? await readDirectoryIdentity(this.revisionsDirectory, this.documentName)
      : null;
    let names: string[];
    try {
      const entries = await fs.readdir(this.revisionsDirectory, {
        withFileTypes: true
      });
      if (directoryIdentity)
        await assertDirectoryIdentity(
          this.revisionsDirectory,
          this.documentName,
          directoryIdentity
        );
      names = [];
      for (const entry of entries) {
        if (!entry.name.endsWith(".json")) continue;
        if (!entry.isFile())
          throw new Error(
            `Revision must be a regular file: ${path.join(this.revisionsDirectory, entry.name)}`
          );
        names.push(entry.name);
      }
      names.sort();
      if (this.sharedAccessGuard && names.length === 0)
        throw new EmptySharedRevisionDirectoryError(
          `${this.documentName} has an empty shared revision directory. Retry after shared storage finishes syncing.`
        );
    } catch (error) {
      if (isMissing(error)) {
        await this.sharedAccessGuard?.assertAvailable();
        if (revisionsDirectoryObserved)
          throw new Error(
            `${this.documentName} shared revisions disappeared after validation. Retry after shared storage finishes syncing.`
          );
        return [];
      }
      throw error;
    }
    const revisions = await Promise.all(
      names.map(async (name) => {
        const filePath = path.join(this.revisionsDirectory, name);
        if (directoryIdentity)
          await assertDirectoryIdentity(
            this.revisionsDirectory,
            this.documentName,
            directoryIdentity
          );
        const raw = JSON.parse(await readFileNoFollow(filePath)) as Partial<
          RevisionEnvelope<unknown>
        >;
        if (directoryIdentity)
          await assertDirectoryIdentity(
            this.revisionsDirectory,
            this.documentName,
            directoryIdentity
          );
        if (
          raw.schema_version !== 1 ||
          typeof raw.revision_id !== "string" ||
          raw.revision_id.length === 0 ||
          `${raw.revision_id}.json` !== name ||
          !Array.isArray(raw.parent_revision_ids) ||
          raw.parent_revision_ids.some(
            (parent) => typeof parent !== "string" || parent.length === 0
          ) ||
          typeof raw.written_at !== "string" ||
          typeof raw.written_by !== "string"
        ) {
          throw new Error(`Invalid revision envelope: ${filePath}`);
        }
        return {
          ...raw,
          value: this.normalize(raw.value)
        } as RevisionEnvelope<T>;
      })
    );
    const ids = new Set(revisions.map((revision) => revision.revision_id));
    if (ids.size !== revisions.length)
      throw new Error(`${this.documentName} contains duplicate revision IDs.`);
    return revisions;
  }
}

async function readDirectoryIdentity(
  directory: string,
  documentName: string
): Promise<DirectoryIdentity> {
  const stats = await fs.lstat(directory);
  if (!stats.isDirectory())
    throw new Error(
      `${documentName} shared revisions path is not a directory: ${directory}`
    );
  return { device: stats.dev, inode: stats.ino };
}

async function assertDirectoryIdentity(
  directory: string,
  documentName: string,
  expected: DirectoryIdentity
): Promise<void> {
  const actual = await readDirectoryIdentity(directory, documentName);
  if (actual.device !== expected.device || actual.inode !== expected.inode)
    throw new Error(
      `${documentName} shared revisions directory changed during read. Retry after shared storage finishes syncing.`
    );
}

function assertAcyclic<T>(
  revisions: Array<RevisionEnvelope<T>>,
  documentName: string
): void {
  const byId = new Map(
    revisions.map((revision) => [revision.revision_id, revision])
  );
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id))
      throw new Error(`${documentName} contains a cyclic revision graph.`);
    if (visited.has(id)) return;
    active.add(id);
    for (const parent of byId.get(id)?.parent_revision_ids ?? [])
      if (byId.has(parent)) visit(parent);
    active.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}
