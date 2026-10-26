import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  analyzeVisibility,
  compareVisibilityRuns,
  summarizeSearchConsole,
} from "./analysis.js";
import { auditPage } from "./audit.js";
import { crawlSite } from "./site-crawl.js";
import { importSearchConsoleCsv } from "./search-console-csv.js";
import { queryModel } from "./model-providers.js";
import {
  listGoogleSearchConsoleSites,
  queryGoogleSearchConsole,
} from "./search-console-api.js";

const visibilityObservationSchema = z.object({
  id: z.string().min(1).max(100),
  source: z.enum(["provider_api", "consumer_web", "user_supplied"]),
  provider: z.string().min(1).max(100),
  model: z.string().max(200).optional(),
  surface: z.string().max(100).optional(),
  locale: z.string().min(1).max(50),
  searchMode: z.string().min(1).max(100),
  promptType: z.enum(["brand_recognition", "unbranded_discovery", "comparison", "other"]),
  prompt: z.string().min(1).max(20_000),
  observedAt: z.string().min(1).max(50),
  status: z.enum(["complete", "partial", "failed"]),
  answer: z.string().max(100_000).optional(),
  citations: z.array(z.string().max(2_000)).max(100).default([]),
});

function asToolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function asToolError(error: unknown) {
  const message = error instanceof Error ? error.message : "The audit failed.";
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
  };
}

function createServer() {
  const server = new McpServer(
    { name: "edgeo", version: "0.1.0" },
    { maxToolInputElements: 100_000 },
  );

  server.registerPrompt(
    "edgeo",
    {
      title: "Run an EdGEO audit",
      description:
        "Audit a website or supplied/authorized SEO, GEO, and Search Console evidence using EdGEO tools and an evidence-first report.",
      argsSchema: z.object({
        url: z.string().url().optional().describe("Public website URL, when known."),
        request: z
          .string()
          .max(20_000)
          .optional()
          .describe("Audit goal, brand, market, or supplied evidence context."),
      }),
    },
    ({ url, request }) => {
      const details = [
        "Run an evidence-first SEO, GEO, or Google AI Search audit using the available EdGEO MCP tools.",
        "Use edgeo_audit_page for a public webpage, edgeo_crawl_site for a bounded robots-aware crawl, edgeo_analyze_visibility or edgeo_compare_visibility_runs for supplied model answers, and edgeo_import_search_console_csv or edgeo_summarize_search_console for Search Console data.",
        "Choose a single page or a bounded site crawl based on the requested scope. For a crawl, state the page cap and do not bypass robots.txt. If robots.txt is unavailable, explain that the crawl was blocked.",
        "For GEO, separate brand recognition, unbranded discovery, comparison, and use-case questions. Do not invent answers or pretend EdGEO queried a model. Compare runs only when the recorded conditions and normalized prompt match.",
        "For Google AI Search, use the read-only Search Console tools when the user has connected their own Google account, or import a supplied export. Keep feature labels as provided and do not infer AI Overviews, AI Mode, or SGE from unlabeled rows.",
        "For model tests, use edgeo_query_model only when requested. Ollama runs on loopback; Gemini sends the prompt externally and requires explicit consent. Do not send private data to external providers without that consent.",
        "Keep observations, interpretations, recommendations, citations, and visits separate. Do not invent a score or ranking guarantee.",
        "Show the evidence, sample size, failed or partial observations, method limits, and a validation step for each recommendation.",
      ];
      if (url) details.push("Target URL: " + url);
      if (request) details.push("User request/context: " + request);
      return {
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: details.join("\n\n") },
          },
        ],
      };
    },
  );

  server.registerTool(
    "edgeo_audit_page",
    {
      title: "Audit a public webpage",
      description:
        "Fetch and audit one public HTTP/HTTPS HTML page for observable technical SEO and page-structure signals. Does not render JavaScript, measure Core Web Vitals, or verify search indexing.",
      inputSchema: z.object({
        url: z.string().url().describe("Public HTTP or HTTPS page URL to inspect."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url }) => {
      try {
        return asToolResult(await auditPage(url));
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "edgeo_crawl_site",
    {
      title: "Crawl and audit a public site",
      description:
        "Run a bounded same-host HTML crawl seeded from the start URL and same-host sitemap URLs. Reads robots.txt first, applies its rules and crawl-delay, and never renders JavaScript or follows links to other hosts.",
      inputSchema: z.object({
        url: z.string().url().describe("Public HTTP or HTTPS start URL."),
        maxPages: z.number().int().min(1).max(50).default(20),
        delayMs: z.number().int().min(100).max(10_000).default(500),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ url, maxPages, delayMs }) => {
      try {
        return asToolResult(await crawlSite({ url, maxPages, delayMs }));
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "edgeo_analyze_visibility",
    {
      title: "Analyze supplied AI answers",
      description:
        "Analyze caller-supplied answers with transparent brand alias and citation checks. Keeps prompt types and failures separate; does not call models or automatically label recommendations.",
      inputSchema: z.object({
        brandName: z.string().min(1).max(200),
        aliases: z.array(z.string().min(1).max(200)).max(20).default([]),
        brandDomain: z.string().max(253).optional(),
        observations: z
          .array(visibilityObservationSchema)
          .min(1)
          .max(100),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ brandName, aliases, brandDomain, observations }) => {
      try {
        return asToolResult(
          analyzeVisibility({ brandName, aliases, brandDomain, observations }),
        );
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "edgeo_compare_visibility_runs",
    {
      title: "Compare two sets of supplied AI answers",
      description:
        "Compare complete answers only when the normalized prompt and recorded source, provider, model, surface, locale, search mode, and prompt type match. Returns paired mention and citation changes with sample counts; does not infer causation or call AI providers.",
      inputSchema: z.object({
        brandName: z.string().min(1).max(200),
        aliases: z.array(z.string().min(1).max(200)).max(20).default([]),
        brandDomain: z.string().max(253).optional(),
        before: z.array(visibilityObservationSchema).min(1).max(100),
        after: z.array(visibilityObservationSchema).min(1).max(100),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ brandName, aliases, brandDomain, before, after }) => {
      try {
        return asToolResult(
          compareVisibilityRuns({ brandName, aliases, brandDomain, before, after }),
        );
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "edgeo_summarize_search_console",
    {
      title: "Summarize supplied Search Console rows",
      description:
        "Summarize user-supplied Search Console rows by provided feature label, including clicks, impressions, CTR, and impression-weighted average position. Does not connect to Google or infer an AI feature from unlabeled data.",
      inputSchema: z.object({
        rows: z
          .array(
            z.object({
              date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
              page: z.string().max(2_000).optional(),
              query: z.string().max(2_000).optional(),
              feature: z.string().max(200).optional(),
              country: z.string().max(100).optional(),
              device: z.string().max(100).optional(),
              clicks: z.number().nonnegative(),
              impressions: z.number().nonnegative(),
              position: z.number().nonnegative().optional(),
            }),
          )
          .min(1)
          .max(10_000),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ rows }) => {
      try {
        return asToolResult(summarizeSearchConsole(rows));
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "edgeo_import_search_console_csv",
    {
      title: "Import a Search Console CSV locally",
      description:
        "Parse a user-provided CSV or TSV export in memory, recognize common English and Indonesian Search Console headers, and return a transparent summary. The file contents are not uploaded or persisted by this tool.",
      inputSchema: z.object({
        csvText: z.string().min(1).max(5_242_880),
        delimiter: z.enum([",", "\t", ";"]).optional(),
        columnMap: z
          .object({
            date: z.string().max(200).optional(),
            page: z.string().max(200).optional(),
            query: z.string().max(200).optional(),
            feature: z.string().max(200).optional(),
            clicks: z.string().max(200).optional(),
            impressions: z.string().max(200).optional(),
            position: z.string().max(200).optional(),
            country: z.string().max(200).optional(),
            device: z.string().max(200).optional(),
          })
          .partial()
          .optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ csvText, delimiter, columnMap }) => {
      try {
        return asToolResult(importSearchConsoleCsv({ csvText, delimiter, columnMap }));
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "edgeo_query_model",
    {
      title: "Collect one AI model answer",
      description:
        "Send one prompt to a configured local Ollama model or, with explicit consent and GEMINI_API_KEY configured, Google Gemini API. Returns an observation ready for EdGEO visibility analysis. Provider API output is not equivalent to a consumer AI app or Google AI Search result; no citations are assumed.",
      inputSchema: z.object({
        provider: z.enum(["ollama", "gemini"]),
        model: z.string().min(1).max(200),
        prompt: z.string().min(1).max(20_000),
        locale: z.string().min(1).max(50),
        promptType: z.enum(["brand_recognition", "unbranded_discovery", "comparison", "other"]),
        maxOutputTokens: z.number().int().min(64).max(8192).optional(),
        consentToExternalRequest: z
          .boolean()
          .optional()
          .describe("Must be true to send a prompt to the external Gemini API. Not needed for Ollama loopback."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        return asToolResult(await queryModel(input));
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "edgeo_search_console_sites",
    {
      title: "List connected Search Console properties",
      description:
        "List Google Search Console properties for the user's locally authorized Google account. Requires prior setup with `edgeo-mcp search-console connect`; uses a read-only OAuth scope and returns only properties the Google account can access.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return asToolResult(await listGoogleSearchConsoleSites());
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  server.registerTool(
    "edgeo_search_console_query",
    {
      title: "Query Google Search Console",
      description:
        "Query the user's authorized Google Search Console property for web, image, video, news, Discover, or Google News performance rows. Requires `edgeo-mcp search-console connect`. Reads Search Console directly with OAuth read-only access; AI feature labels are never inferred from generic search rows.",
      inputSchema: z.object({
        siteUrl: z.string().min(1).max(2048).describe("Verified Search Console property, such as https://example.com/ or sc-domain:example.com."),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dimensions: z.array(z.enum(["date", "query", "page", "country", "device", "searchAppearance"])).max(6).default(["date"]),
        searchType: z.enum(["web", "image", "video", "news", "discover", "googleNews"]).default("web"),
        aggregationType: z.enum(["auto", "byPage", "byProperty"]).default("auto"),
        rowLimit: z.number().int().min(1).max(25_000).default(1000),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        return asToolResult(await queryGoogleSearchConsole(input));
      } catch (error) {
        return asToolError(error);
      }
    },
  );

  return server;
}

serveStdio(createServer);
console.error("EdGEO MCP server running on stdio.");
