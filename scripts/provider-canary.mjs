import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROVIDER_ORDER = ["vertex", "openai", "anthropic"];

const PROVIDER_SPECS = {
  vertex: {
    envName: "PAPERLENS_VERTEX_API_KEY",
  },
  openai: {
    envName: "PAPERLENS_OPENAI_API_KEY",
  },
  anthropic: {
    envName: "PAPERLENS_ANTHROPIC_API_KEY",
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
        maxOutputTokens: 1024,
      },
    };
  }
  if (provider === "openai") {
    const reasoning = body.reasoning_effort && body.reasoning_effort !== "none";
    return { ...body, max_completion_tokens: reasoning ? 1024 : 16 };
  }
  const alwaysThinking = body.model === "claude-opus-5-5" || body.model === "claude-fable-5-1";
  return { ...body, max_tokens: alwaysThinking ? 1024 : 16 };
}

async function loadProviderProtocol() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "paperlens-provider-canary-"));
  const outputFile = join(temporaryDirectory, "provider-protocol.mjs");
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  try {
    const esbuild = await import("esbuild");
    await esbuild.build({
      stdin: {
        contents: 'export * from "./src/shared/provider-protocol"; export { PROVIDERS } from "./src/shared/providers";',
        resolveDir: projectRoot,
        sourcefile: "provider-canary-entry.ts",
        loader: "ts",
      },
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
    runnable.push({ provider, apiKey });
  }

  if (runnable.length === 0) return [];

  const { protocol, temporaryDirectory } = await loadProviderProtocol();
  const results = [];
  try {
    for (const { provider, apiKey } of runnable) {
      for (const { id: model } of protocol.PROVIDERS[provider].models) {
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
