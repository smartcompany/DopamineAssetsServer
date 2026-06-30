import { ai } from "@/lib/ai-client";

const EXPECTED_COUNT = 30;

export type InterestAssetCategory =
  | "us_stock"
  | "kr_stock"
  | "commodity"
  | "crypto";

export type InterestAssetItem = {
  rank: number;
  name: string;
  symbol: string;
  category: InterestAssetCategory;
  score: number;
};

export type InterestAssetsPayload = {
  date: string;
  assets: InterestAssetItem[];
};

function extractJsonObject(raw: string): string {
  let s = raw.trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  if (fenced) return fenced[1].trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  }
  return s;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ALLOWED_INTEREST_CATEGORIES = new Set<string>([
  "us_stock",
  "kr_stock",
  "commodity",
  "crypto",
]);

function isInterestAssetCategory(s: string): s is InterestAssetCategory {
  return ALLOWED_INTEREST_CATEGORIES.has(s);
}

function normalizeInterestAssetSymbol(
  symbol: string,
  category: InterestAssetCategory,
): string {
  const s = symbol.trim().toUpperCase();
  if (category === "crypto") {
    const dashUsd = s.match(/^([A-Z0-9]{1,20})-USD$/);
    if (dashUsd) return dashUsd[1];
  }
  return symbol.trim();
}

/**
 * 모델 출력 JSON을 검증·정규화. 실패 시 null.
 */
export function parseInterestAssetsResponse(raw: string): InterestAssetsPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  const date = o.date;
  if (typeof date !== "string" || !DATE_RE.test(date.trim())) return null;

  const assetsRaw = o.assets;
  if (!Array.isArray(assetsRaw) || assetsRaw.length < EXPECTED_COUNT) {
    return null;
  }

  const rows: Omit<InterestAssetItem, "rank">[] = [];
  for (let i = 0; i < assetsRaw.length; i++) {
    const row = assetsRaw[i];
    if (typeof row !== "object" || row === null) return null;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const symbolRaw = typeof r.symbol === "string" ? r.symbol.trim() : "";
    const catRaw = typeof r.category === "string" ? r.category.trim() : "";
    if (!isInterestAssetCategory(catRaw)) {
      return null;
    }
    const cat = catRaw;
    const score =
      typeof r.score === "number" ? r.score : Number.parseFloat(String(r.score));

    if (
      name.length === 0 ||
      symbolRaw.length > 64 ||
      symbolRaw.length === 0 ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100
    ) {
      return null;
    }
    const symbol = normalizeInterestAssetSymbol(symbolRaw, cat);
    rows.push({
      name,
      symbol,
      category: cat,
      score: Math.round(score * 1000) / 1000,
    });
  }

  rows.sort((a, b) => b.score - a.score);
  const topRows = rows.slice(0, EXPECTED_COUNT);
  const assets: InterestAssetItem[] = topRows.map((row, i) => ({
    ...row,
    rank: i + 1,
  }));

  return { date: date.trim(), assets };
}

function buildUserPrompt(utcDateLabel: string): string {
  return `Generate the top ${EXPECTED_COUNT} most-trending assets in the last 24h across US stocks, KR stocks, commodities, crypto.
Estimate a Google-Trends-style relative interest score 0..100 for each (100 = highest today).

Rules:
- Reflect real market moves, news, investor interest. No fake tickers.
- name: English (e.g. Bitcoin, Tesla, Samsung Electronics).
- commodity.symbol: Yahoo futures tickers only (GC=F, SI=F, CL=F, PL=F, PA=F). Never FX/spot codes like XAUUSD. Never put gold/silver under crypto.
- crypto.symbol: base symbol only (BTC, ETH, SOL). Never -USD suffix.
- category ∈ { us_stock, kr_stock, commodity, crypto }.
- date must equal "${utcDateLabel}".
- Output ONE JSON object only — no markdown, no commentary.

Schema:
{
  "date": "${utcDateLabel}",
  "assets": [
    { "rank": 1, "name": "Gold Futures", "symbol": "GC=F", "category": "commodity", "score": 100 },
    { "rank": 2, "name": "Tesla",         "symbol": "TSLA",  "category": "us_stock",  "score": 95  }
  ]
}

Hard constraints:
- exactly ${EXPECTED_COUNT} items
- rank 1..${EXPECTED_COUNT} integers, unique, ordered by score desc
- score in [0, 100]`;
}

/**
 * OpenAI로 관심 자산 TOP 30 생성. 검증 실패 시 예외.
 */
export async function fetchInterestAssetsFromOpenAI(): Promise<InterestAssetsPayload> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const utcDateLabel = new Date().toISOString().slice(0, 10);

  // long_output: reasoning_effort=minimal 로 gpt-5-mini 응답을 빠르게 유지.
  const completion = await ai.createChatCompletion({
    preset: "long_output",
    messages: [
      {
        role: "system",
        content:
          "You output a single valid JSON object only. No markdown, no code fences, no commentary.",
      },
      {
        role: "user",
        content: buildUserPrompt(utcDateLabel),
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!raw) {
    throw new Error("empty_openai_response");
  }

  const validated = parseInterestAssetsResponse(raw);
  if (!validated) {
    const preview = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
    throw new Error(`invalid_interest_assets_json: ${preview}`);
  }

  return {
    date: utcDateLabel,
    assets: validated.assets,
  };
}
