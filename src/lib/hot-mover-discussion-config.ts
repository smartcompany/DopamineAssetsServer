import type { SupabaseClient } from "@supabase/supabase-js";

/** DB `dopamine_hot_mover_discussion_config` 한 행(id=1)과 동일한 형태 */
export type HotMoverDiscussionConfig = {
  use_time_window: boolean;
  /** `use_time_window`일 때만 사용. 1~8760 */
  window_hours: number;
  /** 급등·급락 종목당, 루트 스레드에 속한 글+댓글+답글 행 합이 이 값 이상일 때 후보 */
  min_thread_comments: number;
  /** 루트 글의 누적 조회수가 이 값 이상(0이면 조건 없음) */
  min_root_view_count: number;
};

export const HOT_MOVER_DISCUSSION_CONFIG_DEFAULTS: HotMoverDiscussionConfig = {
  use_time_window: true,
  window_hours: 4,
  min_thread_comments: 2,
  min_root_view_count: 0,
};

const CONFIG_TABLE = "dopamine_hot_mover_discussion_config";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function normalizeRow(
  row: Record<string, unknown>,
): HotMoverDiscussionConfig {
  const wh = Number(row.window_hours);
  const mc = Number(row.min_thread_comments);
  const mv = Number(row.min_root_view_count);
  return {
    use_time_window: row.use_time_window !== false,
    window_hours: Number.isFinite(wh)
      ? clamp(wh, 1, 8760)
      : HOT_MOVER_DISCUSSION_CONFIG_DEFAULTS.window_hours,
    min_thread_comments: Number.isFinite(mc)
      ? clamp(mc, 1, 500)
      : HOT_MOVER_DISCUSSION_CONFIG_DEFAULTS.min_thread_comments,
    min_root_view_count: Number.isFinite(mv)
      ? clamp(mv, 0, 99_999_999)
      : HOT_MOVER_DISCUSSION_CONFIG_DEFAULTS.min_root_view_count,
  };
}

export async function loadHotMoverDiscussionConfig(
  supabase: SupabaseClient,
): Promise<HotMoverDiscussionConfig> {
  const { data, error } = await supabase
    .from(CONFIG_TABLE)
    .select(
      "use_time_window, window_hours, min_thread_comments, min_root_view_count",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.warn("[hot-mover-discussion-config] load failed", error.message);
    return { ...HOT_MOVER_DISCUSSION_CONFIG_DEFAULTS };
  }
  if (!data) return { ...HOT_MOVER_DISCUSSION_CONFIG_DEFAULTS };
  return normalizeRow(data as Record<string, unknown>);
}

export type HotMoverDiscussionConfigPayload = {
  useTimeWindow: boolean;
  windowHours: number;
  minThreadComments: number;
  minRootViewCount: number;
};

export function configToPayload(c: HotMoverDiscussionConfig): HotMoverDiscussionConfigPayload {
  return {
    useTimeWindow: c.use_time_window,
    windowHours: c.window_hours,
    minThreadComments: c.min_thread_comments,
    minRootViewCount: c.min_root_view_count,
  };
}

export function parseConfigPayload(
  body: unknown,
): { ok: true; config: HotMoverDiscussionConfig } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "invalid_body" };
  }
  const o = body as Record<string, unknown>;
  if (typeof o.useTimeWindow !== "boolean") {
    return { ok: false, error: "invalid_useTimeWindow" };
  }
  const wh = Number(o.windowHours);
  const mc = Number(o.minThreadComments);
  const mv = Number(o.minRootViewCount);
  if (!Number.isFinite(wh) || wh < 1 || wh > 8760) {
    return { ok: false, error: "invalid_windowHours" };
  }
  if (!Number.isFinite(mc) || mc < 1 || mc > 500) {
    return { ok: false, error: "invalid_minThreadComments" };
  }
  if (!Number.isFinite(mv) || mv < 0 || mv > 99_999_999) {
    return { ok: false, error: "invalid_minRootViewCount" };
  }
  return {
    ok: true,
    config: {
      use_time_window: o.useTimeWindow,
      window_hours: Math.floor(wh),
      min_thread_comments: Math.floor(mc),
      min_root_view_count: Math.floor(mv),
    },
  };
}

export async function saveHotMoverDiscussionConfig(
  supabase: SupabaseClient,
  config: HotMoverDiscussionConfig,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from(CONFIG_TABLE).upsert(
    {
      id: 1,
      use_time_window: config.use_time_window,
      window_hours: config.window_hours,
      min_thread_comments: config.min_thread_comments,
      min_root_view_count: config.min_root_view_count,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) return { error: error.message };
  return { error: null };
}
