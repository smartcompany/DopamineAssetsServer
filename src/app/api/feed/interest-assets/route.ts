import { jsonWithCors } from "@/lib/cors";
import { isCronAuthorizedRequest } from "@/lib/cron-secret-auth";
import {
  fetchInterestAssetsFromOpenAI,
  type InterestAssetsPayload,
} from "@/lib/interest-assets-openai";

export const maxDuration = 120;

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

let memoryCache: {
  expiresAt: number;
  payload: InterestAssetsPayload;
} | null = null;

function cacheTtlMs(): number {
  const raw = process.env.INTEREST_ASSETS_CACHE_TTL_MS?.trim();
  if (!raw) return DEFAULT_CACHE_TTL_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CACHE_TTL_MS;
}

/**
 * OpenAI로 생성한 "오늘 관심 자산 TOP 50" (추정 점수).
 * GET ?refresh=1 로 캐시 무시(운영/디버그용).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const bypassCache = url.searchParams.get("refresh") === "1";

  if (bypassCache && !isCronAuthorizedRequest(request)) {
    return jsonWithCors({ error: "cron_unauthorized" }, { status: 401 });
  }

  if (!bypassCache && memoryCache && Date.now() < memoryCache.expiresAt) {
    return jsonWithCors({
      ok: true,
      cached: true,
      ...memoryCache.payload,
    });
  }

  try {
    const payload = await fetchInterestAssetsFromOpenAI();
    memoryCache = {
      expiresAt: Date.now() + cacheTtlMs(),
      payload,
    };
    return jsonWithCors({
      ok: true,
      cached: false,
      ...payload,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (detail.includes("OPENAI_API_KEY")) {
      return jsonWithCors(
        { error: "openai_key_missing", detail },
        { status: 503 },
      );
    }
    console.error("[interest-assets]", e);
    return jsonWithCors(
      { error: "interest_assets_failed", detail },
      { status: 502 },
    );
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
