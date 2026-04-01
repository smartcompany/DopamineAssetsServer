import OpenAI from "openai";
import { jsonWithCors } from "@/lib/cors";
import { openAIChatConfig } from "@/lib/openai-config";
import {
  buildCacheKey,
  canonicalizeNewsUrls,
  getCachedNewsAiSummary,
  saveCachedNewsAiSummary,
} from "@/lib/news-ai-summary-cache";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const SHA256_HEX = /^[a-f0-9]{64}$/i;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const singleUrl = typeof body.url === "string" ? body.url.trim() : "";
    const rawUrls = Array.isArray(body.urls)
      ? body.urls
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : [];
    const rawList = [...(singleUrl ? [singleUrl] : []), ...rawUrls]
      .filter((v, i, arr) => arr.indexOf(v) === i);
    const urls = canonicalizeNewsUrls(rawList);
    const locale = typeof body.locale === "string" ? body.locale.trim().toLowerCase() : "";
    const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
    const assetClass = typeof body.assetClass === "string" ? body.assetClass.trim() : "";
    const assetName = typeof body.assetName === "string" ? body.assetName.trim() : "";
    const titleDigestRaw =
      typeof body.titleDigest === "string" ? body.titleDigest.trim().toLowerCase() : "";
    const titleDigest = SHA256_HEX.test(titleDigestRaw) ? titleDigestRaw : "no_title_digest";

    if (urls.length === 0) {
      return jsonWithCors({ error: "missing_url", hint: "pass url or urls[]" }, { status: 400 });
    }
    for (const u of urls) {
      try {
        const parsed = new URL(u);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          return jsonWithCors({ error: "invalid_url_protocol", url: u }, { status: 400 });
        }
      } catch {
        return jsonWithCors({ error: "invalid_url", url: u }, { status: 400 });
      }
    }
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return jsonWithCors({ error: "openai_key_missing" }, { status: 500 });
    }

    const cacheKey = buildCacheKey({ symbol, titleDigest });

    const cached = await getCachedNewsAiSummary(cacheKey);
    if (cached && cached.summary.length > 0) {
      console.log("[news-ai-summary] cache HIT", {
        symbol,
        titleDigestPrefix: titleDigest.slice(0, 12),
      });
      return jsonWithCors({
        ok: true,
        cached: true,
        summary: cached.summary,
        impact: cached.impact,
        risk: cached.risk,
        sourceUrl: cached.source_urls[0] ?? urls[0] ?? "",
        sourceUrls: cached.source_urls.length > 0 ? cached.source_urls : urls,
      });
    }

    console.log("[news-ai-summary] cache MISS → OpenAI", {
      symbol,
      titleDigestPrefix: titleDigest.slice(0, 12),
    });

    const outputLanguage = locale.startsWith("en") ? "영어" : "한국어";
    const prompt = `당신은 투자 뉴스 요약 어시스턴트입니다.
아래 URL 목록과 종목 메타 정보를 바탕으로 요약하세요.
경제 기자의 관점에서 의견을 남겨 주세요.
응답 언어는 반드시 ${outputLanguage}로 작성하세요.

[출력 형식]
반드시 JSON 하나만 출력:
{
  "summary": "3~5문장 핵심 요약",
  "impact": ["주가/가격 영향 포인트 최대 3개"],
  "risk": ["리스크/불확실성 최대 2개"]
}

[종목 정보]
- 종목명: ${assetName || "(없음)"}
- 심볼: ${symbol || "(없음)"}
- 자산 클래스: ${assetClass || "(없음)"}
- 기사 URL 목록:
${urls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;

    const completion = await openai.chat.completions.create({
      model: openAIChatConfig.model,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) {
      return jsonWithCors({ error: "empty_ai_response" }, { status: 502 });
    }

    let parsed: { summary?: unknown; impact?: unknown; risk?: unknown } | null = null;
    try {
      parsed = JSON.parse(raw) as { summary?: unknown; impact?: unknown; risk?: unknown };
    } catch {
      parsed = null;
    }

    if (!parsed) {
      const payload = {
        ok: true,
        cached: false,
        summary: raw,
        impact: [] as string[],
        risk: [] as string[],
        sourceUrl: urls[0] ?? "",
        sourceUrls: urls,
      };
      void saveCachedNewsAiSummary({
        cacheKey,
        symbol,
        titleDigest,
        summary: raw,
        impact: [],
        risk: [],
        sourceUrls: urls,
      });
      return jsonWithCors(payload);
    }

    const summary =
      typeof parsed.summary === "string" ? parsed.summary.trim() : raw;
    const impact = Array.isArray(parsed.impact)
      ? parsed.impact.filter((v): v is string => typeof v === "string").slice(0, 3)
      : [];
    const risk = Array.isArray(parsed.risk)
      ? parsed.risk.filter((v): v is string => typeof v === "string").slice(0, 2)
      : [];

    const payload = {
      ok: true,
      cached: false,
      summary,
      impact,
      risk,
      sourceUrl: urls[0] ?? "",
      sourceUrls: urls,
    };
    void saveCachedNewsAiSummary({
      cacheKey,
      symbol,
      titleDigest,
      summary,
      impact,
      risk,
      sourceUrls: urls,
    });
    return jsonWithCors(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return jsonWithCors({ error: "news_ai_summary_failed", detail }, { status: 502 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
