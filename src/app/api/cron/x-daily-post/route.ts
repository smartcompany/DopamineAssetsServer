import { jsonWithCors } from "@/lib/cors";
import { getFeedRankings } from "@/lib/feed-rankings-service";
import { isCronAuthorizedRequest } from "@/lib/cron-secret-auth";
import TEMPLATES from "./templates";
import {
  loadXCreds,
  postToX,
  truncateForTweet,
  uploadGifFromUrl,
} from "@/lib/x-post";

// ────────────────────────────────────────────────────────────────────────────
// "랭킹 템플릿" 포스트 cron.
//   - 하루 2회 (기본: KST 10:05 / 18:05, UTC 01:05 / 09:05) 실행.
//   - 30종 템플릿을 **순번**으로 돌면서 게시 (확률/셔플 없음).
//     → 같은 랭킹 데이터가 같은 템플릿에 붙는 경우를 최소화하고, 장기적으로
//       모든 템플릿이 고르게 노출된다.
//   - AI 인사이트 모드는 별도 엔드포인트(/api/cron/x-insight-post)로 분리.
//
// 템플릿 키는 templates.ts와 아래 TEMPLATE_IDS가 **1:1**로 매칭되어야 한다.
// ────────────────────────────────────────────────────────────────────────────

const SHARE_URL = "https://dopamine-assets.vercel.app/?from=share";

function pct(v: number): string {
  if (!Number.isFinite(v)) return "0.00%";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function clipName(name: string, max = 16): string {
  const t = name.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function rowNo(i: number, name: string, sym: string, p: number): string {
  return `${i + 1}. ${clipName(name)} (${sym}) ${pct(p)}`;
}

function bullet(name: string, sym: string, p: number): string {
  return `• ${clipName(name)} (${sym}) ${pct(p)}`;
}

type RankItem = { name: string; symbol: string; priceChangePct: number };

// 30종 템플릿 ID 순서. 12시간 슬롯마다 1칸씩 회전.
// 하루 2포스트(12h 간격) × 15일 = 30슬롯 → 전체 한 바퀴.
// 실제 본문은 templates.ts에 동일 키로 등록되어 있어야 한다.
const TEMPLATE_IDS = [
  "ranking",
  "spotlight_up",
  "spotlight_down",
  "quiz",
  "fire_ice",
  "news_flash",
  "receipt",
  "question",
  "top3_up_only",
  "top3_down_only",
  "bragger",
  "warning",
  "celebration",
  "detective",
  "diary",
  "casino",
  "roast",
  "horoscope",
  "battle",
  "crying_meme",
  "shock_meter",
  "emergency",
  "comeback",
  "hall_of_fame",
  "gossip",
  "robot",
  "apocalypse",
  "to_the_moon",
  "confession",
  "hype",
] as const;
type TemplateId = (typeof TEMPLATE_IDS)[number];

// 부팅 시 1회: 모든 ID가 templates.ts에 존재하는지 확인해 누락을 일찍 잡는다.
for (const id of TEMPLATE_IDS) {
  const t = (TEMPLATES as Record<string, { text?: unknown }>)[id];
  if (!t || typeof t.text !== "string") {
    throw new Error(`missing_template_in_templates_ts: ${id}`);
  }
}

/**
 * `{{KEY}}` 형태 placeholder 치환.
 * 지원 키:
 *   {{URL}}
 *   {{U1_ROW}}..{{U3_ROW}}           "1. Name (SYM) +x.xx%"  (번호 포함)
 *   {{D1_ROW}}..{{D3_ROW}}
 *   {{U1_BULLET}}..{{U3_BULLET}}     "• Name (SYM) +x.xx%"
 *   {{D1_BULLET}}..{{D3_BULLET}}
 *   {{U1_NAME}}..{{U3_NAME}}         (기본 16자 clip)
 *   {{U1_NAME_14}} / {{U1_NAME_18}}  (clip 길이 지정)
 *   {{U1_SYM}}, {{U1_PCT}}           원본 심볼 / 부호 포함 퍼센트
 *   동일 규칙으로 D1/D2/D3 존재.
 */
function renderTemplate(id: TemplateId, u: RankItem[], d: RankItem[]): string {
  const vars: Record<string, string> = { URL: SHARE_URL };
  const sides: Array<["U" | "D", RankItem[]]> = [
    ["U", u],
    ["D", d],
  ];
  for (const [prefix, items] of sides) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const n = i + 1;
      vars[`${prefix}${n}_NAME`] = clipName(it.name, 16);
      vars[`${prefix}${n}_NAME_14`] = clipName(it.name, 14);
      vars[`${prefix}${n}_NAME_18`] = clipName(it.name, 18);
      vars[`${prefix}${n}_SYM`] = it.symbol;
      vars[`${prefix}${n}_PCT`] = pct(it.priceChangePct);
      vars[`${prefix}${n}_ROW`] = rowNo(i, it.name, it.symbol, it.priceChangePct);
      vars[`${prefix}${n}_BULLET`] = bullet(it.name, it.symbol, it.priceChangePct);
    }
  }
  const raw = (TEMPLATES as Record<TemplateId, { text: string }>)[id].text;
  // 본문 마지막에 trailing newline이 있으면 제거해 트윗 여백을 줄인다.
  return raw
    .replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, key: string) => vars[key] ?? m)
    .replace(/\s+$/u, "");
}

// 12시간 슬롯 기준 순번 선택. 하루 2포스트(12h 간격) × 15일 = 30슬롯으로 한 바퀴.
// (예: 2026-04-17 UTC 01:05 슬롯 N, 2026-04-17 UTC 13:05 슬롯 N+1, ...)
function pickTemplateId(dateMs: number): TemplateId {
  const slotMs = 12 * 60 * 60 * 1000;
  const slotIndex = Math.floor(dateMs / slotMs);
  const idx = ((slotIndex % TEMPLATE_IDS.length) + TEMPLATE_IDS.length) % TEMPLATE_IDS.length;
  return TEMPLATE_IDS[idx];
}

type TemplatePostPayload = {
  text: string;
  templateId: TemplateId;
  gifUrl?: string;
};

async function buildTemplatePost(): Promise<TemplatePostPayload> {
  const rankingParams = new URLSearchParams({
    limit: "50",
    source: "yahoo_us",
  });

  const [up, down] = await Promise.all([
    getFeedRankings("up", rankingParams),
    getFeedRankings("down", rankingParams),
  ]);

  const topUps = up.items.slice(0, 3);
  const topDowns = down.items.slice(0, 3);

  if (topUps.length < 3 || topDowns.length < 3) {
    throw new Error("insufficient_rankings_for_x_post");
  }
  const templateId = pickTemplateId(Date.now());
  console.log("[x-daily-post] rankings selected", {
    templateId,
    up: topUps.map((x) => ({ symbol: x.symbol, pct: x.priceChangePct })),
    down: topDowns.map((x) => ({ symbol: x.symbol, pct: x.priceChangePct })),
  });

  const raw = renderTemplate(templateId, topUps, topDowns);
  const text = truncateForTweet(raw);
  const gifUrlRaw = (TEMPLATES as Record<TemplateId, { gif?: string }>)[templateId].gif ?? "";
  const gifUrl = gifUrlRaw.trim() ? gifUrlRaw.trim() : undefined;
  return { text, templateId, gifUrl };
}

export async function POST(request: Request) {
  if (!isCronAuthorizedRequest(request)) {
    return jsonWithCors({ error: "unauthorized" }, { status: 401 });
  }

  try {
    console.log("[x-daily-post] cron request accepted", {
      at: new Date().toISOString(),
    });
    const creds = loadXCreds("x-daily-post");
    const { text, templateId, gifUrl } = await buildTemplatePost();

    // GIF 업로드는 실패해도 텍스트 포스트는 살려둔다(fail-soft).
    let mediaId: string | null = null;
    let gifError: string | null = null;
    if (gifUrl) {
      try {
        mediaId = await uploadGifFromUrl(gifUrl, creds, "x-daily-post");
      } catch (e) {
        gifError = e instanceof Error ? e.message : "unknown_gif_error";
        console.warn("[x-daily-post] gif upload failed, posting text only", { gifError, gifUrl });
      }
    }

    const posted = await postToX(text, mediaId ? [mediaId] : [], creds, "x-daily-post");
    return jsonWithCors({
      ok: true,
      posted: true,
      mode: "template",
      templateId,
      text,
      tweetId: posted.id,
      mediaId,
      gifUrl: gifUrl ?? null,
      gifError,
      at: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    console.error("[x-daily-post] failed:", {
      error: msg,
      at: new Date().toISOString(),
    });
    return jsonWithCors(
      {
        ok: false,
        posted: false,
        error: msg,
      },
      { status: 500 },
    );
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
