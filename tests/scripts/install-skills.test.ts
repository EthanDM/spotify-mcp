import { execFile } from "node:child_process";
import { access, mkdtemp, writeFile } from "node:fs/promises";
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
});
