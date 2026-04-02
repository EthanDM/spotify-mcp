import "dotenv/config";
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

/**
 * Returns the Spotify OAuth client ID from the local environment.
 *
 * The auth CLI and MCP server share this single source of truth so both paths
 * fail with the same actionable setup error instead of drifting into separate
 * setup contracts.
 */
export function getSpotifyClientId(): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();

  if (!clientId) {
    throw new Error("Missing SPOTIFY_CLIENT_ID in the environment.");
  }

  return clientId;
}

/**
 * Returns the redirect URI used for the local PKCE callback server.
 *
 * Keeping this in config allows the auth CLI and OAuth refresh path to agree on
 * the same redirect URI without threading it through every call site.
 */
export function getSpotifyRedirectUri(): string {
  return process.env.SPOTIFY_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
}

/**
 * Returns the on-disk token location.
 *
 * Token material lives outside the repo so a normal development workflow cannot
 * accidentally commit Spotify credentials.
 */
export function getTokenFilePath(): string {
  return path.join(homedir(), ".config", "spotify-mcp", "auth.json");
}

/**
 * Returns the directory used for personalization state files.
 *
 * Personalization data stays outside the repo because it is user-specific
 * runtime state, not source-controlled application data.
 */
export function getPersonalizationDirectoryPath(): string {
  return path.join(homedir(), ".config", "spotify-mcp", "personalization");
}
