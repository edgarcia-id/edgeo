# Install and distribute EdGEO

## Local bootstrap

After `github.com/edgarcia-id/edgeo` is public, users can configure selected local clients with:

```sh
npx -y --package=github:edgarcia-id/edgeo edgeo-mcp install --agent claude,codex,cursor,gemini
```

The GitHub package runs its `prepare` build when npm installs it. The installer launches the native MCP commands for Claude Code and Codex, and merges `mcpServers.edgeo` into the user's Cursor or Gemini JSON config. JSON files are backed up before modification. Conflicting `edgeo` entries are left untouched and reported.

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
| Gemini CLI | Merge EdGEO into `~/.gemini/settings.json` | MCP prompt may appear as `/edgeo` in supported CLI versions |

The MCP server registers a prompt named `edgeo`. MCP standardizes tools and prompts; each agent controls whether it surfaces that prompt as a slash command or another UI element. EdGEO cannot create a new built-in CLI subcommand inside another company's client.

## MCP Registry and agent catalogs

The repository can be published to the [Official MCP Registry](https://registry.modelcontextprotocol.io/docs) after a public GitHub repository and package metadata are ready. The registry is a discovery directory; it does not automatically list EdGEO in each proprietary agent catalog.

- **Gemini CLI extension gallery:** add a root `gemini-extension.json`, add the `gemini-cli-extension` GitHub topic, and use the public-repository release path. The gallery crawls tagged repos.
- **Claude Code marketplace:** publish a `.claude-plugin/marketplace.json` and the EdGEO plugin manifest, then users add `edgarcia-id/edgeo` as a marketplace.
- **Cursor marketplace:** package a Cursor plugin and submit it through Cursor's marketplace review flow.
- **ChatGPT/Codex public plugin directory:** submit a plugin package through the OpenAI plugin portal. Public remote MCP submissions need a stable public HTTPS endpoint; this project currently ships local stdio only. A local client can still be configured directly.

These directory submissions are not completed by pushing the source repository. They require separate manifests, platform policy review, and in the remote case a service endpoint. EdGEO is designed to remain usable locally without that hosted service.

## Release checklist

1. Confirm project owner, license, `NOTICE`, and contact/security policy.
2. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm audit --omit=dev` on a clean checkout.
3. Review `npm pack --dry-run` to verify the published package contents and executable entry point.
4. Create a version tag and GitHub Release after approving the public push. If npm is also used, configure npm publishing separately; no npm token is stored in this repository.
5. Submit the MCP Registry and agent catalog packages independently, using the corresponding official validation/review process.

## Source package commands

For local development:

```sh
npm ci
npm test
npm run typecheck
node dist/cli.js install --agent cursor,gemini
```

The published GitHub install command uses the repository URL directly. A future npm publication can shorten it to `npx -y edgeo-mcp ...` once the package name and account release are confirmed.
