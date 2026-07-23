import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const skillNames = [
  "playlist-builder-from-context",
  "playlist-builder-quality-loop",
  "playlist-prompt-studio",
  "playlist-review"
];

const apply = process.argv.slice(2).includes("--apply");
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const configuredCodexHome =
  process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");

await execute(process.execPath, [
  path.join(repositoryRoot, "scripts", "check-skill-privacy.mjs")
]);

if (!path.isAbsolute(configuredCodexHome)) {
  throw new Error("CODEX_HOME must be a safe absolute directory.");
}
const codexHome = await resolveFilesystemPath(configuredCodexHome);
if (codexHome === path.parse(codexHome).root)
  throw new Error("CODEX_HOME must be a safe absolute directory.");

if (apply) await fs.mkdir(codexHome, { recursive: true, mode: 0o700 });
const skillsRootPath = path.join(codexHome, "skills");
await rejectDanglingSymlink(skillsRootPath);
const skillsRoot = await resolveFilesystemPath(skillsRootPath);
if (!isWithin(codexHome, skillsRoot))
  throw new Error(
    "CODEX_HOME/skills must resolve inside the configured Codex home."
  );
const stagingRoot = apply
  ? await fs.mkdtemp(path.join(codexHome, ".spotify-mcp-skills-"))
  : null;

if (stagingRoot) {
  for (const skillName of skillNames) {
    await fs.cp(
      path.join(repositoryRoot, "skills", skillName),
      path.join(stagingRoot, skillName),
      {
        recursive: true,
        preserveTimestamps: true,
        filter: shouldInstall
      }
    );
  }
}

const replacements = [];
try {
  for (const skillName of skillNames) {
    const source = path.join(repositoryRoot, "skills", skillName);
    const destination = path.join(skillsRoot, skillName);
    process.stdout.write(
      `${apply ? "INSTALL" : "WOULD INSTALL"}: ${source} -> ${destination}\n`
    );
    if (apply) {
      await fs.mkdir(skillsRoot, { recursive: true, mode: 0o700 });
      const backup = path.join(stagingRoot, `${skillName}.backup`);
      const stagedSkill = path.join(stagingRoot, skillName);
      const destinationExists = await entryExists(destination);
      if (destinationExists) await fs.rename(destination, backup);
      replacements.push({ backup, destination, destinationExists });
      await fs.rename(stagedSkill, destination);
    }
  }
} catch (error) {
  for (const replacement of replacements.reverse()) {
    await fs.rm(replacement.destination, { recursive: true, force: true });
    if (replacement.destinationExists)
      await fs.rename(replacement.backup, replacement.destination);
  }
  throw error;
}

if (stagingRoot) await fs.rm(stagingRoot, { recursive: true });

if (!apply) {
  process.stdout.write(
    "No files changed. Re-run with --apply to install the skills.\n"
  );
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function entryExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function rejectDanglingSymlink(target) {
  let stats;
  try {
    stats = await fs.lstat(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (!stats.isSymbolicLink()) return;
  try {
    await fs.realpath(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        "CODEX_HOME/skills must not be a dangling symbolic link."
      );
    }
    throw error;
  }
}

function shouldInstall(source) {
  const relative = path.relative(path.join(repositoryRoot, "skills"), source);
  const segments = relative.split(path.sep);
  return !segments.some(
    (segment) =>
      segment === ".skill-work" ||
      segment === "__pycache__" ||
      segment === ".DS_Store" ||
      segment.endsWith(".pyc")
  );
}

async function resolveFilesystemPath(target) {
  const normalized = path.resolve(target);
  let existing = normalized;
  while (!(await exists(existing))) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const resolvedExisting = await fs.realpath(existing);
  return path.join(resolvedExisting, path.relative(existing, normalized));
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
