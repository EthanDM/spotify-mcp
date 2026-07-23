import "dotenv/config";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const SPOTIFY_ACCOUNTS_BASE_URL = "https://accounts.spotify.com";
export const SPOTIFY_API_BASE_URL = "https://api.spotify.com/v1";
export const DEFAULT_REDIRECT_URI = "http://127.0.0.1:8787/callback";
export const DEFAULT_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-library-read",
  "user-follow-read"
];

export type StorageConfig = {
  localRoot: string;
  sharedRoot: string | null;
  machineId: string | null;
  tokenFile: string;
  localPersonalizationDirectory: string;
  sharedPersonalizationDirectory: string;
  localPeopleDirectory: string;
  sharedPeopleDirectory: string;
  artifactsDirectory: string;
  sharedMode: boolean;
};

export function getSpotifyClientId(): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  if (!clientId)
    throw new Error("Missing SPOTIFY_CLIENT_ID in the environment.");
  return clientId;
}

export function getSpotifyRedirectUri(): string {
  return process.env.SPOTIFY_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
}

export function getStorageConfig(
  environment: NodeJS.ProcessEnv = process.env
): StorageConfig {
  rejectExplicitEmpty(environment, "SPOTIFY_MCP_DATA_DIR");
  rejectExplicitEmpty(environment, "SPOTIFY_MCP_SHARED_DATA_DIR");
  const localRoot = resolveConfiguredPath(
    environment.SPOTIFY_MCP_DATA_DIR,
    path.join(homedir(), ".config", "spotify-mcp"),
    "SPOTIFY_MCP_DATA_DIR"
  );
  const configuredSharedRoot = environment.SPOTIFY_MCP_SHARED_DATA_DIR?.trim();
  const sharedRoot = configuredSharedRoot
    ? resolveConfiguredPath(
        configuredSharedRoot,
        undefined,
        "SPOTIFY_MCP_SHARED_DATA_DIR"
      )
    : null;
  const machineId = environment.SPOTIFY_MCP_MACHINE_ID?.trim() || null;

  if (
    sharedRoot &&
    (isSameOrNested(localRoot, sharedRoot) ||
      isSameOrNested(sharedRoot, localRoot))
  ) {
    throw new Error(
      "SPOTIFY_MCP_SHARED_DATA_DIR and SPOTIFY_MCP_DATA_DIR must be separate, non-nested directories."
    );
  }
  if (sharedRoot && !machineId) {
    throw new Error(
      "SPOTIFY_MCP_MACHINE_ID is required when SPOTIFY_MCP_SHARED_DATA_DIR is set."
    );
  }
  if (machineId && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(machineId)) {
    throw new Error(
      "SPOTIFY_MCP_MACHINE_ID must be a lowercase slug using letters, numbers, underscores, or hyphens."
    );
  }

  return {
    localRoot,
    sharedRoot,
    machineId,
    tokenFile: path.join(localRoot, "auth.json"),
    localPersonalizationDirectory: path.join(localRoot, "personalization"),
    sharedPersonalizationDirectory: path.join(
      sharedRoot ?? localRoot,
      "personalization"
    ),
    localPeopleDirectory: path.join(localRoot, "people"),
    sharedPeopleDirectory: path.join(sharedRoot ?? localRoot, "people"),
    artifactsDirectory: path.join(sharedRoot ?? localRoot, "artifacts"),
    sharedMode: sharedRoot !== null
  };
}

export async function assertSharedStorageAvailable(
  config: StorageConfig
): Promise<void> {
  if (!config.sharedRoot) return;
  try {
    const stats = await fs.stat(config.sharedRoot);
    if (!stats.isDirectory()) throw new Error("not a directory");
    const [physicalLocalRoot, physicalSharedRoot] = await Promise.all([
      resolvePhysicalPath(config.localRoot),
      resolvePhysicalPath(config.sharedRoot)
    ]);
    if (
      isSameOrNested(physicalLocalRoot, physicalSharedRoot) ||
      isSameOrNested(physicalSharedRoot, physicalLocalRoot)
    )
      throw new Error("local and shared roots resolve to nested directories");
    await fs.access(config.sharedRoot, constants.R_OK | constants.W_OK);
  } catch (error) {
    const detail = error instanceof Error ? ` (${error.message})` : "";
    throw new Error(
      `Configured shared storage is unavailable: ${config.sharedRoot}${detail}. Ensure iCloud is mounted and the directory exists before starting Spotify MCP.`
    );
  }
}

function rejectExplicitEmpty(
  environment: NodeJS.ProcessEnv,
  name: "SPOTIFY_MCP_DATA_DIR" | "SPOTIFY_MCP_SHARED_DATA_DIR"
): void {
  if (environment[name] !== undefined && !environment[name]?.trim()) {
    throw new Error(`${name} must not be empty.`);
  }
}

export function getTokenFilePath(): string {
  return getStorageConfig().tokenFile;
}

export function getPersonalizationDirectoryPath(): string {
  return getStorageConfig().localPersonalizationDirectory;
}

export function getPeopleDirectoryPath(): string {
  return getStorageConfig().sharedPeopleDirectory;
}

export function getArtifactsDirectoryPath(): string {
  return getStorageConfig().artifactsDirectory;
}

export function getPersonArtifactsDirectoryPath(profileId: string): string {
  return path.join(getArtifactsDirectoryPath(), "people", profileId);
}

export function toPortableArtifactPath(
  artifactPath: string,
  config: StorageConfig = getStorageConfig()
): string {
  if (!config.sharedMode) return artifactPath;
  const expandedPath =
    artifactPath === "~"
      ? homedir()
      : artifactPath.startsWith("~/")
        ? path.join(homedir(), artifactPath.slice(2))
        : artifactPath;
  if (path.isAbsolute(expandedPath)) {
    if (!isSameOrNested(config.artifactsDirectory, expandedPath))
      throw new Error(
        `Shared artifact paths must be inside ${config.artifactsDirectory}.`
      );
    return path.join(
      "artifacts",
      path.relative(config.artifactsDirectory, expandedPath)
    );
  }
  const normalized = path.normalize(expandedPath);
  if (!isSameOrNested("artifacts", normalized))
    throw new Error(
      `Shared artifact paths must be relative to the shared artifacts directory.`
    );
  return normalized;
}

function resolveConfiguredPath(
  value: string | undefined,
  fallback: string | undefined,
  name: string
): string {
  const raw = value?.trim() || fallback;
  if (!raw) throw new Error(`${name} must not be empty.`);
  const expanded =
    raw === "~"
      ? homedir()
      : raw.startsWith("~/")
        ? path.join(homedir(), raw.slice(2))
        : raw;
  if (!path.isAbsolute(expanded))
    throw new Error(`${name} must be an absolute path or start with ~/.`);
  const resolved = path.resolve(expanded);
  if (resolved === path.parse(resolved).root)
    throw new Error(`${name} must not be a filesystem root.`);
  return resolved;
}

function isSameOrNested(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function resolvePhysicalPath(target: string): Promise<string> {
  const missingSegments: string[] = [];
  let existing = target;
  while (true) {
    try {
      return path.join(
        await fs.realpath(existing),
        ...missingSegments.reverse()
      );
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      missingSegments.push(path.basename(existing));
      existing = parent;
    }
  }
}
