import type { SupabaseClient } from "@supabase/supabase-js";

/** DB `dopamine_hot_mover_discussion_config` 한 행(id=1)과 동일한 형태 */
export type HotMoverDiscussionConfig = {
  use_time_window: boolean;
  /** `use_time_window`일 때만 사용. 1~8760 */
  window_hours: number;
  /** 급등·급락 종목당, 루트 스레드에 속한 글+댓글+답글 행 합 ≥ 이 값일 때 후보. 0이면 합계 조건 없음(답 없는 루트 글만 있어도 가능). */
  min_thread_comments: number;
  /** 루트 글의 누적 조회수가 이 값 이상(0이면 조건 없음) */
  min_root_view_count: number;
  /** 푸시 제목 (한). 플레이스홀더: `{name}` `{pct}` `{direction}` */
  push_title_ko: string;
  /** 푸시 제목 (영) */
  push_title_en: string;
  /** 푸시 본문 (한). `{direction}` = 급등 중 / 급락 중 */
  push_body_template_ko: string;
  /** 푸시 본문 (영). `{direction}` = surging / sliding (예: … is {direction} …) */
  push_body_template_en: string;
};

export const HOT_MOVER_PUSH_DEFAULT_TITLE_KO = "🔥 지금 뜨는 토론";
export const HOT_MOVER_PUSH_DEFAULT_TITLE_EN = "🔥 Heating up";
export const HOT_MOVER_PUSH_DEFAULT_BODY_KO =
  "💬 {name} {direction} ({pct}) · 커뮤니티 온도 미쳤어요 👀 지금 보러 와요!";
export const HOT_MOVER_PUSH_DEFAULT_BODY_EN =
  "💬 {name} is {direction} ({pct}) — Community's buzzing 👀 Tap to see what's up!";

export const HOT_MOVER_DISCUSSION_CONFIG_DEFAULTS: HotMoverDiscussionConfig = {
  use_time_window: true,
  window_hours: 4,
  min_thread_comments: 2,
  min_root_view_count: 0,
  push_title_ko: HOT_MOVER_PUSH_DEFAULT_TITLE_KO,
  push_title_en: HOT_MOVER_PUSH_DEFAULT_TITLE_EN,
  push_body_template_ko: HOT_MOVER_PUSH_DEFAULT_BODY_KO,
  push_body_template_en: HOT_MOVER_PUSH_DEFAULT_BODY_EN,
};

const MAX_PUSH_TITLE_LEN = 80;
const MAX_PUSH_BODY_TEMPLATE_LEN = 320;

/** 푸시 문구 템플릿 치환 (`{name}` `{pct}` `{direction}`) */
export function interpolateHotMoverPushTemplate(
  template: string,
  vars: { name: string; pct: string; direction: string },
): string {
  return template
    .replace(/\{name\}/g, vars.name)
    .replace(/\{pct\}/g, vars.pct)
    .replace(/\{direction\}/g, vars.direction);
}

function clipTemplate(s: string, max: number, fallback: string): string {
  const t = s.trim();
  if (t.length === 0) return fallback;
  return t.length > max ? t.slice(0, max) : t;
}

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
  const r = row as Record<string, unknown>;
  return {
    use_time_window: row.use_time_window !== false,
    window_hours: Number.isFinite(wh)
      ? clamp(wh, 1, 8760)
      : HOT_MOVER_DISCUSSION_CONFIG_DEFAULTS.window_hours,
    min_thread_comments: Number.isFinite(mc)
      ? clamp(mc, 0, 500)
      : HOT_MOVER_DISCUSSION_CONFIG_DEFAULTS.min_thread_comments,
    min_root_view_count: Number.isFinite(mv)
      ? clamp(mv, 0, 99_999_999)
      : HOT_MOVER_DISCUSSION_CONFIG_DEFAULTS.min_root_view_count,
    push_title_ko: clipTemplate(
      typeof r.push_title_ko === "string" ? r.push_title_ko : "",
      MAX_PUSH_TITLE_LEN,
      HOT_MOVER_PUSH_DEFAULT_TITLE_KO,
    ),
    push_title_en: clipTemplate(
      typeof r.push_title_en === "string" ? r.push_title_en : "",
      MAX_PUSH_TITLE_LEN,
      HOT_MOVER_PUSH_DEFAULT_TITLE_EN,
    ),
    push_body_template_ko: clipTemplate(
      typeof r.push_body_template_ko === "string"
        ? r.push_body_template_ko
        : "",
      MAX_PUSH_BODY_TEMPLATE_LEN,
      HOT_MOVER_PUSH_DEFAULT_BODY_KO,
    ),
    push_body_template_en: clipTemplate(
      typeof r.push_body_template_en === "string"
        ? r.push_body_template_en
        : "",
      MAX_PUSH_BODY_TEMPLATE_LEN,
      HOT_MOVER_PUSH_DEFAULT_BODY_EN,
    ),
  };
}

export async function loadHotMoverDiscussionConfig(
  supabase: SupabaseClient,
): Promise<HotMoverDiscussionConfig> {
  const { data, error } = await supabase
    .from(CONFIG_TABLE)
    .select(
      "use_time_window, window_hours, min_thread_comments, min_root_view_count, push_title_ko, push_title_en, push_body_template_ko, push_body_template_en",
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
  pushTitleKo: string;
  pushTitleEn: string;
  pushBodyTemplateKo: string;
  pushBodyTemplateEn: string;
};

export function configToPayload(c: HotMoverDiscussionConfig): HotMoverDiscussionConfigPayload {
  return {
    useTimeWindow: c.use_time_window,
    windowHours: c.window_hours,
    minThreadComments: c.min_thread_comments,
    minRootViewCount: c.min_root_view_count,
    pushTitleKo: c.push_title_ko,
    pushTitleEn: c.push_title_en,
    pushBodyTemplateKo: c.push_body_template_ko,
    pushBodyTemplateEn: c.push_body_template_en,
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
  if (!Number.isFinite(mc) || mc < 0 || mc > 500) {
    return { ok: false, error: "invalid_minThreadComments" };
  }
  if (!Number.isFinite(mv) || mv < 0 || mv > 99_999_999) {
    return { ok: false, error: "invalid_minRootViewCount" };
  }

  const tk =
    typeof o.pushTitleKo === "string"
      ? o.pushTitleKo.trim()
      : HOT_MOVER_PUSH_DEFAULT_TITLE_KO;
  const te =
    typeof o.pushTitleEn === "string"
      ? o.pushTitleEn.trim()
      : HOT_MOVER_PUSH_DEFAULT_TITLE_EN;
  const bk =
    typeof o.pushBodyTemplateKo === "string"
      ? o.pushBodyTemplateKo.trim()
      : HOT_MOVER_PUSH_DEFAULT_BODY_KO;
  const be =
    typeof o.pushBodyTemplateEn === "string"
      ? o.pushBodyTemplateEn.trim()
      : HOT_MOVER_PUSH_DEFAULT_BODY_EN;

  if (tk.length === 0 || tk.length > MAX_PUSH_TITLE_LEN) {
    return { ok: false, error: "invalid_pushTitleKo" };
  }
  if (te.length === 0 || te.length > MAX_PUSH_TITLE_LEN) {
    return { ok: false, error: "invalid_pushTitleEn" };
  }
  if (bk.length === 0 || bk.length > MAX_PUSH_BODY_TEMPLATE_LEN) {
    return { ok: false, error: "invalid_pushBodyTemplateKo" };
  }
  if (be.length === 0 || be.length > MAX_PUSH_BODY_TEMPLATE_LEN) {
    return { ok: false, error: "invalid_pushBodyTemplateEn" };
  }

  return {
    ok: true,
    config: {
      use_time_window: o.useTimeWindow,
      window_hours: Math.floor(wh),
      min_thread_comments: Math.floor(mc),
      min_root_view_count: Math.floor(mv),
      push_title_ko: tk,
      push_title_en: te,
      push_body_template_ko: bk,
      push_body_template_en: be,
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
      push_title_ko: config.push_title_ko,
      push_title_en: config.push_title_en,
      push_body_template_ko: config.push_body_template_ko,
      push_body_template_en: config.push_body_template_en,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) return { error: error.message };
  return { error: null };
}
