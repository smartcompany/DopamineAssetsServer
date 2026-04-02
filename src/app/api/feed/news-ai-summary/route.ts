import OpenAI from "openai";
import { jsonWithCors } from "@/lib/cors";
import { openAIChatConfig } from "@/lib/openai-config";
import {
  buildCacheKey,
  canonicalizeNewsUrls,
  getCachedNewsAiSummary,
  saveCachedNewsAiSummary,
} from "@/lib/news-ai-summary-cache";
import { fetchArticleExcerptsForNewsAi } from "@/lib/news-ai-article-excerpt";

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
    const rawArticleTitles = Array.isArray((body as Record<string, unknown>).articleTitles)
      ? ((body as Record<string, unknown>).articleTitles as unknown[])
          .filter((v): v is string => typeof v === "string")
          .map((t) => t.trim())
      : [];
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

    const feedTitlesForFetch = urls.map((_, i) => rawArticleTitles[i] ?? "");
    const excerpts = await fetchArticleExcerptsForNewsAi(urls, feedTitlesForFetch);

    const outputLanguage = locale.startsWith("en") ? "영어" : "한국어";
    // AI 프롬프트에는 URL을 넣지 않음(모델이 '링크를 열 수 없다' 면책을 쓰는 빈도를 줄이기 위함).
    const articleBlock = excerpts
      .map((ex, i) => {
        const head = [`${i + 1}. 제목: ${ex.title}`];
        if (ex.excerpt.length > 0) {
          head.push(`   본문 앞부분(일부): ${ex.excerpt}`);
        } else {
          head.push(
            `   본문: (발췌 없음 — 아래 제목·종목 맥락만으로 요약)`,
          );
        }
        return head.join("\n");
      })
      .join("\n\n");

    const toneBlock =
      outputLanguage === "영어"
        ? `Brand voice: **Dopamine Assets** — high-energy, playful, a little meme-adjacent, but still sharp and useful. Think "trading floor banter + one clever hook", NOT corporate boilerplate, NOT cringe overload.
- summary: Start with a punchy hook. Short sentences. One vivid metaphor or joke is OK if it helps clarity. Still fact-grounded.
- impact: Bullet-ish energy — why traders might care *now* (momentum, narrative, flow). Avoid stiff labels like "Positive factor 1".
- risk: Honest "cold water" / what could go wrong — same lively tone, not legal-dead.
- Emoji: optional, at most one per field across the whole JSON (or none). No emoji spam.
- Never apologize for "not opening links"; you only have the text below. If excerpt is missing, stay confident and work from titles + stock context.`
        : `톤: 앱 이름이 **도파민 자산**인 것처럼, **텐션 있고 재미있되** 가벼운 농담 수준은 OK, **사실·논리는 지키세요**. 딱딱한 경제 용례 나열·보고서체는 피하세요.
- summary: 첫 문장부터 훅(왜 지금 이 뉴스인지). 3~5문장. 비유·한 마디 드립은 정보 전달에 도움 될 때만.
- impact: "왜 불타는지/왜 관심 가는지" 느낌으로 최대 3개. '호재 1' 같은 뻔한 제목 금지.
- risk: '현실 찬물'·'졸업하며 볼 포인트' 정도로 솔직하게 최대 2개. 겁주기 금지, 과장 금지.
- 이몼지: 전체 JSON에서 필드당 최대 1개 이하(없어도 됨). 남발 금지.
- 링크·URL 언급이나 '열 수 없다' 류 면책 금지. 발췌가 없으면 제목·종목 맥락으로 당당히 요약.`;

    const prompt = `당신은 **도파민 자산(Dopamine Assets)** 앱용 뉴스 큐레이터입니다.
아래 각 기사에 대해 **제목**과, 가능한 경우 **본문 앞부분(일부만)** 만 제공됩니다. 본문은 비용·토큰 절약을 위해 잘린 발췌이며 전문이 아닙니다. (원문 링크는 프롬프트에 포함하지 않습니다.)

${toneBlock}

응답 언어는 반드시 ${outputLanguage}로 작성하세요.

[출력 형식]
반드시 JSON 하나만 출력 (키 이름·배열 구조는 고정):
{
  "summary": "3~5문장. 훅 있게, 도파민 자산 톤.",
  "impact": ["최대 3개 — 재미있게 쓰되 투자 포인트가 드러나게"],
  "risk": ["최대 2개 — 솔직한 주의점, 무겁게만 쓰지 말 것"]
}

[종목 정보]
- 종목명: ${assetName || "(없음)"}
- 심볼: ${symbol || "(없음)"}
- 자산 클래스: ${assetClass || "(없음)"}

[기사별 제목 · 본문 발췌(앞부분)]
${articleBlock}`;

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
      await saveCachedNewsAiSummary({
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
    await saveCachedNewsAiSummary({
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
