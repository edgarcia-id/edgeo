# Changelog

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
