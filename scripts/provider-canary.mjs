import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROVIDER_ORDER = ["vertex", "openai", "anthropic"];

const PROVIDER_SPECS = {
  vertex: {
    envName: "PAPERLENS_VERTEX_API_KEY",
    models: ["gemini-3.1-pro-preview", "gemini-3.6-flash", "gemini-3.5-flash-lite"],
  },
  openai: {
    envName: "PAPERLENS_OPENAI_API_KEY",
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
  },
  anthropic: {
    envName: "PAPERLENS_ANTHROPIC_API_KEY",
    models: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
  },
};

export function selectedProviders(argv) {
  const index = argv.indexOf("--provider");
  const value = index >= 0 ? argv[index + 1] : (argv[0] ?? "all");
  if (![...PROVIDER_ORDER, "all"].includes(value)) {
    throw new Error(`Unsupported provider: ${value}`);
  }
  return value === "all" ? [...PROVIDER_ORDER] : [value];
}

export function statusLine(provider, model, status) {
  return `${provider} ${model}: ${status}`;
}

export function exitCodeForResults(results) {
  return results.every(Boolean) ? 0 : 1;
}

export function withCanaryOutputLimit(provider, body) {
  if (provider === "vertex") {
    return {
      ...body,
      generationConfig: {
        ...(body.generationConfig ?? {}),
        maxOutputTokens: 16,
      },
    };
  }
  if (provider === "openai") {
    return { ...body, max_completion_tokens: 16 };
  }
  return { ...body, max_tokens: 16 };
}

async function loadProviderProtocol() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "paperlens-provider-canary-"));
  const outputFile = join(temporaryDirectory, "provider-protocol.mjs");
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  try {
    const esbuild = await import("esbuild");
    await esbuild.build({
      entryPoints: [join(projectRoot, "src/shared/provider-protocol.ts")],
      outfile: outputFile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      logLevel: "silent",
    });
    const protocol = await import(pathToFileURL(outputFile).href);
    return { protocol, temporaryDirectory };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function runModelCanary(provider, model, apiKey, protocol) {
  try {
    const request = protocol.prepareProviderRequest({
      provider,
      setting: { apiKey, model },
      systemPrompt: "Reply briefly and exactly as requested.",
      userPrompt: "Reply with OK.",
      outputMode: "text",
      stream: false,
    });
    const limitedBody = withCanaryOutputLimit(
      provider,
      JSON.parse(String(request.init.body)),
    );
    const response = await fetch(request.url, {
      ...request.init,
      body: JSON.stringify(limitedBody),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      console.log(statusLine(provider, model, `HTTP ${response.status}`));
      return false;
    }
    protocol.parseProviderResponse(provider, await response.json());
    console.log(statusLine(provider, model, "PASS"));
    return true;
  } catch {
    console.log(statusLine(provider, model, "ERROR"));
    return false;
  }
}

async function run(argv) {
  const providers = selectedProviders(argv);
  const runnable = [];

  for (const provider of providers) {
    const spec = PROVIDER_SPECS[provider];
    const apiKey = process.env[spec.envName]?.trim();
    if (!apiKey) {
      console.log(`${provider}: SKIP missing ${spec.envName}`);
      continue;
    }
    runnable.push({ provider, spec, apiKey });
  }

  if (runnable.length === 0) return [];

  const { protocol, temporaryDirectory } = await loadProviderProtocol();
  const results = [];
  try {
    for (const { provider, spec, apiKey } of runnable) {
      for (const model of spec.models) {
        results.push(await runModelCanary(provider, model, apiKey, protocol));
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  return results;
}

const invokedAsMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedAsMain) {
  run(process.argv.slice(2))
    .then((results) => {
      process.exitCode = exitCodeForResults(results);
    })
    .catch(() => {
      console.error("provider canary: ERROR");
      process.exitCode = 1;
    });
}
