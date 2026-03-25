import { verifyFirebaseIdToken } from "@/lib/firebase-admin-app";

/**
 * Authorization: Bearer (Firebase ID token) 에서 uid 를 검증합니다.
 * 실패·누락 시 null.
 */
export async function parseBearerUid(request: Request): Promise<string | null> {
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
    return decoded.uid;
  } catch {
    return null;
  }
}
