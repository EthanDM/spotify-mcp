import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const skillsRoot = path.join(repositoryRoot, "skills");
const forbiddenFileNames = new Set([
  ".env",
  ".git-credentials",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "_netrc",
  "auth.json",
  "interaction-log.ndjson",
  "playlist-history.ndjson",
  "personalization-context.md",
  "profile.json",
  "profile-context.md",
  "profile-snapshot.json",
  "user-preferences.json"
]);
const forbiddenContent = [
  {
    label: "personal home path",
    pattern:
      /(?:\/Users\/[^/\s]+(?=\/|\s|["'`]|$)|\/home\/[^/\s]+(?=\/|\s|["'`]|$)|\/root(?=\/|\s|["'`]|$)|[A-Za-z]:\\Users\\[^\\\s]+(?=\\|\s|["'`]|$))/i
  },
  {
    label: "email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  },
  {
    label: "hardcoded artifact path",
    pattern: /~\/\.config\/spotify-mcp\/artifacts/
  },
  {
    label: "Spotify entity URI",
    pattern: /spotify:(?:track|playlist|album|artist):[A-Za-z0-9]+/
  },
  {
    label: "Spotify entity URL",
    pattern:
      /https:\/\/open\.spotify\.com\/(?:track|playlist|album|artist)\/[A-Za-z0-9]+/
  },
  {
    label: "GitHub token",
    pattern: /\b(?:gh[opusr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)\b/
  },
  {
    label: "OpenAI API key",
    pattern: /\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{20,}\b/
  },
  {
    label: "private key",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/
  },
  {
    label: "Spotify credential assignment",
    pattern:
      /SPOTIFY_(?:CLIENT_ID|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN)\s*=/i
  },
  {
    label: "AWS credential assignment",
    pattern: /(?:^|\n)\s*aws_(?:access_key_id|secret_access_key)\s*=/i
  },
  {
    label: "stored Spotify token field",
    pattern:
      /"(?:accessToken|refreshToken|access_token|refresh_token|clientSecret|client_secret)"\s*:/
  }
];

const failures = [];
for (const filePath of await listFiles(skillsRoot)) {
  const relativePath = path.relative(repositoryRoot, filePath);
  const skillRelativePath = path.relative(skillsRoot, filePath);
  const fileName = path.basename(filePath);
  const normalizedFileName = fileName.toLowerCase();
  if (
    forbiddenFileNames.has(normalizedFileName) ||
    normalizedFileName.startsWith(".env.") ||
    isForbiddenRuntimePath(skillRelativePath)
  ) {
    failures.push(`${relativePath}: forbidden runtime-state filename`);
    continue;
  }
  const content = await fs.readFile(filePath, "utf8");
  for (const check of forbiddenContent) {
    if (check.pattern.test(content)) {
      failures.push(`${relativePath}: ${check.label}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Skill privacy check failed:\n${failures.join("\n")}`);
}

process.stdout.write("Skill privacy check passed.\n");

async function listFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (isGenerated(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
    else if (entry.isSymbolicLink())
      throw new Error(
        `Skill privacy check failed:\n${path.relative(repositoryRoot, entryPath)}: symbolic links are forbidden`
      );
  }
  return files;
}

function isForbiddenRuntimePath(relativePath) {
  const segments = relativePath
    .split(path.sep)
    .map((segment) => segment.toLowerCase());
  if (segments.length < 2) return false;
  const parentDirectory = segments.at(-2);
  const fileName = segments.at(-1);
  return (
    (parentDirectory === ".docker" && fileName === "config.json") ||
    (parentDirectory === ".kube" && fileName === "config")
  );
}

function isGenerated(name) {
  return (
    name === ".skill-work" ||
    name === "__pycache__" ||
    name === ".DS_Store" ||
    name.endsWith(".pyc")
  );
}
