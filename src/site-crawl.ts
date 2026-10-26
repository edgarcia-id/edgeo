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

function normalizedPageUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    url.hash = "";
    url.search = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url;
  } catch {
    return null;
  }
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

async function loadRobots(siteUrl: URL): Promise<RobotsPolicy> {
  const robotsUrl = new URL("/robots.txt", siteUrl);
  try {
    const response = await fetchPublicHtml(robotsUrl.toString(), {
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
      await pause(delayMs);
      const response = await fetchPublicHtml(sitemapUrl, {
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
      const isIndex = $("sitemapindex").length > 0;
      const locs = $("loc")
        .toArray()
        .map((element) => $(element).text().trim())
        .filter(Boolean);
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

export async function crawlSite(input: {
  url: string;
  maxPages: number;
  delayMs: number;
}) {
  const start = normalizedPageUrl(input.url);
  if (!start) throw new Error("Enter a valid public HTTP or HTTPS site URL.");
  if (start.protocol !== "http:" && start.protocol !== "https:") {
    throw new Error("Only public HTTP and HTTPS sites can be crawled.");
  }
  const hostname = start.hostname.toLowerCase().replace(/\.$/, "");
  const policy = await loadRobots(start);
  const sitemapUrls = [
    ...policy.sitemaps,
    new URL("/sitemap.xml", start).toString(),
  ];
  const sitemapResults =
    policy.status === "unavailable" || input.maxPages <= 0
      ? { urls: [] as string[], failures: [] as Array<{ url: string; reason: string }> }
      : await loadSitemaps(
          sitemapUrls,
          hostname,
          Math.max(input.delayMs, policy.crawlDelayMs ?? 0),
          Math.min(input.maxPages * 10, 250),
        );

  const queue = [start.toString(), ...sitemapResults.urls];
  const queued = new Set(queue);
  const visited = new Set<string>();
  const linkedFromCrawledPages = new Set<string>();
  const pages: Array<Record<string, unknown>> = [];
  const errors: Array<{ url: string; reason: string }> = [];
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
    await pause(effectiveDelayMs);
    scanned += 1;
    try {
      const audit = await auditPage(urlKey, { allowedHostnames: [hostname] });
      const finalUrl = new URL(audit.finalUrl);
      const page = audit.page as {
        title: string | null;
        metaDescription: string | null;
        bodyTextCharacters: number;
        h1Text: string[];
        internalLinks: number;
        internalLinkUrls: string[];
      };
      pages.push({
        requestedUrl: urlKey,
        finalUrl: audit.finalUrl,
        httpStatus: (audit.http as { status: number }).status,
        title: page.title,
        metaDescription: page.metaDescription,
        bodyTextCharacters: page.bodyTextCharacters,
        h1Text: page.h1Text,
        internalLinks: page.internalLinks,
        findings: (audit.findings as Array<{ code: string; severity: string }>).map(
          ({ code, severity }) => ({ code, severity }),
        ),
      });

      for (const href of page.internalLinkUrls) {
        const link = normalizedPageUrl(new URL(href, finalUrl).toString());
        if (!link || !isSameHost(link, hostname)) continue;
        linkedFromCrawledPages.add(link.toString());
        if (!visited.has(link.toString()) && !queued.has(link.toString())) {
          queue.push(link.toString());
          queued.add(link.toString());
        }
      }
    } catch (error) {
      errors.push({
        url: urlKey,
        reason: error instanceof Error ? error.message : "Page fetch failed.",
      });
    }
  }

  const titlePages = new Map<string, { title: string; urls: string[] }>();
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
  const sitemapSet = new Set(sitemapResults.urls);
  const sitemapPagesNotLinked = [...sitemapSet].filter((url) => !linkedFromCrawledPages.has(url));
  const remainingQueue = queue.filter((url) => !visited.has(url));

  return {
    audit: "EdGEO bounded site crawl",
    observedAt: new Date().toISOString(),
    requestedUrl: start.toString(),
    crawlScope: { hostname, sameHostnameOnly: true, queryParametersRemoved: true },
    policy: {
      robotsStatus: policy.status,
      robotsMessage: policy.message,
      selectedAgents: policy.selectedAgents,
      rulesApplied: policy.rules.length,
      requestedDelayMs: input.delayMs,
      effectiveDelayMs,
      crawlDelayCapMs: 30_000,
      sitemapPageUrlsFound: sitemapResults.urls.length,
      sitemapFailures: sitemapResults.failures,
    },
    limits: { maxPages: input.maxPages, pagesAttempted: scanned, remainingQueuedPages: remainingQueue.length },
    pages,
    errors,
    summary: {
      pagesReturned: pages.length,
      pagesWithErrors: errors.length,
      duplicateTitles,
      duplicateMetaDescriptions,
      findingsByCode: [...findingsByCode.entries()].map(([code, pages]) => ({ code, pages })),
      sitemapPagesNotLinkedInScannedHtml: sitemapPagesNotLinked.slice(0, 100),
      sitemapPagesNotLinkedCount: sitemapPagesNotLinked.length,
    },
    limitations: [
      "This is a bounded HTML crawl, not a full rendering, indexing, or ranking check.",
      "Crawl scope is the exact hostname in the requested URL; sibling subdomains are excluded.",
      "Query strings and fragments are removed to reduce duplicate URLs. This can omit parameter-specific content.",
      "robots.txt parsing supports user-agent groups, Allow/Disallow paths, crawl-delay, and Sitemap directives; advanced extensions may differ.",
      "The non-standard crawl-delay directive is capped at 30 seconds; path percent-encoding behavior may differ from a full standards implementation.",
      "A sitemap URL not linked in scanned HTML is a review lead, not proof that a page is orphaned.",
      "Crawl page errors and blocked paths remain separate from pages that returned audit data.",
    ],
  };
}
