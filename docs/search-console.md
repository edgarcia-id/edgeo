# Google Search Console connection

EdGEO can read a user's Search Console properties directly. The API is free of charge under Google's current pricing page, subject to its usage limits. EdGEO requests only `https://www.googleapis.com/auth/webmasters.readonly` and never writes to Search Console.

## Create a desktop OAuth client

1. In Google Cloud Console, create or select a project and enable the Google Search Console API.
2. Configure the OAuth consent screen. If the app is in Testing mode, add the Google account that will authorize it as a test user.
3. Create an OAuth client with application type **Desktop app**.
4. On a computer that has EdGEO installed, run:

   ```sh
   edgeo-mcp search-console connect --client-id YOUR_DESKTOP_OAUTH_CLIENT_ID
   ```

   If your desktop client uses a client secret, pass `--client-secret` or set `GOOGLE_OAUTH_CLIENT_SECRET` for the command. Do not commit credentials or paste them into an agent conversation.

5. Sign in as the Google account that has permission for the desired Search Console properties and approve the read-only scope.
6. In the agent, call `edgeo_search_console_sites`, then `edgeo_search_console_query` with the exact property URL or `sc-domain:example.com` value.

The OAuth callback listens on an ephemeral loopback port on the same computer. The token exchange uses PKCE and state validation. If the browser is on another computer, copy the authorization URL into a browser on the computer running EdGEO; do not expose the callback port to a network.

## Token storage and removal

EdGEO stores the OAuth refresh token, access token, client ID, and optional client secret as JSON under `~/.edgeo/google-search-console-token.json` (Windows: the user's home directory). On POSIX systems the file is created with user-only permissions. Windows relies on the user profile's filesystem ACLs. Set `EDGEO_DATA_DIR` before connecting to use a different directory. Protect the account and the directory like other local credentials.

Run `edgeo-mcp search-console status` to check whether local credentials are present. Run `edgeo-mcp search-console disconnect` to request Google token revocation and delete the local file. You can also revoke EdGEO from your Google Account's third-party connections page.

## Available MCP tools

- `edgeo_search_console_sites` lists the properties authorized for the account; optionally pass `siteUrlContains` to filter property URLs case-insensitively.
- `edgeo_search_console_query` reads rows using the date range, search type, dimensions, aggregation, and row limit the user specifies.

Supported dimensions are `date`, `query`, `page`, `country`, `device`, and `searchAppearance`. The limit is 25,000 rows per request. Google may return fewer rows, omit anonymized queries, or truncate results.

`searchAppearance` values are passed through only when Search Console returns them. EdGEO does not classify generic web rows as AI Overviews, AI Mode, or SGE. API performance data cannot establish why a model recommended a product or whether a change caused a result.

## Data flow

The refresh token is stored on the local computer. EdGEO sends OAuth token refresh and Search Console requests directly to Google over HTTPS. Returned rows go to the connected agent and may be included in that agent's context or logs under its own service terms. EdGEO has no hosted database or telemetry.
