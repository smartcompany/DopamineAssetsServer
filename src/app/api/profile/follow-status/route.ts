import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const MAX_IDS = 80;

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
  if (typeof body !== "object" || body === null) {
    return jsonWithCors({ error: "invalid_body" }, { status: 400 });
  }
  const raw = (body as Record<string, unknown>).targetUids;
  if (!Array.isArray(raw)) {
    return jsonWithCors({ error: "invalid_target_uids" }, { status: 400 });
  }
  const targetUids = raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== uid)
    .slice(0, MAX_IDS);

  if (targetUids.length === 0) {
    return jsonWithCors({ following: {} as Record<string, boolean> });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: rows, error } = await supabase
      .from("dopamine_user_follows")
      .select("following_uid")
      .eq("follower_uid", uid)
      .in("following_uid", targetUids);

    if (error) {
      console.error(error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      );
    }

    const set = new Set((rows ?? []).map((r) => r.following_uid as string));
    const following: Record<string, boolean> = {};
    for (const id of targetUids) {
      following[id] = set.has(id);
    }
    return jsonWithCors({ following });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
