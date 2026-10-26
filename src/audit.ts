import { load } from "cheerio";
import { fetchPublicHtml } from "./safe-fetch.js";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface AuditFinding {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: string;
}

export interface HeadingOutlineItem {
  level: number;
  text: string;
}

export interface RedirectClassification {
  kind: "single_redirect" | "trailing_slash_normalization" | "redirect_chain";
  code: string;
  severity: Severity;
  title: string;
  detail: string;
}

function textOf(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function addFinding(
  findings: AuditFinding[],
  code: string,
  severity: Severity,
  title: string,
  detail: string,
  evidence: string,
): void {
  findings.push({ code, severity, title, detail, evidence });
}

function withoutTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
}

export function classifyRedirect(
  requestedUrl: string,
  finalUrl: string,
  redirectCount: number,
): RedirectClassification | null {
  if (redirectCount <= 0) return null;
  if (redirectCount > 1) {
    return {
      kind: "redirect_chain",
      code: "redirect_chain",
      severity: "low",
      title: "Multiple redirects were followed",
      detail:
        "The requested URL passed through more than one redirect before reaching its final response. Check each hop and update internal links and sitemap entries to the intended final URL where appropriate.",
    };
  }

  let trailingSlashOnly = false;
  try {
    const requested = new URL(requestedUrl);
    const final = new URL(finalUrl);
    trailingSlashOnly =
      requested.origin === final.origin &&
      requested.search === final.search &&
      requested.hash === final.hash &&
      requested.pathname !== final.pathname &&
      withoutTrailingSlash(requested.pathname) === withoutTrailingSlash(final.pathname);
  } catch {
    // Keep a generic single-redirect observation if either URL is malformed.
  }

  if (trailingSlashOnly) {
    return {
      kind: "trailing_slash_normalization",
      code: "url_normalization_redirect",
      severity: "info",
      title: "One redirect changes the trailing slash",
      detail:
        "This is a single URL-normalization redirect, not a redirect chain. It is not by itself an SEO defect; use the preferred URL consistently in internal links and the sitemap if those sources disagree.",
    };
  }

  return {
    kind: "single_redirect",
    code: "single_redirect",
    severity: "info",
    title: "The requested URL redirects once",
    detail:
      "A single redirect was followed; this is not a redirect chain. Compare the final URL with internal links, sitemap entries, and the page canonical before treating it as an issue.",
  };
}

export function extractHeadingOutline($: ReturnType<typeof load>): HeadingOutlineItem[] {
  return $("h1,h2,h3,h4,h5,h6")
    .toArray()
    .filter((element) => {
      const chain = [element, ...$(element).parents().toArray()];
      return !chain.some((node) => {
        const item = $(node);
        const style = textOf(item.attr("style")).toLowerCase().replace(/\s+/g, "");
        return (
          item.attr("hidden") !== undefined ||
          textOf(item.attr("aria-hidden")).toLowerCase() === "true" ||
          /(?:^|;)display:none(?:!important)?(?:;|$)/.test(style) ||
          /(?:^|;)visibility:(?:hidden|collapse)(?:!important)?(?:;|$)/.test(style)
        );
      });
    })
    .map((element) => ({
      level: Number(element.tagName.slice(1)),
      text: textOf($(element).text()),
    }))
    .filter((item) => item.text);
}

export function findHeadingLevelJumps(headings: HeadingOutlineItem[]): string[] {
  let previousLevel = 0;
  const jumps: string[] = [];
  for (const heading of headings) {
    if (previousLevel > 0 && heading.level > previousLevel + 1) {
      jumps.push("H" + previousLevel + " → H" + heading.level + ": " + heading.text);
    }
    previousLevel = heading.level;
  }
  return jumps;
}

export async function auditPage(
  url: string,
  options: { allowedHostnames?: string[]; fetchPage?: typeof fetchPublicHtml } = {},
) {
  const response = await (options.fetchPage ?? fetchPublicHtml)(url, {
    allowedHostnames: options.allowedHostnames,
  });
  const $ = load(response.html);
  const findings: AuditFinding[] = [];
  const title = textOf($("title").first().text());
  const description = textOf($('meta[name="description"]').attr("content"));
  const openGraph = {
    title: textOf($('meta[property="og:title"]').attr("content")) || null,
    description: textOf($('meta[property="og:description"]').attr("content")) || null,
    url: textOf($('meta[property="og:url"]').attr("content")) || null,
    image: textOf($('meta[property="og:image"]').attr("content")) || null,
    type: textOf($('meta[property="og:type"]').attr("content")) || null,
  };
  const twitterCard = {
    card: textOf($('meta[name="twitter:card"]').attr("content")) || null,
    title: textOf($('meta[name="twitter:title"]').attr("content")) || null,
    description: textOf($('meta[name="twitter:description"]').attr("content")) || null,
    image: textOf($('meta[name="twitter:image"]').attr("content")) || null,
  };
  const hreflangAlternates = $('link[rel~="alternate"][hreflang]')
    .toArray()
    .map((element) => ({
      language: textOf($(element).attr("hreflang")),
      href: textOf($(element).attr("href")),
    }))
    .filter((item) => item.language && item.href);
  const canonicalElements = $('link[rel~="canonical"]');
  const canonicalHref = textOf(canonicalElements.first().attr("href"));
  let canonical: string | null = null;
  let invalidCanonical = false;
  if (canonicalHref) {
    try {
      canonical = new URL(canonicalHref, response.finalUrl).toString();
      if (!canonical.startsWith("http://") && !canonical.startsWith("https://")) {
        canonical = null;
        invalidCanonical = true;
      }
    } catch {
      invalidCanonical = true;
    }
  }
  const robots = [
    textOf($('meta[name="robots"]').attr("content")),
    textOf($('meta[name="googlebot"]').attr("content")),
    textOf(response.headers["x-robots-tag"]),
  ]
    .filter(Boolean)
    .join("; ");
  const headings = extractHeadingOutline($);
  const h1s = headings.filter((heading) => heading.level === 1).map((heading) => heading.text);
  const images = $("img").toArray();
  const imagesMissingAlt = images.filter((element) => $(element).attr("alt") === null).length;
  const anchors = $("a[href]").toArray();
  const links = anchors
    .map((element) => {
      const href = textOf($(element).attr("href"));
      try {
        return new URL(href, response.finalUrl);
      } catch {
        return null;
      }
    })
    .filter((link): link is URL => link !== null);
  const finalHost = new URL(response.finalUrl).hostname.toLowerCase();
  const internalLinks = links.filter(
    (link) => link.hostname.toLowerCase() === finalHost,
  ).length;
  const internalLinkUrls = [
    ...new Set(
      links
        .filter((link) => link.hostname.toLowerCase() === finalHost)
        .map((link) => link.toString()),
    ),
  ].slice(0, 500);
  const externalLinks = links.length - internalLinks;
  const emptyAnchors = anchors.filter(
    (element) =>
      !textOf($(element).text()) &&
      !textOf($(element).find("img").attr("alt")) &&
      !textOf($(element).attr("aria-label")) &&
      !textOf($(element).attr("title")),
  ).length;
  const text = textOf($("body").text());
  const jsonLd = $('script[type="application/ld+json"]')
    .toArray()
    .map((element, index) => {
      const content = $(element).text().trim();
      try {
        JSON.parse(content);
        return { index, valid: true, error: null };
      } catch (error) {
        return {
          index,
          valid: false,
          error: error instanceof Error ? error.message : "Invalid JSON",
        };
      }
    });
  const jsonLdTypes = new Set<string>();
  let jsonLdTypeScanTruncated = false;
  $('script[type="application/ld+json"]')
    .toArray()
    .forEach((element) => {
      try {
        const pending: unknown[] = [JSON.parse($(element).text())];
        let visitedNodes = 0;
        const queueChildren = (children: unknown[]) => {
          for (const child of children) {
            if (visitedNodes + pending.length >= 20_000) {
              jsonLdTypeScanTruncated = true;
              break;
            }
            pending.push(child);
          }
        };
        while (pending.length > 0 && visitedNodes < 20_000) {
          const value = pending.pop();
          visitedNodes += 1;
          if (Array.isArray(value)) {
            queueChildren(value);
          } else if (value && typeof value === "object") {
            const object = value as Record<string, unknown>;
            const type = object["@type"];
            if (typeof type === "string") jsonLdTypes.add(type);
            else if (Array.isArray(type)) {
              type
                .filter((item): item is string => typeof item === "string")
                .forEach((item) => jsonLdTypes.add(item));
            }
            queueChildren(Object.values(object));
          }
        }
        if (pending.length > 0) jsonLdTypeScanTruncated = true;
      } catch {
        // Syntax errors are already reported through invalidJsonLd.
      }
    });

  if (response.status >= 500) {
    addFinding(
      findings,
      "http_server_error",
      "high",
      "The server returned an error",
      "The request received a server-side error. Check the origin, deployment, or access rules.",
      "HTTP " + response.status + " " + response.statusText,
    );
  } else if (response.status >= 400) {
    addFinding(
      findings,
      "http_client_error",
      "high",
      "The page did not return successfully",
      "The requested page returned a client error. Confirm the URL and whether public visitors can access it.",
      "HTTP " + response.status + " " + response.statusText,
    );
  } else if (response.status >= 300) {
    addFinding(
      findings,
      "http_non_success",
      "medium",
      "The final response is not a success response",
      "The last response after redirects was not in the 2xx range.",
      "HTTP " + response.status + " " + response.statusText,
    );
  }

  const redirectClassification = classifyRedirect(
    response.requestedUrl,
    response.finalUrl,
    response.redirectCount,
  );
  if (redirectClassification) {
    addFinding(
      findings,
      redirectClassification.code,
      redirectClassification.severity,
      redirectClassification.title,
      redirectClassification.detail,
      "Redirects followed: " + response.redirectCount + "; final URL: " + response.finalUrl,
    );
  }

  if (!response.contentType || !/text\/html|application\/xhtml\+xml/i.test(response.contentType)) {
    addFinding(
      findings,
      "not_html",
      "high",
      "The final response is not HTML",
      "This prototype audits HTML pages. Other content types are reported without parsing their body.",
      "Content-Type: " + (response.contentType ?? "not returned"),
    );
  }

  if (!title) {
    addFinding(
      findings,
      "missing_title",
      "high",
      "No page title was found",
      "A descriptive title helps people and search systems identify the page. Confirm that the intended title is present in the returned HTML.",
      "No non-empty <title> element was found.",
    );
  }

  if (!description) {
    addFinding(
      findings,
      "missing_meta_description",
      "medium",
      "No meta description was found",
      "A description can help describe the page in search results. Its absence does not by itself prove a ranking issue.",
      'No non-empty meta[name="description"] was found.',
    );
  }

  if (!canonical) {
    if (invalidCanonical) {
      addFinding(
        findings,
        "invalid_canonical",
        "medium",
        "The canonical URL could not be resolved",
        "Correct the canonical href so it points to a valid absolute or relative URL.",
        "Canonical href: " + canonicalHref,
      );
    } else {
      addFinding(
        findings,
        "missing_canonical",
        "low",
        "No canonical link was found",
        "Review whether this page needs an explicit preferred URL, especially if duplicate or parameterized URLs exist.",
        'No link[rel="canonical"] was found.',
      );
    }
  } else if (new URL(canonical).hostname.toLowerCase() !== finalHost) {
    addFinding(
      findings,
      "cross_host_canonical",
      "medium",
      "The canonical points to another host",
      "Confirm that the cross-host canonical is intentional and points to the correct equivalent page.",
      "Canonical URL: " + canonical,
    );
  }
  if (canonicalElements.length > 1) {
    addFinding(
      findings,
      "multiple_canonical_links",
      "medium",
      "More than one canonical link was found",
      "Keep one intended canonical link in the document or confirm that duplicate declarations resolve consistently.",
      "Canonical link elements found: " + canonicalElements.length,
    );
  }

  if (/\bnoindex\b/i.test(robots)) {
    addFinding(
      findings,
      "noindex_directive",
      "critical",
      "A noindex directive was found",
      "The response includes a noindex directive. Confirm that this page is intentionally excluded from indexing.",
      "Robots directives: " + robots,
    );
  }
  if (/\bnofollow\b/i.test(robots)) {
    addFinding(
      findings,
      "nofollow_directive",
      "medium",
      "A nofollow directive was found",
      "The response includes a nofollow directive. Confirm that search systems should not follow links from this page.",
      "Robots directives: " + robots,
    );
  }

  if (h1s.length === 0) {
    addFinding(
      findings,
      "missing_h1",
      "medium",
      "No H1 heading was found",
      "Check that the main topic is clear in the page structure. Search engines can use multiple signals, so this is a structural observation rather than a ranking diagnosis.",
      "No non-empty H1 element was found.",
    );
  } else if (h1s.length > 1) {
    addFinding(
      findings,
      "multiple_h1",
      "low",
      "The page has multiple H1 headings",
      "Multiple H1 elements can be valid HTML. Review whether the hierarchy communicates one clear primary topic to readers.",
      "H1 text: " + h1s.join(" | "),
    );
  }

  const headingJumps = findHeadingLevelJumps(headings);
  if (headingJumps.length > 0) {
    addFinding(
      findings,
      "heading_level_jumps",
      "info",
      "The HTML heading outline skips a level",
      "This is a structural cue to review, not evidence of a search-ranking problem. The audit excludes explicitly hidden headings but cannot evaluate computed CSS or the intended visual hierarchy.",
      headingJumps.slice(0, 10).join("; "),
    );
  }

  const language = textOf($("html").attr("lang"));
  if (!language) {
    addFinding(
      findings,
      "missing_language",
      "low",
      "The HTML element has no language attribute",
      "Add the page's primary language to the html element when it is known.",
      '<html lang="..."> was not found.',
    );
  }

  if (!$('meta[name="viewport"]').length) {
    addFinding(
      findings,
      "missing_viewport",
      "low",
      "No viewport meta tag was found",
      "Check the mobile layout if this is intended to be a responsive page.",
      'No meta[name="viewport"] was found.',
    );
  }

  if (imagesMissingAlt > 0) {
    addFinding(
      findings,
      "images_missing_alt",
      "medium",
      "Some images have no alt attribute",
      "Provide alternative text for informative images; use an empty alt attribute for decorative images.",
      imagesMissingAlt + " of " + images.length + " images have no alt attribute.",
    );
  }

  if (emptyAnchors > 0) {
    addFinding(
      findings,
      "empty_links",
      "medium",
      "Some links have no accessible text",
      "Give each link a useful text label or an accessible name, including image links.",
      emptyAnchors + " of " + anchors.length + " links have no text or image alt text.",
    );
  }

  const invalidJsonLd = jsonLd.filter((item) => !item.valid);
  if (invalidJsonLd.length > 0) {
    addFinding(
      findings,
      "invalid_json_ld",
      "medium",
      "A JSON-LD block could not be parsed",
      "Correct the JSON syntax and then validate that the structured data matches visible page content.",
      invalidJsonLd.map((item) => "Block " + (item.index + 1) + ": " + item.error).join("; "),
    );
  }

  if (jsonLd.length > 0 && invalidJsonLd.length === 0) {
    addFinding(
      findings,
      "json_ld_present",
      "info",
      "JSON-LD structured data was found",
      "The blocks parse as JSON. This does not confirm schema validity, eligibility, or a special GEO benefit.",
      "Valid JSON-LD blocks: " + jsonLd.length,
    );
  }

  return {
    audit: "EdGEO page audit",
    observedAt: new Date().toISOString(),
    requestedUrl: response.requestedUrl,
    finalUrl: response.finalUrl,
    http: {
      status: response.status,
      statusText: response.statusText,
      redirectCount: response.redirectCount,
      redirectClassification: redirectClassification?.kind ?? "none",
      contentType: response.contentType,
      responseBytes: response.responseBytes,
      xRobotsTag: response.headers["x-robots-tag"] ?? null,
    },
    page: {
      title: title || null,
      titleCharacters: title.length,
      metaDescription: description || null,
      metaDescriptionCharacters: description.length,
      socialMetadata: { openGraph, twitterCard },
      canonical,
      robotsDirectives: robots || null,
      language: language || null,
      hreflangAlternates,
      h1Count: h1s.length,
      h1Text: h1s,
      headingCount: headings.length,
      headings,
      imageCount: images.length,
      imagesMissingAlt,
      linkCount: links.length,
      internalLinks,
      internalLinkUrls,
      externalLinks,
      emptyLinks: emptyAnchors,
      jsonLdBlocks: jsonLd.length,
      invalidJsonLdBlocks: invalidJsonLd.length,
      jsonLdTypes: [...jsonLdTypes].sort(),
      hasMainElement: $("main").length > 0,
      bodyTextCharacters: text.length,
      jsonLdTypeScanTruncated,
    },
    findings,
    limitations: [
      "This audit inspects server-returned HTML and response headers; it does not execute page JavaScript.",
      "It does not measure Core Web Vitals, confirm Google indexing, or observe Google Search result features.",
      "Findings are observations and review suggestions, not ranking guarantees or a composite score.",
    ],
  };
}
