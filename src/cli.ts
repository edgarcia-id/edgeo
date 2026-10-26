#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectGoogleSearchConsole,
  disconnectGoogleSearchConsole,
  isGoogleSearchConsoleConnected,
} from "./search-console-api.js";

const VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;
const SKILL_SOURCE = fileURLToPath(new URL("../integrations/edgeo.skill.md", import.meta.url));
const SERVER_CONFIG = {
  command: "npx",
  args: ["-y", "edgeo-mcp", "serve"],
};
const SUPPORTED_AGENTS = ["claude", "codex", "cursor", "gemini"] as const;
type Agent = (typeof SUPPORTED_AGENTS)[number];

function usage(): void {
  process.stdout.write(`EdGEO ${VERSION}\n\nUsage:\n  edgeo-mcp serve\n  edgeo-mcp install [--agent claude,codex,cursor,gemini]\n  edgeo-mcp uninstall [--agent claude,codex,cursor,gemini]\n  edgeo-mcp doctor\n  edgeo-mcp search-console connect --client-id ID [--client-secret SECRET]\n  edgeo-mcp search-console status\n  edgeo-mcp search-console disconnect\n\nThe installer configures local MCP clients. The client controls slash-command syntax.\n`);
}

function parseOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Expected a value after ${name}.`);
  return value;
}

function selectedAgents(args: string[]): Agent[] {
  const raw = parseOption(args, "--agent");
  if (!raw) return detectAgents();
  const names = raw === "all" ? [...SUPPORTED_AGENTS] : raw.split(",").map((name) => name.trim());
  const invalid = names.filter((name) => !SUPPORTED_AGENTS.includes(name as Agent));
  if (invalid.length) throw new Error(`Unknown agent: ${invalid.join(", ")}. Choose ${SUPPORTED_AGENTS.join(", ")} or all.`);
  return [...new Set(names as Agent[])];
}

function commandAvailable(command: string): boolean {
  const probe = process.platform === "win32" ? "where.exe" : "which";
  return spawnSync(probe, [command], { stdio: "ignore", windowsHide: true }).status === 0;
}

function jsonConfigPath(agent: "cursor" | "gemini"): string {
  return agent === "cursor"
    ? join(homedir(), ".cursor", "mcp.json")
    : join(homedir(), ".gemini", "settings.json");
}

function detectAgents(): Agent[] {
  const found: Agent[] = [];
  if (commandAvailable("claude")) found.push("claude");
  if (commandAvailable("codex")) found.push("codex");
  if (commandAvailable("gemini") || existsSync(jsonConfigPath("gemini"))) found.push("gemini");
  const cursorAppPaths = process.platform === "win32"
    ? [
        ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "Programs", "cursor", "Cursor.exe")] : []),
        join(process.env.ProgramFiles ?? "C:\\Program Files", "Cursor", "Cursor.exe"),
      ]
    : [];
  if (commandAvailable("cursor") || existsSync(jsonConfigPath("cursor")) || cursorAppPaths.some((path) => existsSync(path))) found.push("cursor");
  return found;
}

async function backup(path: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(path, `${path}.edgeo-backup-${timestamp}`);
}

async function mergeJsonServerConfig(agent: "cursor" | "gemini"): Promise<void> {
  const path = jsonConfigPath(agent);
  let config: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("root must be an object");
    config = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Cannot safely edit ${path}: ${error instanceof Error ? error.message : "invalid JSON"}`);
    }
  }
  const servers = config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
    ? config.mcpServers as Record<string, unknown>
    : {};
  const existing = servers.edgeo;
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify(SERVER_CONFIG)) {
      process.stdout.write(`${agent}: EdGEO is already configured at ${path}\n`);
      return;
    }
    throw new Error(`${path} already contains a different MCP server named edgeo. Rename or remove that entry before installing.`);
  }
  try { await readFile(path); await backup(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  config.mcpServers = { ...servers, edgeo: SERVER_CONFIG };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.edgeo-tmp`;
  await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", "utf8");
  await rename(temporary, path);
  process.stdout.write(`${agent}: configured EdGEO at ${path}\n`);
}

function runHostCli(agent: "claude" | "codex", action: "install" | "uninstall"): void {
  const command = agent;
  const args = action === "install"
    ? agent === "claude"
      ? ["mcp", "add", "--scope", "user", "--transport", "stdio", "edgeo", "--", "npx", ...SERVER_CONFIG.args]
      : ["mcp", "add", "edgeo", "--", "npx", ...SERVER_CONFIG.args]
    : agent === "claude"
      ? ["mcp", "remove", "edgeo", "--scope", "user"]
      : ["mcp", "remove", "edgeo"];
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw new Error(`${agent} command failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${agent} returned exit code ${result.status ?? "unknown"}.`);
}

async function installSkill(agent: "claude" | "codex"): Promise<void> {
  const content = await readFile(SKILL_SOURCE, "utf8");
  const root = agent === "claude"
    ? join(homedir(), ".claude", "skills", "edgeo")
    : join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "skills", "edgeo");
  const path = join(root, "SKILL.md");
  await mkdir(root, { recursive: true });
  try {
    const current = await readFile(path, "utf8");
    if (current === content) return;
    throw new Error(`${path} already exists with different content; move it aside before replacing it.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(path, content, "utf8");
}

async function install(args: string[]): Promise<void> {
  const agents = selectedAgents(args);
  if (!agents.length) throw new Error("No supported agent detected. Specify --agent claude,codex,cursor,gemini or --agent all.");
  for (const agent of agents) {
    if (agent === "claude" || agent === "codex") {
      if (!commandAvailable(agent)) throw new Error(`${agent} CLI was not found. Install it first or omit it from --agent.`);
      runHostCli(agent, "install");
      await installSkill(agent);
    } else {
      await mergeJsonServerConfig(agent);
    }
  }
  process.stdout.write("EdGEO is configured. Restart or reload each agent; run `edgeo-mcp doctor` to inspect the setup.\n");
}

async function removeJsonServerConfig(agent: "cursor" | "gemini"): Promise<void> {
  const path = jsonConfigPath(agent);
  let config: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    config = parsed as Record<string, unknown>;
  } catch {
    return;
  }
  const servers = config.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return;
  const record = servers as Record<string, unknown>;
  const entry = record.edgeo;
  if (!entry || typeof entry !== "object" || JSON.stringify(entry) !== JSON.stringify(SERVER_CONFIG)) return;
  await backup(path);
  delete record.edgeo;
  config.mcpServers = record;
  const temporary = `${path}.edgeo-tmp`;
  await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", "utf8");
  await rename(temporary, path);
  process.stdout.write(`${agent}: removed EdGEO MCP entry from ${path}\n`);
}

async function uninstall(args: string[]): Promise<void> {
  const agents = selectedAgents(args);
  if (!agents.length) throw new Error("No supported agent detected. Specify --agent ... to uninstall.");
  for (const agent of agents) {
    if (agent === "claude" || agent === "codex") {
      if (commandAvailable(agent)) runHostCli(agent, "uninstall");
      const skillPath = agent === "claude"
        ? join(homedir(), ".claude", "skills", "edgeo", "SKILL.md")
        : join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "skills", "edgeo", "SKILL.md");
      const installed = await readFile(skillPath, "utf8").catch(() => "");
      const shipped = await readFile(SKILL_SOURCE, "utf8");
      if (installed === shipped) await rm(dirname(skillPath), { recursive: true, force: true });
    } else {
      await removeJsonServerConfig(agent);
    }
  }
  process.stdout.write("EdGEO uninstall finished. Existing unrelated server entries were preserved.\n");
}

async function doctor(): Promise<void> {
  process.stdout.write(`EdGEO ${VERSION} · Node ${process.versions.node}\n`);
  for (const agent of SUPPORTED_AGENTS) {
    const available = agent === "claude" || agent === "codex"
      ? commandAvailable(agent)
      : agent === "cursor"
        ? commandAvailable("cursor") || await readFile(jsonConfigPath(agent), "utf8").then(() => true, () => false)
        : commandAvailable("gemini") || await readFile(jsonConfigPath(agent), "utf8").then(() => true, () => false);
    process.stdout.write(`${agent}: ${available ? "client/config detected" : "not detected"}\n`);
  }
  process.stdout.write(`Google Search Console: ${await isGoogleSearchConsoleConnected() ? "read-only OAuth token saved" : "not connected"}\n`);
  process.stdout.write("This diagnostic does not call external APIs or disclose credentials.\n");
}

async function searchConsole(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "connect") {
    const clientId = parseOption(args, "--client-id") ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = parseOption(args, "--client-secret") ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId) throw new Error("Provide --client-id from a Google OAuth Desktop application, or set GOOGLE_OAUTH_CLIENT_ID.");
    await connectGoogleSearchConsole({
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      onAuthorizationUrl: (url) => process.stdout.write(`\nAuthorize the Google Search Console read-only scope in your browser:\n${url}\n\nWaiting for the local OAuth callback...\n`),
    });
    process.stdout.write("Google Search Console connected. The refresh token is stored in your local EdGEO data directory.\n");
    return;
  }
  if (subcommand === "disconnect") {
    await disconnectGoogleSearchConsole();
    process.stdout.write("Google Search Console credentials removed from this computer.\n");
    return;
  }
  if (subcommand === "status") {
    process.stdout.write(`${await isGoogleSearchConsoleConnected() ? "Connected (read-only OAuth grant saved)." : "Not connected."}\n`);
    return;
  }
  throw new Error("Use search-console connect, status, or disconnect.");
}

async function main(): Promise<void> {
  const [command = "serve", ...args] = process.argv.slice(2);
  try {
    if (command === "serve" || command === "start") {
      await import("./server.js");
      return;
    }
    if (command === "install") return await install(args);
    if (command === "uninstall") return await uninstall(args);
    if (command === "doctor") return await doctor();
    if (command === "search-console") return await searchConsole(args);
    if (command === "--help" || command === "-h" || command === "help") return usage();
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    process.stderr.write(`EdGEO: ${error instanceof Error ? error.message : "command failed"}\n`);
    process.exitCode = 1;
  }
}

await main();
