import {
  summarizeSearchConsole,
  type SearchConsoleRow,
} from "./analysis.js";

export type SearchConsoleColumn =
  | "date"
  | "page"
  | "query"
  | "feature"
  | "clicks"
  | "impressions"
  | "position"
  | "country"
  | "device";

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 25_000;

const HEADER_ALIASES: Record<SearchConsoleColumn, string[]> = {
  date: ["date", "tanggal"],
  page: ["page", "pages", "top pages", "halaman", "url", "page url"],
  query: ["query", "queries", "top queries", "kueri", "kata kunci", "search query"],
  feature: [
    "search appearance",
    "search appearances",
    "search feature",
    "feature",
    "tampilan penelusuran",
    "fitur penelusuran",
  ],
  clicks: ["clicks", "klik"],
  impressions: ["impressions", "tayangan"],
  position: ["position", "average position", "avg position", "posisi", "posisi rata-rata"],
  country: ["country", "countries", "negara"],
  device: ["device", "devices", "perangkat"],
};

function normalizeHeader(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(field);
      if (record.some((cell) => cell.trim() !== "")) records.push(record);
      record = [];
      field = "";
      if (records.length > MAX_CSV_ROWS + 1) {
        throw new Error(`CSV exceeds the ${MAX_CSV_ROWS.toLocaleString()} data-row limit.`);
      }
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field.");
  record.push(field);
  if (record.some((cell) => cell.trim() !== "")) records.push(record);
  if (records.length > MAX_CSV_ROWS + 1) {
    throw new Error(`CSV exceeds the ${MAX_CSV_ROWS.toLocaleString()} data-row limit.`);
  }
  return records;
}

function detectDelimiter(text: string): string {
  const candidates = [",", "\t", ";"];
  const counts = new Map(candidates.map((candidate) => [candidate, 0]));
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (char === "\n" || char === "\r")) {
      break;
    } else if (!quoted && counts.has(char)) {
      counts.set(char, counts.get(char)! + 1);
    }
  }
  return candidates.sort((left, right) => counts.get(right)! - counts.get(left)!)[0]!;
}

function numericValue(value: string, decimalComma: boolean): number | null {
  let normalized = value.trim().replace(/[\s\u00a0]/g, "");
  if (!normalized) return null;
  if (normalized.includes(",") && normalized.includes(".")) {
    const decimalSeparator = normalized.lastIndexOf(",") > normalized.lastIndexOf(".") ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized.split(groupingSeparator).join("");
    if (decimalSeparator === ",") normalized = normalized.replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = decimalComma
      ? normalized.replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (
    !decimalComma &&
    /^\d{1,3}(?:\.\d{3})+$/.test(normalized)
  ) {
    normalized = normalized.replace(/\./g, "");
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function validIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === trimmed
    ? trimmed
    : null;
}

export function importSearchConsoleCsv(input: {
  csvText: string;
  delimiter?: "," | "\t" | ";";
  columnMap?: Partial<Record<SearchConsoleColumn, string>>;
}) {
  if (Buffer.byteLength(input.csvText, "utf8") > MAX_CSV_BYTES) {
    throw new Error("CSV is larger than the 5 MiB import limit.");
  }
  const delimiter = input.delimiter ?? detectDelimiter(input.csvText);
  const records = parseRecords(input.csvText.replace(/^\uFEFF/, ""), delimiter);
  if (records.length < 2) throw new Error("CSV must contain a header and at least one data row.");

  const headers = records[0]!.map((header) => header.trim());
  const normalizedHeaders = headers.map(normalizeHeader);
  const mapping: Partial<Record<SearchConsoleColumn, number>> = {};
  const suppliedMapping: Partial<Record<SearchConsoleColumn, string>> = input.columnMap ?? {};
  for (const column of Object.keys(HEADER_ALIASES) as SearchConsoleColumn[]) {
    const explicitHeader = suppliedMapping[column];
    const index = explicitHeader
      ? headers.findIndex((header) => header === explicitHeader)
      : normalizedHeaders.findIndex((header) =>
          HEADER_ALIASES[column].some((alias) => normalizeHeader(alias) === header),
        );
    if (explicitHeader && index < 0) {
      throw new Error(`Configured ${column} header "${explicitHeader}" was not found in the CSV.`);
    }
    if (index >= 0) mapping[column] = index;
  }
  for (const required of ["clicks", "impressions"] as const) {
    if (mapping[required] === undefined) {
      throw new Error(
        `Could not identify the required "${required}" column. Use columnMap to specify its exact header.`,
      );
    }
  }

  const warnings: string[] = [];
  const rows: SearchConsoleRow[] = [];
  let skippedRows = 0;
  for (let rowIndex = 1; rowIndex < records.length; rowIndex += 1) {
    const cells = records[rowIndex]!;
    if (cells.length > headers.length) {
      skippedRows += 1;
      if (warnings.length < 20) warnings.push(`Row ${rowIndex + 1} was skipped: more fields than the header.`);
      continue;
    }
    const get = (column: SearchConsoleColumn) => {
      const index = mapping[column];
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };
    const clicks = numericValue(get("clicks"), false);
    const impressions = numericValue(get("impressions"), false);
    const positionText = get("position");
    const position = positionText ? numericValue(positionText, true) : null;
    const dateText = get("date");
    const date = dateText ? validIsoDate(dateText) : null;
    if (
      clicks === null ||
      impressions === null ||
      !Number.isInteger(clicks) ||
      !Number.isInteger(impressions) ||
      clicks < 0 ||
      impressions < 0 ||
      (positionText !== "" && (position === null || position < 0)) ||
      (dateText !== "" && date === null)
    ) {
      skippedRows += 1;
      if (warnings.length < 20) warnings.push(`Row ${rowIndex + 1} was skipped: invalid metric or date.`);
      continue;
    }
    rows.push({
      ...(date ? { date } : {}),
      ...(get("page") ? { page: get("page") } : {}),
      ...(get("query") ? { query: get("query") } : {}),
      ...(get("feature") ? { feature: get("feature") } : {}),
      ...(get("country") ? { country: get("country") } : {}),
      ...(get("device") ? { device: get("device") } : {}),
      clicks,
      impressions,
      ...(position !== null ? { position } : {}),
    });
  }
  if (rows.length === 0) throw new Error("No valid Search Console data rows were found.");

  return {
    import: "EdGEO local Search Console CSV import",
    observedAt: new Date().toISOString(),
    delimiter: delimiter === "\t" ? "tab" : delimiter === ";" ? "semicolon" : "comma",
    headerMapping: Object.fromEntries(
      Object.entries(mapping).map(([column, index]) => [column, headers[index!]]),
    ),
    importedRows: rows.length,
    skippedRows,
    warnings,
    summary: summarizeSearchConsole(rows),
    limitations: [
      "CSV is parsed locally in memory and is not uploaded by this tool.",
      "Only ISO dates (YYYY-MM-DD) are accepted when a date column exists; ambiguous locale dates are skipped.",
      "Search Console exports may omit anonymized queries and may be truncated or filtered by the export method.",
      "Feature names are taken directly from the file and are not inferred from generic query or page rows.",
    ],
  };
}
