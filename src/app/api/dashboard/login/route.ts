import { NextResponse } from "next/server";
import {
  createDashboardToken,
  getDashboardCookieConfig,
} from "@/lib/dashboard-auth";

/**
 * POST /api/dashboard/login
 * Body: { username, password }
 * env: DASHBOARD_USERNAME, DASHBOARD_PASSWORD, DASHBOARD_SECRET (JWT 서명)
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };
    const username = body.username ?? "";
    const password = body.password ?? "";

    const expectedUser = process.env.DASHBOARD_USERNAME?.trim() ?? "";
    const expectedPass = process.env.DASHBOARD_PASSWORD?.trim() ?? "";

    if (!expectedUser || !expectedPass) {
      return NextResponse.json(
        { error: "Dashboard login not configured" },
        { status: 503 },
      );
    }

    if (username !== expectedUser || password !== expectedPass) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 },
      );
    }

    const token = createDashboardToken();
    const { name, options } = getDashboardCookieConfig();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(name, token, options);
    return res;
  } catch (e) {
    console.error("[dashboard login]", e);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
