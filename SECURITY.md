# Security policy

## Supported versions

Security fixes are made against the latest release. Users should update to the latest tagged release before reporting a vulnerability.

## Reporting a vulnerability

Please do not publish exploitable vulnerability details in a public issue. Use GitHub's private vulnerability reporting for `edgarcia-id/edgeo` when available. If private reporting is not enabled yet, contact the repository owner through the GitHub profile and ask for a private reporting channel.

Include the affected release/commit, reproduction steps, impact, and any suggested mitigation. Do not include live tokens, customer data, or secrets. Reports are reviewed as maintainers become available; this project does not promise a response-time SLA.

## Scope

The local server accepts user-selected public URLs and makes optional outbound calls to Gemini and Google Search Console. Reports about SSRF, credential leakage, OAuth state/token handling, unsafe file writes, or MCP tool input handling are especially relevant. Agent host, provider, operating system, and public-site behavior remain outside EdGEO's control.
