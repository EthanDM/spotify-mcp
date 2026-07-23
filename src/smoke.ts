import "dotenv/config";

import { getStorageConfig } from "./config.js";
import { TokenStore } from "./auth/token-store.js";
import { SpotifyClient } from "./lib/spotify.js";
import { SharedStorageGuard } from "./storage/shared.js";
import type { TrackResult } from "./types.js";

/**
 * Runs a real-account smoke pass against the local Spotify MCP client surface.
 *
 * The script is intentionally imperative and visible about its side effects:
 * it creates temporary playlists because Spotify's Web API does not offer
 * playlist deletion for cleanup after the run.
 */
async function main(): Promise<void> {
  const storage = getStorageConfig();
  const sharedStorage = storage.sharedMode
    ? new SharedStorageGuard(storage)
    : null;
  await sharedStorage?.claimMachineId();
  const client = new SpotifyClient(
    new TokenStore(
      storage.tokenFile,
      sharedStorage ? () => sharedStorage.assertWritable() : undefined
    )
  );
  const stamp = createTimestamp();
  const smokePrefix = `[spotify-mcp smoke ${stamp}]`;
  const verbose = process.env.SPOTIFY_SMOKE_VERBOSE === "1";

  logStep("profile");
  const profile = await client.getMyProfile();
  console.log(
    `Authenticated as ${profile.display_name ?? profile.id} (${profile.id})`
  );

  logStep("list playlists");
  const playlists = await client.listPlaylists(5, 0);
  console.log(
    `Found ${playlists.total} playlists. Top ${playlists.items.length}:`
  );
  for (const playlist of playlists.items) {
    console.log(`- ${playlist.name} (${playlist.tracks_total} tracks)`);
  }

  logStep("search tracks");
  const search = await client.searchTracks(
    process.env.SPOTIFY_SMOKE_QUERY?.trim() || "ODESZA",
    10
  );
  const seedTracks = pickUniqueTracks(search.items, 3);

  if (seedTracks.length < 3) {
    throw new Error("Smoke run needs at least 3 unique search results.");
  }

  const [trackA, trackB, trackC] = seedTracks;

  logStep("create playlists");
  const target = await client.createPlaylist({
    name: `${smokePrefix} target`,
    description: "Temporary playlist created by spotify-mcp smoke.",
    public: false
  });
  const source = await client.createPlaylist({
    name: `${smokePrefix} source`,
    description: "Temporary playlist created by spotify-mcp smoke.",
    public: false
  });

  logStep("change playlist details");
  await client.changePlaylistDetails({
    playlistId: target.id,
    name: `${smokePrefix} target updated`,
    description: "Updated by spotify-mcp smoke."
  });

  logStep("add tracks");
  await client.addPlaylistItems({
    playlistId: target.id,
    uris: [trackA.uri, trackB.uri]
  });

  logStep("replace tracks");
  await client.replacePlaylistItems({
    playlistId: target.id,
    uris: [trackC.uri, trackB.uri, trackA.uri]
  });
  await waitForPlaylistItems(
    client,
    target.id,
    10,
    3,
    "target after replace",
    verbose
  );

  logStep("clear playlist");
  await client.replacePlaylistItems({
    playlistId: target.id,
    uris: []
  });
  await waitForPlaylistItems(
    client,
    target.id,
    10,
    0,
    "target after clear",
    verbose
  );

  logStep("seed dedupe and merge state");
  await client.replacePlaylistItems({
    playlistId: target.id,
    uris: [trackA.uri, trackB.uri, trackA.uri]
  });
  await client.replacePlaylistItems({
    playlistId: source.id,
    uris: [trackB.uri, trackC.uri]
  });
  await waitForPlaylistItems(
    client,
    target.id,
    10,
    3,
    "target after seed",
    verbose
  );
  await waitForPlaylistItems(
    client,
    source.id,
    10,
    2,
    "source after seed",
    verbose
  );

  logStep("dedupe playlist");
  await client.dedupePlaylist({
    playlistId: target.id
  });
  await waitForPlaylistItems(
    client,
    target.id,
    10,
    2,
    "target after dedupe",
    verbose
  );

  logStep("merge playlists");
  await client.mergePlaylists({
    targetPlaylistId: target.id,
    sourcePlaylistIds: [source.id],
    dedupe: true
  });

  logStep("reorder tracks");
  const mergedItems = await waitForPlaylistItems(
    client,
    target.id,
    10,
    3,
    "target after merge",
    verbose
  );
  if (mergedItems.items.length >= 2) {
    await client.reorderPlaylistItems({
      playlistId: target.id,
      rangeStart: mergedItems.items.length - 1,
      insertBefore: 0
    });
  }
  await waitForPlaylistItems(
    client,
    target.id,
    10,
    3,
    "target after reorder",
    verbose
  );

  logStep("remove track");
  const removableItems = await waitForPlaylistItems(
    client,
    target.id,
    10,
    1,
    "target before remove",
    verbose
  );
  const removableTrackUri = removableItems.items
    .map((item) => item.track?.uri)
    .find((uri) => typeof uri === "string");

  if (!removableTrackUri) {
    throw new Error(
      "Smoke run could not find a track URI to remove from the merged playlist."
    );
  }

  await client.removePlaylistItems({
    playlistId: target.id,
    uris: [removableTrackUri]
  });

  logStep("clone playlist");
  const clone = await client.clonePlaylist({
    sourcePlaylistId: target.id,
    name: `${smokePrefix} clone`,
    public: false
  });

  logStep("final state");
  const targetItems = await client.getPlaylistItems(target.id, 20, 0);
  const sourceItems = await client.getPlaylistItems(source.id, 20, 0);
  const cloneItems = await client.getPlaylistItems(clone.id, 20, 0);

  console.log("");
  console.log("Smoke run completed.");
  console.log("Created playlists:");
  console.log(
    `- target: ${target.name} (${target.id}) -> ${targetItems.total} tracks`
  );
  console.log(
    `- source: ${source.name} (${source.id}) -> ${sourceItems.total} tracks`
  );
  console.log(
    `- clone: ${clone.name} (${clone.id}) -> ${cloneItems.total} tracks`
  );
  console.log("");
  console.log(
    "Spotify does not expose playlist deletion via this client, so remove these manually when done."
  );
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * The smoke run needs distinct URIs so merge/dedupe/reorder assertions are meaningful.
 */
function pickUniqueTracks(tracks: TrackResult[], count: number): TrackResult[] {
  const seen = new Set<string>();
  const unique: TrackResult[] = [];

  for (const track of tracks) {
    if (seen.has(track.uri)) {
      continue;
    }

    seen.add(track.uri);
    unique.push(track);

    if (unique.length === count) {
      return unique;
    }
  }

  return unique;
}

function logStep(name: string): void {
  console.log(`\n[smoke] ${name}`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke run failed: ${message}`);
  process.exitCode = 1;
});

/**
 * Spotify can lag briefly after replace/merge mutations, so the smoke run
 * polls for visible playlist items before attempting reorder/remove steps.
 */
async function waitForPlaylistItems(
  client: SpotifyClient,
  playlistId: string,
  limit: number,
  minimumCount: number,
  label: string,
  verbose: boolean
): Promise<Awaited<ReturnType<SpotifyClient["getPlaylistItems"]>>> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [playlist, items] = await Promise.all([
      client.getPlaylist(playlistId),
      client.getPlaylistItems(playlistId, limit, 0)
    ]);
    const resolvedUris = items.items
      .map((item) => item.track?.uri)
      .filter((uri): uri is string => typeof uri === "string");

    if (verbose) {
      console.log(
        `[smoke] ${label} attempt ${attempt + 1}: summary=${playlist.tracks_total} visible=${items.items.length} resolved=${resolvedUris.length}`
      );
      console.log(
        `[smoke] ${label} uris: ${items.items.map((item) => item.track?.uri ?? "null").join(", ")}`
      );
    }

    if (resolvedUris.length >= minimumCount) {
      return items;
    }

    await delay(500);
  }

  return client.getPlaylistItems(playlistId, limit, 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
