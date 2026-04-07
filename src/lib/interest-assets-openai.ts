import OpenAI from "openai";
import { openAIChatConfig } from "@/lib/openai-config";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const EXPECTED_COUNT = 50;

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
  if (!Array.isArray(assetsRaw) || assetsRaw.length !== EXPECTED_COUNT) {
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
  const assets: InterestAssetItem[] = rows.map((row, i) => ({
    ...row,
    rank: i + 1,
  }));

  return { date: date.trim(), assets };
}

function buildUserPrompt(utcDateLabel: string): string {
  return `당신은 금융 데이터 분석 AI입니다.

작업:
최근 24시간 동안 시장에서 가장 주목받는 자산 TOP 50을 생성하세요.
대상 자산은 다음을 포함합니다:
- 미국 주식
- 한국 주식
- 원자재
- 암호화폐

각 자산에 대해 Google Trends 기준 상대 관심 점수(0~100)를 추정하세요.
(100은 오늘 기준 가장 높은 관심도를 의미합니다)

요구사항:
- 실제 시장 흐름, 뉴스, 투자자 관심도를 반영할 것
- 최근 검색량이 높거나 뉴스 언급이 많은 자산을 우선 포함할 것
- 모든 자산에 대해 일관된 기준으로 점수를 부여할 것
- 임의로 만든 가짜 자산은 포함하지 말 것
- name은 기본적으로 영어(영문) 자산명을 사용할 것 (예: Bitcoin, Tesla, Samsung Electronics)
- 원자재(commodity) symbol은 반드시 Yahoo Finance 선물 티커만 쓸 것 (금 GC=F, 은 SI=F, 원유 CL=F, 백금 PL=F, 팔라듐 PA=F). FX 스팟·브로커 코드(XAUUSD, XAGUSD 등)는 절대 쓰지 말 것. 금·은을 crypto 카테고리로 넣지 말 것.
- crypto symbol은 반드시 코인 베이스 심볼만 쓸 것 (예: BTC, ETH, SOL). BTC-USD 같은 -USD 접미사는 절대 쓰지 말 것.

[출력의 date 필드]
반드시 다음 날짜 문자열을 사용하세요 (그대로 복사): "${utcDateLabel}"

category 값은 반드시 다음 중 하나만 사용하세요 (영문 소문자):
- us_stock (미국 주식)
- kr_stock (한국 주식)
- commodity (원자재)
- crypto (암호화폐)

출력 형식 (반드시 JSON만 출력, 다른 텍스트·마크다운·코드펜스 금지):

{
  "date": "${utcDateLabel}",
  "assets": [
    {
      "rank": 1,
      "name": "Gold Futures",
      "symbol": "GC=F",
      "category": "commodity",
      "score": 100
    },
    {
      "rank": 2,
      "name": "Tesla",
      "symbol": "TSLA",
      "category": "us_stock",
      "score": 95
    }
  ]
}

규칙:
- 반드시 50개 자산을 포함할 것
- rank는 1부터 50까지 정수, 중복 없이 score 내림차순과 일치할 것
- score는 0~100 사이 값
- 설명 없이 JSON 객체만 한 번 출력할 것`;
}

/**
 * OpenAI로 관심 자산 TOP 50 생성. 검증 실패 시 예외.
 */
export async function fetchInterestAssetsFromOpenAI(): Promise<InterestAssetsPayload> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const utcDateLabel = new Date().toISOString().slice(0, 10);

  const completion = await openai.chat.completions.create({
    model: openAIChatConfig.model,
    max_completion_tokens: 14_000,
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
