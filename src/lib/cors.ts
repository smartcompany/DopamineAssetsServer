import { NextResponse } from "next/server";

export function jsonWithCors(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Accept");
  const status = init?.status ?? 200;
  if (status === 204) {
    return new NextResponse(null, { status: 204, headers });
  }
  return NextResponse.json(data, { status, headers });
}
