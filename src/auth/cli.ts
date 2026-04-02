import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";

import {
  DEFAULT_SCOPES,
  getSpotifyClientId,
  getSpotifyRedirectUri,
  getTokenFilePath
} from "../config.js";
import { SpotifyMcpError } from "../errors.js";
import { createPkcePair, createState } from "./pkce.js";
import { SpotifyOAuthClient } from "./oauth.js";
import { TokenStore } from "./token-store.js";

/**
 * Runs the one-time local PKCE login flow and persists the resulting tokens.
 *
 * This command is separate from the MCP server because OAuth needs an
 * interactive browser/callback exchange that does not fit the stdio tool model.
 */
async function main(): Promise<void> {
  const clientId = getSpotifyClientId();
  const redirectUri = getSpotifyRedirectUri();
  const redirect = new URL(redirectUri);

  assertSupportedRedirectUri(redirect);

  const oauthClient = new SpotifyOAuthClient(clientId, redirectUri);
  const tokenStore = new TokenStore(getTokenFilePath());
  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = createState();
  const authorizeUrl = oauthClient.createAuthorizeUrl({
    codeChallenge,
    state,
    scopes: DEFAULT_SCOPES
  });

  console.log("Open this URL in your browser and approve access:\n");
  console.log(authorizeUrl);
  console.log(`\nWaiting for callback on ${redirectUri} ...`);

  const code = await waitForAuthorizationCode(redirect, state);
  const tokens = await oauthClient.exchangeCodeForTokens(code, codeVerifier);

  await tokenStore.write(tokens);

  console.log(`Saved Spotify tokens to ${getTokenFilePath()}`);
}

/**
 * Rejects redirect URIs that would require broader network exposure than the
 * local callback flow is designed to handle.
 */
function assertSupportedRedirectUri(redirectUri: URL): void {
  const isLocalHost =
    redirectUri.hostname === "127.0.0.1" ||
    redirectUri.hostname === "localhost";

  if (redirectUri.protocol !== "http:" || !isLocalHost) {
    throw new SpotifyMcpError(
      "SPOTIFY_REDIRECT_URI must be a local http callback such as http://127.0.0.1:8787/callback.",
      "auth_invalid_redirect_uri"
    );
  }
}

/**
 * Waits for exactly one Spotify redirect and resolves with its authorization code.
 *
 * The temporary server shuts down after the first success or failure so this
 * command never lingers as a background listener.
 */
function waitForAuthorizationCode(
  redirectUri: URL,
  expectedState: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || "/", redirectUri.origin);

      if (requestUrl.pathname !== redirectUri.pathname) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");

      if (state !== expectedState) {
        response.statusCode = 400;
        response.end("Invalid state");
        server.close();
        reject(
          new SpotifyMcpError(
            "Spotify auth state mismatch.",
            "auth_state_mismatch"
          )
        );
        return;
      }

      if (error) {
        response.statusCode = 400;
        response.end(`Spotify auth failed: ${error}`);
        server.close();
        reject(
          new SpotifyMcpError(`Spotify auth failed: ${error}`, "auth_denied")
        );
        return;
      }

      if (!code) {
        response.statusCode = 400;
        response.end("Missing authorization code");
        server.close();
        reject(
          new SpotifyMcpError(
            "Spotify auth callback did not include a code.",
            "auth_missing_code"
          )
        );
        return;
      }

      response.end("Spotify auth complete. You can close this window.");
      server.close();
      resolve(code);
    });

    server.on("error", reject);

    const port = Number(redirectUri.port || 80);
    server.listen(port, redirectUri.hostname);
  });
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
