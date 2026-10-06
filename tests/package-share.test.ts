import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inflateRawSync } from "node:zlib";

const repoRoot = process.cwd();

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(directory, relative));
    else files.push(relative);
  }
  return files.sort();
}

// Read the central directory so this checks the delivered archive, not the
// packaging script's list of intended entries.
function unzip(bytes: Buffer): Map<string, Buffer> {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, "missing ZIP end record");
  const entries = new Map<string, Buffer>();
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    const method = bytes.readUInt16LE(cursor + 10);
    const length = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50);
    const dataOffset = localOffset + 30
      + bytes.readUInt16LE(localOffset + 26)
      + bytes.readUInt16LE(localOffset + 28);
    const data = bytes.subarray(dataOffset, dataOffset + length);
    assert.ok(method === 0 || method === 8, `unsupported ZIP method: ${method}`);
    entries.set(name, method === 8 ? inflateRawSync(data) : data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(entries.size, count, "duplicate archive entries");
  return entries;
}

test("share package delivers a ready unpacked extension without source or workstation configuration", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "paperlens-share-"));
  try {
    await writeFile(path.join(outputDir, "private.env"), "API_KEY=private-test-only-key", "utf8");
    const result = spawnSync(process.execPath, [
      "scripts/package-share.mjs", "--output-dir", outputDir,
    ], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const version = JSON.parse(await readFile(path.join(repoRoot, "manifest.json"), "utf8")).version;
    const folderName = `paperlens-${version}`;
    const entries = unzip(await readFile(path.join(outputDir, `${folderName}.zip`)));
    const requiredFiles = [
      "background.js", "content.js", "popup.js", "options.js",
      "manifest.json", "popup.html", "options.html", "content.css",
      "INSTALL.md", "PRIVACY.md", "THIRD_PARTY_NOTICES.md",
      "LICENSE",
      "icons/icon16.png", "icons/icon48.png", "icons/icon128.png",
      "licenses/APACHE-2.0.txt", "licenses/Readability-LICENSE.md",
      "licenses/Zod-LICENSE.txt",
    ];
    assert.deepEqual([...entries.keys()].sort(), requiredFiles.map((file) => `${folderName}/${file}`).sort());
    const helperAssets = ["Install-Update-PaperLens.cmd", "install-update-paperlens.ps1"];
    assert.deepEqual((await readdir(outputDir)).sort(), [
      folderName, `${folderName}.zip`, "SHA256SUMS", ...helperAssets, "private.env",
    ].sort());
    assert.deepEqual(await listFiles(path.join(outputDir, folderName)), requiredFiles.sort());
    assert.equal(await readFile(path.join(outputDir, "private.env"), "utf8"), "API_KEY=private-test-only-key");
    assert.deepEqual(entries.get(`${folderName}/LICENSE`), await readFile(path.join(repoRoot, "LICENSE")));
    const checksums = new Map<string, string>();
    for (const line of (await readFile(path.join(outputDir, "SHA256SUMS"), "utf8")).trim().split(/\r?\n/)) {
      const match = /^([a-f0-9]{64}) {2}([^\\/]+)$/.exec(line);
      assert.ok(match, `invalid checksum line: ${line}`);
      assert.equal(checksums.has(match[2]), false, `duplicate checksum: ${match[2]}`);
      checksums.set(match[2], match[1]);
    }
    assert.deepEqual([...checksums.keys()].sort(), [`${folderName}.zip`, ...helperAssets].sort());
    for (const [name, hash] of checksums) {
      assert.equal(hash, createHash("sha256").update(await readFile(path.join(outputDir, name))).digest("hex"), name);
    }
    for (const name of helperAssets) {
      assert.deepEqual(await readFile(path.join(outputDir, name)), await readFile(path.join(repoRoot, "scripts", name)), name);
    }

    for (const file of requiredFiles) {
      const archived = entries.get(`${folderName}/${file}`)!;
      assert.deepEqual(archived, await readFile(path.join(outputDir, folderName, file)), file);
      if (/\.(?:js|json|html|css|md|txt)$/.test(file)) {
        assert.doesNotMatch(archived.toString("utf8"), /[A-Z]:[\\/](?:Users|Documents)[\\/]/i, file);
        assert.doesNotMatch(archived.toString("utf8"), /chrome-extension:\/\/[a-p]{32}\//, file);
      }
    }

    const manifest = JSON.parse(entries.get(`${folderName}/manifest.json`)!.toString("utf8"));
    for (const runtimeAsset of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, ...Object.values(manifest.icons)]) {
      assert.ok(entries.has(`${folderName}/${runtimeAsset}`), `missing referenced runtime asset: ${runtimeAsset}`);
    }
    for (const page of ["popup.html", "options.html"]) {
      const html = entries.get(`${folderName}/${page}`)!.toString("utf8");
      for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
        assert.ok(entries.has(`${folderName}/${match[1]}`), `missing script in ${page}: ${match[1]}`);
      }
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("a release tag that differs from the extension version fails before changing output", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "paperlens-release-version-"));
  try {
    await writeFile(path.join(outputDir, "keep.txt"), "existing output", "utf8");
    const result = spawnSync(process.execPath, [
      "scripts/package-share.mjs", "--output-dir", outputDir, "--release-tag", "v0.0.0",
    ], { cwd: repoRoot, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release tag .* does not match/i);
    assert.deepEqual(await readdir(outputDir), ["keep.txt"]);
    assert.equal(await readFile(path.join(outputDir, "keep.txt"), "utf8"), "existing output");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("mismatched package and manifest versions are rejected before a build starts", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "paperlens-package-version-"));
  try {
    const scriptDir = path.join(fixtureDir, "scripts");
    await mkdir(scriptDir);
    await writeFile(path.join(scriptDir, "package-share.mjs"), await readFile(path.join(repoRoot, "scripts/package-share.mjs")));
    await writeFile(path.join(fixtureDir, "manifest.json"), '{"version":"1.1.1"}', "utf8");
    await writeFile(path.join(fixtureDir, "package.json"), '{"version":"2.0.0"}', "utf8");
    const result = spawnSync(process.execPath, [path.join(scriptDir, "package-share.mjs")], {
      cwd: fixtureDir,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Package version 2\.0\.0 does not match manifest version 1\.1\.1/);
    assert.deepEqual((await readdir(fixtureDir)).sort(), ["manifest.json", "package.json", "scripts"]);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

for (const fixture of [
  {
    name: "top-level",
    lock: { version: "2.0.0", packages: { "": { version: "1.1.1" } } },
    error: /Lockfile version 2\.0\.0 does not match manifest version 1\.1\.1/,
  },
  {
    name: "root-package",
    lock: { version: "1.1.1", packages: { "": { version: "2.0.0" } } },
    error: /Lockfile root package version 2\.0\.0 does not match manifest version 1\.1\.1/,
  },
]) {
  test(`mismatched ${fixture.name} lockfile version is rejected before a build starts`, async () => {
    const fixtureDir = await mkdtemp(path.join(tmpdir(), "paperlens-lock-version-"));
    try {
      const scriptDir = path.join(fixtureDir, "scripts");
      await mkdir(scriptDir);
      await writeFile(path.join(scriptDir, "package-share.mjs"), await readFile(path.join(repoRoot, "scripts/package-share.mjs")));
      await writeFile(path.join(fixtureDir, "manifest.json"), '{"version":"1.1.1"}', "utf8");
      await writeFile(path.join(fixtureDir, "package.json"), '{"version":"1.1.1"}', "utf8");
      await writeFile(path.join(fixtureDir, "package-lock.json"), JSON.stringify(fixture.lock), "utf8");
      const result = spawnSync(process.execPath, [path.join(scriptDir, "package-share.mjs")], {
        cwd: fixtureDir,
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, fixture.error);
      assert.deepEqual((await readdir(fixtureDir)).sort(), ["manifest.json", "package-lock.json", "package.json", "scripts"]);
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });
}
