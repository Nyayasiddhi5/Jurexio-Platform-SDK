import { NextRequest } from 'next/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  const body = await req.text();
  return new Response(JSON.stringify({ ok: true, got: body }), { headers: { 'content-type': 'application/json' } });
}
