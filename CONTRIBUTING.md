# Contributing to EdGEO

Contributions that improve evidence quality, safety, accessibility, documentation, or supported host workflows are welcome.

## Before opening a change

1. Open an issue for a significant feature or methodology change so its scope and limitations can be discussed.
2. Keep source attribution, prompt conditions, sample denominators, failures, and uncertainty explicit.
3. Do not add telemetry, hosted dependencies, model calls, or credential collection without clear opt-in and documentation.
4. Add or update automated tests for behavior changes.

## Local checks

```sh
npm ci
npm test
npm run typecheck
npm audit --omit=dev
```

For package changes, also review:

```sh
npm pack --dry-run
```

## Submitting a contribution

- Describe the user-visible behavior and the evidence that supports it.
- Include provider/model, locale, search mode, and other conditions when changing measurement behavior.
- Keep each pull request focused and update related docs and language-specific adapters.
- Do not commit API keys, OAuth tokens, local Search Console data, or personal website exports.

By submitting a contribution, you agree that the contribution is offered under the project's Apache-2.0 license unless a separate written agreement says otherwise.
