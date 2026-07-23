import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { assertSharedStorageAvailable, type StorageConfig } from "../config.js";

type MachineClaim = {
  schema_version: 1;
  machine_id: string;
  installation_id: string;
  claimed_at: string;
};

export class SharedStorageGuard {
  private installationId: string | null = null;

  constructor(private readonly config: StorageConfig) {
    if (!config.sharedRoot || !config.machineId)
      throw new Error("Shared storage configuration is required.");
  }

  get sharedRoot(): string {
    return this.config.sharedRoot!;
  }

  async claimMachineId(): Promise<void> {
    await assertSharedStorageAvailable(this.config);
    const installationId = await this.getInstallationId();
    const claimsDirectory = path.join(this.sharedRoot, "machines");
    await ensureDirectoryWithinRoot(this.sharedRoot, claimsDirectory);
    const claimPath = this.claimPath;
    const claim: MachineClaim = {
      schema_version: 1,
      machine_id: this.config.machineId!,
      installation_id: installationId,
      claimed_at: new Date().toISOString()
    };
    try {
      await fs.writeFile(claimPath, `${JSON.stringify(claim, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    await this.assertWritable();
  }

  async assertWritable(): Promise<void> {
    await assertSharedStorageAvailable(this.config);
    const installationId = await this.getInstallationId();
    await assertNoSymlinksWithinRoot(this.sharedRoot, this.claimPath);
    let claim: MachineClaim;
    try {
      claim = JSON.parse(
        await readFileNoFollow(this.claimPath)
      ) as MachineClaim;
    } catch (error) {
      if (isMissing(error))
        throw new Error(
          `Machine ID ${this.config.machineId} is not claimed in shared storage. Restart Spotify MCP while iCloud is available.`
        );
      throw error;
    }
    if (
      claim.schema_version !== 1 ||
      claim.machine_id !== this.config.machineId ||
      claim.installation_id !== installationId
    ) {
      throw new Error(
        `SPOTIFY_MCP_MACHINE_ID ${this.config.machineId} is already claimed by another installation. Choose a unique stable machine ID.`
      );
    }
  }

  private get claimPath(): string {
    return path.join(
      this.sharedRoot,
      "machines",
      `${this.config.machineId}.json`
    );
  }

  private async getInstallationId(): Promise<string> {
    if (this.installationId) return this.installationId;
    const file = path.join(this.config.localRoot, "installation-id");
    try {
      this.installationId = (await fs.readFile(file, "utf8")).trim();
    } catch (error) {
      if (!isMissing(error)) throw error;
      await fs.mkdir(this.config.localRoot, { recursive: true, mode: 0o700 });
      try {
        await fs.writeFile(file, `${randomUUID()}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx"
        });
      } catch (writeError) {
        if (!isAlreadyExists(writeError)) throw writeError;
      }
      this.installationId = (await fs.readFile(file, "utf8")).trim();
    }
    if (!this.installationId)
      throw new Error(`Invalid empty installation identity: ${file}`);
    return this.installationId;
  }
}

export async function ensureDirectoryWithinRoot(
  root: string,
  directory: string
): Promise<void> {
  const relative = path.relative(root, directory);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(
      `Shared directory escapes its configured root: ${directory}`
    );
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      await fs.mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink())
        throw new Error(
          `Shared storage path must not contain symlinks: ${current}`
        );
      if (!stats.isDirectory())
        throw new Error(`Shared storage path is not a directory: ${current}`);
    }
  }
}

export async function appendPrivateFile(
  file: string,
  value: string
): Promise<void> {
  const handle = await fs.open(
    file,
    constants.O_APPEND |
      constants.O_CREAT |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(value, "utf8");
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

export async function readFileNoFollow(file: string): Promise<string> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export async function assertNoSymlinksWithinRoot(
  root: string,
  target: string
): Promise<void> {
  const relative = path.relative(root, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`Shared path escapes its configured root: ${target}`);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error(
          `Shared storage path must not contain symlinks: ${current}`
        );
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
