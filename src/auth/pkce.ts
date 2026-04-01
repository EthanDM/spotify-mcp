import { createHash, randomBytes } from "node:crypto";

/**
 * Generates a verifier/challenge pair for Spotify's PKCE flow.
 */
export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(64).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  return { codeVerifier, codeChallenge };
}

/**
 * Generates a short CSRF token for the local callback flow.
 */
export function createState(): string {
  return randomBytes(24).toString("base64url");
}
