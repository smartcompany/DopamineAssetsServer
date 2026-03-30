/** Supabase cache for theme rankings and charts. */

/** `dopamine_theme_cache.id` — all computed theme rows (raw metrics). */
export const THEME_CACHE_ID = "themes_computed_rows" as const;

/** `dopamine_theme_chart_cache.id` prefix. */
export const THEME_CHART_CACHE_ID_PREFIX = "theme_chart" as const;

export function themeChartCacheId(
  themeId: string,
  rangeDays: number,
): string {
  return `${THEME_CHART_CACHE_ID_PREFIX}|${themeId}|${rangeDays}`;
}

