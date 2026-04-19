import crypto from "node:crypto";

// ────────────────────────────────────────────────────────────────────────────
// X(Twitter) cron 엔드포인트들이 공용으로 쓰는 OAuth 1.0a 서명 / 트윗 POST /
// v1.1 미디어 청크 업로드 유틸.
//
// 현재 사용처:
//  - /api/cron/x-daily-post  (랭킹 템플릿 포스트, 2/일)
//  - /api/cron/x-insight-post (coinpang 인사이트 포스트, 1/일)
//
// 환경변수:
//  - X_API_POST_URL           필수. 예: https://api.x.com/2/tweets
//  - X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET
//    OAuth 1.0a User Context 4종 (미디어 업로드에 User Context 필수).
// ────────────────────────────────────────────────────────────────────────────

// 미디어 업로드는 공식적으로 여전히 v1.1 upload.twitter.com만 지원된다.
const MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
// Animated GIF 최대 15MB (X 공식 스펙).
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
// APPEND 한 번에 올릴 최대 바이트. 4MB 권장.
const APPEND_CHUNK_BYTES = 4 * 1024 * 1024;

export type XCreds = {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

export function fingerprintEnv(
  name: string,
): { name: string; len: number; tail: string } | { name: string; missing: true } {
  const v = process.env[name];
  if (v == null) return { name, missing: true };
  return { name, len: v.length, tail: v.length >= 4 ? v.slice(-4) : v };
}

export function loadXCreds(logTag = "x-post"): XCreds {
  const consumerKey = process.env.X_API_KEY?.trim();
  const consumerSecret = process.env.X_API_SECRET?.trim();
  const accessToken = process.env.X_ACCESS_TOKEN?.trim();
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET?.trim();
  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
    console.error(`[${logTag}] missing creds`, {
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

export function buildPostUrlCandidates(): string[] {
  const primary = process.env.X_API_POST_URL?.trim().replace(/\/+$/, "");
  if (!primary) {
    throw new Error("missing_x_api_post_url");
  }
  const candidates = [primary];
  // 리브랜딩 시기 보정: api.x.com <-> api.twitter.com 호스트만 스왑해 1회 폴백.
  if (primary.includes("api.x.com")) {
    candidates.push(primary.replace("api.x.com", "api.twitter.com"));
  } else if (primary.includes("api.twitter.com")) {
    candidates.push(primary.replace("api.twitter.com", "api.x.com"));
  }
  return candidates;
}

// ────────────────────────────────────────────────────────────────────────────
// 트윗 길이 ("weight") 추정 & 안전 절단
//   - Latin/숫자/기호 = 1, 한글/한자/가나/이모지 = 2
//   - http(s) URL은 t.co로 감싸져 23 고정 (정규식으로 자동 탐지 후 _*23으로 치환)
// ────────────────────────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/\S+/g;

export function estimateTweetWeight(text: string): number {
  const placeholder = "_".repeat(23);
  const replaced = text.replace(URL_REGEX, placeholder);
  let w = 0;
  for (const ch of replaced) {
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

export function truncateForTweet(text: string, max = 280): string {
  if (estimateTweetWeight(text) <= max) return text;
  // 간단하게 뒤에서부터 한 글자씩 깎는다.
  const chars = Array.from(text);
  while (chars.length > 0) {
    chars.pop();
    const t = `${chars.join("")}…`;
    if (estimateTweetWeight(t) <= max) return t;
  }
  return "";
}

// ────────────────────────────────────────────────────────────────────────────
// OAuth 1.0a User Context 서명 헤더 빌더
// ────────────────────────────────────────────────────────────────────────────

export function oauthEnc(v: string): string {
  return encodeURIComponent(v).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * OAuth 1.0a Authorization 헤더.
 * - `url`은 쿼리스트링 제외한 base URL만.
 * - `queryParams`: URL에 붙는 ?k=v (서명에 포함).
 * - `formParams`: application/x-www-form-urlencoded 바디 (서명에 포함).
 *   multipart/form-data나 JSON 바디의 경우 formParams는 비운다 (OAuth 1.0a 규격).
 */
export function buildOAuth1Header(opts: {
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
// 미디어 다운로드 + X v1.1 청크 업로드
// ────────────────────────────────────────────────────────────────────────────

async function downloadMedia(
  url: string,
  logTag: string,
): Promise<{ buffer: Buffer; mime: string }> {
  console.log(`[${logTag}] media download start`, { url });
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`media_download_failed_${res.status}`);
  }
  const headerMime = (res.headers.get("content-type") || "").split(";")[0].trim();
  const ab = await res.arrayBuffer();
  const buffer = Buffer.from(ab);
  if (buffer.length === 0) throw new Error("media_download_empty");
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new Error(`media_too_large_${buffer.length}`);
  }
  // Content-Type이 비었거나 이상하면 확장자로 보정.
  let mime = headerMime;
  if (!mime || !/^(image|video)\//.test(mime)) {
    if (/\.gif(\?|$)/i.test(url)) mime = "image/gif";
    else if (/\.(mp4|m4v)(\?|$)/i.test(url)) mime = "video/mp4";
    else if (/\.(jpe?g)(\?|$)/i.test(url)) mime = "image/jpeg";
    else if (/\.png(\?|$)/i.test(url)) mime = "image/png";
    else mime = "image/gif";
  }
  console.log(`[${logTag}] media downloaded`, { bytes: buffer.length, mime });
  return { buffer, mime };
}

function mediaCategoryFor(mime: string): string {
  if (mime === "image/gif") return "tweet_gif";
  if (mime.startsWith("video/")) return "tweet_video";
  return "tweet_image";
}

export async function uploadMediaToX(
  buffer: Buffer,
  mime: string,
  creds: XCreds,
  logTag = "x-post",
): Promise<string> {
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
  console.log(`[${logTag}] media INIT ok`, { mediaId, category });

  // 2) APPEND (multipart/form-data). command/media_id/segment_index는 쿼리로 보내 서명 포함.
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
    form.append(
      "media",
      new Blob([new Uint8Array(chunk)], { type: "application/octet-stream" }),
      "chunk",
    );
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
  console.log(`[${logTag}] media APPEND ok`, { segments: segIndex });

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
  console.log(`[${logTag}] media FINALIZE ok`, {
    mediaId,
    state: finJson.processing_info?.state ?? "none",
  });

  // 4) STATUS polling — GIF/video는 거의 항상 필요. 최대 ~30초 대기.
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
    throw new Error(
      `media_processing_failed:${procInfo.error?.message ?? procInfo.error?.name ?? "unknown"}`,
    );
  }

  console.log(`[${logTag}] media ready`, { mediaId });
  return mediaId;
}

export async function uploadGifFromUrl(
  gifUrl: string,
  creds: XCreds,
  logTag = "x-post",
): Promise<string> {
  const { buffer, mime } = await downloadMedia(gifUrl, logTag);
  return uploadMediaToX(buffer, mime, creds, logTag);
}

// ────────────────────────────────────────────────────────────────────────────
// 트윗 POST
// ────────────────────────────────────────────────────────────────────────────

export async function postToX(
  text: string,
  mediaIds: string[],
  creds: XCreds,
  logTag = "x-post",
): Promise<{ id: string | null; raw: unknown }> {
  const postUrlCandidates = buildPostUrlCandidates();
  console.log(`[${logTag}] postToX start`, {
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
    console.log(`[${logTag}] attempt`, { url });
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
    console.log(`[${logTag}] attempt result`, {
      url,
      status: res.status,
      ok: res.ok,
      responsePreview: String(rawText).slice(0, 240),
    });
    return { status: res.status, ok: res.ok, rawText, parsed, headers };
  }

  // 1차 URL이 404일 때만 폴백 URL로 재시도. 그 외는 즉시 중단.
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
  // X가 내려주는 한도/크레딧 헤더만 골라 로그.
  const quotaHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.headers)) {
    if (/^x-.*(credit|limit|quota|rate|remaining|reset|used)/i.test(k)) {
      quotaHeaders[k] = v;
    }
  }
  console.log(`[${logTag}] post success`, {
    tweetId: obj?.data?.id ?? null,
    quotaHeaders,
  });
  return { id: obj?.data?.id ?? null, raw: result.parsed };
}
