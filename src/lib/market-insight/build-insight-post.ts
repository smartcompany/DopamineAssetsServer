import OpenAI from "openai";
import { openAIChatConfig } from "@/lib/openai-config";

// ────────────────────────────────────────────────────────────────────────────
// X `x-daily-post` cron의 "인사이트 모드" 본문 빌더.
//
// 소스: coinpang.org (자매 사이트) Supabase `posts` 테이블의 최근 게시글.
//  - 본인 소유 콘텐츠라 원문 활용에 저작권 제약 없음.
//  - OpenAI는 원문(한국어)을 280자 트윗으로 "재미있게 축약"하는 역할만 수행.
//  - 트윗에는 해당 글의 coinpang.org permalink를 함께 첨부해 cross-promotion.
//
// 환경변수:
//  - COINPANG_SUPABASE_URL            (예: https://xxxx.supabase.co)
//  - COINPANG_SUPABASE_ANON_KEY       (읽기 전용 anon 키. RLS로 public SELECT 허용되어 있음)
//  - COINPANG_SITE_URL                (기본 https://coinpang.org)
//  - COINPANG_INSIGHT_BOARD_TYPES     (comma 구분. 기본 "coin_news")
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_COINPANG_SITE_URL = "https://coinpang.org";
const DEFAULT_BOARD_TYPES = ["coin_news"] as const;

// OpenAI에 프롬프트로 넣을 원문 최대 글자 수. 과하게 길면 토큰 낭비.
const MAX_CONTENT_CHARS_FOR_PROMPT = 3500;

// 너무 오래된 글은 스킵(48h). 48시간 안에 글이 없으면 insight 스킵 → 템플릿 모드로 fallback.
const MAX_POST_AGE_MS = 48 * 60 * 60 * 1000;

// OpenAI에 요청할 본문 길이 상한(한국어 문자 기준). 안전 마진 충분히 확보.
// 한국어 1자 = 트윗 weight 2, 본문 말고도 URL/이모지가 추가로 들어가므로 보수적으로.
const MAX_KOREAN_CHARS = 110;

// DB에서 끌어오는 최근 글 수. 이 중 셔플해서 CANDIDATE_COUNT만 OpenAI에 후보로 전달.
// 셔플은 매 실행 시 다른 글이 뽑히도록 하기 위함(하루 여러 번 실행되는 cron에서 중복 방지).
const FETCH_LIMIT = 20;
const CANDIDATE_COUNT = 5;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });

// ────────────────────────────────────────────────────────────────────────────
// Config 로더
// ────────────────────────────────────────────────────────────────────────────

function getCoinpangSupabase(): { url: string; key: string } {
  const url = process.env.COINPANG_SUPABASE_URL?.trim();
  const key = process.env.COINPANG_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    throw new Error("COINPANG_SUPABASE_URL/COINPANG_SUPABASE_ANON_KEY missing");
  }
  return { url: url.replace(/\/+$/, ""), key };
}

function getCoinpangSiteUrl(): string {
  const raw = process.env.COINPANG_SITE_URL?.trim() || DEFAULT_COINPANG_SITE_URL;
  return raw.replace(/\/+$/, "");
}

function getBoardTypes(): string[] {
  const raw = process.env.COINPANG_INSIGHT_BOARD_TYPES?.trim();
  if (!raw) return [...DEFAULT_BOARD_TYPES];
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : [...DEFAULT_BOARD_TYPES];
}

// ────────────────────────────────────────────────────────────────────────────
// coinpang Supabase에서 최근 게시글 fetch (PostgREST 직접 호출)
// ────────────────────────────────────────────────────────────────────────────

type CoinpangPost = {
  id: number;
  title: string;
  content: string;
  board_type: string | null;
  created_at: string;
  image_url: string | null;
  author: string | null;
};

async function fetchRecentCoinpangPosts(): Promise<CoinpangPost[]> {
  const { url, key } = getCoinpangSupabase();
  const boardTypes = getBoardTypes();
  // PostgREST 필터: 단일은 `eq`, 복수는 `in.(a,b)` 사용.
  const boardTypeFilter =
    boardTypes.length === 1
      ? `board_type=eq.${encodeURIComponent(boardTypes[0])}`
      : `board_type=in.(${boardTypes.map((t) => encodeURIComponent(t)).join(",")})`;

  const endpoint = `${url}/rest/v1/posts?select=id,title,content,board_type,created_at,image_url,author&order=created_at.desc&limit=${FETCH_LIMIT}&${boardTypeFilter}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[market-insight] coinpang fetch non-ok", {
        status: res.status,
        body: (await res.text().catch(() => "")).slice(0, 200),
      });
      return [];
    }
    const raw = (await res.json()) as CoinpangPost[];
    console.log("[market-insight] coinpang fetched", {
      count: raw.length,
      boardTypes,
    });
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.warn("[market-insight] coinpang fetch failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 후보 필터·셔플 + OpenAI 축약
// ────────────────────────────────────────────────────────────────────────────

function trimContentForPrompt(c: string): string {
  if (!c) return "";
  // 연속된 빈 줄 정리 + 앞뒤 공백 제거. Markdown/plain 원본 그대로 OpenAI에 넘겨도 된다.
  const collapsed = c.replace(/\n{3,}/g, "\n\n").trim();
  if (collapsed.length <= MAX_CONTENT_CHARS_FOR_PROMPT) return collapsed;
  return `${collapsed.slice(0, MAX_CONTENT_CHARS_FOR_PROMPT)}…(이하 생략)`;
}

function pickCandidates(posts: CoinpangPost[]): CoinpangPost[] {
  const now = Date.now();
  const fresh = posts.filter((p) => {
    if (!p.title || !p.content) return false;
    const t = Date.parse(p.created_at);
    if (!Number.isFinite(t)) return true;
    return now - t <= MAX_POST_AGE_MS;
  });
  // 매 실행마다 후보가 달라지도록 셔플 → 하루 여러 번 올려도 동일 글 재노출 확률 최소화.
  const shuffled = [...fresh].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, CANDIDATE_COUNT);
}

function buildPrompt(candidates: CoinpangPost[]): string {
  const list = candidates
    .map((c, i) => {
      const body = trimContentForPrompt(c.content ?? "");
      return `${i + 1}. 제목: ${c.title}\n   본문:\n${body}`;
    })
    .join("\n\n---\n\n");

  return `당신은 "도파민 자산" 앱의 X(트위터) 소셜 담당자이자, 자매 사이트 **코인팡(coinpang.org)** 의 오늘 올라온 글을 살짝 재미있게 홍보하는 큐레이터입니다.
아래 코인팡에 최근 올라온 한국어 코인 뉴스 글 ${candidates.length}건 중 **개미 투자자에게 가장 흥미로울 1건**을 골라서, 해당 글의 핵심을 재미있게 X 트윗 본문으로 축약해 주세요.

[톤·문체]
- 한국어 2-3줄, 공백 포함 ${MAX_KOREAN_CHARS}자 이내 (반드시 지킬 것).
- 첫 줄: 훅(궁금증 자극 / 놀라움 / 한 문장 요약 중 하나).
- 나머지: 핵심 숫자·고유명사 1-2개 꼭 포함(BTC, 9만 달러, SEC 같은 구체어).
- 가볍고 캐주얼한 말투 ("~래요", "~이래", 적당한 반말체 OK). "대박", "떡상" 같은 밈 단어는 과하지 않게 한두 번 허용.
- "사세요/파세요", "매수 추천" 같은 단정적 투자 조언 금지. 예측은 "~라는 시각" 식으로 완곡하게.
- 이모지 최대 2개. 해시태그·URL·"출처"·"코인팡" 단어 본문 내 언급 금지 (링크/브랜딩은 밖에서 자동으로 붙음).
- 저작권: 본문 문장을 그대로 복사하지 말고 의미만 살려 재구성할 것.

[출력]
반드시 다음 형식의 JSON 하나만 출력 (다른 텍스트·마크다운·코드펜스 금지):
{
  "index": <선택한 글의 1-based index (1~${candidates.length} 사이)>,
  "body": "<트윗 본문 한국어>"
}

[후보 글]
${list}`;
}

type ModelPick = { index: number; body: string };

function parsePick(raw: string): ModelPick | null {
  try {
    const parsed = JSON.parse(raw) as { index?: unknown; body?: unknown };
    const idx =
      typeof parsed.index === "number"
        ? parsed.index
        : Number.parseInt(String(parsed.index ?? ""), 10);
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!Number.isFinite(idx) || idx < 1 || !body) return null;
    return { index: idx, body };
  } catch {
    return null;
  }
}

async function callOpenAI(candidates: CoinpangPost[]): Promise<ModelPick | null> {
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

// ────────────────────────────────────────────────────────────────────────────
// 최종 트윗 본문 조립
// ────────────────────────────────────────────────────────────────────────────

function composeTweetText(body: string, post: CoinpangPost): string {
  const postUrl = `${getCoinpangSiteUrl()}/post/${post.id}`;
  // 포맷:
  //   {본문}
  //
  //   🪙 더보기 → {coinpang permalink}
  //
  // 본문이 내용 훅을 이미 가지고 있으므로 상단 header는 생략 (군더더기 감소 + weight 절약).
  // share URL(도파민자산)은 인사이트에서는 빼서 cross-promo가 coinpang 단일 CTA가 되게 함.
  return `${body.trim()}\n\n🪙 더보기 → ${postUrl}`;
}

export type InsightPost = {
  text: string;
  /** 선택된 coinpang 글의 permalink (로그·응답 디버깅용) */
  sourceUrl: string;
  /** 선택된 글의 제목 */
  sourceTitle: string;
  /** 출처 라벨 (현재는 항상 "코인팡") */
  sourceName: string;
  /** 선택된 coinpang posts.id */
  sourcePostId: number;
};

/**
 * coinpang 최근 글 수집 → OpenAI 축약 → 트윗 본문 완성.
 * 어느 단계라도 실패하면 null (상위 cron이 자동으로 템플릿 모드로 fallback).
 */
export async function buildInsightPost(): Promise<InsightPost | null> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.warn("[market-insight] skip: OPENAI_API_KEY missing");
    return null;
  }
  if (!process.env.COINPANG_SUPABASE_URL?.trim() || !process.env.COINPANG_SUPABASE_ANON_KEY?.trim()) {
    console.warn("[market-insight] skip: COINPANG_SUPABASE_URL/KEY missing");
    return null;
  }

  const posts = await fetchRecentCoinpangPosts();
  if (posts.length === 0) {
    console.warn("[market-insight] skip: no posts fetched");
    return null;
  }

  const candidates = pickCandidates(posts);
  if (candidates.length === 0) {
    console.warn("[market-insight] skip: no fresh candidates (all >48h old)");
    return null;
  }
  console.log("[market-insight] candidates", {
    count: candidates.length,
    ids: candidates.map((c) => c.id),
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
    console.warn("[market-insight] openai picked out-of-range index", {
      index: pick.index,
    });
    return null;
  }

  const text = composeTweetText(pick.body, chosen);
  const postUrl = `${getCoinpangSiteUrl()}/post/${chosen.id}`;
  return {
    text,
    sourceUrl: postUrl,
    sourceTitle: chosen.title,
    sourceName: "코인팡",
    sourcePostId: chosen.id,
  };
}
