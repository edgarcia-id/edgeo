# EdGEO privacy and data handling

EdGEO runs as a local process over MCP stdio. It has no EdGEO-hosted account, database, telemetry, or background upload. This does not mean every operation stays on the same computer: each connection described below has its own network destination.

## Network requests

- Page audits send bounded HTTP GET requests to the public URL selected by the user. They do not send cookies, authorization headers, or user-supplied credentials.
- Site crawls also request that site's `robots.txt`, same-host sitemap files, and a bounded set of same-host pages. EdGEO applies robots rules and crawl delay and blocks the crawl if robots.txt cannot be read.
- The public-site fetcher allows HTTP/HTTPS on ports 80/443, rejects local/private addresses, pins validated DNS addresses per request, limits redirects and response size, and enforces a request timeout.
- The optional Search Console connector sends OAuth refresh and API requests directly to Google. It stores a local refresh token and uses the read-only scope. Search Console results are returned to the connected agent.
- The optional Gemini connector sends a prompt to Google's Gemini API only when the tool call sets `consentToExternalRequest: true`. Provider terms, data use, and charges depend on the user's API account and selected model.
- The optional Ollama connector sends one prompt to the loopback Ollama API. Ollama may be configured to use a cloud model; the user should check the selected model's data flow.

## Local data and credentials

- Supplied answers, prompts, citations, Search Console rows, and website responses are processed in memory and returned to the connected agent. EdGEO does not keep an audit database or report history.
- Search Console OAuth credentials are stored in the user's local EdGEO data directory. On POSIX systems EdGEO requests user-only file permissions; on Windows it relies on the home directory's ACLs. Users are responsible for protecting the local account and chosen data directory.
- `GEMINI_API_KEY` is read from the MCP process environment and is not returned by EdGEO tools or written to EdGEO logs.
- The AI-agent host may send chat and tool inputs/outputs to its own model service or keep them in its logs. Local EdGEO execution does not make the agent's model local.

## Limits of this statement

This describes EdGEO's current implementation. It does not describe the privacy behavior of agent hosts, operating systems, Google, Gemini API, Ollama cloud models, or public websites being audited. Review each service's terms and avoid confidential inputs unless the complete data flow is acceptable.
