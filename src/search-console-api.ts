import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";
const TOKEN_TIMEOUT_MS = 10_000;

interface StoredGoogleToken {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  scope: string;
}

function tokenPath(): string {
  const base = process.env.EDGEO_DATA_DIR?.trim() || join(homedir(), ".edgeo");
  return join(base, "google-search-console-token.json");
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function equalState(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 1_048_576) {
    throw new Error("The Google response exceeded the 1 MiB limit.");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Google returned an invalid JSON response.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Google returned an unexpected response.");
  }
  if (!response.ok) {
    const message = "error_description" in data ? String(data.error_description) : `HTTP ${response.status}`;
    throw new Error(`Google Search Console request failed: ${message}`);
  }
  return data as Record<string, unknown>;
}

async function saveToken(token: StoredGoogleToken, path = tokenPath()): Promise<void> {
  const directory = join(path, "..");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(token, null, 2) + "\n", { mode: 0o600 });
  try {
    await chmod(temporary, 0o600);
  } catch {
    // Windows ACLs are inherited from the user's profile directory.
  }
  await rename(temporary, path);
}

async function loadToken(path = tokenPath()): Promise<StoredGoogleToken> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("Google Search Console is not connected. Run `npx --yes --prefer-online edgeo-mcp@latest search-console connect --client-id YOUR_DESKTOP_OAUTH_CLIENT_ID`.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("clientId" in value) ||
    !("refreshToken" in value) ||
    typeof value.clientId !== "string" ||
    typeof value.refreshToken !== "string"
  ) {
    throw new Error("The saved Google Search Console credentials are invalid. Run `edgeo-mcp search-console connect` again.");
  }
  return value as StoredGoogleToken;
}

export async function isGoogleSearchConsoleConnected(path = tokenPath()): Promise<boolean> {
  try {
    const token = await loadToken(path);
    return Boolean(token.refreshToken && token.clientId && token.scope === READONLY_SCOPE);
  } catch {
    return false;
  }
}

async function refreshToken(
  token: StoredGoogleToken,
  options: { fetchImpl?: typeof fetch; tokenFile?: string } = {},
): Promise<StoredGoogleToken> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    client_id: token.clientId,
    refresh_token: token.refreshToken,
    grant_type: "refresh_token",
  });
  if (token.clientSecret) body.set("client_secret", token.clientSecret);
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const data = await responseJson(response);
  if (typeof data.access_token !== "string") throw new Error("Google did not return an access token.");
  const refreshed: StoredGoogleToken = {
    ...token,
    accessToken: data.access_token,
    expiresAt: Date.now() + (typeof data.expires_in === "number" ? data.expires_in : 3600) * 1000,
  };
  await saveToken(refreshed, options.tokenFile);
  return refreshed;
}

export async function getGoogleSearchConsoleAccessToken(
  options: { fetchImpl?: typeof fetch; tokenFile?: string } = {},
): Promise<string> {
  const token = await loadToken(options.tokenFile);
  if (token.scope !== READONLY_SCOPE) {
    throw new Error("The saved Google grant does not have the EdGEO read-only scope. Reconnect Search Console.");
  }
  const current = token.accessToken && token.expiresAt > Date.now() + 60_000
    ? token
    : await refreshToken(token, options);
  return current.accessToken;
}

function openBrowser(url: string): void {
  const commands: Record<string, { command: string; args: string[] }> = {
    win32: { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] },
    darwin: { command: "open", args: [url] },
    linux: { command: "xdg-open", args: [url] },
  };
  const entry = commands[process.platform];
  if (!entry) return;
  const child = spawn(entry.command, entry.args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => undefined);
  child.unref();
}

export async function connectGoogleSearchConsole(input: {
  clientId: string;
  clientSecret?: string;
  tokenFile?: string;
  onAuthorizationUrl?: (url: string) => void;
  openAuthorizationUrl?: (url: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const clientId = input.clientId.trim();
  if (!clientId || clientId.length > 512) throw new Error("A valid Google OAuth Desktop client ID is required.");
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(48));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start the local OAuth callback server.");
  }
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: READONLY_SCOPE,
    access_type: "offline",
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();

  const onUrl = input.onAuthorizationUrl ?? ((url: string) => process.stdout.write(`Open this URL to authorize EdGEO:\n${url}\n`));
  onUrl(authorization.toString());
  (input.openAuthorizationUrl ?? openBrowser)(authorization.toString());

  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Google authorization timed out after five minutes."));
    }, 300_000);
    server.on("request", (request, response) => {
      const incoming = new URL(request.url ?? "/", redirectUri);
      if (incoming.pathname !== "/oauth2callback") {
        response.writeHead(404).end("Not found");
        return;
      }
      const returnedState = incoming.searchParams.get("state") ?? "";
      if (!equalState(state, returnedState)) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Invalid OAuth state. Return to the terminal and retry.");
        return;
      }
      const error = incoming.searchParams.get("error");
      if (error) {
        clearTimeout(timeout);
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Authorization was not completed. You may close this window.");
        server.close();
        reject(new Error(`Google authorization failed: ${error}`));
        return;
      }
      const authorizationCode = incoming.searchParams.get("code");
      if (!authorizationCode) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Google returned no authorization code.");
        return;
      }
      clearTimeout(timeout);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end("<!doctype html><meta charset=utf-8><title>EdGEO connected</title><p>Search Console is connected to EdGEO. You may close this window.</p>");
      server.close();
      resolve(authorizationCode);
    });
  });

  const tokenBody = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (input.clientSecret) tokenBody.set("client_secret", input.clientSecret);
  const response = await (input.fetchImpl ?? fetch)(TOKEN_ENDPOINT, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: tokenBody,
  });
  const result = await responseJson(response);
  if (typeof result.access_token !== "string" || typeof result.refresh_token !== "string") {
    throw new Error("Google did not return the access and refresh tokens required for ongoing Search Console access. Retry consent and approve the read-only permission.");
  }
  await saveToken({
    clientId,
    ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
    refreshToken: result.refresh_token,
    accessToken: result.access_token,
    expiresAt: Date.now() + (typeof result.expires_in === "number" ? result.expires_in : 3600) * 1000,
    scope: READONLY_SCOPE,
  }, input.tokenFile);
}

async function googleApi<T>(
  url: string,
  body: unknown,
  options: { accessToken?: string; fetchImpl?: typeof fetch; tokenFile?: string } = {},
): Promise<T> {
  const token = options.accessToken ?? await getGoogleSearchConsoleAccessToken(options);
  const response = await (options.fetchImpl ?? fetch)(url, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return await responseJson(response) as T;
}

export async function listGoogleSearchConsoleSites(
  options: { accessToken?: string; fetchImpl?: typeof fetch; tokenFile?: string } = {},
) {
  return googleApi<{ siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> }>(
    `${SEARCH_CONSOLE_API}/sites`,
    undefined,
    options,
  );
}

const DIMENSIONS = new Set(["date", "query", "page", "country", "device", "searchAppearance"]);

export async function queryGoogleSearchConsole(input: {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  searchType?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
  aggregationType?: "auto" | "byPage" | "byProperty";
  rowLimit?: number;
}, options: { accessToken?: string; fetchImpl?: typeof fetch; tokenFile?: string } = {}) {
  if (!input.siteUrl.trim() || input.siteUrl.length > 2048) throw new Error("Provide a Search Console property URL or `sc-domain:example.com` value.");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(input.startDate) || !datePattern.test(input.endDate)) throw new Error("Dates must use YYYY-MM-DD format.");
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  const end = new Date(`${input.endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.valueOf()) || start.toISOString().slice(0, 10) !== input.startDate || Number.isNaN(end.valueOf()) || end.toISOString().slice(0, 10) !== input.endDate || start > end) {
    throw new Error("Provide valid dates where startDate is on or before endDate.");
  }
  const dimensions = [...new Set(input.dimensions ?? ["date"])];
  if (dimensions.length > 6 || dimensions.some((dimension) => !DIMENSIONS.has(dimension))) {
    throw new Error("Supported dimensions are date, query, page, country, device, and searchAppearance (up to six).");
  }
  const rowLimit = input.rowLimit ?? 1000;
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 25_000) throw new Error("rowLimit must be from 1 to 25,000.");
  const requestBody = {
    startDate: input.startDate,
    endDate: input.endDate,
    dimensions,
    type: input.searchType ?? "web",
    aggregationType: input.aggregationType ?? "auto",
    rowLimit,
  };
  const url = `${SEARCH_CONSOLE_API}/sites/${encodeURIComponent(input.siteUrl)}/searchAnalytics/query`;
  const result = await googleApi<{ rows?: unknown[]; responseAggregationType?: string }>(url, requestBody, options);
  return {
    source: "Google Search Console API",
    siteUrl: input.siteUrl,
    request: requestBody,
    responseAggregationType: result.responseAggregationType ?? null,
    rows: result.rows ?? [],
    returnedRows: result.rows?.length ?? 0,
    limitations: [
      "The Search Console API may omit anonymized queries and can return top rows rather than every matching row.",
      "AI feature visibility is reported only when the API returns an explicit searchAppearance value; EdGEO does not infer AI Overviews, AI Mode, or SGE from ordinary web rows.",
      "A Search Console impression or click does not identify an AI recommendation or prove a causal GEO effect.",
    ],
  };
}

export async function disconnectGoogleSearchConsole(path = tokenPath()): Promise<boolean> {
  try {
    const token = await loadToken(path);
    const body = new URLSearchParams({ token: token.refreshToken });
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }).catch(() => undefined);
  } catch {
    // Continue to remove local credentials even if the file is missing or revocation is unavailable.
  }
  const { rm } = await import("node:fs/promises");
  try {
    await rm(path, { force: true });
    return true;
  } catch {
    return false;
  }
}
