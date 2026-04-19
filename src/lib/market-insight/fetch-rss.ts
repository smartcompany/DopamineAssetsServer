import { RSS_SOURCES, type RssSource } from "./rss-sources";

export type RssItem = {
  sourceKey: string;
  sourceName: string;
  title: string;
  link: string;
  description: string;
  /** Unix millis. 파싱 실패 시 0. */
  publishedAtMs: number;
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => {
      const code = Number.parseInt(d, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => {
      const code = Number.parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractCdataOrText(raw: string): string {
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  const body = cdata ? cdata[1] : raw;
  return stripHtml(decodeHtmlEntities(body)).trim();
}

function extractTagText(itemXml: string, tag: string): string {
  // `<tag attr="...">...content...</tag>` 또는 self-closing 제외.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = itemXml.match(re);
  if (!m) return "";
  return extractCdataOrText(m[1]);
}

function parsePubDateMs(raw: string): number {
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function parseRssItems(xml: string, source: RssSource): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  const matches = xml.match(itemRe) ?? [];
  for (const block of matches) {
    const title = extractTagText(block, "title");
    const link = extractTagText(block, "link");
    const descriptionRaw = extractTagText(block, "description");
    const pubDate = extractTagText(block, "pubDate");
    if (!title || !link) continue;
    items.push({
      sourceKey: source.key,
      sourceName: source.name,
      title,
      link,
      description: descriptionRaw,
      publishedAtMs: parsePubDateMs(pubDate),
    });
  }
  return items;
}

async function fetchSource(source: RssSource, timeoutMs: number): Promise<RssItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(source.url, {
      headers: source.userAgent ? { "User-Agent": source.userAgent } : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[market-insight] rss fetch non-ok", {
        source: source.key,
        status: res.status,
      });
      return [];
    }
    const xml = await res.text();
    const items = parseRssItems(xml, source);
    console.log("[market-insight] rss fetch ok", {
      source: source.key,
      count: items.length,
    });
    return items;
  } catch (e) {
    console.warn("[market-insight] rss fetch failed", {
      source: source.key,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 모든 소스 병렬 수집 → 최신순 정렬된 기사 리스트 반환.
 * 개별 소스 실패는 무시(fail-soft).
 */
export async function fetchAllRssItems(timeoutMs = 8000): Promise<RssItem[]> {
  const results = await Promise.all(RSS_SOURCES.map((s) => fetchSource(s, timeoutMs)));
  const all = results.flat();
  all.sort((a, b) => b.publishedAtMs - a.publishedAtMs);
  return all;
}
