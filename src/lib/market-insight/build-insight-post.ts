import OpenAI from "openai";
import { openAIChatConfig } from "@/lib/openai-config";
import { fetchAllRssItems, type RssItem } from "./fetch-rss";

// 인사이트 포스트에서 카드 미리보기는 원문 URL이 잡도록 source_url을 본문 "앞쪽"에 둔다.
// 우리 앱 share URL은 맨 마지막에 붙여 유입 경로를 남긴다.
const SHARE_URL = "https://dopamine-assets.vercel.app/?from=share";

// 한 번에 OpenAI에 넘길 후보 기사 수. 너무 많으면 토큰만 낭비.
const CANDIDATE_ARTICLES = 8;

// 기사가 너무 오래됐으면(>48h) 인사이트로 부적합.
const MAX_STALE_MS = 48 * 60 * 60 * 1000;

// 너무 짧은 제목은 광고/내비 링크일 가능성 → 제외.
const MIN_TITLE_LEN = 20;

// 트윗 본문 안전 한도 (실제 280 weight 제한은 route.ts의 truncate가 마지막 방어선).
// 여기서는 여유 있게 OpenAI에 200자 이내를 요청.
const MAX_KOREAN_CHARS = 150;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

export type InsightPost = {
  /** 트윗 전체 본문 */
  text: string;
  /** 선택된 기사 원문 URL (트윗에도 포함됨) */
  sourceUrl: string;
  /** 선택된 기사 제목 (로그/응답용) */
  sourceTitle: string;
  /** 선택된 기사 출처명 (예: "CNBC") */
  sourceName: string;
};

function looksTooPromotional(t: string): boolean {
  const lower = t.toLowerCase();
  return (
    lower.includes("sponsor") ||
    lower.includes("advertisement") ||
    lower.includes("ad:") ||
    lower.includes("webinar")
  );
}

function pickCandidates(items: RssItem[]): RssItem[] {
  const now = Date.now();
  const filtered = items.filter((it) => {
    if (!it.title || it.title.length < MIN_TITLE_LEN) return false;
    if (!it.link || !/^https?:\/\//i.test(it.link)) return false;
    if (looksTooPromotional(it.title)) return false;
    if (it.publishedAtMs > 0 && now - it.publishedAtMs > MAX_STALE_MS) return false;
    return true;
  });
  // 이미 최신순 정렬되어 있다고 가정(fetch-rss에서 sort).
  // 출처 다양성을 위해 같은 source가 연속으로 나오지 않게 살짝 셔플.
  const byKey = new Map<string, RssItem[]>();
  for (const it of filtered) {
    const bucket = byKey.get(it.sourceKey) ?? [];
    bucket.push(it);
    byKey.set(it.sourceKey, bucket);
  }
  const roundRobin: RssItem[] = [];
  let added = true;
  while (added && roundRobin.length < CANDIDATE_ARTICLES) {
    added = false;
    for (const bucket of byKey.values()) {
      const next = bucket.shift();
      if (next) {
        roundRobin.push(next);
        added = true;
        if (roundRobin.length >= CANDIDATE_ARTICLES) break;
      }
    }
  }
  return roundRobin;
}

type ModelPick = {
  /** CANDIDATE_ARTICLES 내 1-based index */
  index: number;
  /** 한국어 본문 (SHARE URL/원문 URL/출처라벨 제외) */
  body: string;
};

function buildPrompt(candidates: RssItem[]): string {
  const list = candidates
    .map((c, i) => {
      const desc = c.description ? c.description.slice(0, 400) : "(설명 없음)";
      return `${i + 1}. [${c.sourceName}]\n   제목: ${c.title}\n   설명: ${desc}`;
    })
    .join("\n\n");
  return `당신은 **도파민 자산(Dopamine Assets)** 앱의 장전 시황 큐레이터입니다.
아래 영어 금융 뉴스 후보 ${candidates.length}건 중 "일반 개미 투자자에게 가장 유용할" 1건을 고르고,
그 기사를 바탕으로 한국어 장전 인사이트 트윗 본문을 작성하세요.

[원문 활용 규칙]
- 기사 본문 **그대로 번역·복붙 금지** (저작권). 핵심만 재구성.
- 사실만 요약하고, 예측/투자조언/"매수" 같은 표현 금지.
- 특정 종목 티커(예: AAPL, TSLA)·기업명은 그대로 써도 OK.

[문체]
- 한국어 2-3줄, 공백 포함 ${MAX_KOREAN_CHARS}자 이내.
- 첫 줄: 훅(왜 지금 이 뉴스가 중요한지).
- 나머지: 근거 1-2개(숫자/고유명사 구체적으로).
- 이몼지 최대 1개(없어도 됨). 해시태그·URL·"출처" 언급 금지 (밖에서 붙임).
- 가볍게 캐주얼하지만 신뢰감 있는 톤. "대박/떡상/존버" 같은 밈 단어 금지.

[후보 기사]
${list}

[출력 형식]
반드시 JSON 하나만:
{
  "index": <선택한 기사의 1-based index>,
  "body": "<한국어 본문>"
}`;
}

function parsePick(raw: string): ModelPick | null {
  try {
    const parsed = JSON.parse(raw) as { index?: unknown; body?: unknown };
    const idx = typeof parsed.index === "number" ? parsed.index : Number.parseInt(String(parsed.index ?? ""), 10);
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!Number.isFinite(idx) || idx < 1 || !body) return null;
    return { index: idx, body };
  } catch {
    return null;
  }
}

async function callOpenAI(candidates: RssItem[]): Promise<ModelPick | null> {
  const prompt = buildPrompt(candidates);
  const completion = await openai.chat.completions.create({
    model: openAIChatConfig.model,
    max_completion_tokens: openAIChatConfig.max_completion_tokens,
    messages: [
      {
        role: "system",
        content:
          "You output a single valid JSON object only. No markdown, no code fences, no commentary.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });
  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!raw) return null;
  return parsePick(raw);
}

function composeTweetText(body: string, source: RssItem): string {
  const header = "📊 장전 인사이트\n\n";
  const sourceLine = `\n\n📰 출처: ${source.sourceName}\n${source.link}`;
  const footer = `\n\n${SHARE_URL}`;
  return `${header}${body.trim()}${sourceLine}${footer}`;
}

/**
 * RSS 수집 → OpenAI 기사 선택·요약 → 트윗 본문 완성.
 * 어느 단계라도 실패하면 null 반환 (상위에서 일반 템플릿으로 fallback).
 */
export async function buildInsightPost(): Promise<InsightPost | null> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.warn("[market-insight] skip: OPENAI_API_KEY missing");
    return null;
  }
  const all = await fetchAllRssItems();
  if (all.length === 0) {
    console.warn("[market-insight] skip: no rss items");
    return null;
  }
  const candidates = pickCandidates(all);
  if (candidates.length === 0) {
    console.warn("[market-insight] skip: no candidates after filter");
    return null;
  }
  console.log("[market-insight] candidates", {
    count: candidates.length,
    sources: candidates.map((c) => c.sourceKey),
  });

  let pick: ModelPick | null = null;
  try {
    pick = await callOpenAI(candidates);
  } catch (e) {
    console.warn("[market-insight] openai failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
  if (!pick) {
    console.warn("[market-insight] openai returned invalid JSON");
    return null;
  }

  const chosen = candidates[pick.index - 1];
  if (!chosen) {
    console.warn("[market-insight] openai picked out-of-range index", { index: pick.index });
    return null;
  }

  const text = composeTweetText(pick.body, chosen);
  return {
    text,
    sourceUrl: chosen.link,
    sourceTitle: chosen.title,
    sourceName: chosen.sourceName,
  };
}
