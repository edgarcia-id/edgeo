# Model provider connections

EdGEO can collect individual model API answers as observations for analysis. Model API results are not consumer web/app results and do not represent Google AI Search.

## Ollama local API

1. Install and start Ollama on the same computer.
2. Pull a model you want to evaluate, for example `ollama pull qwen3:8b`.
3. Call `edgeo_query_model` with `provider: "ollama"`, the installed model name, the prompt, locale, and prompt type.

EdGEO connects only to `http://127.0.0.1:11434/api/chat`. It does not issue web search and returns an empty citations array rather than guessing sources. Model quality and speed depend on local hardware. Ollama may also expose cloud-backed models; review the model's data flow before testing confidential prompts.

## Google Gemini API

Set `GEMINI_API_KEY` in the EdGEO MCP process environment, choose a Gemini API model available to the key, and call `edgeo_query_model` with `provider: "gemini"` and `consentToExternalRequest: true`.

The explicit consent flag is required for every Gemini request. The prompt and locale are sent directly to Google's Gemini API. EdGEO does not include Google Search grounding in this tool and returns no citations. Some models currently have free-tier quotas, while others are paid or unavailable on the free tier. Google may use some free-tier inputs to improve products; check the current model-specific pricing and data terms before sending sensitive information.

## Observation format

The tool returns an `observation` object compatible with `edgeo_analyze_visibility`:

- source and provider
- model and API surface
- prompt, prompt type, and locale
- search mode (currently `offline`)
- collection timestamp and status
- answer and citations (empty unless a future connector explicitly retrieves them)

Each API call may incur provider charges depending on the account and model. EdGEO does not retry a failed request automatically or treat it as a zero-mention result.
