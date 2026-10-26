import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

const MAX_REDIRECTS = 4;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_MS = 25_000;

export interface PublicHtmlResponse {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  statusText: string;
  redirectCount: number;
  contentType: string | null;
  headers: Record<string, string>;
  html: string;
  responseBytes: number;
}

export interface PublicFetchOptions {
  readTextBody?: boolean;
  allowedHostnames?: string[];
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
}

function validateUrl(input: URL): void {
  if (input.protocol !== "http:" && input.protocol !== "https:") {
    throw new Error("Only public HTTP and HTTPS pages can be audited.");
  }
  if (input.username || input.password) {
    throw new Error("URLs containing credentials are not allowed.");
  }
  if (input.protocol === "http:" && input.port && input.port !== "80") {
    throw new Error("Only port 80 is allowed for HTTP URLs.");
  }
  if (input.protocol === "https:" && input.port && input.port !== "443") {
    throw new Error("Only port 443 is allowed for HTTPS URLs.");
  }
  if (input.port && input.port !== "80" && input.port !== "443") {
    throw new Error("Only ports 80 and 443 are allowed.");
  }

  const hostname = normalizeHostname(input.hostname);
  if (!hostname || hostname.includes("%")) {
    throw new Error("The URL host is invalid.");
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".test")
  ) {
    throw new Error("Local and internal hostnames are not allowed.");
  }
}

function assertPublicAddress(address: string): void {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.process(address);
  } catch {
    throw new Error("The host resolved to an invalid IP address.");
  }
  if (parsed.range() !== "unicast") {
    throw new Error("The host resolved to a non-public IP address.");
  }
}

async function resolvePublicAddresses(
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  const normalized = normalizeHostname(hostname);
  const literalFamily = isIP(normalized);
  const addresses = literalFamily
    ? [{ address: normalized, family: literalFamily }]
    : await lookup(normalized, { all: true, verbatim: true });

  if (addresses.length === 0) {
    throw new Error("The host did not resolve to an IP address.");
  }
  // Reject mixed public/private answers so an alternate DNS answer cannot
  // make the same hostname reach a local or metadata service.
  for (const entry of addresses) assertPublicAddress(entry.address);
  return addresses;
}

function createPinnedAgent(
  hostname: string,
  addresses: Array<{ address: string; family: number }>,
): Agent {
  const expectedHost = normalizeHostname(hostname);
  const pinnedLookup = (
    lookupHost: string,
    options: number | { all?: boolean; family?: number },
    callback: (...args: unknown[]) => void,
  ): void => {
    if (normalizeHostname(lookupHost) !== expectedHost) {
      callback(new Error("Unexpected hostname during connection."));
      return;
    }

    const requestedFamily = typeof options === "number" ? options : options?.family;
    const selected = requestedFamily
      ? addresses.filter((entry) => entry.family === requestedFamily)
      : addresses;
    if (selected.length === 0) {
      callback(new Error("No validated address matches the requested IP family."));
      return;
    }

    if (typeof options === "object" && options?.all) {
      callback(null, selected);
      return;
    }
    callback(null, selected[0].address, selected[0].family);
  };

  return new Agent({
    connect: {
      lookup: pinnedLookup as never,
    },
  });
}

async function readLimitedBody(
  response: UndiciResponse,
  maxBytes: number,
): Promise<{ body: Buffer; bytes: number }> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new Error("The response body exceeds the 2 MiB fetch limit.");
  }

  const reader = response.body?.getReader();
  if (!reader) return { body: Buffer.alloc(0), bytes: 0 };

  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("The response body exceeds the 2 MiB fetch limit.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return { body: Buffer.concat(chunks), bytes };
}

export async function fetchPublicHtml(
  inputUrl: string,
  options: PublicFetchOptions = {},
): Promise<PublicHtmlResponse> {
  let current: URL;
  try {
    current = new URL(inputUrl);
  } catch {
    throw new Error("Enter a valid public HTTP or HTTPS URL.");
  }
  validateUrl(current);
  const allowedHostnames = options.allowedHostnames?.map(normalizeHostname);
  if (allowedHostnames && !allowedHostnames.includes(normalizeHostname(current.hostname))) {
    throw new Error("The URL host is outside the allowed fetch scope.");
  }
  const requestedUrl = current.toString();
  const signal = AbortSignal.timeout(MAX_TOTAL_MS);
  let redirectCount = 0;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    validateUrl(current);
    const hostname = normalizeHostname(current.hostname);
    const addresses = await resolvePublicAddresses(hostname);
    const agent = createPinnedAgent(hostname, addresses);

    try {
      const response = await undiciFetch(current, {
        method: "GET",
        redirect: "manual",
        signal,
        dispatcher: agent,
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "accept-encoding": "identity",
          "user-agent": "EdGEO/0.1 (+local evidence-based website audit)",
        },
      });

      const location = response.headers.get("location");
      const isRedirect = [301, 302, 303, 307, 308].includes(response.status) && location;
      if (isRedirect) {
        await response.body?.cancel();
        if (hop === MAX_REDIRECTS) {
          throw new Error("The page exceeded the redirect limit.");
        }
        const redirectTarget = new URL(location, current);
        if (
          allowedHostnames &&
          !allowedHostnames.includes(normalizeHostname(redirectTarget.hostname))
        ) {
          throw new Error("The redirect target is outside the allowed host scope.");
        }
        current = redirectTarget;
        redirectCount += 1;
        continue;
      }

      const contentType = response.headers.get("content-type");
      const isHtml = contentType
        ? /text\/html|application\/xhtml\+xml/i.test(contentType)
        : true;
      const isText = contentType
        ? /^text\//i.test(contentType) || /\b(xml|json|rss\+xml|atom\+xml)\b/i.test(contentType)
        : options.readTextBody === true;
      const shouldReadBody = isHtml || (options.readTextBody === true && isText);
      const downloaded = shouldReadBody
        ? await readLimitedBody(response, MAX_RESPONSE_BYTES)
        : { body: Buffer.alloc(0), bytes: 0 };
      if (!shouldReadBody) await response.body?.cancel();

      return {
        requestedUrl,
        finalUrl: current.toString(),
        status: response.status,
        statusText: response.statusText,
        redirectCount,
        contentType,
        headers: Object.fromEntries(response.headers.entries()),
        html: downloaded.body.toString("utf8"),
        responseBytes: downloaded.bytes,
      };
    } finally {
      await agent.close();
    }
  }

  throw new Error("The page could not be fetched within the redirect limit.");
}
