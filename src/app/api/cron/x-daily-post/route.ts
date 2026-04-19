import { jsonWithCors } from "@/lib/cors";
import { getFeedRankings } from "@/lib/feed-rankings-service";
import { isCronAuthorizedRequest } from "@/lib/cron-secret-auth";
import crypto from "node:crypto";
import TEMPLATES from "./templates";
import { buildInsightPost, type InsightPost } from "@/lib/market-insight/build-insight-post";

// 하루 3회 X 포스트 중 30% 확률로 "장전 인사이트" 모드로 전환.
// 신뢰성 레이어(시장 뉴스 요약)와 재미 레이어(랭킹 템플릿)를 섞어 계정 톤을 다양하게.
// 환경변수 `X_INSIGHT_PROBABILITY`로 덮어쓰기 가능 (0~1, 기본 0.3).
const DEFAULT_INSIGHT_PROBABILITY = 0.3;

// X Tweets(생성) API URL. env `X_API_POST_URL`에 반드시 지정되어 있어야 한다.
// 404가 나면 `api.x.com` <-> `api.twitter.com` 호스트만 스왑해 한 번 더 시도한다(리브랜딩 시기 보정).
// 검색용 `X_API_BASE_URL`(다른 env)와는 별개.
const SHARE_URL = "https://dopamine-assets.vercel.app/?from=share";

// 미디어 업로드는 여전히 v1.1 upload.twitter.com 엔드포인트만 공식 지원된다.
const MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";

// 업로드 허용 미디어 최대 크기 (X 공식 스펙 기준 Animated GIF 15MB).
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
// APPEND 한 번에 올릴 최대 바이트. 4MB 권장.
const APPEND_CHUNK_BYTES = 4 * 1024 * 1024;

function buildPostUrlCandidates(): string[] {
  const primary = process.env.X_API_POST_URL?.trim().replace(/\/+$/, "");
  if (!primary) {
    throw new Error("missing_x_api_post_url");
  }
  const candidates = [primary];
  // 호스트 스왑 폴백 URL 한 개 추가.
  if (primary.includes("api.x.com")) {
    candidates.push(primary.replace("api.x.com", "api.twitter.com"));
  } else if (primary.includes("api.twitter.com")) {
    candidates.push(primary.replace("api.twitter.com", "api.x.com"));
  }
  return candidates;
}

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

/**
 * X tweet "weight" 추정 (실제 계산은 twitter-text 라이브러리와 살짝 다르지만 근사).
 * Latin/숫자/기호 = 1, 한글/한자/가나/이모지 = 2. URL은 t.co로 감싸져 23.
 */
function estimateTweetWeight(text: string, urlsAs23: string[] = []): number {
  let work = text;
  for (const u of urlsAs23) work = work.split(u).join("_".repeat(23));
  let w = 0;
  for (const ch of work) {
    const cp = ch.codePointAt(0) ?? 0;
    const isHeavy =
      (cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
      (cp >= 0x3000 && cp <= 0x9fff) || // CJK
      (cp >= 0xa000 && cp <= 0xd7a3) || // Yi/Hangul Syllables
      (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
      cp >= 0x10000; // Supplementary (emoji 등)
    w += isHeavy ? 2 : 1;
  }
  return w;
}

function truncateForTweet(text: string, max = 280): string {
  if (estimateTweetWeight(text, [SHARE_URL]) <= max) return text;
  // 간단하게 뒤에서부터 한 글자씩 깎는다.
  const chars = Array.from(text);
  while (chars.length > 0) {
    chars.pop();
    const t = `${chars.join("")}…`;
    if (estimateTweetWeight(t, [SHARE_URL]) <= max) return t;
  }
  return "";
}

type RankItem = { name: string; symbol: string; priceChangePct: number };

// 30종 템플릿 ID. 8시간 슬롯마다 회전하는 순서대로 나열.
// 실제 본문은 templates.ts에 동일한 키로 등록되어 있어야 한다.
// 하루 3포스트(08h 간격) × 10일 = 30슬롯 → 전체 한 바퀴.
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

// 부팅 시 1회: 10개 ID가 templates.ts에 모두 존재하는지 확인해 누락을 일찍 잡아낸다.
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

// 8시간 슬롯 기준 템플릿 선택. 하루 3포스트(08h 간격) × 10일 = 30슬롯으로 한 바퀴.
// (예: 2026-04-17 UTC 01:05 슬롯 N, 2026-04-17 UTC 09:05 슬롯 N+1, ...)
function pickTemplateId(dateMs: number): TemplateId {
  const slotMs = 8 * 60 * 60 * 1000;
  const slotIndex = Math.floor(dateMs / slotMs);
  const idx = ((slotIndex % TEMPLATE_IDS.length) + TEMPLATE_IDS.length) % TEMPLATE_IDS.length;
  return TEMPLATE_IDS[idx];
}

type DailyPostMode = "template" | "insight";

type DailyPostPayload = {
  mode: DailyPostMode;
  text: string;
  /** mode="template"일 때만 채워진다. insight 모드에서는 "insight" 고정 라벨. */
  templateId: TemplateId | "insight";
  gifUrl?: string;
  /** insight 모드에서 원문 기사 링크 (로그/응답 디버깅용) */
  sourceUrl?: string;
  sourceTitle?: string;
  sourceName?: string;
};

function insightProbability(): number {
  const raw = process.env.X_INSIGHT_PROBABILITY?.trim();
  if (!raw) return DEFAULT_INSIGHT_PROBABILITY;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return DEFAULT_INSIGHT_PROBABILITY;
  return Math.min(1, Math.max(0, n));
}

function shouldUseInsightMode(): boolean {
  const p = insightProbability();
  if (p <= 0) return false;
  if (p >= 1) return true;
  // 매 실행마다 독립적으로 Math.random() 판정 → 예측 불가, 장기적으로 p에 수렴.
  return Math.random() < p;
}

function insightPostToPayload(post: InsightPost): DailyPostPayload {
  const text = truncateForTweet(post.text);
  return {
    mode: "insight",
    text,
    templateId: "insight",
    gifUrl: undefined,
    sourceUrl: post.sourceUrl,
    sourceTitle: post.sourceTitle,
    sourceName: post.sourceName,
  };
}

async function buildTemplatePost(): Promise<DailyPostPayload> {
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
  return { mode: "template", text, templateId, gifUrl };
}

/**
 * 인사이트 모드 우선 시도 → 실패 시 템플릿 모드로 fallback.
 * 환경변수 `X_INSIGHT_PROBABILITY`(0~1)로 스위칭 확률 제어.
 */
async function buildDailyPost(): Promise<DailyPostPayload> {
  const useInsight = shouldUseInsightMode();
  console.log("[x-daily-post] mode roll", {
    probability: insightProbability(),
    useInsight,
  });
  if (useInsight) {
    try {
      const insight = await buildInsightPost();
      if (insight) {
        console.log("[x-daily-post] insight built", {
          sourceName: insight.sourceName,
          sourceTitle: insight.sourceTitle.slice(0, 80),
          textLen: insight.text.length,
        });
        return insightPostToPayload(insight);
      }
      console.warn("[x-daily-post] insight builder returned null, fallback to template");
    } catch (e) {
      console.warn("[x-daily-post] insight build failed, fallback to template", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return buildTemplatePost();
}

function fingerprintEnv(
  name: string,
): { name: string; len: number; tail: string } | { name: string; missing: true } {
  const v = process.env[name];
  if (v == null) return { name, missing: true };
  // 값 자체는 노출하지 않고 길이 + 끝 4글자 "지문"만 로그로 남긴다.
  return { name, len: v.length, tail: v.length >= 4 ? v.slice(-4) : v };
}

// ────────────────────────────────────────────────────────────────────────────
// OAuth 1.0a User Context 서명 유틸
// 여러 엔드포인트(POST 트윗, v1.1 미디어 업로드)에서 재사용.
// ────────────────────────────────────────────────────────────────────────────

type XCreds = {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

function loadXCreds(): XCreds {
  const consumerKey = process.env.X_API_KEY?.trim();
  const consumerSecret = process.env.X_API_SECRET?.trim();
  const accessToken = process.env.X_ACCESS_TOKEN?.trim();
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET?.trim();
  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
    console.error("[x-daily-post] missing creds", {
      fingerprints: [
        fingerprintEnv("X_API_KEY"),
        fingerprintEnv("X_API_SECRET"),
        fingerprintEnv("X_ACCESS_TOKEN"),
        fingerprintEnv("X_ACCESS_TOKEN_SECRET"),
      ],
    });
    throw new Error("missing_x_oauth1_user_context_credentials");
  }
  return { consumerKey, consumerSecret, accessToken, accessTokenSecret };
}

function oauthEnc(v: string): string {
  return encodeURIComponent(v).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * OAuth 1.0a Authorization 헤더 빌드.
 * - URL은 쿼리스트링 제외한 base URL만 넘긴다.
 * - queryParams: URL에 붙일 ?k=v 들 (서명에 포함).
 * - formParams: application/x-www-form-urlencoded 바디 파라미터 (서명에 포함).
 *   multipart/form-data나 JSON 바디의 경우 formParams는 비운다 (OAuth 1.0a 규격).
 */
function buildOAuth1Header(opts: {
  method: "GET" | "POST";
  url: string;
  creds: XCreds;
  queryParams?: Record<string, string>;
  formParams?: Record<string, string>;
}): string {
  const { method, url, creds, queryParams = {}, formParams = {} } = opts;
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_token: creds.accessToken,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_version: "1.0",
  };
  const allParams: Record<string, string> = { ...oauth, ...queryParams, ...formParams };
  const paramEntries = Object.entries(allParams)
    .map(([k, v]) => [oauthEnc(k), oauthEnc(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)));
  const normalized = paramEntries.map(([k, v]) => `${k}=${v}`).join("&");
  const baseString = `${method}&${oauthEnc(url)}&${oauthEnc(normalized)}`;
  const signingKey = `${oauthEnc(creds.consumerSecret)}&${oauthEnc(creds.accessTokenSecret)}`;
  oauth.oauth_signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
  const headerParams = Object.entries(oauth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${oauthEnc(k)}="${oauthEnc(v)}"`)
    .join(", ");
  return `OAuth ${headerParams}`;
}

// ────────────────────────────────────────────────────────────────────────────
// 미디어(GIF/이미지) 다운로드 + X에 업로드 → media_id 반환
// 실패해도 상위에서 텍스트만 올리도록 throw.
// ────────────────────────────────────────────────────────────────────────────

async function downloadMedia(url: string): Promise<{ buffer: Buffer; mime: string }> {
  console.log("[x-daily-post] gif download start", { url });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`gif_download_failed_${res.status}`);
  }
  const headerMime = (res.headers.get("content-type") || "").split(";")[0].trim();
  const ab = await res.arrayBuffer();
  const buffer = Buffer.from(ab);
  if (buffer.length === 0) throw new Error("gif_download_empty");
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new Error(`gif_too_large_${buffer.length}`);
  }
  // Content-Type이 비어있거나 이상하면 URL 확장자로 보정.
  let mime = headerMime;
  if (!mime || !/^(image|video)\//.test(mime)) {
    if (/\.gif(\?|$)/i.test(url)) mime = "image/gif";
    else if (/\.(mp4|m4v)(\?|$)/i.test(url)) mime = "video/mp4";
    else if (/\.(jpe?g)(\?|$)/i.test(url)) mime = "image/jpeg";
    else if (/\.png(\?|$)/i.test(url)) mime = "image/png";
    else mime = "image/gif";
  }
  console.log("[x-daily-post] gif downloaded", { bytes: buffer.length, mime });
  return { buffer, mime };
}

function mediaCategoryFor(mime: string): string {
  if (mime === "image/gif") return "tweet_gif";
  if (mime.startsWith("video/")) return "tweet_video";
  return "tweet_image";
}

async function uploadMediaToX(buffer: Buffer, mime: string, creds: XCreds): Promise<string> {
  const category = mediaCategoryFor(mime);

  // 1) INIT (application/x-www-form-urlencoded)
  const initForm: Record<string, string> = {
    command: "INIT",
    total_bytes: buffer.length.toString(),
    media_type: mime,
    media_category: category,
  };
  const initAuth = buildOAuth1Header({
    method: "POST",
    url: MEDIA_UPLOAD_URL,
    creds,
    formParams: initForm,
  });
  const initRes = await fetch(MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: initAuth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(initForm).toString(),
  });
  if (!initRes.ok) {
    const t = await initRes.text().catch(() => "");
    throw new Error(`media_init_failed_${initRes.status}:${t.slice(0, 300)}`);
  }
  const initJson = (await initRes.json()) as { media_id_string?: string };
  const mediaId = initJson.media_id_string;
  if (!mediaId) throw new Error("media_init_missing_id");
  console.log("[x-daily-post] media INIT ok", { mediaId, category });

  // 2) APPEND (multipart/form-data). command/media_id/segment_index는 쿼리 파라미터로 보내 서명에 포함시킨다.
  let segIndex = 0;
  for (let offset = 0; offset < buffer.length; offset += APPEND_CHUNK_BYTES) {
    const end = Math.min(offset + APPEND_CHUNK_BYTES, buffer.length);
    const chunk = buffer.subarray(offset, end);
    const queryParams: Record<string, string> = {
      command: "APPEND",
      media_id: mediaId,
      segment_index: segIndex.toString(),
    };
    const qs = new URLSearchParams(queryParams).toString();
    const appendUrl = `${MEDIA_UPLOAD_URL}?${qs}`;
    const appendAuth = buildOAuth1Header({
      method: "POST",
      url: MEDIA_UPLOAD_URL,
      creds,
      queryParams,
    });
    const form = new FormData();
    form.append("media", new Blob([new Uint8Array(chunk)], { type: "application/octet-stream" }), "chunk");
    const appendRes = await fetch(appendUrl, {
      method: "POST",
      headers: { Authorization: appendAuth },
      body: form,
    });
    if (!appendRes.ok) {
      const t = await appendRes.text().catch(() => "");
      throw new Error(`media_append_failed_${appendRes.status}:${t.slice(0, 300)}`);
    }
    segIndex++;
  }
  console.log("[x-daily-post] media APPEND ok", { segments: segIndex });

  // 3) FINALIZE
  const finalizeForm = { command: "FINALIZE", media_id: mediaId };
  const finalizeAuth = buildOAuth1Header({
    method: "POST",
    url: MEDIA_UPLOAD_URL,
    creds,
    formParams: finalizeForm,
  });
  const finalizeRes = await fetch(MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: finalizeAuth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(finalizeForm).toString(),
  });
  if (!finalizeRes.ok) {
    const t = await finalizeRes.text().catch(() => "");
    throw new Error(`media_finalize_failed_${finalizeRes.status}:${t.slice(0, 300)}`);
  }
  type ProcInfo = {
    state: "pending" | "in_progress" | "succeeded" | "failed";
    check_after_secs?: number;
    error?: { message?: string; name?: string };
  };
  const finJson = (await finalizeRes.json()) as { processing_info?: ProcInfo };
  console.log("[x-daily-post] media FINALIZE ok", {
    mediaId,
    state: finJson.processing_info?.state ?? "none",
  });

  // 4) STATUS polling (GIF/video는 거의 항상 필요). 최대 ~20초 정도 대기 보장.
  let procInfo = finJson.processing_info;
  const deadline = Date.now() + 30_000;
  while (procInfo && (procInfo.state === "pending" || procInfo.state === "in_progress")) {
    if (Date.now() > deadline) throw new Error("media_processing_timeout");
    const waitSec = Math.max(1, procInfo.check_after_secs ?? 1);
    await new Promise((r) => setTimeout(r, waitSec * 1000));
    const statusQuery = { command: "STATUS", media_id: mediaId };
    const qs = new URLSearchParams(statusQuery).toString();
    const statusAuth = buildOAuth1Header({
      method: "GET",
      url: MEDIA_UPLOAD_URL,
      creds,
      queryParams: statusQuery,
    });
    const statusRes = await fetch(`${MEDIA_UPLOAD_URL}?${qs}`, {
      method: "GET",
      headers: { Authorization: statusAuth },
    });
    if (!statusRes.ok) {
      const t = await statusRes.text().catch(() => "");
      throw new Error(`media_status_failed_${statusRes.status}:${t.slice(0, 300)}`);
    }
    const sj = (await statusRes.json()) as { processing_info?: ProcInfo };
    procInfo = sj.processing_info;
  }
  if (procInfo && procInfo.state === "failed") {
    throw new Error(`media_processing_failed:${procInfo.error?.message ?? procInfo.error?.name ?? "unknown"}`);
  }

  console.log("[x-daily-post] media ready", { mediaId });
  return mediaId;
}

async function uploadGifFromUrl(gifUrl: string, creds: XCreds): Promise<string> {
  const { buffer, mime } = await downloadMedia(gifUrl);
  return uploadMediaToX(buffer, mime, creds);
}

// ────────────────────────────────────────────────────────────────────────────
// 트윗 POST
// ────────────────────────────────────────────────────────────────────────────

async function postToX(
  text: string,
  mediaIds: string[],
  creds: XCreds,
): Promise<{ id: string | null; raw: unknown }> {
  const postUrlCandidates = buildPostUrlCandidates();
  console.log("[x-daily-post] postToX start", {
    postUrlCandidates,
    textLength: text.length,
    hasMedia: mediaIds.length > 0,
    mediaIds,
    oauthMode: "oauth1_user_context",
    credFingerprints: [
      fingerprintEnv("X_API_KEY"),
      fingerprintEnv("X_API_SECRET"),
      fingerprintEnv("X_ACCESS_TOKEN"),
      fingerprintEnv("X_ACCESS_TOKEN_SECRET"),
    ],
  });

  const body: Record<string, unknown> = { text };
  if (mediaIds.length > 0) body.media = { media_ids: mediaIds };
  const bodyStr = JSON.stringify(body);

  async function attempt(url: string): Promise<{
    status: number;
    ok: boolean;
    rawText: string;
    parsed: unknown;
    headers: Record<string, string>;
  }> {
    const authHeader = buildOAuth1Header({ method: "POST", url, creds });
    console.log("[x-daily-post] attempt", { url });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const rawText = await res.text().catch(() => "");
    let parsed: unknown = rawText;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      // keep raw text
    }
    console.log("[x-daily-post] attempt result", {
      url,
      status: res.status,
      ok: res.ok,
      responsePreview: String(rawText).slice(0, 240),
    });
    return { status: res.status, ok: res.ok, rawText, parsed, headers };
  }

  // 1차 URL 실패(404)만 폴백 URL로 재시도. 그 외 에러는 즉시 중단.
  let result: Awaited<ReturnType<typeof attempt>> | null = null;
  for (const url of postUrlCandidates) {
    result = await attempt(url);
    if (result.ok) break;
    if (result.status !== 404) break;
  }

  if (!result || !result.ok) {
    const status = result?.status ?? 0;
    const raw = result?.rawText ?? "";
    throw new Error(`x_post_failed_${status}:${String(raw).slice(0, 500)}`);
  }

  const obj = result.parsed as { data?: { id?: string } } | null;
  // X가 내려주는 한도/크레딧 관련 헤더만 골라 남긴다.
  const quotaHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.headers)) {
    if (/^x-.*(credit|limit|quota|rate|remaining|reset|used)/i.test(k)) {
      quotaHeaders[k] = v;
    }
  }
  console.log("[x-daily-post] post success", {
    tweetId: obj?.data?.id ?? null,
    quotaHeaders,
  });
  return { id: obj?.data?.id ?? null, raw: result.parsed };
}

export async function POST(request: Request) {
  if (!isCronAuthorizedRequest(request)) {
    return jsonWithCors({ error: "unauthorized" }, { status: 401 });
  }

  try {
    console.log("[x-daily-post] cron request accepted", {
      at: new Date().toISOString(),
    });
    const creds = loadXCreds();
    const payload = await buildDailyPost();
    const { mode, text, templateId, gifUrl, sourceUrl, sourceTitle, sourceName } = payload;

    // GIF 업로드는 실패해도 텍스트 포스트는 살려둔다(fail-soft).
    let mediaId: string | null = null;
    let gifError: string | null = null;
    if (gifUrl) {
      try {
        mediaId = await uploadGifFromUrl(gifUrl, creds);
      } catch (e) {
        gifError = e instanceof Error ? e.message : "unknown_gif_error";
        console.warn("[x-daily-post] gif upload failed, posting text only", { gifError, gifUrl });
      }
    }

    const posted = await postToX(text, mediaId ? [mediaId] : [], creds);
    return jsonWithCors({
      ok: true,
      posted: true,
      mode,
      templateId,
      text,
      tweetId: posted.id,
      mediaId,
      gifUrl: gifUrl ?? null,
      gifError,
      sourceUrl: sourceUrl ?? null,
      sourceTitle: sourceTitle ?? null,
      sourceName: sourceName ?? null,
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
