import { jsonWithCors } from "@/lib/cors";

/**
 * 레거시 멀티파트 업로드는 Vercel 본문 한도(~4.5MB)로 413이 납니다.
 * [POST /api/feed/community-image/sign] 후 Supabase `signedUrl`로 직접 PUT 하세요.
 */
export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
