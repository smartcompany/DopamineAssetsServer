import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const PLATFORMS = new Set(["ios", "android", "web", "unknown"]);

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
  const o = body as Record<string, unknown>;
  const fcmToken =
    typeof o.fcmToken === "string"
      ? o.fcmToken.trim()
      : typeof o.token === "string"
        ? o.token.trim()
        : "";
  const rawPlatform = typeof o.platform === "string" ? o.platform.trim() : "";
  const platform = PLATFORMS.has(rawPlatform) ? rawPlatform : "unknown";
  const rawLocale = typeof o.locale === "string" ? o.locale.trim().toLowerCase() : "";
  const locale = rawLocale.startsWith("en")
    ? "en"
    : rawLocale.startsWith("ko")
      ? "ko"
      : "en";

  if (!fcmToken || fcmToken.length < 10 || fcmToken.length > 4096) {
    return jsonWithCors({ error: "invalid_fcm_token" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("dopamine_device_push_tokens").upsert(
      {
        uid,
        fcm_token: fcmToken,
        platform,
        locale,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "uid,fcm_token" },
    );
    if (error) {
      console.error("[push-token] supabase upsert failed", error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      );
    }
    console.log("[push-token] ok", uid.slice(0, 8), platform);
    return jsonWithCors({ ok: true });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
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
  const o = body as Record<string, unknown>;
  const fcmToken =
    typeof o.fcmToken === "string"
      ? o.fcmToken.trim()
      : typeof o.token === "string"
        ? o.token.trim()
        : "";
  if (!fcmToken) {
    return jsonWithCors({ error: "invalid_fcm_token" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("dopamine_device_push_tokens")
      .delete()
      .eq("uid", uid)
      .eq("fcm_token", fcmToken);
    if (error) {
      console.error(error);
      return jsonWithCors(
        { error: "supabase_error", detail: error.message },
        { status: 500 },
      );
    }
    return jsonWithCors({ ok: true });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
