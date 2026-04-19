// X `x-daily-post` cron에서 장전 인사이트 포스트를 만들 때 긁어오는 시장 뉴스 RSS 소스.
//
// 저작권 이슈를 피하기 위해:
//   - 본문은 복붙하지 않고, OpenAI로 한국어 2-3줄 요약을 생성한다.
//   - 원문 링크와 출처명을 반드시 트윗에 포함해 attribution을 준다.
//
// 모든 소스는 표준 RSS 2.0 `<item><title>/<link>/<description>/<pubDate>` 포맷이어야 한다.

export type RssSource = {
  /** 출처 라벨 (트윗에 표시) */
  name: string;
  /** 트윗/로그용 짧은 식별자 */
  key: string;
  /** RSS 피드 URL */
  url: string;
  /** 무료 피드 중 일부는 브라우저 User-Agent가 없으면 차단한다. */
  userAgent?: string;
};

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

export const RSS_SOURCES: RssSource[] = [
  {
    name: "CNBC",
    key: "cnbc_top",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
    userAgent: DEFAULT_UA,
  },
  {
    name: "CNBC Markets",
    key: "cnbc_markets",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20409666",
    userAgent: DEFAULT_UA,
  },
  {
    name: "MarketWatch",
    key: "mw_top",
    url: "https://feeds.marketwatch.com/marketwatch/topstories/",
    userAgent: DEFAULT_UA,
  },
  {
    name: "Yahoo Finance",
    key: "yahoo",
    url: "https://finance.yahoo.com/news/rssindex",
    userAgent: DEFAULT_UA,
  },
];
