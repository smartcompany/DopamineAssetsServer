import { NextResponse } from "next/server";
import { getDashboardCookieConfig } from "@/lib/dashboard-auth";

export async function POST() {
  const { name, options } = getDashboardCookieConfig();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(name, "", { ...options, maxAge: 0 });
  return res;
}
