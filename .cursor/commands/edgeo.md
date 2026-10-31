---
name: edgeo
description: Audit public website SEO, analyze AI visibility evidence, or inspect connected Google Search Console data.
argument-hint: [URL or audit request]
---

Use the EdGEO MCP tools to fulfill this request: $ARGUMENTS

Choose `edgeo_audit_page` for one public URL or `edgeo_crawl_site` for a bounded same-host crawl that honors robots.txt (default 50 attempted URLs, maximum 200). Raise the cap when the user requests a broader sample. For model answers, use `edgeo_query_model` only when requested: Ollama targets loopback; Gemini sends the prompt externally and requires `consentToExternalRequest: true`. Analyze results with `edgeo_analyze_visibility` and compare matching runs with `edgeo_compare_visibility_runs`.

Use the Search Console read-only tools only after the user has connected their Google account. Preserve actual `searchAppearance` values. Do not infer AI Overviews, AI Mode, or SGE from generic search rows.

Show evidence, denominators, failures, uncertainty, and validation steps. A mention is not a recommendation; a citation does not prove support; provider API results do not represent consumer AI apps or Google AI Search. Do not promise rankings or invent a single visibility score.
