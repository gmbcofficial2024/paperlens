import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CHROME_EXTENSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EDGE_EXTENSION_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const scriptPath = path.resolve("scripts/register-native-host.ps1");

function runRegistration(
  command: string,
  manifestPath: string,
  extraEnvironment: NodeJS.ProcessEnv = {},
): ReturnType<typeof spawnSync> {
  return spawnSync(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PAPERLENS_REGISTRATION_SCRIPT: scriptPath,
        PAPERLENS_TEST_MANIFEST: manifestPath,
        PAPERLENS_CHROME_EXTENSION_ID: CHROME_EXTENSION_ID,
        PAPERLENS_EDGE_EXTENSION_ID: EDGE_EXTENSION_ID,
        ...extraEnvironment,
      },
    },
  );
}

test("native-host registration writes both deduplicated origins and targets each browser once", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "paperlens-native-host-"));
  const manifestPath = path.join(tempDir, "com.paperlens.summary_host.json");

  try {
    const result = runRegistration(
      [
        "& $env:PAPERLENS_REGISTRATION_SCRIPT",
        "-ExtensionId @(",
        "$env:PAPERLENS_CHROME_EXTENSION_ID,",
        "$env:PAPERLENS_EDGE_EXTENSION_ID,",
        "$env:PAPERLENS_CHROME_EXTENSION_ID",
        ")",
        '-Browser @("Chrome", "Edge", "Chrome")',
        "-ManifestPath $env:PAPERLENS_TEST_MANIFEST",
        "-SkipRegistry",
      ].join(" "),
      manifestPath,
    );

    assert.equal(
      result.status,
      0,
      `registration failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );

    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      allowed_origins: string[];
    };
    assert.deepEqual(manifest.allowed_origins, [
      `chrome-extension://${CHROME_EXTENSION_ID}/`,
      `chrome-extension://${EDGE_EXTENSION_ID}/`,
    ]);
    assert.equal(
      result.stdout.match(/Skipped registry registration for Chrome\./g)?.length,
      1,
    );
    assert.equal(
      result.stdout.match(/Skipped registry registration for Edge\./g)?.length,
      1,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("native-host registration fails before success output when reg.exe returns nonzero", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "paperlens-native-host-"));
  const manifestPath = path.join(tempDir, "com.paperlens.summary_host.json");
  const failingRegistryCommand = path.join(tempDir, "fail-reg.cmd");
  await writeFile(failingRegistryCommand, "@exit /b 7\r\n", "utf8");

  try {
    const result = runRegistration(
      [
        "& $env:PAPERLENS_REGISTRATION_SCRIPT",
        "-ExtensionId $env:PAPERLENS_CHROME_EXTENSION_ID",
        '-Browser "Chrome"',
        "-ManifestPath $env:PAPERLENS_TEST_MANIFEST",
        "-RegistryCommand $env:PAPERLENS_FAIL_REG",
      ].join(" "),
      manifestPath,
      { PAPERLENS_FAIL_REG: failingRegistryCommand },
    );

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Registry registration failed.*Chrome.*exit code 7/is,
    );
    assert.doesNotMatch(result.stdout, /Registered .* for Chrome/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("native-host registration rejects extension IDs outside lowercase a through p", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "paperlens-native-host-"));
  const manifestPath = path.join(tempDir, "com.paperlens.summary_host.json");

  try {
    const result = runRegistration(
      [
        "& $env:PAPERLENS_REGISTRATION_SCRIPT",
        '-ExtensionId "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"',
        '-Browser "Chrome"',
        "-ManifestPath $env:PAPERLENS_TEST_MANIFEST",
        "-SkipRegistry",
      ].join(" "),
      manifestPath,
    );

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Extension ID must be 32 lowercase characters from a through p/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
