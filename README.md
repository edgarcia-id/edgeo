# EdGEO

<img align="right" src="assets/edgeo-icon.svg" alt="EdGEO icon" width="96" height="96">

[![EdGEO MCP server](https://mcprush.com/badge/edgeo-mcp/card.svg)](https://mcprush.com/to/edgeo-mcp?ref=badge)

**A free, local-first MCP toolkit for evidence-based SEO, GEO, and Google AI Search audits.**

EdGEO gives compatible AI agents tools to inspect public website pages, crawl a bounded part of a site, analyze AI answers, and read a user's own Google Search Console data. It is a standalone open-source project. No EdGEO account, hosted EdGEO service, telemetry, or subscription is required.

> An API answer is not the same as what a person sees in ChatGPT, Gemini, Google AI Overviews, or another consumer product. EdGEO reports the source and conditions for each observation and does not promise rankings.

## What EdGEO can do

- **Audit a page:** inspect HTTP status and redirects, title and description, canonical and robots directives, headings, language, viewport, links, image alt text, Open Graph/Twitter metadata, hreflang, and parseable JSON-LD.
- **Crawl a bounded site sample:** make up to 50 same-host URL fetch attempts, starting from the requested URL and same-host sitemap URLs. EdGEO preserves trailing slashes when requesting URLs, follows `robots.txt` and crawl delay, separates non-HTML resources, and deduplicates pages that resolve to the same final URL. Remaining queued URLs are not a sitewide coverage estimate.
- **Collect an AI answer:** query an Ollama server on loopback or query the Gemini API after explicit consent. Returned observations include provider, model, prompt type, locale, timestamp, and limitations.
- **Analyze and compare AI answers:** analyze supplied or collected answers for literal brand mentions and domain citations. Compare answers only when prompt and recorded conditions match.
- **Connect to Google Search Console:** authorize the user's account with a read-only OAuth scope, list available properties, and query selected dates, dimensions, and search types.
- **Import exported data:** parse Search Console CSV/TSV locally, including common English and Indonesian headers, or summarize structured rows.

## Install in an AI agent

Install the local MCP server in selected clients with:

```sh
npx -y edgeo-mcp install --agent claude,codex,cursor,gemini
```

For a native Gemini CLI extension installation, use:

```sh
gemini extensions install https://github.com/edgarcia-id/edgeo
```

The extension registers the MCP prompt as `/edgeo`. Its optional Gemini API key setting is only needed for EdGEO's Gemini provider; the key is kept in Gemini CLI's sensitive extension settings.

For the Claude Code marketplace plugin, add the EdGEO marketplace and install its plugin:

```sh
claude plugin marketplace add edgarcia-id/edgeo
claude plugin install edgeo@edgeo-marketplace
```

The plugin provides MCP tools and the namespaced `/edgeo:edgeo` command. The standalone installer below also installs an unqualified `/edgeo` skill.

The installer merges user-level settings, backs up JSON config files before editing them, and preserves unrelated server entries. Claude Code and Codex use their native CLI commands; Cursor and Gemini CLI use their user MCP configuration. Claude Code and Codex also receive an EdGEO skill. Restart or reload the selected clients after installation.

```sh
npx -y edgeo-mcp doctor
npx -y edgeo-mcp uninstall --agent claude,codex,cursor,gemini
```

The MCP server registers a prompt named `edgeo`. Hosts that expose MCP prompts as slash commands may show `/edgeo`; other hosts use their skill picker, prompt UI, or normal tool invocation. MCP does not define one slash-command syntax for every agent.

For direct/manual setup and supported host behavior, read [Install and distribute EdGEO](docs/INSTALL_AND_DISTRIBUTE.md) and [agent install notes](integrations/mcp-setup.md).

## Search Console setup

Google Search Console API usage is free of charge and subject to Google's quotas. Each user connects their own Google account; EdGEO requests only the Search Console read-only scope. To connect, create a Google OAuth client of type **Desktop app**, enable the Search Console API in that Google Cloud project, and run:

```sh
npx -y edgeo-mcp search-console connect --client-id YOUR_DESKTOP_OAUTH_CLIENT_ID
```

The browser opens Google's consent screen and returns to a loopback callback on the same computer. The refresh token is stored in the user's local EdGEO data directory; set `EDGEO_DATA_DIR` to choose another directory. `edgeo-mcp search-console status` checks local setup and `edgeo-mcp search-console disconnect` revokes the saved grant and removes it.

See [Google Search Console connection details](docs/search-console.md) for OAuth setup and data handling.

## Model connections

- **Ollama:** local API requests go to `127.0.0.1:11434`; no model API bill is added by EdGEO. Local hardware is required. A cloud-backed Ollama model may still transmit prompts externally.
- **Gemini API:** configure `GEMINI_API_KEY` in the MCP process environment. The tool requires `consentToExternalRequest: true` before sending a prompt. Some model tiers have free quotas; rates, availability, and data terms vary. Do not send confidential data unless the provider's terms and settings are acceptable.

Neither connector automatically performs consumer-app testing or web search. Returned answers have no assumed citations. See [model connection details](docs/model-providers.md).

## Requirements and local development

- Node.js 20.18.1 or later
- An agent that supports local stdio MCP for agent use

```sh
npm ci
npm test
npm run typecheck
npm start
```

`npm start` runs the local stdio MCP server. The server writes diagnostic messages to stderr and reserves stdout for MCP messages. `npm test` builds the TypeScript and exercises CSV parsing, visibility analysis, API request shaping, OAuth token refresh, installer config merging, SSRF rejection, and MCP initialization/tool discovery.

## Method limits

- Page audits inspect server-returned HTML and headers. They do not render JavaScript, measure Core Web Vitals, verify indexing, or observe search rankings.
- Crawling is bounded to the exact hostname, obeys applicable `robots.txt` rules, and stops when robots.txt cannot be read.
- Search Console only reports fields and appearance labels returned by Google. EdGEO does not infer AI Overviews, AI Mode, or SGE from ordinary web search rows.
- Brand matching is literal and may need human entity review. A mention is not a positive description or recommendation; a citation does not prove support for a nearby claim.
- Comparisons are descriptive, not causal. Differences may reflect sampling, model updates, retrieval, account state, or unrecorded conditions.
- Search Console exports and API responses can omit anonymized queries or be truncated. A click, citation, or impression is not revenue or proof of a GEO effect.

## Privacy and security

Page and crawl requests go directly to the public site selected by the user. EdGEO blocks local/private IP targets and pins validated DNS addresses. Supplied data and API results are processed locally and returned to the connected agent; the agent host may keep conversation or tool data under its own policies. Gemini prompts leave the computer only after an explicit tool consent flag. See [privacy and data handling](docs/PRIVACY.md) and [security policy](SECURITY.md).

## License

Apache-2.0. Commercial use and redistribution are permitted subject to the license and included attribution notices. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Project status

The `edgeo-mcp` package and EdGEO server metadata are published to npm and the Official MCP Registry. Version 0.1.2 refines crawl URL handling, redirect classification, sitemap link observations, and heading cues. Version 0.1.1 added native Gemini CLI extension support; the Gemini gallery discovers qualifying tagged repositories through its daily crawler.
