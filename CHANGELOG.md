# Changelog

## 0.1.2 — crawl and audit accuracy

- Preserve trailing slashes from sitemap and internal links when requesting pages; report one-hop normalization separately from multi-hop redirect chains.
- Deduplicate page observations by final URL, compare sitemap and link routes across trailing-slash variants, and separate non-HTML sitemap resources.
- Describe partial sitemap/link observations as unobserved in scanned HTML, not orphan pages; expose known queue counts without implying sitewide coverage.
- Ignore explicitly hidden headings and label heading-level gaps as informational structure cues rather than ranking problems.
- Use the published npm package in generated agent configurations and derive CLI/MCP version strings from package metadata.

## 0.1.1 — Gemini CLI extension

- Add a native Gemini CLI extension manifest that starts the published npm MCP server.
- Expose the `edgeo` MCP prompt as the Gemini CLI `/edgeo` command.
- Keep the optional Gemini API key in Gemini CLI's sensitive extension settings.
- Include the extension manifest in the npm package and update MCP Registry metadata.

## 0.1.0 — initial release

- Add local MCP tools for page audits, bounded site crawling, Search Console CSV import and summaries, AI answer analysis, and comparison of recorded observations.
- Add optional provider API observations through loopback Ollama or Google Gemini with explicit consent before external prompt submission.
- Add direct read-only Google Search Console OAuth access, property listing, and bounded performance queries.
- Add local installers and setup instructions for Claude Code, Codex, Cursor, and Gemini CLI.
- Add SSRF defenses for public website collection, request and response limits, privacy notes, and release checks.
- License the project under Apache-2.0 and include the required attribution notice.

This release does not render JavaScript, perform traditional search rank tracking, or guarantee AI recommendations. See the README for measurement and provider limitations.
