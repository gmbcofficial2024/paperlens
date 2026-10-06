import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const windows = process.platform === "win32";
const script = path.resolve("scripts/install-update-paperlens.ps1");
const launcher = path.resolve("scripts/Install-Update-PaperLens.cmd");
const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
const version = "1.2.3";
const browserFiles = [
  "LICENSE", "INSTALL.md", "PRIVACY.md", "THIRD_PARTY_NOTICES.md",
  "background.js", "content.js", "popup.js", "options.js", "manifest.json",
  "popup.html", "options.html", "content.css", "icons/icon16.png",
  "icons/icon48.png", "icons/icon128.png", "licenses/APACHE-2.0.txt",
  "licenses/Readability-LICENSE.md", "licenses/Zod-LICENSE.txt",
];

function manifest(value = version): string {
  return JSON.stringify({
    manifest_version: 3, name: "PaperLens", version: value,
    background: { service_worker: "background.js" },
    action: { default_popup: "popup.html" }, options_page: "options.html",
    icons: { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" },
  });
}

type ZipEntry = { name: string; bytes: Buffer; attributes?: number };
function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

// Build independent, uncompressed ZIP fixtures, including hostile entry metadata.
function zip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(entry.bytes.length, 18);
    header.writeUInt32LE(entry.bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(0x0314, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(entry.bytes.length, 20);
    directory.writeUInt32LE(entry.bytes.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(entry.attributes ?? 0, 38);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, entry.bytes);
    central.push(directory, name);
    offset += header.length + name.length + entry.bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function validEntries(): ZipEntry[] {
  return browserFiles.map((file) => ({
    name: `paperlens-${version}/${file}`,
    bytes: Buffer.from(file === "manifest.json" ? manifest() : `fixture:${file}`, "utf8"),
  }));
}

async function fixture(entries = validEntries()) {
  const root = await mkdtemp(path.join(tmpdir(), "paperlens installer "));
  const release = path.join(root, "offline release");
  const target = path.join(root, "extension");
  await mkdir(release);
  const archive = zip(entries);
  const archiveName = `paperlens-${version}.zip`;
  await writeFile(path.join(release, archiveName), archive);
  const digest = createHash("sha256").update(archive).digest("hex");
  await writeFile(path.join(release, "SHA256SUMS"), `${digest}  ${archiveName}\n`, "ascii");
  return { root, release, target, archiveName };
}

function run(release: string, target: string, wrapper?: string, cwd = process.cwd()) {
  const args = wrapper
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper]
    : ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-LocalReleaseDirectory", release, "-InstallDirectory", target];
  return spawnSync(powershell, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 20000 });
}

async function oldInstallation(target: string) {
  await mkdir(target);
  for (const file of browserFiles.filter((name) => name !== "LICENSE")) {
    await mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await writeFile(path.join(target, file), file === "manifest.json" ? manifest("1.1.1") : `old:${file}`);
  }
}

test("new-install default uses Windows Documents independently of cwd and profile environment paths", { skip: !windows }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paperlens default path "));
  try {
    const wrapper = path.join(root, "resolve default fixture.ps1");
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    await writeFile(wrapper, [
      "$ErrorActionPreference = 'Stop'",
      "$tokens = $null; $errors = $null",
      `$ast = [Management.Automation.Language.Parser]::ParseFile(${quote(script)}, [ref]$tokens, [ref]$errors)`,
      "if ($errors.Count) { throw 'Installer did not parse.' }",
      "$ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { Invoke-Expression $_.Extent.Text }",
      "$LocalReleaseDirectory = $null",
      `$env:LOCALAPPDATA = ${quote(path.join(root, "unrelated app data"))}`,
      `$env:USERPROFILE = ${quote(path.join(root, "unrelated profile"))}`,
      `$env:HOME = ${quote(path.join(root, "unrelated home"))}`,
      "function Read-Host { 'N' }",
      "$actual = Resolve-InstallDirectory ''",
      "$documents = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments, [Environment+SpecialFolderOption]::DoNotVerify)",
      "if (-not $documents) { throw 'Test environment has no Windows Documents folder.' }",
      "@{ actual = $actual; expected = [IO.Path]::Combine($documents, 'PaperLens', 'extension'); cwd = (Get-Location).Path } | ConvertTo-Json -Compress",
    ].join("\r\n"), "ascii");
    const result = run("", "", wrapper, root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const resolved = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) ?? "");
    assert.equal(resolved.actual, resolved.expected);
    assert.equal(resolved.cwd, root);
    assert.notEqual(path.dirname(resolved.actual), root);
    assert.deepEqual(await readdir(root), ["resolve default fixture.ps1"], "resolving the default must not install or move files");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Windows PowerShell 5.1 installs a verified local release in a stable explicit folder", { skip: !windows }, async () => {
  const data = await fixture();
  try {
    const result = run(data.release, data.target, undefined, data.root);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(await readFile(path.join(data.target, "manifest.json"), "utf8")).version, "1.2.3");
    assert.equal(await readFile(path.join(data.target, "content.js"), "utf8"), "fixture:content.js");
    assert.ok((await readdir(data.target)).includes("LICENSE"));
    assert.match(result.stdout, /Load unpacked/);
    assert.match(result.stdout, /PowerShell 5\.1/);
    assert.deepEqual((await readdir(data.root)).sort(), ["extension", "offline release"]);
  } finally { await rm(data.root, { recursive: true, force: true }); }
});

test("updating an older release keeps its exact folder path and retains a complete backup", { skip: !windows }, async () => {
  const data = await fixture();
  try {
    await oldInstallation(data.target);
    const result = run(data.release, data.target);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const backup = (await readdir(data.root)).find((name) => name.startsWith("extension.backup-"));
    assert.ok(backup, "updates must retain the previous extension directory for rollback");
    assert.equal(await readFile(path.join(data.root, backup, "content.js"), "utf8"), "old:content.js");
    assert.equal(JSON.parse(await readFile(path.join(data.target, "manifest.json"), "utf8")).version, "1.2.3");
    assert.match(result.stdout, /Reload.*PaperLens/i);
    assert.match(result.stdout, /refresh.*article/i);
  } finally { await rm(data.root, { recursive: true, force: true }); }
});

test("checksum failure leaves an existing extension unchanged before replacement begins", { skip: !windows }, async () => {
  const data = await fixture();
  try {
    await oldInstallation(data.target);
    await writeFile(path.join(data.release, "SHA256SUMS"), `${"0".repeat(64)}  ${data.archiveName}\n`, "ascii");
    const result = run(data.release, data.target);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /SHA-256.*mismatch/i);
    assert.equal(await readFile(path.join(data.target, "content.js"), "utf8"), "old:content.js");
    assert.deepEqual((await readdir(data.root)).sort(), ["extension", "offline release"]);
  } finally { await rm(data.root, { recursive: true, force: true }); }
});

for (const [name, extra] of [
  ["parent traversal", { name: `paperlens-${version}/../escape.txt`, bytes: Buffer.from("escape") }],
  ["unexpected nested code", { name: `paperlens-${version}/icons/nested/evil.js`, bytes: Buffer.from("evil") }],
  ["Windows path aliases", { name: `paperlens-${version}/content.js.`, bytes: Buffer.from("alias") }],
  ["duplicate entries", { name: `paperlens-${version}/content.js`, bytes: Buffer.from("duplicate") }],
  ["symbolic links", { name: `paperlens-${version}/icons/icon16.png`, bytes: Buffer.from("../target"), attributes: (0xa1ff << 16) >>> 0 }],
] as const) {
  test(`ZIP validation rejects ${name} before writing extension files`, { skip: !windows }, async () => {
    const entries = name === "symbolic links"
      ? validEntries().map((entry) => entry.name === extra.name ? extra : entry)
      : [...validEntries(), extra];
    const data = await fixture(entries);
    try {
      const result = run(data.release, data.target);
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /ZIP.*(invalid|allowlist|duplicate|link)/i);
      assert.deepEqual(await readdir(data.root), ["offline release"], "no destination or escaped file may be created");
    } finally { await rm(data.root, { recursive: true, force: true }); }
  });
}

test("promotion failure restores the previous extension after its backup was moved", { skip: !windows }, async () => {
  const data = await fixture();
  try {
    await oldInstallation(data.target);
    const wrapper = path.join(data.root, "failed move fixture.ps1");
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    await writeFile(wrapper, [
      "function Move-Item {",
      "  [CmdletBinding()] param([string]$LiteralPath, [string]$Destination)",
      "  if ($LiteralPath -like '*.staging-*') { throw 'Simulated promotion failure.' }",
      "  Microsoft.PowerShell.Management\\Move-Item @PSBoundParameters",
      "}",
      `& ${quote(script)} -LocalReleaseDirectory ${quote(data.release)} -InstallDirectory ${quote(data.target)}`,
      "exit $LASTEXITCODE",
    ].join("\r\n"), "ascii");
    const result = run(data.release, data.target, wrapper);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Simulated promotion failure/);
    assert.match(result.stdout, /Restored.*previous/i);
    assert.equal(await readFile(path.join(data.target, "content.js"), "utf8"), "old:content.js");
    assert.equal(JSON.parse(await readFile(path.join(data.target, "manifest.json"), "utf8")).version, "1.1.1");
    assert.equal((await readdir(data.root)).some((name) => /\.backup-|\.staging-/.test(name)), false);
  } finally { await rm(data.root, { recursive: true, force: true }); }
});

test("updater refuses a source checkout or personal folder containing unrelated files", { skip: !windows }, async () => {
  const data = await fixture();
  try {
    await oldInstallation(data.target);
    await writeFile(path.join(data.target, "private.env"), "leave-this-alone");
    const result = run(data.release, data.target);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /dedicated.*extension folder/i);
    assert.equal(await readFile(path.join(data.target, "private.env"), "utf8"), "leave-this-alone");
    assert.equal(await readFile(path.join(data.target, "content.js"), "utf8"), "old:content.js");
  } finally { await rm(data.root, { recursive: true, force: true }); }
});

test("double-click launcher forwards offline options through built-in Windows PowerShell", { skip: !windows }, async () => {
  const data = await fixture();
  try {
    const command = `""${launcher}" -LocalReleaseDirectory "${data.release}" -InstallDirectory "${data.target}""`;
    const result = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], { input: "\n", encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true, timeout: 20000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(await readFile(path.join(data.target, "manifest.json"), "utf8")).version, "1.2.3");
    assert.match(result.stdout, /PowerShell 5\.1/);
  } finally { await rm(data.root, { recursive: true, force: true }); }
});

test("drive-relative installation paths are rejected instead of resolving against the current directory", { skip: !windows }, async () => {
  const data = await fixture();
  try {
    const driveRelative = `${path.parse(data.root).root.slice(0, 2)}relative-extension`;
    const result = run(data.release, driveRelative, undefined, data.root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /absolute extension folder/i);
    assert.deepEqual(await readdir(data.root), ["offline release"]);
  } finally { await rm(data.root, { recursive: true, force: true }); }
});
