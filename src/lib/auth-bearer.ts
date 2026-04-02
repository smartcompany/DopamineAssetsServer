import { verifyFirebaseIdToken } from "@/lib/firebase-admin-app";

/**
 * Authorization: Bearer (Firebase ID token) 에서 uid 를 검증합니다.
 * 실패·누락 시 null.
 */
export async function parseBearerUid(request: Request): Promise<string | null> {
  const auth = await parseBearerAuth(request);
  return auth?.uid ?? null;
}

/** Firebase ID 토큰에서 uid 및 이메일(있으면)을 검증합니다. */
export async function parseBearerAuth(
  request: Request,
): Promise<{ uid: string; email: string | null } | null> {
  const authHeader = request.headers.get("authorization")?.trim();
  const token =
    authHeader?.toLowerCase().startsWith("bearer ") === true
      ? authHeader.slice(7).trim()
      : null;
  if (!token) {
    return null;
  }
  try {
    const decoded = await verifyFirebaseIdToken(token);
    const raw =
      typeof decoded.email === "string" ? decoded.email.trim() : "";
    const email = raw.length > 0 ? raw.slice(0, 320) : null;
    return { uid: decoded.uid, email };
  } catch {
    return null;
  }
}
