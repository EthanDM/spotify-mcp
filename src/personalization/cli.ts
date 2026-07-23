import "dotenv/config";

import { TokenStore } from "../auth/token-store.js";
import { getStorageConfig } from "../config.js";
import { SpotifyClient } from "../lib/spotify.js";
import { SharedStorageGuard } from "../storage/shared.js";
import { PersonalizationService } from "./service.js";
import { PersonalizationStore } from "./store.js";

/**
 * Small CLI entrypoint for rebuilding the personalization snapshot on demand.
 */
async function main(): Promise<void> {
  const command = process.argv[2];

  if (command !== "refresh") {
    throw new Error(
      "Unknown command. Use `pnpm personalize:refresh` to rebuild personalization state."
    );
  }

  const storage = getStorageConfig();
  const sharedStorage = storage.sharedMode
    ? new SharedStorageGuard(storage)
    : null;
  await sharedStorage?.claimMachineId();
  const spotify = new SpotifyClient(new TokenStore(storage.tokenFile));
  const personalization = new PersonalizationService(
    spotify,
    storage.sharedMode
      ? new PersonalizationStore({
          localDirectory: storage.localPersonalizationDirectory,
          sharedDirectory: storage.sharedPersonalizationDirectory,
          machineId: storage.machineId!,
          sharedMode: true,
          sharedRoot: sharedStorage!.sharedRoot,
          assertSharedWriteAvailable: () => sharedStorage!.assertWritable()
        })
      : new PersonalizationStore(storage.localPersonalizationDirectory)
  );

  const result = await personalization.refreshState({
    playlistLimit: 250,
    savedTracksLimit: 200,
    savedAlbumsLimit: 100,
    followedArtistsLimit: 100
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
