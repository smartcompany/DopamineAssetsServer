import { NextResponse } from "next/server";
import { verifyDashboardRequest } from "@/lib/dashboard-auth";
import {
  configToPayload,
  loadHotMoverDiscussionConfig,
  parseConfigPayload,
  saveHotMoverDiscussionConfig,
} from "@/lib/hot-mover-discussion-config";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/dashboard/hot-mover-discussion-config
 */
export async function GET(request: Request) {
  if (!verifyDashboardRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const supabase = getSupabaseAdmin();
    const config = await loadHotMoverDiscussionConfig(supabase);
    return NextResponse.json({ config: configToPayload(config) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}

/**
 * PUT /api/dashboard/hot-mover-discussion-config
 * Body: { useTimeWindow, windowHours, minThreadComments, minRootViewCount }
 */
export async function PUT(request: Request) {
  if (!verifyDashboardRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = parseConfigPayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await saveHotMoverDiscussionConfig(supabase, parsed.config);
    if (error) {
      return NextResponse.json({ error: "supabase_error", detail: error }, { status: 500 });
    }
    const next = await loadHotMoverDiscussionConfig(supabase);
    return NextResponse.json({ ok: true, config: configToPayload(next) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
