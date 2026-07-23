import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readdir,
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

  it("replaces dangling destination symlinks without losing the entry", async () => {
    const codexHome = await mkdtemp(path.join(os.tmpdir(), "spotify-skills-"));
    const destination = path.join(codexHome, "skills", "playlist-review");
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(path.join(codexHome, "missing-skill"), destination);

    await execute("node", ["scripts/install-skills.mjs", "--apply"], {
      env: { ...process.env, CODEX_HOME: codexHome }
    });

    await expect(
      access(path.join(destination, "SKILL.md"))
    ).resolves.toBeUndefined();
  });

  it("rejects a dangling skills-root link before creating staging files", async () => {
    const codexHome = await mkdtemp(path.join(os.tmpdir(), "spotify-skills-"));
    await symlink(
      path.join(codexHome, "missing-skills"),
      path.join(codexHome, "skills")
    );

    await expect(
      execute("node", ["scripts/install-skills.mjs", "--apply"], {
        env: { ...process.env, CODEX_HOME: codexHome }
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("must not be a dangling symbolic link")
    });

    expect(
      (await readdir(codexHome)).filter((name) =>
        name.startsWith(".spotify-mcp-skills-")
      )
    ).toEqual([]);
  });

  it("excludes generated skill work from installed packages", async () => {
    const codexHome = await mkdtemp(path.join(os.tmpdir(), "spotify-skills-"));
    const workDirectory = path.resolve(
      "skills",
      "playlist-review",
      ".skill-work"
    );
    await mkdir(workDirectory, { recursive: true });
    await writeFile(
      path.join(workDirectory, "private.json"),
      "spotify:track:generated"
    );
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
      await expect(
        execute("node", ["scripts/check-skill-privacy.mjs"])
      ).resolves.toMatchObject({
        stdout: expect.stringContaining("Skill privacy check passed")
      });
    } finally {
      await rm(workDirectory, { recursive: true, force: true });
    }
  });

  it("runs the privacy gate before installing skill contents", async () => {
    const codexHome = await mkdtemp(path.join(os.tmpdir(), "spotify-skills-"));
    const fixture = path.resolve(
      "skills",
      "playlist-review",
      ".env.installer-test"
    );
    try {
      await writeFile(fixture, "UNRECOGNIZED_SECRET=value");
      await expect(
        execute("node", ["scripts/install-skills.mjs", "--apply"], {
          env: { ...process.env, CODEX_HOME: codexHome }
        })
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("forbidden runtime-state filename")
      });
      await expect(
        access(path.join(codexHome, "skills", "playlist-review"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(fixture, { force: true });
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

    const codexHome = await mkdtemp(
      path.join(os.tmpdir(), "spotify-skills-link-")
    );
    await symlink(path.parse(codexHome).root, path.join(codexHome, "skills"));
    await expect(
      execute("node", ["scripts/install-skills.mjs"], {
        env: { ...process.env, CODEX_HOME: codexHome }
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "skills must resolve inside the configured Codex home"
      )
    });
  });

  it("rejects Linux and Windows personal home paths", async () => {
    const fixture = path.resolve(
      "skills",
      "playlist-review",
      "privacy-path-fixture.md"
    );
    try {
      await writeFile(
        fixture,
        [
          "/home/alice/private/file",
          String.raw`C:\Users\alice\private`,
          String.raw`C:\users\alice\private`,
          "/Users/alice",
          "/home/alice",
          String.raw`C:\Users\alice`
        ].join("\n")
      );
      await expect(
        execute("node", ["scripts/check-skill-privacy.mjs"])
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("personal home path")
      });
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("rejects standard private-key PEM headers", async () => {
    const fixture = path.resolve(
      "skills",
      "playlist-review",
      "privacy-key-fixture.md"
    );
    try {
      for (const header of [
        "-----BEGIN DSA PRIVATE KEY-----",
        "-----BEGIN ENCRYPTED PRIVATE KEY-----"
      ]) {
        await writeFile(fixture, header);
        await expect(
          execute("node", ["scripts/check-skill-privacy.mjs"])
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("private key")
        });
      }
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("rejects fine-grained GitHub tokens and symbolic links", async () => {
    const tokenFixture = path.resolve(
      "skills",
      "playlist-review",
      "privacy-token-fixture.md"
    );
    const linkFixture = path.resolve(
      "skills",
      "playlist-review",
      "privacy-link-fixture"
    );
    try {
      await writeFile(tokenFixture, "github_pat_example_credential");
      await expect(
        execute("node", ["scripts/check-skill-privacy.mjs"])
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("GitHub token")
      });
      await rm(tokenFixture, { force: true });
      await symlink("/home/alice/private/profile.json", linkFixture);
      await expect(
        execute("node", ["scripts/check-skill-privacy.mjs"])
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("symbolic links are forbidden")
      });
    } finally {
      await rm(tokenFixture, { force: true });
      await rm(linkFixture, { force: true });
    }
  });

  it("rejects stored Spotify token fields under arbitrary filenames", async () => {
    const fixture = path.resolve(
      "skills",
      "playlist-review",
      "oauth-backup.json"
    );
    try {
      for (const value of [
        { accessToken: "access-value", refreshToken: "refresh-value" },
        { access_token: "access-value", refresh_token: "refresh-value" },
        { client_secret: "secret-value" },
        { clientSecret: "secret-value" }
      ]) {
        await writeFile(fixture, JSON.stringify(value));
        await expect(
          execute("node", ["scripts/check-skill-privacy.mjs"])
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("stored Spotify token field")
        });
      }
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("rejects environment variants and generated personalization context", async () => {
    const fixtures = [
      path.resolve("skills", "playlist-review", ".env.production"),
      path.resolve("skills", "playlist-review", ".ENV.production"),
      path.resolve("skills", "playlist-review", ".git-credentials"),
      path.resolve("skills", "playlist-review", ".netrc"),
      path.resolve("skills", "playlist-review", ".npmrc"),
      path.resolve("skills", "playlist-review", ".pypirc"),
      path.resolve("skills", "playlist-review", "_netrc"),
      path.resolve("skills", "playlist-review", "AUTH.JSON"),
      path.resolve("skills", "playlist-review", "personalization-context.md")
    ];
    try {
      for (const fixture of fixtures) {
        await writeFile(fixture, "private runtime value");
        await expect(
          execute("node", ["scripts/check-skill-privacy.mjs"])
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("forbidden runtime-state filename")
        });
        await rm(fixture, { force: true });
      }
    } finally {
      await Promise.all(
        fixtures.map((fixture) => rm(fixture, { force: true }))
      );
    }
  });
});
