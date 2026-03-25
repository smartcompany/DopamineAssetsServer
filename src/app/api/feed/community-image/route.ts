import { jsonWithCors } from "@/lib/cors";
import { parseBearerUid } from "@/lib/auth-bearer";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/** Supabase Dashboard → Storage 에서 생성한 버킷 이름 */
const BUCKET = "dopamine-assets";
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
]);

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

function inferMimeFromFilename(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

export async function POST(request: Request) {
  const uid = await parseBearerUid(request);
  if (!uid) {
    return jsonWithCors({ error: "missing_or_invalid_token" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonWithCors({ error: "invalid_form_data" }, { status: 400 });
  }

  const raw = formData.get("file");
  if (!(raw instanceof Blob)) {
    return jsonWithCors({ error: "missing_file" }, { status: 400 });
  }

  if (raw.size > MAX_BYTES) {
    return jsonWithCors(
      { error: "file_too_large", maxBytes: MAX_BYTES },
      { status: 400 },
    );
  }

  const fileName = raw instanceof File ? raw.name : "";
  const fromName = fileName ? inferMimeFromFilename(fileName) : null;
  const mime =
    raw.type &&
    raw.type !== "" &&
    raw.type !== "application/octet-stream"
      ? raw.type
      : (fromName ?? "application/octet-stream");

  if (!ALLOWED_TYPES.has(mime)) {
    return jsonWithCors({ error: "invalid_file_type" }, { status: 400 });
  }

  const ab = await raw.arrayBuffer();
  const buffer = Buffer.from(ab);

  const ext = extForMime(mime);
  const name = `${Date.now()}_${Math.random().toString(36).slice(2, 12)}.${ext}`;
  const path = `community_posts/${uid}/${name}`;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mime,
      upsert: false,
    });

    if (error) {
      console.error("[community-image]", error);
      return jsonWithCors(
        { error: "upload_failed", detail: error.message },
        { status: 500 },
      );
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

    return jsonWithCors({ url: pub.publicUrl });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
