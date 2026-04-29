import { parseBearerUid } from "@/lib/auth-bearer";
import {
  applyBadgeEvent,
  BADGE_CATALOG,
  sanitizeBadgeState,
  type BadgeState,
} from "@/lib/badge-engine";
import { jsonWithCors } from "@/lib/cors";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const TABLE = "dopamine_user_badges";

async function loadState(uid: string): Promise<BadgeState> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .select("unlocked_keys, counters")
    .eq("uid", uid)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return { unlockedKeys: [], counters: {} };
  }
  return sanitizeBadgeState({
    unlockedKeys: data.unlocked_keys ?? [],
    counters: data.counters ?? {},
  });
}

async function saveState(uid: string, state: BadgeState) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from(TABLE).upsert(
    {
      uid,
      unlocked_keys: state.unlockedKeys,
      counters: state.counters,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "uid" },
  );
  if (error) {
    throw new Error(error.message);
  }
}

export async function GET(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }
  try {
    const state = await loadState(uid);
    return jsonWithCors({
      state,
      catalog: BADGE_CATALOG,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "supabase_error", detail }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithCors({ error: "invalid_json" }, { status: 400 });
  }
  const o = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  const eventName = typeof o?.eventName === "string" ? o.eventName.trim() : "";
  const params =
    typeof o?.params === "object" && o.params !== null
      ? (o.params as Record<string, unknown>)
      : {};
  if (!eventName) {
    return jsonWithCors({ error: "invalid_event_name" }, { status: 400 });
  }
  try {
    const current = await loadState(uid);
    const { state, newlyUnlocked } = applyBadgeEvent({
      state: current,
      eventName,
      params,
    });
    await saveState(uid, state);
    return jsonWithCors({ state, newlyUnlocked, catalog: BADGE_CATALOG });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "supabase_error", detail }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
