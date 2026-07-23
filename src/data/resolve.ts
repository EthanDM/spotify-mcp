import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

import { getStorageConfig } from "../config.js";
import { normalizePreferences } from "../personalization/store.js";
import { RevisionStore } from "../storage/revisions.js";
import { SharedStorageGuard } from "../storage/shared.js";
import {
  validatePersonProfileDocument,
  validatePreferencesDocument
} from "./validation.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = getStorageConfig();
  if (!config.sharedRoot || !config.machineId)
    throw new Error("Shared storage configuration is required.");
  const sharedStorage = new SharedStorageGuard(config);
  await sharedStorage.claimMachineId();
  if (!args.document)
    throw new Error(
      "Use --document preferences or --document people/<profile-id>."
    );
  const isPreferences = args.document === "preferences";
  const profileId = args.document.startsWith("people/")
    ? args.document.slice(7)
    : null;
  if (!isPreferences && !profileId)
    throw new Error(
      "Use --document preferences or --document people/<profile-id>."
    );
  const revisionsDirectory = isPreferences
    ? path.join(
        config.sharedRoot,
        "personalization",
        "preferences",
        "revisions"
      )
    : path.join(config.sharedRoot, "people", profileId!, "revisions");
  const normalize = isPreferences
    ? (value: unknown) =>
        normalizePreferences(validatePreferencesDocument(value))
    : (value: unknown) => validatePersonProfileDocument(value, profileId!);
  const store = new RevisionStore<unknown>(
    revisionsDirectory,
    args.document,
    config.machineId,
    normalize,
    {
      root: sharedStorage.sharedRoot,
      assertWritable: () => sharedStorage.assertWritable()
    }
  );
  const tips = await store.readTips();
  process.stdout.write(
    `${JSON.stringify(
      {
        tips: tips.map(
          ({
            revision_id,
            parent_revision_ids,
            written_at,
            written_by,
            value
          }) => ({
            revision_id,
            parent_revision_ids,
            written_at,
            written_by,
            value
          })
        ),
        differences: compareTips(tips.map((tip) => tip.value))
      },
      null,
      2
    )}\n`
  );
  if (!args.apply) {
    process.stdout.write(
      "No files changed. Select --from-revision <id> or --from-file <path>, then add --apply.\n"
    );
    return;
  }
  if (tips.length < 2)
    throw new Error(
      "The document does not currently have multiple conflicting tips."
    );
  let value: unknown;
  if (args.fromRevision) {
    const selected = tips.find((tip) => tip.revision_id === args.fromRevision);
    if (!selected)
      throw new Error("--from-revision must identify a current tip.");
    value = selected.value;
  } else if (args.fromFile) {
    if (!path.isAbsolute(args.fromFile))
      throw new Error("--from-file must be absolute.");
    value = normalize(JSON.parse(await fs.readFile(args.fromFile, "utf8")));
  } else throw new Error("Resolution requires --from-revision or --from-file.");
  const revision = await store.resolve(
    value,
    tips.map((tip) => tip.revision_id)
  );
  process.stdout.write(
    `Resolved ${args.document} as revision ${revision.revision_id}. Previous revisions were preserved.\n`
  );
}

function compareTips(values: unknown[]): Record<string, unknown[]> {
  if (values.length < 2) return {};
  const flattened = values.map((value) => flattenValue(value));
  const keys = new Set(flattened.flatMap((value) => Object.keys(value)));
  return Object.fromEntries(
    [...keys]
      .sort()
      .map((key) => [key, flattened.map((value) => value[key])])
      .filter(([, candidates]) => {
        const serialized = (candidates as unknown[]).map((value) =>
          JSON.stringify(value)
        );
        return new Set(serialized).size > 1;
      })
  );
}

function flattenValue(
  value: unknown,
  prefix = "",
  result: Record<string, unknown> = {}
): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenValue(child, prefix ? `${prefix}.${key}` : key, result);
    }
  } else {
    result[prefix || "$"] = value;
  }
  return result;
}

function parseArgs(args: string[]): {
  document?: string;
  fromRevision?: string;
  fromFile?: string;
  apply: boolean;
} {
  const result: {
    document?: string;
    fromRevision?: string;
    fromFile?: string;
    apply: boolean;
  } = { apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") result.apply = true;
    else if (arg === "--document") result.document = args[++index];
    else if (arg === "--from-revision") result.fromRevision = args[++index];
    else if (arg === "--from-file") result.fromFile = args[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (result.fromRevision && result.fromFile)
    throw new Error("Choose either --from-revision or --from-file.");
  return result;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
