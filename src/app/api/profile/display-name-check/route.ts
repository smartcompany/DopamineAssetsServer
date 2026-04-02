import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isDisplayNameTakenByOther } from "@/lib/profile-display-name";

const MAX_NAME = 80;

export async function GET(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get("displayName")?.trim() ?? "";
  if (raw.length < 1 || raw.length > MAX_NAME) {
    return jsonWithCors({ error: "invalid_display_name", max: MAX_NAME }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const taken = await isDisplayNameTakenByOther(supabase, uid, raw);
    return jsonWithCors({ available: !taken });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
