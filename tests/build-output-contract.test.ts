import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function runBuild(outputDir: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["build.mjs", "--outdir", outputDir], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(directory, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files.sort();
}

test("production build emits loadable browser assets into the requested isolated directory", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "paperlens-build-"));
  try {
    const result = runBuild(outputDir);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const copiedFiles = [
      "LICENSE",
      "manifest.json", "popup.html", "options.html", "content.css",
      "THIRD_PARTY_NOTICES.md", "INSTALL.md", "PRIVACY.md",
      "icons/icon16.png", "icons/icon48.png", "icons/icon128.png",
      "licenses/APACHE-2.0.txt", "licenses/Readability-LICENSE.md",
      "licenses/Zod-LICENSE.txt",
    ];
    assert.deepEqual(await listFiles(outputDir), [
      "background.js", "content.js", "popup.js", "options.js", ...copiedFiles,
    ].sort());
    for (const file of copiedFiles) {
      const source = file === "INSTALL.md" || file === "PRIVACY.md" ? `docs/${file}` : file;
      assert.equal(await sha256(path.join(outputDir, file)), await sha256(path.join(repoRoot, source)), file);
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("an isolated build refuses to erase an existing nonempty directory", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "paperlens-build-preserve-"));
  const sentinel = path.join(outputDir, "keep.txt");
  try {
    await writeFile(sentinel, "existing user file", "utf8");
    const result = runBuild(outputDir);
    assert.notEqual(result.status, 0, "building over a nonempty custom directory must fail");
    assert.equal(await readFile(sentinel, "utf8"), "existing user file");
    assert.deepEqual(await readdir(outputDir), ["keep.txt"]);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
