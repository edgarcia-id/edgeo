import { load } from "cheerio";
import { auditPage } from "./audit.js";
import { fetchPublicHtml } from "./safe-fetch.js";

interface RobotsRule {
  allow: boolean;
  path: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelayMs: number | null;
}

interface RobotsPolicy {
  status: "loaded" | "not_found" | "unavailable";
  rules: RobotsRule[];
  crawlDelayMs: number | null;
  sitemaps: string[];
  selectedAgents: string[];
  message: string;
}

export function normalizedPageUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    url.hash = "";
    url.search = "";
    return url;
  } catch {
    return null;
  }
}

export function pageUrlIdentity(input: string): string | null {
  return normalizedPageUrl(input)?.toString() ?? null;
}

function xmlLocalName(tagName: string): string {
  return tagName.slice(tagName.lastIndexOf(":") + 1).toLowerCase();
}

export function extractSitemapLocations(xml: string, isIndex: boolean): string[] {
  const $ = load(xml, { xmlMode: true });
  const parentName = isIndex ? "sitemap" : "url";
  const locations: string[] = [];
  for (const parent of $("*").toArray()) {
    if (!("tagName" in parent) || xmlLocalName(parent.tagName) !== parentName) continue;
    for (const child of $(parent).children().toArray()) {
      if ("tagName" in child && xmlLocalName(child.tagName) === "loc") {
        const location = $(child).text().trim();
        if (location) locations.push(location);
      }
    }
  }
  return locations;
}

function parseRobots(body: string): {
  groups: RobotsGroup[];
  sitemaps: string[];
} {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let crawlDelayMs: number | null = null;
  let groupHasDirective = false;

  const flush = () => {
    if (agents.length > 0) groups.push({ agents, rules, crawlDelayMs });
    agents = [];
    rules = [];
    crawlDelayMs = null;
    groupHasDirective = false;
  };

  for (const rawLine of body.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0]?.trim() ?? "";
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "sitemap" && value) {
      sitemaps.push(value);
      continue;
    }
    if (key === "user-agent" && value) {
      if (groupHasDirective) flush();
      agents.push(value.toLowerCase());
      continue;
    }
    if (!agents.length) continue;

    if ((key === "allow" || key === "disallow") && value) {
      rules.push({ allow: key === "allow", path: value });
      groupHasDirective = true;
    } else if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        crawlDelayMs = Math.min(30_000, Math.round(seconds * 1000));
        groupHasDirective = true;
      }
    }
  }
  flush();
  return { groups, sitemaps: [...new Set(sitemaps)] };
}

function selectRobotsPolicy(body: string): Omit<RobotsPolicy, "status" | "message"> {
  const parsed = parseRobots(body);
  const specificGroups = parsed.groups.filter((group) =>
    group.agents.some((agent) => agent === "edgeo" || agent === "edgeo/0.1"),
  );
  const wildcardGroups = parsed.groups.filter((group) => group.agents.includes("*"));
  const chosen = specificGroups.length ? specificGroups : wildcardGroups;
  return {
    rules: chosen.flatMap((group) => group.rules),
    crawlDelayMs: chosen.reduce<number | null>(
      (max, group) =>
        group.crawlDelayMs === null ? max : Math.max(max ?? 0, group.crawlDelayMs),
      null,
    ),
    sitemaps: parsed.sitemaps,
    selectedAgents: chosen.flatMap((group) => group.agents),
  };
}

function robotsRuleMatches(rule: RobotsRule, target: string): boolean {
  const anchorEnd = rule.path.endsWith("$");
  const pattern = anchorEnd ? rule.path.slice(0, -1) : rule.path;
  const expression = pattern
    .replace(/([.+?^${}()|[\]\\])/g, "\\$1")
    .replace(/\*/g, ".*");
  try {
    return new RegExp("^" + expression + (anchorEnd ? "$" : "")).test(target);
  } catch {
    return target.startsWith(rule.path.replace(/\*|\$$/g, ""));
  }
}

function isAllowedByRobots(url: URL, rules: RobotsRule[]): boolean {
  const target = url.pathname + url.search;
  const matches = rules
    .filter((rule) => robotsRuleMatches(rule, target))
    .sort((left, right) => {
      const lengthDifference = right.path.replace(/[\*$]/g, "").length - left.path.replace(/[\*$]/g, "").length;
      if (lengthDifference !== 0) return lengthDifference;
      return Number(right.allow) - Number(left.allow);
    });
  return matches.length === 0 || matches[0]!.allow;
}

function isSameHost(url: URL, hostname: string): boolean {
  return url.hostname.toLowerCase().replace(/\.$/, "") === hostname;
}

async function pause(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function loadRobots(
  siteUrl: URL,
  fetchPage: typeof fetchPublicHtml,
): Promise<RobotsPolicy> {
  const robotsUrl = new URL("/robots.txt", siteUrl);
  try {
    const response = await fetchPage(robotsUrl.toString(), {
      readTextBody: true,
      allowedHostnames: [siteUrl.hostname],
    });
    if (response.status === 404 || response.status === 410) {
      return {
        status: "not_found",
        rules: [],
        crawlDelayMs: null,
        sitemaps: [],
        selectedAgents: [],
        message: "robots.txt returned a not-found status; no crawl directives were supplied.",
      };
    }
    if (response.status >= 500 || response.status >= 400) {
      return {
        status: "unavailable",
        rules: [{ allow: false, path: "/" }],
        crawlDelayMs: null,
        sitemaps: [],
        selectedAgents: [],
        message: "robots.txt returned an error status; the crawl was conservatively blocked.",
      };
    }
    if (response.contentType && !/^text\/plain\b/i.test(response.contentType)) {
      return {
        status: "unavailable",
        rules: [{ allow: false, path: "/" }],
        crawlDelayMs: null,
        sitemaps: [],
        selectedAgents: [],
        message: "robots.txt did not return text/plain; the crawl was conservatively blocked.",
      };
    }
    if (!isSameHost(new URL(response.finalUrl), siteUrl.hostname.toLowerCase().replace(/\.$/, ""))) {
      return {
        status: "unavailable",
        rules: [{ allow: false, path: "/" }],
        crawlDelayMs: null,
        sitemaps: [],
        selectedAgents: [],
        message: "robots.txt redirected to another host; the crawl was conservatively blocked.",
      };
    }
    return {
      status: "loaded",
      ...selectRobotsPolicy(response.html),
      message: "Applicable EdGEO or wildcard rules were selected from robots.txt.",
    };
  } catch (error) {
    return {
      status: "unavailable",
      rules: [{ allow: false, path: "/" }],
      crawlDelayMs: null,
      sitemaps: [],
      selectedAgents: [],
      message:
        "robots.txt could not be fetched; the crawl was conservatively blocked. " +
        (error instanceof Error ? error.message : "Fetch failed."),
    };
  }
}

async function loadSitemaps(
  sitemapUrls: string[],
  hostname: string,
  delayMs: number,
  maxUrls: number,
  fetchPage: typeof fetchPublicHtml,
  wait: typeof pause,
): Promise<{ urls: string[]; failures: Array<{ url: string; reason: string }> }> {
  const queue = [...new Set(sitemapUrls)].slice(0, 5);
  const seenSitemaps = new Set<string>();
  const urls = new Set<string>();
  const failures: Array<{ url: string; reason: string }> = [];

  while (queue.length > 0 && seenSitemaps.size < 5 && urls.size < maxUrls) {
    const sitemapUrl = queue.shift()!;
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);
    try {
      await wait(delayMs);
      const response = await fetchPage(sitemapUrl, {
        readTextBody: true,
        allowedHostnames: [hostname],
      });
      if (response.status < 200 || response.status >= 300) {
        failures.push({ url: sitemapUrl, reason: "HTTP " + response.status });
        continue;
      }
      if (
        response.contentType &&
        !/^text\//i.test(response.contentType) &&
        !/\b(xml|json|rss\+xml|atom\+xml)\b/i.test(response.contentType)
      ) {
        failures.push({ url: sitemapUrl, reason: "The response is not a readable text or XML type." });
        continue;
      }
      const finalUrl = new URL(response.finalUrl);
      if (!isSameHost(finalUrl, hostname)) {
        failures.push({ url: sitemapUrl, reason: "Redirected to a different host." });
        continue;
      }
      const $ = load(response.html, { xmlMode: true });
      const isIndex = $("sitemapindex, *").toArray().some(
        (element) => xmlLocalName(element.tagName) === "sitemapindex",
      );
      const locs = extractSitemapLocations(response.html, isIndex);
      for (const loc of locs) {
        let resolved: URL;
        try {
          resolved = new URL(loc, finalUrl);
        } catch {
          continue;
        }
        if (
          (resolved.protocol !== "http:" && resolved.protocol !== "https:") ||
          resolved.username ||
          resolved.password ||
          !isSameHost(resolved, hostname)
        ) continue;
        if (isIndex) {
          if (queue.length + seenSitemaps.size < 5) queue.push(resolved.toString());
        } else {
          const pageUrl = normalizedPageUrl(resolved.toString());
          if (pageUrl) urls.add(pageUrl.toString());
          if (urls.size >= maxUrls) break;
        }
      }
    } catch (error) {
      failures.push({
        url: sitemapUrl,
        reason: error instanceof Error ? error.message : "Fetch failed.",
      });
    }
  }
  return { urls: [...urls], failures };
}

export async function crawlSite(
  input: {
    url: string;
    maxPages: number;
    delayMs: number;
  },
  dependencies: { fetchPage?: typeof fetchPublicHtml; wait?: typeof pause } = {},
) {
  const start = normalizedPageUrl(input.url);
  if (!start) throw new Error("Enter a valid public HTTP or HTTPS site URL.");
  if (start.protocol !== "http:" && start.protocol !== "https:") {
    throw new Error("Only public HTTP and HTTPS sites can be crawled.");
  }
  const hostname = start.hostname.toLowerCase().replace(/\.$/, "");
  const fetchPage = dependencies.fetchPage ?? fetchPublicHtml;
  const wait = dependencies.wait ?? pause;
  const policy = await loadRobots(start, fetchPage);
  const sitemapUrls = [
    ...policy.sitemaps,
    new URL("/sitemap.xml", start).toString(),
  ];
  const sitemapUrlLimit = Math.min(input.maxPages * 10, 250);
  const sitemapResults =
    policy.status === "unavailable" || input.maxPages <= 0
      ? { urls: [] as string[], failures: [] as Array<{ url: string; reason: string }> }
      : await loadSitemaps(
          sitemapUrls,
          hostname,
          Math.max(input.delayMs, policy.crawlDelayMs ?? 0),
          sitemapUrlLimit,
          fetchPage,
          wait,
        );

  const queue: string[] = [];
  const queued = new Set<string>();
  const discoveredBy = new Map<string, Set<string>>();
  const enqueue = (url: string, source: string) => {
    const sources = discoveredBy.get(url) ?? new Set<string>();
    sources.add(source);
    discoveredBy.set(url, sources);
    if (!queued.has(url)) {
      queue.push(url);
      queued.add(url);
    }
  };
  enqueue(start.toString(), "start_url");
  for (const sitemapUrl of sitemapResults.urls) enqueue(sitemapUrl, "sitemap");
  const visited = new Set<string>();
  const linkedFromCrawledPages = new Set<string>();
  const pagesByFinalUrl = new Map<string, Record<string, unknown>>();
  const errors: Array<{ url: string; reason: string }> = [];
  const nonHtmlResources: Array<{
    requestedUrl: string;
    finalUrl: string;
    status: number;
    contentType: string | null;
  }> = [];
  const redirectObservations: Array<{
    requestedUrl: string;
    finalUrl: string;
    redirectCount: number;
    kind: string;
    discoveredBy: string[];
  }> = [];
  const effectiveDelayMs = Math.max(input.delayMs, policy.crawlDelayMs ?? 0);
  let scanned = 0;

  while (queue.length > 0 && scanned < input.maxPages) {
    const rawUrl = queue.shift()!;
    const pageUrl = normalizedPageUrl(rawUrl);
    if (!pageUrl || !isSameHost(pageUrl, hostname)) continue;
    const urlKey = pageUrl.toString();
    if (visited.has(urlKey)) continue;
    visited.add(urlKey);
    if (!isAllowedByRobots(pageUrl, policy.rules)) {
      errors.push({ url: urlKey, reason: "Blocked by robots.txt." });
      continue;
    }

    // robots.txt and sitemap requests also count toward pacing the origin.
    await wait(effectiveDelayMs);
    scanned += 1;
    try {
      const audit = await auditPage(urlKey, {
        allowedHostnames: [hostname],
        fetchPage,
      });
      const finalUrl = new URL(audit.finalUrl);
      const page = audit.page as {
        title: string | null;
        metaDescription: string | null;
        bodyTextCharacters: number;
        h1Text: string[];
        internalLinks: number;
        internalLinkUrls: string[];
      };
      const http = audit.http as {
        status: number;
        redirectCount: number;
        redirectClassification: string;
        contentType: string | null;
      };
      if (http.redirectCount > 0) {
        redirectObservations.push({
          requestedUrl: urlKey,
          finalUrl: audit.finalUrl,
          redirectCount: http.redirectCount,
          kind: http.redirectClassification,
          discoveredBy: [...(discoveredBy.get(urlKey) ?? new Set(["unknown"]))],
        });
      }

      if (http.contentType && !/text\/html|application\/xhtml\+xml/i.test(http.contentType)) {
        nonHtmlResources.push({
          requestedUrl: urlKey,
          finalUrl: audit.finalUrl,
          status: http.status,
          contentType: http.contentType,
        });
        continue;
      }

      const finalPageKey = normalizedPageUrl(audit.finalUrl)?.toString() ?? audit.finalUrl;
      const existingPage = pagesByFinalUrl.get(finalPageKey);
      if (existingPage) {
        const requestedUrls = existingPage.requestedUrls as string[];
        if (!requestedUrls.includes(urlKey)) requestedUrls.push(urlKey);
        const sourceList = existingPage.discoveredBy as string[];
        for (const source of discoveredBy.get(urlKey) ?? []) {
          if (!sourceList.includes(source)) sourceList.push(source);
        }
        continue;
      }

      const pageRecord: Record<string, unknown> = {
        requestedUrl: urlKey,
        requestedUrls: [urlKey],
        discoveredBy: [...(discoveredBy.get(urlKey) ?? new Set(["unknown"]))],
        finalUrl: audit.finalUrl,
        httpStatus: http.status,
        redirectCount: http.redirectCount,
        redirectClassification: http.redirectClassification,
        title: page.title,
        metaDescription: page.metaDescription,
        bodyTextCharacters: page.bodyTextCharacters,
        h1Text: page.h1Text,
        internalLinks: page.internalLinks,
        findings: (audit.findings as Array<{ code: string; severity: string }>).map(
          ({ code, severity }) => ({ code, severity }),
        ),
      };
      pagesByFinalUrl.set(finalPageKey, pageRecord);

      for (const href of page.internalLinkUrls) {
        const link = normalizedPageUrl(new URL(href, finalUrl).toString());
        if (!link || !isSameHost(link, hostname)) continue;
        const identity = pageUrlIdentity(link.toString());
        if (identity) linkedFromCrawledPages.add(identity);
        enqueue(link.toString(), "internal_link");
      }
    } catch (error) {
      errors.push({
        url: urlKey,
        reason: error instanceof Error ? error.message : "Page fetch failed.",
      });
    }
  }

  const titlePages = new Map<string, { title: string; urls: string[] }>();
  const pages = [...pagesByFinalUrl.values()];
  for (const page of pages) {
    const title = (page.title as string | null)?.trim();
    if (!title) continue;
    const key = title.toLocaleLowerCase();
    const existing = titlePages.get(key) ?? { title, urls: [] };
    existing.urls.push(page.finalUrl as string);
    titlePages.set(key, existing);
  }
  const duplicateTitles = [...titlePages.values()]
    .filter((item) => item.urls.length > 1)
    .map((item) => ({ title: item.title, pages: item.urls.length, urls: item.urls }));
  const descriptionPages = new Map<string, { description: string; urls: string[] }>();
  for (const page of pages) {
    const description = (page.metaDescription as string | null)?.trim();
    if (!description) continue;
    const key = description.toLocaleLowerCase();
    const existing = descriptionPages.get(key) ?? { description, urls: [] };
    existing.urls.push(page.finalUrl as string);
    descriptionPages.set(key, existing);
  }
  const duplicateMetaDescriptions = [...descriptionPages.values()]
    .filter((item) => item.urls.length > 1)
    .map((item) => ({ description: item.description, pages: item.urls.length, urls: item.urls }));
  const findingsByCode = new Map<string, number>();
  for (const page of pages) {
    for (const finding of page.findings as Array<{ code: string }>) {
      findingsByCode.set(finding.code, (findingsByCode.get(finding.code) ?? 0) + 1);
    }
  }
  for (const redirect of redirectObservations) {
    if (!redirect.discoveredBy.includes("internal_link")) continue;
    const requestedIdentity = pageUrlIdentity(redirect.requestedUrl);
    const finalIdentity = pageUrlIdentity(redirect.finalUrl);
    if (requestedIdentity && finalIdentity && linkedFromCrawledPages.has(requestedIdentity)) {
      linkedFromCrawledPages.add(finalIdentity);
    }
  }
  const sitemapUrlsNotObservedInScannedHtml = [...new Set(sitemapResults.urls)].filter((url) => {
    const identity = pageUrlIdentity(url);
    return identity !== null && !linkedFromCrawledPages.has(identity);
  });
  const remainingQueue = queue.filter((url) => !visited.has(url));
  const redirectSummary = {
    redirectedRequests: redirectObservations.length,
    singleRedirects: redirectObservations.filter((item) => item.redirectCount === 1).length,
    trailingSlashNormalizations: redirectObservations.filter(
      (item) => item.kind === "trailing_slash_normalization",
    ).length,
    multiHopChains: redirectObservations.filter((item) => item.redirectCount > 1).length,
  };

  return {
    audit: "EdGEO bounded site crawl",
    observedAt: new Date().toISOString(),
    requestedUrl: start.toString(),
    crawlScope: {
      hostname,
      sameHostnameOnly: true,
      queryParametersRemoved: true,
      trailingSlashPreservedForRequests: true,
    },
    policy: {
      robotsStatus: policy.status,
      robotsMessage: policy.message,
      selectedAgents: policy.selectedAgents,
      rulesApplied: policy.rules.length,
      requestedDelayMs: input.delayMs,
      effectiveDelayMs,
      crawlDelayCapMs: 30_000,
      sitemapUrlsFound: sitemapResults.urls.length,
      sitemapUrlCollectionLimit: sitemapUrlLimit,
      sitemapUrlCollectionMayBeTruncated: sitemapResults.urls.length >= sitemapUrlLimit,
      sitemapFailures: sitemapResults.failures,
    },
    limits: {
      maxPages: input.maxPages,
      urlsAttempted: scanned,
      knownUrlsDiscovered: queued.size,
      knownUrlsRemainingAtLimit: remainingQueue.length,
      queueExhausted: remainingQueue.length === 0,
      totalSiteUrlCountKnown: false,
    },
    pages,
    errors,
    nonHtmlResources,
    redirects: {
      summary: redirectSummary,
      observations: redirectObservations.slice(0, 100),
    },
    summary: {
      htmlPagesReturned: pages.length,
      pagesWithErrors: errors.length,
      nonHtmlResources: nonHtmlResources.length,
      duplicateTitles,
      duplicateMetaDescriptions,
      findingsByCode: [...findingsByCode.entries()].map(([code, pages]) => ({ code, pages })),
      redirectSummary,
      sitemapUrlsNotObservedInScannedHtml: sitemapUrlsNotObservedInScannedHtml.slice(0, 100),
      sitemapUrlsNotObservedCount: sitemapUrlsNotObservedInScannedHtml.length,
      sitemapLinkAssessment:
        "This compares sitemap URLs with links found only in crawled HTML pages; it is not a complete link graph or proof that any URL is orphaned.",
    },
    limitations: [
      "This is a bounded HTML crawl, not a full rendering, indexing, or ranking check.",
      "Crawl scope is the exact hostname in the requested URL; sibling subdomains are excluded.",
      "Query strings and fragments are removed to reduce duplicate URLs. This can omit parameter-specific content.",
      "robots.txt parsing supports user-agent groups, Allow/Disallow paths, crawl-delay, and Sitemap directives; advanced extensions may differ.",
      "The non-standard crawl-delay directive is capped at 30 seconds; path percent-encoding behavior may differ from a full standards implementation.",
      "A sitemap URL not observed in scanned HTML is a bounded-sample observation, not proof that a page is orphaned; unscanned pages may link to it.",
      "Known queued URL counts come only from fetched sitemaps and links found on scanned pages; they are not a sitewide denominator and must not be converted into a site coverage percentage.",
      "One-hop URL-normalization redirects are reported separately from multi-hop redirect chains. Trailing-slash variants remain distinct unless a crawl observes a redirect from one form to the other.",
      "Non-HTML sitemap resources are listed separately and are not included in HTML page summaries.",
      "Crawl page errors and blocked paths remain separate from pages that returned audit data.",
    ],
  };
}
