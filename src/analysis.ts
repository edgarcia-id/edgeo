export type PromptType =
  | "brand_recognition"
  | "unbranded_discovery"
  | "comparison"
  | "other";

export interface VisibilityObservation {
  id: string;
  source: "provider_api" | "consumer_web" | "user_supplied";
  provider: string;
  model?: string;
  surface?: string;
  locale: string;
  searchMode: string;
  promptType: PromptType;
  prompt: string;
  observedAt: string;
  status: "complete" | "partial" | "failed";
  answer?: string;
  citations: string[];
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function containsLiteralAlias(text: string, alias: string): boolean {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "u").test(text);
}

function hostMatchesDomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const trimmed = domain.trim().replace(/^\*\./, "");
  let target = trimmed.toLowerCase().replace(/\.$/, "");
  try {
    target = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname
      .toLowerCase()
      .replace(/\.$/, "");
  } catch {
    // Leave malformed input unmatched unless it is itself a valid hostname.
  }
  return host === target || host.endsWith("." + target);
}

export function analyzeVisibility(input: {
  brandName: string;
  aliases: string[];
  brandDomain?: string;
  observations: VisibilityObservation[];
}) {
  const aliases = [...new Set([input.brandName, ...input.aliases].map((value) => value.trim()).filter(Boolean))];
  const normalizedAliases = aliases.map((alias) => ({ alias, normalized: normalize(alias) }));
  const processed = input.observations.map((observation) => {
    const answer = observation.answer ?? "";
    const normalizedAnswer = normalize(answer);
    const mentionedAliases = normalizedAliases
      .filter((item) => item.normalized && containsLiteralAlias(normalizedAnswer, item.normalized))
      .map((item) => item.alias);
    const brandAppearsInPrompt = normalizedAliases.some(
      (item) => item.normalized && containsLiteralAlias(normalize(observation.prompt), item.normalized),
    );
    const domainCitations = input.brandDomain
      ? observation.citations.filter((citation) => {
          try {
            return hostMatchesDomain(new URL(citation).hostname, input.brandDomain as string);
          } catch {
            return false;
          }
        })
      : [];

    return {
      id: observation.id,
      source: observation.source,
      provider: observation.provider,
      model: observation.model ?? null,
      surface: observation.surface ?? null,
      locale: observation.locale,
      searchMode: observation.searchMode,
      promptType: observation.promptType,
      observedAt: observation.observedAt,
      status: observation.status,
      brandAppearsInPrompt,
      unbrandedPromptNeedsReview:
        observation.promptType === "unbranded_discovery" && brandAppearsInPrompt,
      answerCharacters: answer.length,
      brandMentioned: mentionedAliases.length > 0,
      matchedAliases: mentionedAliases,
      citationsReturned: observation.citations.length,
      brandDomainCitations: domainCitations,
      recommendationAssessment: "not_assessed",
      answerExcerpt: answer.slice(0, 500) || null,
    };
  });

  const buckets = new Map<string, typeof processed>();
  for (const item of processed) {
    const key = JSON.stringify([
      item.source,
      item.provider,
      item.model ?? "model_not_specified",
      item.surface ?? "surface_not_specified",
      item.locale,
      item.searchMode,
      item.promptType,
    ]);
    const current = buckets.get(key) ?? [];
    current.push(item);
    buckets.set(key, current);
  }

  const summaries = [...buckets.entries()].map(([key, items]) => {
    const dimensions = JSON.parse(key) as string[];
    const group = dimensions.join(" | ");
    const valid = items.filter((item) => item.status === "complete" && item.answerCharacters > 0);
    const mentions = valid.filter((item) => item.brandMentioned).length;
    const citations = valid.filter((item) => item.brandDomainCitations.length > 0).length;
    const dates = items.map((item) => item.observedAt).sort();
    return {
      group,
      conditions: {
        source: items[0]?.source ?? null,
        provider: items[0]?.provider ?? null,
        model: items[0]?.model ?? null,
        surface: items[0]?.surface ?? null,
        locale: items[0]?.locale ?? null,
        searchMode: items[0]?.searchMode ?? null,
        promptType: items[0]?.promptType ?? null,
      },
      observedAtRange: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
      plannedObservations: items.length,
      validAnswers: valid.length,
      partialAnswers: items.filter((item) => item.status === "partial").length,
      failedAnswers: items.filter((item) => item.status === "failed").length,
      completeButEmpty: items.filter(
        (item) => item.status === "complete" && item.answerCharacters === 0,
      ).length,
      answersWithBrandMention: mentions,
      mentionRate: valid.length ? mentions / valid.length : null,
      answersWithBrandDomainCitation: input.brandDomain ? citations : null,
      brandDomainCitationRate: input.brandDomain && valid.length ? citations / valid.length : null,
      recommendationRate: null,
      note: "Mention and citation rates use valid answers as the denominator. Recommendation is not automatically classified.",
    };
  });

  return {
    analysis: "EdGEO supplied-answer visibility analysis",
    observedAt: new Date().toISOString(),
    brandName: input.brandName,
    aliases,
    brandDomain: input.brandDomain ?? null,
    plannedObservations: input.observations.length,
    summaries,
    observations: processed,
    limitations: [
      "Answers were supplied by the caller; EdGEO did not query any model or consumer AI product.",
      "Literal alias matches can confuse entities with similar names and need human review.",
      "A brand mention is not automatically a positive description or recommendation.",
      "Returned citations do not by themselves prove that a source supports the adjacent claim.",
      "An API answer is not equivalent to the consumer web or app experience.",
      "These observations do not represent a market share or permanent ranking.",
    ],
  };
}

function conditionKey(observation: VisibilityObservation): string {
  return JSON.stringify([
    observation.source,
    observation.provider,
    observation.model ?? "model_not_specified",
    observation.surface ?? "surface_not_specified",
    observation.locale,
    observation.searchMode,
    observation.promptType,
  ]);
}

function normalizedPrompt(prompt: string): string {
  return normalize(prompt).replace(/\s+/g, " ");
}

export function compareVisibilityRuns(input: {
  brandName: string;
  aliases: string[];
  brandDomain?: string;
  before: VisibilityObservation[];
  after: VisibilityObservation[];
}) {
  const beforeAnalysis = analyzeVisibility({
    brandName: input.brandName,
    aliases: input.aliases,
    brandDomain: input.brandDomain,
    observations: input.before,
  });
  const afterAnalysis = analyzeVisibility({
    brandName: input.brandName,
    aliases: input.aliases,
    brandDomain: input.brandDomain,
    observations: input.after,
  });
  const beforeGroups = new Map<string, Map<string, VisibilityObservation[]>>();
  const afterGroups = new Map<string, Map<string, VisibilityObservation[]>>();
  const collect = (
    observations: VisibilityObservation[],
    target: Map<string, Map<string, VisibilityObservation[]>>,
  ) => {
    for (const observation of observations) {
      const group = conditionKey(observation);
      const promptKey = normalizedPrompt(observation.prompt);
      const prompts = target.get(group) ?? new Map<string, VisibilityObservation[]>();
      const items = prompts.get(promptKey) ?? [];
      items.push(observation);
      prompts.set(promptKey, items);
      target.set(group, prompts);
    }
  };
  collect(input.before, beforeGroups);
  collect(input.after, afterGroups);

  const comparisons = [...beforeGroups.entries()].map(([group, beforePrompts]) => {
    const afterPrompts = afterGroups.get(group) ?? new Map<string, VisibilityObservation[]>();
    let matched = 0;
    let beforeMentions = 0;
    let afterMentions = 0;
    let beforeCitations = 0;
    let afterCitations = 0;
    let transitions = 0;
    let mentionAdded = 0;
    let mentionRemoved = 0;
    let beforeValid = 0;
    let afterValid = 0;

    for (const observations of beforePrompts.values()) {
      beforeValid += observations.filter(
        (item) => item.status === "complete" && Boolean(item.answer?.trim()),
      ).length;
    }
    for (const observations of afterPrompts.values()) {
      afterValid += observations.filter(
        (item) => item.status === "complete" && Boolean(item.answer?.trim()),
      ).length;
    }

    for (const [prompt, beforeItems] of beforePrompts.entries()) {
      const afterItems = afterPrompts.get(prompt) ?? [];
      const beforeValidItems = beforeItems.filter(
        (item) => item.status === "complete" && Boolean(item.answer?.trim()),
      );
      const afterValidItems = afterItems.filter(
        (item) => item.status === "complete" && Boolean(item.answer?.trim()),
      );
      const pairs = Math.min(beforeValidItems.length, afterValidItems.length);
      for (let index = 0; index < pairs; index += 1) {
        const previous = beforeValidItems[index]!;
        const current = afterValidItems[index]!;
        const previousMention = analyzeVisibility({
          brandName: input.brandName,
          aliases: input.aliases,
          brandDomain: input.brandDomain,
          observations: [previous],
        }).observations[0]!;
        const currentMention = analyzeVisibility({
          brandName: input.brandName,
          aliases: input.aliases,
          brandDomain: input.brandDomain,
          observations: [current],
        }).observations[0]!;
        matched += 1;
        beforeMentions += Number(previousMention.brandMentioned);
        afterMentions += Number(currentMention.brandMentioned);
        beforeCitations += Number(previousMention.brandDomainCitations.length > 0);
        afterCitations += Number(currentMention.brandDomainCitations.length > 0);
        if (previousMention.brandMentioned !== currentMention.brandMentioned) {
          transitions += 1;
          if (currentMention.brandMentioned) mentionAdded += 1;
          else mentionRemoved += 1;
        }
      }
    }

    const dimensions = JSON.parse(group) as string[];
    return {
      group: dimensions.join(" | "),
      conditions: {
        source: dimensions[0],
        provider: dimensions[1],
        model: dimensions[2],
        surface: dimensions[3],
        locale: dimensions[4],
        searchMode: dimensions[5],
        promptType: dimensions[6],
      },
      beforeValidAnswers: beforeValid,
      afterValidAnswers: afterValid,
      matchedPromptObservations: matched,
      unmatchedValidAnswers: {
        before: Math.max(0, beforeValid - matched),
        after: Math.max(0, afterValid - matched),
      },
      beforeMentionCount: beforeMentions,
      afterMentionCount: afterMentions,
      beforeMentionRate: matched ? beforeMentions / matched : null,
      afterMentionRate: matched ? afterMentions / matched : null,
      mentionRateChangePercentagePoints: matched
        ? ((afterMentions - beforeMentions) / matched) * 100
        : null,
      mentionTransitions: { added: mentionAdded, removed: mentionRemoved, changed: transitions },
      beforeBrandDomainCitationCount: input.brandDomain ? beforeCitations : null,
      afterBrandDomainCitationCount: input.brandDomain ? afterCitations : null,
      beforeBrandDomainCitationRate: input.brandDomain && matched ? beforeCitations / matched : null,
      afterBrandDomainCitationRate: input.brandDomain && matched ? afterCitations / matched : null,
    };
  });
  const formatConditions = (keys: string[]) =>
    keys.map((key) => {
      const dimensions = JSON.parse(key) as string[];
      return {
        source: dimensions[0],
        provider: dimensions[1],
        model: dimensions[2],
        surface: dimensions[3],
        locale: dimensions[4],
        searchMode: dimensions[5],
        promptType: dimensions[6],
      };
    });
  const beforeOnly = [...beforeGroups.keys()].filter((key) => !afterGroups.has(key));
  const afterOnly = [...afterGroups.keys()].filter((key) => !beforeGroups.has(key));

  return {
    analysis: "EdGEO paired supplied-answer comparison",
    observedAt: new Date().toISOString(),
    brandName: input.brandName,
    brandDomain: input.brandDomain ?? null,
    beforeObservationCount: input.before.length,
    afterObservationCount: input.after.length,
    comparisons,
    conditionsPresentOnlyInOneRun: {
      beforeOnly: formatConditions(beforeOnly),
      afterOnly: formatConditions(afterOnly),
    },
    before: beforeAnalysis,
    after: afterAnalysis,
    limitations: [
      "Only complete, non-empty answers with the same normalized prompt and identical provider, model, surface, locale, search mode, and prompt type are paired.",
      "Repeated copies of an identical prompt are paired in input order; this is a descriptive comparison, not a causal experiment.",
      "A mention or returned citation does not establish a positive recommendation, source support, or improved business outcome.",
      "Differences can reflect sampling, model updates, retrieval changes, account state, or other conditions outside the recorded fields.",
      "Unmatched and failed observations are reported in the source analyses and excluded from paired rates.",
    ],
  };
}

export interface SearchConsoleRow {
  date?: string;
  page?: string;
  query?: string;
  feature?: string;
  country?: string;
  device?: string;
  clicks: number;
  impressions: number;
  position?: number;
}

export function summarizeSearchConsole(rows: SearchConsoleRow[]) {
  const grouped = new Map<string, SearchConsoleRow[]>();
  for (const row of rows) {
    const key = row.feature?.trim() || "feature_not_specified";
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }

  const summarize = (values: SearchConsoleRow[], group: string) => {
    const clicks = values.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = values.reduce((sum, row) => sum + row.impressions, 0);
    const positionRows = values.filter(
      (row) => typeof row.position === "number" && row.impressions > 0,
    );
    const weightedPosition = positionRows.length
      ? positionRows.reduce((sum, row) => sum + (row.position ?? 0) * row.impressions, 0) /
        positionRows.reduce((sum, row) => sum + row.impressions, 0)
      : null;
    const dates = values.map((row) => row.date).filter((date): date is string => Boolean(date)).sort();
    return {
      group,
      rows: values.length,
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : null,
      impressionWeightedAveragePosition: weightedPosition,
      dateRange: {
        from: dates[0] ?? null,
        to: dates.at(-1) ?? null,
      },
    };
  };

  const topDimension = (dimension: "page" | "query") => {
    const totals = new Map<string, { clicks: number; impressions: number }>();
    for (const row of rows) {
      const key = row[dimension]?.trim();
      if (!key) continue;
      const current = totals.get(key) ?? { clicks: 0, impressions: 0 };
      current.clicks += row.clicks;
      current.impressions += row.impressions;
      totals.set(key, current);
    }
    return [...totals.entries()]
      .map(([value, metrics]) => ({
        value,
        clicks: metrics.clicks,
        impressions: metrics.impressions,
        ctr: metrics.impressions ? metrics.clicks / metrics.impressions : null,
      }))
      .sort((left, right) => right.impressions - left.impressions)
      .slice(0, 10);
  };

  const dailyTotals = new Map<string, { clicks: number; impressions: number }>();
  for (const row of rows) {
    const date = row.date ?? "date_not_provided";
    const current = dailyTotals.get(date) ?? { clicks: 0, impressions: 0 };
    current.clicks += row.clicks;
    current.impressions += row.impressions;
    dailyTotals.set(date, current);
  }

  const summarizeDimension = (dimension: "device" | "country") => {
    const values = new Map<string, { clicks: number; impressions: number; rows: number }>();
    for (const row of rows) {
      const key = row[dimension]?.trim() || "dimension_not_provided";
      const current = values.get(key) ?? { clicks: 0, impressions: 0, rows: 0 };
      current.clicks += row.clicks;
      current.impressions += row.impressions;
      current.rows += 1;
      values.set(key, current);
    }
    return [...values.entries()]
      .map(([value, metrics]) => ({
        value,
        ...metrics,
        ctr: metrics.impressions ? metrics.clicks / metrics.impressions : null,
      }))
      .sort((left, right) => right.impressions - left.impressions);
  };

  return {
    analysis: "EdGEO Search Console row summary",
    observedAt: new Date().toISOString(),
    source: "user_supplied_search_console_rows",
    rowCount: rows.length,
    totals: summarize(rows, "all_input_rows"),
    byFeature: [...grouped.entries()].map(([feature, values]) => summarize(values, feature)),
    byDate: [...dailyTotals.entries()]
      .map(([date, metrics]) => ({
        date,
        clicks: metrics.clicks,
        impressions: metrics.impressions,
        ctr: metrics.impressions ? metrics.clicks / metrics.impressions : null,
      }))
      .sort((left, right) => left.date.localeCompare(right.date)),
    byCountry: summarizeDimension("country"),
    byDevice: summarizeDimension("device"),
    topPages: topDimension("page"),
    topQueries: topDimension("query"),
    aiFeatureRowsNamedInInput: [...grouped.keys()].filter((feature) =>
      /ai overviews?|ai mode|generative ai|search generative experience|\bsge\b/i.test(feature),
    ),
    limitations: [
      "Rows were supplied by the caller; EdGEO did not connect to Google Search Console.",
      "Feature labels are accepted as provided. Missing labels are not inferred as SGE, AI Overviews, or AI Mode.",
      "Totals sum the supplied rows; do not combine overlapping exports or dimensions.",
      "Average position is impression-weighted from supplied row values and is not a fixed rank.",
      "Search Console visibility metrics do not equal visits, qualified leads, or revenue.",
    ],
  };
}
