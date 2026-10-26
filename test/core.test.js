import assert from "node:assert/strict";
import test from "node:test";
import { analyzeVisibility, compareVisibilityRuns } from "../dist/analysis.js";
import { importSearchConsoleCsv } from "../dist/search-console-csv.js";
import { fetchPublicHtml } from "../dist/safe-fetch.js";
import { queryModel } from "../dist/model-providers.js";
import {
  getGoogleSearchConsoleAccessToken,
  queryGoogleSearchConsole,
} from "../dist/search-console-api.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

test("imports English Search Console CSV and aggregates metrics", () => {
  const result = importSearchConsoleCsv({
    csvText:
      "Date,Page,Query,Clicks,Impressions,Position\n2026-10-01,https://example.com/,seo,2,20,3.5",
  });

  assert.equal(result.importedRows, 1);
  assert.equal(result.summary.totals.clicks, 2);
  assert.equal(result.summary.totals.impressions, 20);
  assert.equal(result.summary.totals.impressionWeightedAveragePosition, 3.5);
});

test("imports Indonesian semicolon Search Console CSV and decimal positions", () => {
  const result = importSearchConsoleCsv({
    csvText:
      "Tanggal;Halaman;Kueri;Klik;Tayangan;Posisi\n2026-10-01;https://example.com/;seo;1;10;2,5",
  });

  assert.equal(result.importedRows, 1);
  assert.equal(result.delimiter, "semicolon");
  assert.equal(result.summary.totals.clicks, 1);
  assert.equal(result.summary.totals.impressionWeightedAveragePosition, 2.5);
});

test("counts literal brand mentions at word boundaries", () => {
  const result = analyzeVisibility({
    brandName: "EdGEO",
    aliases: ["Edgeo"],
    observations: [
      {
        id: "mention",
        source: "user_supplied",
        provider: "sample",
        model: "test-model",
        locale: "id-ID",
        searchMode: "offline",
        promptType: "unbranded_discovery",
        prompt: "SEO audit tool",
        observedAt: "2026-10-01",
        status: "complete",
        answer: "EdGEO helps with SEO.",
        citations: [],
      },
      {
        id: "substring-only",
        source: "user_supplied",
        provider: "sample",
        model: "test-model",
        locale: "id-ID",
        searchMode: "offline",
        promptType: "unbranded_discovery",
        prompt: "SEO audit tool",
        observedAt: "2026-10-01",
        status: "complete",
        answer: "Edgeology tools are available.",
        citations: [],
      },
    ],
  });

  assert.equal(result.observations[0].brandMentioned, true);
  assert.equal(result.observations[1].brandMentioned, false);
});

test("pairs visibility runs only when prompt and recorded conditions match", () => {
  const common = {
    source: "user_supplied",
    provider: "sample",
    model: "test-model",
    locale: "id-ID",
    searchMode: "offline",
    promptType: "unbranded_discovery",
    observedAt: "2026-10-01",
    status: "complete",
    citations: [],
  };
  const result = compareVisibilityRuns({
    brandName: "EdGEO",
    aliases: [],
    before: [{ ...common, id: "before", prompt: "SEO audit tool", answer: "No brand." }],
    after: [{ ...common, id: "after", prompt: " SEO   audit tool ", answer: "EdGEO." }],
  });

  assert.equal(result.comparisons.length, 1);
  assert.equal(result.comparisons[0].matchedPromptObservations, 1);
  assert.equal(result.comparisons[0].mentionTransitions.added, 1);
});

test("blocks loopback addresses before making a network request", async () => {
  await assert.rejects(
    fetchPublicHtml("http://127.0.0.1/"),
    /non-public IP address/,
  );
});

test("collects an Ollama answer as a provider API observation", async () => {
  let requestBody;
  const result = await queryModel(
    {
      provider: "ollama",
      model: "test-model",
      prompt: "SEO audit tool",
      locale: "id-ID",
      promptType: "unbranded_discovery",
    },
    {
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ message: { content: "A test answer." } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  assert.equal(requestBody.model, "test-model");
  assert.equal(result.observation.provider, "Ollama local API");
  assert.equal(result.observation.answer, "A test answer.");
  assert.equal(result.observation.citations.length, 0);
});

test("requires explicit external request consent for Gemini", async () => {
  await assert.rejects(
    queryModel(
      {
        provider: "gemini",
        model: "test-model",
        prompt: "Private product question",
        locale: "en-US",
        promptType: "other",
      },
      { apiKey: "test-key", fetchImpl: async () => { throw new Error("fetch should not be called"); } },
    ),
    /consentToExternalRequest/,
  );
});

test("queries Search Console with read-only bearer auth and bounded dimensions", async () => {
  let requestUrl;
  let requestBody;
  const result = await queryGoogleSearchConsole(
    {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-10-01",
      endDate: "2026-10-07",
      dimensions: ["date", "searchAppearance"],
      rowLimit: 50,
    },
    {
      accessToken: "test-access-token",
      fetchImpl: async (url, init) => {
        requestUrl = String(url);
        assert.equal(init.headers.authorization, "Bearer test-access-token");
        requestBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ rows: [{ keys: ["2026-10-01", "AI Overview"], clicks: 1, impressions: 2 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  assert.match(requestUrl, /sc-domain%3Aexample\.com/);
  assert.deepEqual(requestBody.dimensions, ["date", "searchAppearance"]);
  assert.equal(requestBody.rowLimit, 50);
  assert.equal(result.rows[0].keys[1], "AI Overview");
});

test("refreshes and persists an expired Search Console OAuth access token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeo-oauth-"));
  const tokenFile = join(directory, "token.json");
  await writeFile(tokenFile, JSON.stringify({
    clientId: "desktop-client",
    refreshToken: "refresh-token",
    accessToken: "expired-token",
    expiresAt: 0,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
  }));
  try {
    const token = await getGoogleSearchConsoleAccessToken({
      tokenFile,
      fetchImpl: async (_url, init) => {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("refresh_token"), "refresh-token");
        assert.equal(body.get("client_id"), "desktop-client");
        return new Response(JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    assert.equal(token, "fresh-token");
    const saved = JSON.parse(await readFile(tokenFile, "utf8"));
    assert.equal(saved.accessToken, "fresh-token");
    assert.ok(saved.expiresAt > Date.now());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("starts the stdio MCP server and exposes the release tools", async () => {
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  let nextId = 1;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for MCP ${method}. ${stderr}`));
    }, 5000);
    pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  try {
    const initialized = await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "edgeo-release-test", version: "1.0.0" },
    });
    assert.equal(initialized.result.serverInfo.name, "edgeo");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const tools = await request("tools/list");
    const names = tools.result.tools.map((tool) => tool.name);
    assert.equal(names.length, 9);
    assert.ok(names.includes("edgeo_search_console_query"));
    assert.ok(names.includes("edgeo_query_model"));
  } finally {
    lines.close();
    child.kill();
  }
});

test("installer merges and removes only EdGEO entries in Cursor and Gemini configs", async () => {
  const home = await mkdtemp(join(tmpdir(), "edgeo-install-"));
  const cursorConfig = join(home, ".cursor", "mcp.json");
  const geminiConfig = join(home, ".gemini", "settings.json");
  await mkdir(join(home, ".cursor"), { recursive: true });
  await mkdir(join(home, ".gemini"), { recursive: true });
  await writeFile(cursorConfig, JSON.stringify({ mcpServers: { existing: { command: "keep-me" } } }, null, 2));
  await writeFile(geminiConfig, JSON.stringify({ theme: "dark", mcpServers: { existing: { command: "keep-me" } } }, null, 2));
  const env = {
    ...process.env,
    ...(process.platform === "win32" ? { USERPROFILE: home } : { HOME: home }),
  };
  const run = (command) => spawnSync(process.execPath, ["dist/cli.js", ...command], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  try {
    const installed = run(["install", "--agent", "cursor,gemini"]);
    assert.equal(installed.status, 0, installed.stderr);
    const cursor = JSON.parse(await readFile(cursorConfig, "utf8"));
    const gemini = JSON.parse(await readFile(geminiConfig, "utf8"));
    assert.equal(cursor.mcpServers.existing.command, "keep-me");
    assert.equal(cursor.mcpServers.edgeo.command, "npx");
    assert.equal(gemini.theme, "dark");
    assert.equal(gemini.mcpServers.existing.command, "keep-me");
    assert.equal(gemini.mcpServers.edgeo.command, "npx");

    const repeated = run(["install", "--agent", "cursor,gemini"]);
    assert.equal(repeated.status, 0, repeated.stderr);
    const removed = run(["uninstall", "--agent", "cursor,gemini"]);
    assert.equal(removed.status, 0, removed.stderr);
    const cursorAfter = JSON.parse(await readFile(cursorConfig, "utf8"));
    const geminiAfter = JSON.parse(await readFile(geminiConfig, "utf8"));
    assert.deepEqual(Object.keys(cursorAfter.mcpServers), ["existing"]);
    assert.deepEqual(Object.keys(geminiAfter.mcpServers), ["existing"]);
    assert.equal(geminiAfter.theme, "dark");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("doctor detects Cursor and Gemini from their existing user configuration", async () => {
  const home = await mkdtemp(join(tmpdir(), "edgeo-doctor-"));
  await mkdir(join(home, ".cursor"), { recursive: true });
  await mkdir(join(home, ".gemini"), { recursive: true });
  await writeFile(join(home, ".cursor", "mcp.json"), "{}\n");
  await writeFile(join(home, ".gemini", "settings.json"), "{}\n");
  const env = {
    ...process.env,
    ...(process.platform === "win32" ? { USERPROFILE: home } : { HOME: home }),
    EDGEO_DATA_DIR: join(home, ".edgeo"),
  };
  try {
    const result = spawnSync(process.execPath, ["dist/cli.js", "doctor"], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /cursor: client\/config detected/);
    assert.match(result.stdout, /gemini: client\/config detected/);
    assert.match(result.stdout, /Google Search Console: not connected/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("MCP Registry metadata matches the npm package identity", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const registry = JSON.parse(await readFile(new URL("../server.json", import.meta.url), "utf8"));
  assert.equal(packageJson.mcpName, registry.name);
  assert.equal(packageJson.version, registry.version);
  assert.equal(registry.packages[0].identifier, packageJson.name);
  assert.equal(registry.packages[0].version, packageJson.version);
  assert.equal(registry.packages[0].transport.type, "stdio");
});
