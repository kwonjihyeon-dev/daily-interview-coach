import { NextRequest, NextResponse } from "next/server";
import { VISITOR_COOKIE_NAME, buildVisitorCookieOptions } from "../../../../lib/visitorCookie";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md
 * "Next.js Route Handler (apps/web/src/app/api/gate/verify/route.ts)" 절.
 *
 * 브라우저는 apps/api의 존재를 모른다 — 이 Route Handler가 서버 사이드에서
 * apps/api의 POST /api/auth/verify-email을 호출하는 유일한 경유지다.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const email = typeof body?.email === "string" ? body.email : "";

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(`${process.env.API_BASE_URL}/api/auth/verify-email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    return NextResponse.json(
      {
        error: "upstream_unreachable",
        message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      },
      { status: 502 },
    );
  }

  const upstreamBody = await upstreamResponse.json();

  if (!upstreamResponse.ok) {
    return NextResponse.json(upstreamBody, { status: upstreamResponse.status });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(VISITOR_COOKIE_NAME, normalizedEmail, buildVisitorCookieOptions());
  return response;
}
