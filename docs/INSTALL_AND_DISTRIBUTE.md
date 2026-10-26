# Install and distribute EdGEO

## Local bootstrap

Users can configure selected local clients from the published npm package with:

```sh
npx -y edgeo-mcp install --agent claude,codex,cursor,gemini
```

The installer launches the native MCP commands for Claude Code and Codex, and merges `mcpServers.edgeo` into the user's Cursor or Gemini JSON config. JSON files are backed up before modification. Conflicting `edgeo` entries are left untouched and reported.

Supported commands:

```sh
edgeo-mcp install --agent claude,codex,cursor,gemini
edgeo-mcp doctor
edgeo-mcp uninstall --agent claude,codex,cursor,gemini
edgeo-mcp search-console connect --client-id YOUR_DESKTOP_OAUTH_CLIENT_ID
edgeo-mcp search-console status
edgeo-mcp search-console disconnect
```

Use only the agent names installed on the computer. `--agent all` selects all four and will report an error if Claude Code or Codex's native CLI is unavailable. `doctor` checks local client/config presence and the saved OAuth grant; it makes no external API calls.

The installer configures a local stdio process. Public/cloud agent clients cannot launch a process on a user's computer; their remote MCP endpoint or secure-tunnel setup is separate and is not part of this source release.

## What differs by host

| Agent | Installer behavior | Invocation |
|---|---|---|
| Claude Code | `claude mcp add --scope user` plus a global EdGEO skill | `/edgeo` skill; MCP tools are available in the session |
| Codex | `codex mcp add` plus a global EdGEO skill | `$edgeo` / skill picker; MCP prompt behavior depends on host support |
| Cursor | Merge EdGEO into `~/.cursor/mcp.json` | MCP tools in the agent; use its prompt interface where exposed |
| Gemini CLI | Install the EdGEO extension from GitHub | `/edgeo` MCP prompt |

Claude Code can also install the repository's self-hosted marketplace plugin:

```sh
claude plugin marketplace add edgarcia-id/edgeo
claude plugin install edgeo@edgeo-marketplace
```

The plugin command is namespaced as `/edgeo:edgeo`. A third-party marketplace can be hosted in the same public GitHub repository without an Anthropic directory submission. The Anthropic directory is a separate, reviewed listing for Claude.ai and Cowork and requires a paid Claude plan to submit.

The MCP server registers a prompt named `edgeo`. MCP standardizes tools and prompts; each agent controls whether it surfaces that prompt as a slash command or another UI element. EdGEO cannot create a new built-in CLI subcommand inside another company's client.

## MCP Registry and agent catalogs

The repository includes `server.json` and the npm `mcpName` required by the [Official MCP Registry](https://registry.modelcontextprotocol.io/docs). Publish the npm package first, then authenticate with `mcp-publisher` and publish `server.json`. The registry is a discovery directory; it does not automatically list EdGEO in each proprietary agent catalog. See the [official package publishing quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx).

- **Gemini CLI extension gallery:** the repository has a root `gemini-extension.json`; install it with `gemini extensions install https://github.com/edgarcia-id/edgeo`. A public repo with the `gemini-cli-extension` topic is discovered by the gallery crawler. See the [official release guide](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/releasing.md).
- **Claude Code marketplace:** publish a `.claude-plugin/marketplace.json` and the EdGEO plugin manifest, then users add `edgarcia-id/edgeo` as a marketplace.
- **Cursor marketplace:** package a Cursor plugin and submit it through Cursor's marketplace review flow.
- **ChatGPT/Codex public plugin directory:** submit a plugin package through the OpenAI plugin portal. Public remote MCP submissions need a stable public HTTPS endpoint; this project currently ships local stdio only. A local client can still be configured directly.

These directory submissions are not completed by pushing the source repository. They require separate manifests, platform policy review, and in the remote case a service endpoint. EdGEO is designed to remain usable locally without that hosted service.

## Release checklist

1. Confirm project owner, license, `NOTICE`, and contact/security policy.
2. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm audit --omit=dev` on a clean checkout.
3. Review `npm pack --dry-run` to verify the published package contents and executable entry point.
4. Publish `edgeo-mcp` to npm, then validate and publish `server.json` with `mcp-publisher`.
5. Create a version tag and GitHub Release after approval. Submit other agent listings separately through each platform's validation and review flow.

## Source package commands

For local development:

```sh
npm ci
npm test
npm run typecheck
node dist/cli.js install --agent cursor,gemini
```

The GitHub source install command remains available as a bootstrap option before npm publication.
