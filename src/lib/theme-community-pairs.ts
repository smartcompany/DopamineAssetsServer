export type ThemeCommunityAssetClass =
  | "us_stock"
  | "kr_stock"
  | "jp_stock"
  | "cn_stock"
  | "crypto"
  | "commodity";

/**
 * 테마 Yahoo 심볼 → 앱 asset_class (theme-definitions 심볼 규칙 기준).
 */
export function inferAssetClassForThemeSymbol(
  symbol: string,
): ThemeCommunityAssetClass {
  const s = symbol.trim();
  if (s.endsWith(".KS") || s.endsWith(".KQ")) return "kr_stock";
  if (s.endsWith(".T")) return "jp_stock";
  if (s.endsWith(".SS") || s.endsWith(".SZ")) return "cn_stock";
  if (s.includes("=")) return "commodity";
  return "us_stock";
}
