import jwt from "jsonwebtoken";

const COOKIE_NAME = "dashboard_token";

function dashboardSecret(): string {
  return (
    process.env.DASHBOARD_SECRET?.trim() ||
    "dashboard-dev-secret-change-in-production"
  );
}

export type DashboardPayload = { dashboard: true };

export function createDashboardToken(): string {
  return jwt.sign({ dashboard: true } as DashboardPayload, dashboardSecret(), {
    expiresIn: "24h",
  });
}

export function verifyDashboardToken(token: string): DashboardPayload | null {
  try {
    const decoded = jwt.verify(token, dashboardSecret()) as DashboardPayload;
    return decoded?.dashboard ? decoded : null;
  } catch {
    return null;
  }
}

export function getDashboardTokenFromRequest(request: Request): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k !== COOKIE_NAME) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function verifyDashboardRequest(request: Request): boolean {
  const token = getDashboardTokenFromRequest(request);
  if (!token) return false;
  return verifyDashboardToken(token) !== null;
}

export function getDashboardCookieConfig() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    name: COOKIE_NAME,
    options: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24,
      path: "/",
    },
  };
}
