import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const BUCKET = "dopamine-assets";
/** 본문은 Vercel을 거치지 않고 Supabase로 PUT — GIPHY 등 대용량 GIF 허용 */
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
]);

function resolveTopLevelFolder(scope: string): "community_posts" | "profiles" {
  const s = scope.trim().toLowerCase();
  if (s === "profile") return "profiles";
  return "community_posts";
}

function extForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/heic":
      return "heic";
    default:
      return "jpg";
  }
}

/**
 * 클라이언트가 파일 바이트를 Supabase Storage로 직접 PUT 하기 위한 서명 URL 발급.
 * (Vercel 멀티파트 본문 한도 ~4.5MB 회피)
 */
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
  const contentType =
    typeof o.contentType === "string" ? o.contentType.trim() : "";
  const scopeRaw = typeof o.scope === "string" ? o.scope.trim() : "community";
  const byteLength = typeof o.byteLength === "number" ? o.byteLength : -1;

  if (!ALLOWED_TYPES.has(contentType)) {
    return jsonWithCors({ error: "invalid_file_type" }, { status: 400 });
  }
  if (byteLength < 1 || byteLength > MAX_BYTES) {
    return jsonWithCors(
      { error: "invalid_size", maxBytes: MAX_BYTES },
      { status: 400 },
    );
  }

  const ext = extForMime(contentType);
  const name = `${Date.now()}_${Math.random().toString(36).slice(2, 12)}.${ext}`;
  const topFolder = resolveTopLevelFolder(scopeRaw);
  const path = `${topFolder}/${uid}/${name}`;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data) {
      console.error("[community-image/sign]", error);
      return jsonWithCors(
        { error: "sign_failed", detail: error?.message ?? "unknown" },
        { status: 500 },
      );
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

    return jsonWithCors({
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path,
      publicUrl: pub.publicUrl,
    });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
