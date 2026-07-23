import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execute = promisify(execFile);

describe("skill installer", () => {
  it("replaces installed packages instead of retaining stale files", async () => {
    const codexHome = await mkdtemp(path.join(os.tmpdir(), "spotify-skills-"));
    const environment = { ...process.env, CODEX_HOME: codexHome };

    await execute("node", ["scripts/install-skills.mjs", "--apply"], {
      env: environment
    });
    const staleFile = path.join(
      codexHome,
      "skills",
      "playlist-review",
      "stale-file.md"
    );
    await writeFile(staleFile, "stale");

    await execute("node", ["scripts/install-skills.mjs", "--apply"], {
      env: environment
    });

    await expect(access(staleFile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(path.join(codexHome, "skills", "playlist-review", "SKILL.md"))
    ).resolves.toBeUndefined();
  });

  it("excludes generated skill work from installed packages", async () => {
    const codexHome = await mkdtemp(path.join(os.tmpdir(), "spotify-skills-"));
    const workDirectory = path.resolve(
      "skills",
      "playlist-review",
      ".skill-work"
    );
    await mkdir(workDirectory, { recursive: true });
    await writeFile(path.join(workDirectory, "private.json"), "private");
    try {
      await execute("node", ["scripts/install-skills.mjs", "--apply"], {
        env: { ...process.env, CODEX_HOME: codexHome }
      });
      await expect(
        access(
          path.join(
            codexHome,
            "skills",
            "playlist-review",
            ".skill-work",
            "private.json"
          )
        )
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(workDirectory, { recursive: true, force: true });
    }
  });

  it("rejects CODEX_HOME paths that resolve to the filesystem root", async () => {
    await expect(
      execute("node", ["scripts/install-skills.mjs"], {
        env: { ...process.env, CODEX_HOME: "/tmp/.." }
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("safe absolute directory")
    });

    const directory = await mkdtemp(path.join(os.tmpdir(), "spotify-link-"));
    const rootLink = path.join(directory, "root");
    await symlink(path.parse(directory).root, rootLink);
    await expect(
      execute("node", ["scripts/install-skills.mjs"], {
        env: { ...process.env, CODEX_HOME: rootLink }
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("safe absolute directory")
    });
  });
});
