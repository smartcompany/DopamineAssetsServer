import { jsonWithCors } from "@/lib/cors";
import { getFeedRankings } from "@/lib/feed-rankings-service";
import { isCronAuthorizedRequest } from "@/lib/cron-secret-auth";
import crypto from "node:crypto";

// X Tweets(생성) API URL. env `X_API_POST_URL`에 반드시 지정되어 있어야 한다.
// 404가 나면 `api.x.com` <-> `api.twitter.com` 호스트만 스왑해 한 번 더 시도한다(리브랜딩 시기 보정).
// 검색용 `X_API_BASE_URL`(다른 env)와는 별개.
const SHARE_URL = "https://dopamine-assets.vercel.app/?from=share";

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

function clipName(name: string, max = 28): string {
  const t = name.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function lineNo(index: number, name: string, symbol: string, changePct: number): string {
  return `${index + 1}. ${clipName(name)} (${symbol}) ${pct(changePct)}`;
}

function truncateForTweet(text: string, max = 280): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

async function buildDailyPostText(): Promise<string> {
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
  console.log("[x-daily-post] rankings selected", {
    up: topUps.map((x) => ({ symbol: x.symbol, pct: x.priceChangePct })),
    down: topDowns.map((x) => ({ symbol: x.symbol, pct: x.priceChangePct })),
  });

  const upLines = topUps.map((x, i) => lineNo(i, x.name, x.symbol, x.priceChangePct));
  const downLines = topDowns.map((x, i) => lineNo(i, x.name, x.symbol, x.priceChangePct));

  const body = [
    "Today’s most insane assets 🚀📉",
    "",
    ...upLines,
    "",
    ...downLines,
    "",
    SHARE_URL,
  ].join("\n");

  return truncateForTweet(body);
}

function fingerprintEnv(name: string): { name: string; len: number; tail: string } | { name: string; missing: true } {
  const v = process.env[name];
  if (v == null) return { name, missing: true };
  // 값 자체는 노출하지 않고 길이 + 끝 4글자 "지문"만 로그로 남긴다.
  return { name, len: v.length, tail: v.length >= 4 ? v.slice(-4) : v };
}

async function postToX(text: string): Promise<{ id: string | null; raw: unknown }> {
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
  const postUrlCandidates = buildPostUrlCandidates();
  console.log("[x-daily-post] postToX start", {
    postUrlCandidates,
    textLength: text.length,
    oauthMode: "oauth1_user_context",
    credFingerprints: [
      fingerprintEnv("X_API_KEY"),
      fingerprintEnv("X_API_SECRET"),
      fingerprintEnv("X_ACCESS_TOKEN"),
      fingerprintEnv("X_ACCESS_TOKEN_SECRET"),
    ],
  });

  function enc(v: string): string {
    return encodeURIComponent(v)
      .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  }

  function buildOAuth1Header(url: string, method: "POST"): string {
    const oauth: Record<string, string> = {
      oauth_consumer_key: consumerKey!,
      oauth_token: accessToken!,
      oauth_nonce: crypto.randomBytes(16).toString("hex"),
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_signature_method: "HMAC-SHA1",
      oauth_version: "1.0",
    };

    const paramEntries = Object.entries(oauth)
      .map(([k, v]) => [enc(k), enc(v)] as const)
      .sort(([ak, av], [bk, bv]) => {
        if (ak === bk) return av.localeCompare(bv);
        return ak.localeCompare(bk);
      });
    const normalizedParams = paramEntries.map(([k, v]) => `${k}=${v}`).join("&");
    const baseString = `${method}&${enc(url)}&${enc(normalizedParams)}`;
    const signingKey = `${enc(consumerSecret!)}&${enc(accessTokenSecret!)}`;
    const signature = crypto
      .createHmac("sha1", signingKey)
      .update(baseString)
      .digest("base64");
    oauth.oauth_signature = signature;

    const headerParams = Object.entries(oauth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${enc(k)}="${enc(v)}"`)
      .join(", ");
    return `OAuth ${headerParams}`;
  }

  async function attempt(url: string): Promise<{
    status: number;
    ok: boolean;
    rawText: string;
    parsed: unknown;
  }> {
    const authHeader = buildOAuth1Header(url, "POST");
    console.log("[x-daily-post] attempt", { url });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
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
    return { status: res.status, ok: res.ok, rawText, parsed };
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
  console.log("[x-daily-post] post success", { tweetId: obj?.data?.id ?? null });
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
    const text = await buildDailyPostText();
    const posted = await postToX(text);
    return jsonWithCors({
      ok: true,
      posted: true,
      text,
      tweetId: posted.id,
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
