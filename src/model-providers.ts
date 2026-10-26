export type ModelProvider = "ollama" | "gemini";
export type AuditPromptType = "brand_recognition" | "unbranded_discovery" | "comparison" | "other";

export interface ModelQueryInput {
  provider: ModelProvider;
  model: string;
  prompt: string;
  locale: string;
  promptType: AuditPromptType;
  maxOutputTokens?: number;
  consentToExternalRequest?: boolean;
}

type FetchLike = typeof fetch;

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 1_048_576) {
    throw new Error("The model response exceeded the 1 MiB response limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The model provider returned invalid JSON.");
  }
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? JSON.stringify((parsed as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(`The model provider request failed: ${message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The model provider returned an unexpected response.");
  }
  return parsed as Record<string, unknown>;
}

function outputText(content: unknown): string {
  if (!content || typeof content !== "object" || Array.isArray(content)) return "";
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) =>
      part && typeof part === "object" && "text" in part && typeof part.text === "string"
        ? part.text
        : "",
    )
    .join("")
    .trim();
}

export async function queryModel(
  input: ModelQueryInput,
  options: { fetchImpl?: FetchLike; apiKey?: string } = {},
) {
  const model = input.model.trim();
  const prompt = input.prompt.trim();
  const locale = input.locale.trim();
  if (!model || model.length > 200) throw new Error("Provide a model name up to 200 characters.");
  if (!prompt || prompt.length > 20_000) throw new Error("Provide a prompt up to 20,000 characters.");
  if (!locale || locale.length > 50) throw new Error("Provide a locale up to 50 characters.");
  const maxOutputTokens = Math.max(64, Math.min(input.maxOutputTokens ?? 1024, 8192));
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  let providerLabel: string;
  let searchMode: string;

  if (input.provider === "ollama") {
    response = await fetchImpl("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: { num_predict: maxOutputTokens },
      }),
    });
    providerLabel = "Ollama local API";
    searchMode = "offline";
  } else {
    if (input.consentToExternalRequest !== true) {
      throw new Error("Set consentToExternalRequest to true to send this prompt to Gemini API.");
    }
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured for the EdGEO MCP process.");
    }
    response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(90_000),
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens },
        }),
      },
    );
    providerLabel = "Google Gemini API";
    searchMode = "offline";
  }

  const result = await readJsonResponse(response);
  let answer = "";
  if (input.provider === "ollama") {
    const message = result.message;
    if (message && typeof message === "object" && "content" in message) {
      answer = typeof message.content === "string" ? message.content.trim() : "";
    }
  } else {
    const candidates = result.candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      answer = outputText((candidates[0] as { content?: unknown }).content);
    }
  }
  if (!answer) throw new Error("The model returned no text answer.");

  return {
    observation: {
      id: crypto.randomUUID(),
      source: "provider_api" as const,
      provider: providerLabel,
      model,
      surface: "provider_api",
      locale,
      searchMode,
      promptType: input.promptType,
      prompt,
      observedAt: new Date().toISOString(),
      status: "complete" as const,
      answer,
      citations: [] as string[],
    },
    limitations: [
      "This is a provider API answer, not the consumer web or app experience.",
      "No web search was requested; citations are empty and must not be inferred from answer text.",
      ...(input.provider === "ollama"
        ? ["Ollama is addressed on loopback; a locally configured cloud-backed Ollama model may still send prompts to its provider."]
        : ["The prompt was sent to Google Gemini API under the account and data terms for the configured API key."]),
    ],
  };
}
