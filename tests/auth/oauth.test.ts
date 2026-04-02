import { describe, expect, it, vi } from "vitest";

import { SpotifyOAuthClient } from "../../src/auth/oauth.js";
import type { StoredTokens } from "../../src/types.js";

describe("SpotifyOAuthClient", () => {
  it("builds the PKCE authorize URL", () => {
    const client = new SpotifyOAuthClient(
      "client-id",
      "http://127.0.0.1:8787/callback"
    );
    const url = new URL(
      client.createAuthorizeUrl({
        codeChallenge: "challenge",
        state: "state",
        scopes: ["playlist-read-private", "playlist-modify-private"]
      })
    );

    expect(url.origin).toBe("https://accounts.spotify.com");
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("scope")).toBe(
      "playlist-read-private playlist-modify-private"
    );
  });

  it("refreshes tokens and preserves the existing refresh token if Spotify omits it", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: "new-access",
          token_type: "Bearer",
          scope: "playlist-read-private",
          expires_in: 3600
        }),
        { status: 200 }
      );
    });

    const client = new SpotifyOAuthClient(
      "client-id",
      "http://127.0.0.1:8787/callback",
      fetchMock as typeof fetch
    );
    const existing: StoredTokens = {
      accessToken: "old-access",
      refreshToken: "refresh",
      expiresAt: 1,
      scope: "playlist-read-private",
      tokenType: "Bearer"
    };

    const refreshed = await client.refreshAccessToken(existing);

    expect(refreshed.accessToken).toBe("new-access");
    expect(refreshed.refreshToken).toBe("refresh");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
