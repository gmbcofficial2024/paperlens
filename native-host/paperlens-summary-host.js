#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  systemPrompt: SUMMARY_SYSTEM_PROMPT,
} = require("../src/shared/summary-policy.json");

// Chrome's incoming native-messaging protocol boundary is 64 MiB. PaperLens
// applies no smaller content or provider limit and never truncates a frame.
const CHROME_NATIVE_MESSAGE_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180000;
const SAFE_CLI_VALUE = /^[A-Za-z0-9._:/-]{1,128}$/;

const CHILD_ENVIRONMENT_ALLOWLIST = new Set([
  "all_proxy",
  "anthropic_api_key",
  "anthropic_auth_token",
  "appdata",
  "claude_code_oauth_token",
  "codex_home",
  "comspec",
  "home",
  "http_proxy",
  "https_proxy",
  "localappdata",
  "node_extra_ca_certs",
  "no_proxy",
  "openai_api_key",
  "path",
  "pathext",
  "ssl_cert_file",
  "systemdrive",
  "systemroot",
  "temp",
  "tmp",
  "userprofile",
  "windir",
]);

function readExactly(fd, length) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const read = fs.readSync(fd, buffer, offset, length - offset, null);
    if (read === 0) {
      throw new Error("Native host input ended unexpectedly.");
    }
    offset += read;
  }
  return buffer;
}

function readMessage(fd = 0) {
  const header = readExactly(fd, 4);
  const length = header.readUInt32LE(0);
  if (length <= 0 || length > CHROME_NATIVE_MESSAGE_MAX_BYTES) {
    throw new Error(`Invalid native message length: ${length}`);
  }
  return JSON.parse(readExactly(fd, length).toString("utf8"));
}

function writeMessage(message, fd = 1) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  fs.writeSync(fd, header);
  fs.writeSync(fd, body);
}

function findOnPath(fileName, environment) {
  const pathValue =
    environment.PATH ?? environment.Path ?? environment.path ?? "";
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, fileName);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Continue searching the remaining explicit PATH entries.
    }
  }
  return null;
}

function spawnSpec(command, args, environment = process.env) {
  if (process.platform === "win32" && command === "codex") {
    // npm's codex.ps1 is the normal Windows CLI launcher. Prefer it over a
    // same-named packaged desktop executable that may also be present on PATH.
    const script = findOnPath("codex.ps1", environment);
    if (script) {
      return {
        file: "pwsh.exe",
        args: ["-NoProfile", "-NonInteractive", "-File", script, ...args],
        label: script,
      };
    }

    const executable = findOnPath("codex.exe", environment);
    if (executable) {
      return {
        file: executable,
        args,
        label: executable,
      };
    }

    throw new Error(
      "Secure Codex launcher not found. Expected codex.ps1 or codex.exe on PATH.",
    );
  }

  const executable =
    process.platform === "win32" && command === "claude"
      ? "claude.exe"
      : command;
  return {
    file: executable,
    args,
    label: executable,
  };
}

function sanitizeChildEnvironment(environment = process.env) {
  const sanitized = {};
  for (const [name, value] of Object.entries(environment)) {
    if (
      value !== undefined &&
      CHILD_ENVIRONMENT_ALLOWLIST.has(name.toLowerCase())
    ) {
      sanitized[name] = value;
    }
  }
  sanitized.NO_COLOR = "1";
  return sanitized;
}

function runCommand(command, args, input, options = {}) {
  const spawnImpl = options.spawnImpl ?? spawn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const environment = options.environment ?? process.env;
  const spec = spawnSpec(command, args, environment);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(spec.file, spec.args, {
        cwd: options.cwd,
        env: sanitizeChildEnvironment(environment),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new Error(`${spec.label} failed to start: ${error.message}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => {
        reject(new Error(`${command} timed out after ${timeoutMs / 1000}s.`));
      });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      finish(() => reject(error));
    });

    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(
            new Error(
              `${spec.label} exited with code ${code}: ${stderr || stdout}`.trim(),
            ),
          );
          return;
        }
        resolve(stdout.trim());
      });
    });

    child.stdin.end(input);
  });
}

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "paperlens-summary-"));
}

function removeTempDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

async function runIsolatedCommand(
  command,
  argsForDirectory,
  input,
  dependencies = {},
) {
  const createDirectory =
    dependencies.createTempDirectory ?? createTempDirectory;
  const removeDirectory =
    dependencies.removeTempDirectory ?? removeTempDirectory;
  const directory = createDirectory();
  try {
    const args = argsForDirectory(directory);
    return await runCommand(command, args, input, {
      ...dependencies,
      cwd: directory,
    });
  } finally {
    removeDirectory(directory);
  }
}

function appendValidatedOption(args, flag, value, label) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return;
  }
  const normalized = String(value).trim();
  if (!SAFE_CLI_VALUE.test(normalized)) {
    throw new Error(`Invalid ${label}.`);
  }
  args.push(flag, normalized);
}

function requireWindowsCodexSandbox(environment) {
  if (process.platform !== "win32") return;
  const readEnvironment = (name) => Object.entries(environment).find(
    ([key, value]) => key.toLowerCase() === name && typeof value === "string" && value.length > 0,
  )?.[1];
  // Codex's Windows default uses the OS profile, not HOME/USERPROFILE overrides.
  const codexHome = readEnvironment("codex_home") ?? path.join(
    os.userInfo().homedir,
    ".codex",
  );
  let ready = false;
  try {
    ready = path.isAbsolute(codexHome) && fs.lstatSync(
      path.join(codexHome, ".sandbox", "setup_marker.json"),
    ).isFile();
  } catch {
    // Check readiness metadata only. Never provision or read sandbox secrets.
  }
  if (!ready) {
    throw new Error(
      "Codex's elevated Windows sandbox needs one-time administrator setup. Complete that setup in Codex, then retry Alt+S.",
    );
  }
}

function buildCodexArgs(message, workingDirectory) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--disable",
    "web_search",
    "-c",
    'default_permissions="paperlens_summary"',
    "-c",
    'permissions.paperlens_summary.filesystem={":root"="deny",":workspace_roots"={"."="read"}}',
    "-c",
    "permissions.paperlens_summary.network.enabled=false",
    "-c",
    'approval_policy="never"',
    "-c",
    'shell_environment_policy.inherit="none"',
    "-c",
    "allow_login_shell=false",
    "-c",
    "agents.enabled=false",
    "-c",
    `developer_instructions=${JSON.stringify(SUMMARY_SYSTEM_PROMPT)}`,
    "-C",
    workingDirectory,
  ];
  if (process.platform === "win32") {
    args.push("-c", 'windows.sandbox="elevated"');
  }
  appendValidatedOption(args, "-m", message.codexModel, "Codex model");
  // User profiles are intentionally ignored: they can add tools, MCP servers,
  // instructions, or permissions that break the summary isolation boundary.
  args.push("-");
  return args;
}

function buildClaudeArgs(message) {
  const args = [
    "-p",
    "--output-format",
    "text",
    "--input-format",
    "text",
    "--safe-mode",
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    "{}",
    "--no-chrome",
    "--disable-slash-commands",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--system-prompt",
    SUMMARY_SYSTEM_PROMPT,
  ];
  appendValidatedOption(args, "--model", message.claudeModel, "Claude model");
  return args;
}

async function handleMessage(message, dependencies = {}) {
  if (!message || typeof message !== "object") {
    throw new Error("Invalid native host request.");
  }
  if (typeof message.prompt !== "string" || !message.prompt.trim()) {
    throw new Error("Missing summary prompt.");
  }

  if (message.provider === "codex") {
    requireWindowsCodexSandbox(dependencies.environment ?? process.env);
    const summary = await runIsolatedCommand(
      "codex",
      (directory) => buildCodexArgs(message, directory),
      message.prompt,
      dependencies,
    );
    return { ok: true, summary };
  }

  if (message.provider === "claude") {
    const summary = await runIsolatedCommand(
      "claude",
      () => buildClaudeArgs(message),
      message.prompt,
      dependencies,
    );
    return { ok: true, summary };
  }

  throw new Error(`Unsupported summary provider: ${message.provider}`);
}

async function main() {
  writeMessage(await handleMessage(readMessage()));
}

if (require.main === module) {
  main().catch((error) => {
    writeMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

module.exports = {
  CHROME_NATIVE_MESSAGE_MAX_BYTES,
  SUMMARY_SYSTEM_PROMPT,
  buildClaudeArgs,
  buildCodexArgs,
  handleMessage,
  readMessage,
  runCommand,
  runIsolatedCommand,
  sanitizeChildEnvironment,
  spawnSpec,
  writeMessage,
};
