import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!["--output-dir", "--release-tag"].includes(flag) || !value || value.startsWith("--") || options.has(flag)) {
    throw new Error("Usage: node scripts/package-share.mjs [--output-dir DIRECTORY] [--release-tag vVERSION]");
  }
  options.set(flag, value);
}
const outputDir = path.resolve(repoRoot, options.get("--output-dir") ?? "release");
const publicFiles = [
  "background.js", "content.js", "popup.js", "options.js",
  "manifest.json", "popup.html", "options.html", "content.css",
  "INSTALL.md", "PRIVACY.md", "THIRD_PARTY_NOTICES.md", "LICENSE",
  "icons/icon16.png", "icons/icon48.png", "icons/icon128.png",
  "licenses/APACHE-2.0.txt", "licenses/Readability-LICENSE.md",
  "licenses/Zod-LICENSE.txt",
].sort();
const helperAssets = ["Install-Update-PaperLens.cmd", "install-update-paperlens.ps1"];

function assertOutputChild(target) {
  if (!target.startsWith(`${outputDir}${path.sep}`)) {
    throw new Error(`Release target must stay inside its output directory: ${target}`);
  }
}

const crcTable = Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

// Classic ZIP with DEFLATE, UTF-8 names and a fixed timestamp. Only Node's
// standard library is needed on Windows, macOS and Linux.
function createZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;
  for (const { name, bytes } of entries) {
    const filename = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(bytes);
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x0021, 12); // 1980-01-01
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localRecords.push(local, filename, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centralRecords.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

function buildBrowserFiles(directory) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, "build.mjs"), "--distribution", "--outdir", directory], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Build failed (${code}).`)));
  });
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "manifest.json"), "utf8"));
  const packageMetadata = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) {
    throw new Error("Manifest version must contain three or four numeric components.");
  }
  if (packageMetadata.version !== manifest.version) {
    throw new Error(`Package version ${packageMetadata.version} does not match manifest version ${manifest.version}.`);
  }
  const lockfile = JSON.parse(await readFile(path.join(repoRoot, "package-lock.json"), "utf8"));
  if (lockfile.version !== manifest.version) {
    throw new Error(`Lockfile version ${lockfile.version} does not match manifest version ${manifest.version}.`);
  }
  const lockedPackageVersion = lockfile.packages?.[""]?.version;
  if (lockedPackageVersion !== manifest.version) {
    throw new Error(`Lockfile root package version ${lockedPackageVersion} does not match manifest version ${manifest.version}.`);
  }
  const releaseTag = options.get("--release-tag");
  if (releaseTag && releaseTag !== `v${manifest.version}`) {
    throw new Error(`Release tag ${releaseTag} does not match v${manifest.version}.`);
  }
  const folderName = `paperlens-${manifest.version}`;
  const targetDir = path.join(outputDir, folderName);
  const zipPath = path.join(outputDir, `${folderName}.zip`);
  assertOutputChild(targetDir);
  assertOutputChild(zipPath);
  await mkdir(outputDir, { recursive: true });
  const stagingDir = await mkdtemp(path.join(outputDir, ".paperlens-build-"));
  assertOutputChild(stagingDir);
  try {
    const buildDir = path.join(stagingDir, "build");
    const browserDir = path.join(stagingDir, "browser");
    await buildBrowserFiles(buildDir);
    const entries = await Promise.all(publicFiles.map(async (file) => ({
      name: `${folderName}/${file}`,
      bytes: await readFile(path.join(buildDir, file)),
    })));
    // Both delivery formats use the same explicit allowlist, even if a future
    // build copies additional assets or local data into its working directory.
    for (let index = 0; index < publicFiles.length; index += 1) {
      const target = path.join(browserDir, publicFiles[index]);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, entries[index].bytes);
    }
    const archive = createZip(entries);
    const releaseAssets = [
      { name: `${folderName}.zip`, bytes: archive },
      ...await Promise.all(helperAssets.map(async (name) => ({
        name,
        bytes: await readFile(path.join(repoRoot, "scripts", name)),
      }))),
    ];
    const checksums = releaseAssets.map(({ name, bytes }) =>
      `${createHash("sha256").update(bytes).digest("hex")}  ${name}`,
    ).join("\n") + "\n";
    await rm(targetDir, { recursive: true, force: true });
    // Copy also works under restricted Windows temporary-directory ACLs that
    // can permit file creation/deletion while denying directory renames.
    await cp(browserDir, targetDir, { recursive: true });
    for (const { name, bytes } of releaseAssets) {
      const assetPath = path.join(outputDir, name);
      assertOutputChild(assetPath);
      await writeFile(assetPath, bytes);
    }
    await writeFile(path.join(outputDir, "SHA256SUMS"), checksums, "utf8");
    console.log(`Unpacked extension: ${targetDir}`);
    console.log(`Shareable ZIP: ${zipPath}`);
    console.log(`Checksums and Windows install/update helpers: ${outputDir}`);
    console.log("Install or update: keep one permanent extension directory, replace its browser files, and reload it in Chrome.");
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
