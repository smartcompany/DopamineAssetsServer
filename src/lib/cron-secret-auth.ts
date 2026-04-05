/**
 * GitHub Actions 크론 등: `Authorization: Bearer <CRON_SECRET>` 또는 `?secret=<CRON_SECRET>`.
 * `NODE_ENV === "development"` 일 때는 검사 생략(로컬 next dev).
 */
export function isCronAuthorizedRequest(request: Request): boolean {
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const auth = request.headers.get("authorization")?.trim();
  const bearer =
    auth?.toLowerCase().startsWith("bearer ") === true
      ? auth.slice(7).trim()
      : null;
  if (bearer === secret) return true;

  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}
