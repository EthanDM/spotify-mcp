import {
  SPOTIFY_API_BASE_URL,
  getSpotifyClientId,
  getSpotifyRedirectUri
} from "../config.js";
import { SpotifyOAuthClient } from "../auth/oauth.js";
import type { TokenStoreLike } from "../auth/token-store.js";
import { SpotifyApiError, SpotifyMcpError } from "../errors.js";
import type { StoredTokens } from "../types.js";
import type { FetchLike } from "./spotify-shared.js";

/**
 * Internal request client that owns auth refresh and Spotify-directed retries.
 *
 * Keeping this separate lets `SpotifyClient` stay focused on playlist behavior
 * instead of carrying transport details through every method.
 */
export class SpotifyRequestClient {
  private readonly oauthClient: SpotifyOAuthClient;

  constructor(
    private readonly tokenStore: TokenStoreLike,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.oauthClient = new SpotifyOAuthClient(
      getSpotifyClientId(),
      getSpotifyRedirectUri(),
      fetchImpl
    );
  }

  async request<T>(
    path: string,
    init: RequestInit = {},
    hasRetried = false,
    rateLimitRetriesRemaining = 2
  ): Promise<T> {
    const response = await this.send(
      path,
      init,
      hasRetried,
      rateLimitRetriesRemaining
    );
    return (await response.json()) as T;
  }

  async requestEmpty(
    path: string,
    init: RequestInit = {},
    hasRetried = false,
    rateLimitRetriesRemaining = 2
  ): Promise<void> {
    await this.send(path, init, hasRetried, rateLimitRetriesRemaining);
  }

  /**
   * Executes a Spotify request with one auth-refresh retry and bounded 429 retries.
   */
  private async send(
    path: string,
    init: RequestInit,
    hasRetried: boolean,
    rateLimitRetriesRemaining: number
  ): Promise<Response> {
    const tokens = await this.getValidTokens();

    const response = await this.fetchImpl(`${SPOTIFY_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });

    if (response.status === 401 && !hasRetried) {
      await this.refreshTokens(tokens);
      return this.send(path, init, true, rateLimitRetriesRemaining);
    }

    if (response.status === 429) {
      if (rateLimitRetriesRemaining <= 0) {
        const message = await readSpotifyError(response);
        throw new SpotifyApiError(
          message,
          response.status,
          readRetryAfter(response)
        );
      }

      const retryAfterSeconds = Number(
        response.headers.get("retry-after") || "1"
      );
      await delay(retryAfterSeconds * 1000);
      return this.send(path, init, hasRetried, rateLimitRetriesRemaining - 1);
    }

    if (!response.ok) {
      const message = await readSpotifyError(response);
      throw new SpotifyApiError(
        message,
        response.status,
        readRetryAfter(response)
      );
    }

    return response;
  }

  /**
   * Returns currently usable tokens, refreshing them shortly before expiration.
   *
   * The one-minute buffer prevents a request from starting with a token that is
   * likely to expire while the call is in flight.
   */
  private async getValidTokens(): Promise<StoredTokens> {
    const tokens = await this.tokenStore.read();

    if (!tokens) {
      throw new SpotifyMcpError(
        "Spotify is not authenticated. Run `pnpm auth` first.",
        "auth_missing_tokens"
      );
    }

    if (Date.now() < tokens.expiresAt - 60_000) {
      return tokens;
    }

    return this.refreshTokens(tokens);
  }

  /**
   * Refreshes and persists tokens so the next request path sees the same state.
   */
  private async refreshTokens(tokens: StoredTokens): Promise<StoredTokens> {
    try {
      const refreshed = await this.oauthClient.refreshAccessToken(tokens);
      await this.tokenStore.write(refreshed);
      return refreshed;
    } catch (error) {
      if (isRevokedRefreshTokenError(error)) {
        throw new SpotifyMcpError(
          "Spotify refresh token is no longer valid. Run `pnpm auth` again to re-authenticate.",
          "auth_refresh_token_revoked"
        );
      }

      throw error;
    }
  }
}

/**
 * Spotify uses `invalid_grant` when a stored refresh token has been revoked or
 * otherwise invalidated. Higher layers should surface that as a re-auth action,
 * not as a raw OAuth transport failure.
 */
function isRevokedRefreshTokenError(error: unknown): boolean {
  return (
    error instanceof SpotifyApiError &&
    error.status === 400 &&
    error.message.toLowerCase().includes("invalid_grant")
  );
}

/**
 * Extracts a useful message from Spotify's JSON error payload when present.
 */
async function readSpotifyError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: {
        message?: string;
      };
    };
    return (
      payload.error?.message ||
      `Spotify API request failed with status ${response.status}.`
    );
  } catch {
    return `Spotify API request failed with status ${response.status}.`;
  }
}

/**
 * Reads Spotify's optional backoff header as seconds.
 */
function readRetryAfter(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  return retryAfter ? Number(retryAfter) : undefined;
}

/**
 * Small async delay helper used for Spotify-directed retry backoff.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
