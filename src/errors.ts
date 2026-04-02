/**
 * Domain error for local guardrails and configuration failures that originate in
 * this project rather than from Spotify's HTTP API.
 */
export class SpotifyMcpError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "SpotifyMcpError";
  }
}

/**
 * HTTP-layer error from Spotify.
 *
 * The optional retry delay is kept on the error so higher layers can choose to
 * surface or honor Spotify's backoff guidance.
 */
export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

/**
 * Produces a user-facing error message that is safe to return through MCP text
 * responses without exposing stack traces.
 */
export function formatErrorMessage(error: unknown): string {
  if (error instanceof SpotifyMcpError || error instanceof SpotifyApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}
