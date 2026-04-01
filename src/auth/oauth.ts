import { SPOTIFY_ACCOUNTS_BASE_URL } from "../config.js";
import { SpotifyApiError, SpotifyMcpError } from "../errors.js";
import type { StoredTokens } from "../types.js";

type FetchLike = typeof fetch;

type TokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
};

/**
 * Handles the Spotify OAuth endpoints used by both the auth CLI and the MCP server.
 */
export class SpotifyOAuthClient {
  /**
   * `clientId` and `redirectUri` are captured here so every OAuth call shares a
   * single configuration contract and tests can replace only the fetch layer.
   */
  constructor(
    private readonly clientId: string,
    private readonly redirectUri: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  /**
   * Builds the Spotify authorize URL for a local PKCE login session.
   */
  createAuthorizeUrl(input: {
    codeChallenge: string;
    state: string;
    scopes: string[];
  }): string {
    const url = new URL("/authorize", SPOTIFY_ACCOUNTS_BASE_URL);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      code_challenge_method: "S256",
      code_challenge: input.codeChallenge,
      state: input.state,
      scope: input.scopes.join(" ")
    }).toString();

    return url.toString();
  }

  /**
   * Exchanges the authorization code for the first access/refresh token pair.
   */
  async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<StoredTokens> {
    const response = await this.fetchToken({
      client_id: this.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      code_verifier: codeVerifier
    });

    return normalizeTokenResponse(response);
  }

  /**
   * Refreshes an access token while preserving the prior refresh token if Spotify
   * chooses not to return a replacement.
   */
  async refreshAccessToken(existing: StoredTokens): Promise<StoredTokens> {
    const response = await this.fetchToken({
      client_id: this.clientId,
      grant_type: "refresh_token",
      refresh_token: existing.refreshToken
    });

    return normalizeTokenResponse(response, existing.refreshToken);
  }

  /**
   * Sends a token request to Spotify Accounts.
   *
   * This method intentionally returns the raw token payload so the normalization
   * logic for initial exchange vs refresh stays in one place.
   */
  private async fetchToken(body: Record<string, string>): Promise<TokenResponse> {
    const response = await this.fetchImpl(`${SPOTIFY_ACCOUNTS_BASE_URL}/api/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new SpotifyApiError(
        `Spotify token request failed (${response.status}): ${text || response.statusText}`,
        response.status
      );
    }

    return (await response.json()) as TokenResponse;
  }
}

/**
 * Converts Spotify's token response into the persisted runtime shape.
 *
 * Refresh responses may omit `refresh_token`, so callers must supply the
 * previously stored refresh token as a fallback.
 */
function normalizeTokenResponse(
  response: TokenResponse,
  fallbackRefreshToken?: string
): StoredTokens {
  const refreshToken = response.refresh_token || fallbackRefreshToken;

  if (!refreshToken) {
    throw new SpotifyMcpError("Spotify did not return a refresh token.", "auth_missing_refresh_token");
  }

  return {
    accessToken: response.access_token,
    refreshToken,
    expiresAt: Date.now() + response.expires_in * 1000,
    scope: response.scope,
    tokenType: response.token_type
  };
}
