import { jsonWithCors } from "@/lib/cors";
import { getFeedRankings } from "@/lib/feed-rankings-service";
import { isCronAuthorizedRequest } from "@/lib/cron-secret-auth";

const DEFAULT_X_API_BASE_URL = "https://api.twitter.com";
const SHARE_URL = "https://dopamine-assets.vercel.app/?from=share";

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

async function postToX(text: string): Promise<{ id: string | null; raw: unknown }> {
  const configuredBaseUrl = process.env.X_API_BASE_URL?.trim().replace(/\/+$/, "");
  const baseUrl = configuredBaseUrl || DEFAULT_X_API_BASE_URL;
  const bearer = process.env.X_API_TOKEN?.trim();
  if (!bearer) {
    throw new Error("missing_x_api_token");
  }
  console.log("[x-daily-post] postToX start", {
    baseUrl,
    textLength: text.length,
    tokenPresent: true,
  });

  async function attempt(base: string): Promise<{
    status: number;
    ok: boolean;
    rawText: string;
    parsed: unknown;
  }> {
    console.log("[x-daily-post] attempt", { base, endpoint: "/2/tweets" });
    const res = await fetch(`${base}/2/tweets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
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
      base,
      status: res.status,
      ok: res.ok,
      responsePreview: String(rawText).slice(0, 240),
    });
    return { status: res.status, ok: res.ok, rawText, parsed };
  }

  let usedBase = baseUrl;
  let result = await attempt(usedBase);

  // 일부 계정/설정에서 api.x.com 경로가 404일 수 있어 twitter 호스트로 폴백.
  if (
    result.status === 404 &&
    usedBase.includes("api.x.com") &&
    !usedBase.includes("api.twitter.com")
  ) {
    usedBase = "https://api.twitter.com";
    result = await attempt(usedBase);
  }

  if (!result.ok) {
    throw new Error(
      `x_post_failed_${result.status}:${String(result.rawText).slice(0, 500)}`,
    );
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
