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
    const tips = await this.readTips();
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
    const tips = await this.readTips();
    if (
      tips.some((tip) => JSON.stringify(tip.value) === JSON.stringify(value))
    ) {
      throw new Error(
        `${this.documentName} already contains this imported value.`
      );
    }
    return this.writeRevision(value, []);
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
    if (this.sharedAccessGuard) {
      await this.sharedAccessGuard.assertAvailable();
      await ensureDirectoryWithinRoot(
        this.sharedAccessGuard.root,
        this.revisionsDirectory
      );
    } else {
      await fs.mkdir(this.revisionsDirectory, { recursive: true, mode: 0o700 });
    }
    const destination = path.join(
      this.revisionsDirectory,
      `${envelope.revision_id}.json`
    );
    const temporary = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(envelope, null, 2), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await fs.rename(temporary, destination);
    return envelope;
  }

  private async loadAll(): Promise<Array<RevisionEnvelope<T>>> {
    if (this.sharedAccessGuard)
      await assertNoSymlinksWithinRoot(
        this.sharedAccessGuard.root,
        this.revisionsDirectory
      );
    let names: string[];
    try {
      const entries = await fs.readdir(this.revisionsDirectory, {
        withFileTypes: true
      });
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
    } catch (error) {
      if (isMissing(error)) {
        await this.sharedAccessGuard?.assertAvailable();
        return [];
      }
      throw error;
    }
    const revisions = await Promise.all(
      names.map(async (name) => {
        const filePath = path.join(this.revisionsDirectory, name);
        const raw = JSON.parse(await readFileNoFollow(filePath)) as Partial<
          RevisionEnvelope<unknown>
        >;
        if (
          raw.schema_version !== 1 ||
          typeof raw.revision_id !== "string" ||
          raw.revision_id.length === 0 ||
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
