# 기능 명세: 클라이언트 데이터 계층 전환 (Server-First: RSC + Server Actions/Route Handler)

- **기능명 슬러그**: `client-data-layer`
- **상태**: Awaiting Approval
- **작성일**: 2026-08-12
- **근거 문서**: [`.claude/docs/deploy-topology-review.md`](../../docs/deploy-topology-review.md) 3절(배포 토폴로지: EC2 코로케이션)·4절(클라이언트 데이터 전략: 서버 우선), [`.claude/docs/progress.md`](../../docs/progress.md) "다음 액션" 3번

## 개요

`apps/web`이 브라우저에서 `apps/api`(Express)를 직접 호출하던 3곳의 인라인 `fetch(NEXT_PUBLIC_API_BASE_URL...)` 호출을 서버 우선 아키텍처(Server Action 2곳 + Route Handler 1곳)로 전환한다.

**배경(필수 전환 이유)**: `deploy-topology-review.md` 3절 확정에 따라 프로덕션에서 Express를 `127.0.0.1:3001`에 바인딩한다. 브라우저는 더 이상 `apps/api`에 네트워크 경로로 도달할 수 없다 — 이 전환은 선호가 아니라 필수 변경이다. 4절에서 TanStack Query는 명시적으로 기각되었으므로 이 전환에서 재검토하지 않는다.

**전환 대상은 3곳**(리뷰 문서 4절이 언급한 2곳이 아니라 3곳임을 명시):

| # | 파일:라인 | 호출 | 전환 방식 |
|---|---|---|---|
| 1 | `apps/web/src/app/gate/GateForm.tsx:34` | `POST /api/sessions` | Server Action |
| 2 | `apps/web/src/app/ResumeUploadForm.tsx:154` | `POST /api/sources/resume` (FormData) | Server Action |
| 3 | `apps/web/src/app/ResumeUploadForm.tsx:84` + `apps/web/src/app/today/EmptyQuestionState.tsx:32` | `POST /api/questions/generate` (동일 엔드포인트, 2개 호출부) | **Route Handler** (Server Action 아님 — 근거는 아래 설계 판단 3) |

이미 서버 우선인 `apps/web/src/app/today/page.tsx`, `apps/web/src/lib/apiClient.ts`, `apps/web/src/proxy.ts`, `apps/web/src/app/gate/page.tsx`는 변경하지 않는다.

---

## 상세 명세

### 설계 판단 1 — 게이트 쿠키 발급 경로: 안 (a) 채택, apps/api가 쿠키 정책 계속 소유

**비교**

| | (a) apps/api Set-Cookie를 Next가 그대로 전달 | (b) Next가 자체 옵션으로 재발급 |
|---|---|---|
| 정책 소유 | apps/api 단일 소유(게이트 v2 설계 유지) | 웹/API 양쪽에 분산(v2가 일원화한 걸 되돌림) |
| 신규 코드 | Set-Cookie 파싱 로직 필요 | 없음(단, httpOnly/secure/sameSite/maxAge를 Next 쪽에도 하드코딩해야 함) |
| 정책 변경 시 | apps/api 한 곳만 수정 | 두 곳 동기화 필요(누락 위험) |

**결정: (a).** `apiClient.ts`의 `ApiResult`는 변경하지 않는다 — `{kind:"ok", response: Response}`의 `response`가 원본 `Response` 객체이므로, 호출부(Server Action)가 `response.headers.getSetCookie()`로 직접 읽으면 된다. `apiPost`를 감싸는 이 기능 전용으로만 쓰는 로직을 `ApiResult`에 넣는 것은 과잉설계(현재 Set-Cookie를 발급하는 엔드포인트는 `/api/sessions` 단 하나뿐).

**신규 모듈**: `apps/web/src/lib/setCookieForwarding.ts` (순수 함수, `sanitizeNextPath.ts`/`visitorCookie.ts`와 동일한 패턴으로 별도 파일 분리 — 테스트 가능성 확보)

```ts
export interface ParsedSetCookie {
  name: string;
  value: string;
  options: {
    path?: string;
    maxAge?: number;      // 단위: 초 (Next의 cookies().set() 옵션과 동일 단위)
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
  };
}

export function parseSetCookieHeader(rawSetCookie: string): ParsedSetCookie;
export async function applySetCookieHeaders(rawSetCookieHeaders: string[]): Promise<void>;
```

**`parseSetCookieHeader` 파싱 규칙(정확한 계약)**:
1. `;`로 분리, 각 세그먼트 trim.
2. 첫 세그먼트는 `name=value` — `=` 첫 등장 위치로 분리. `value`는 `decodeURIComponent()`로 디코드(Express `res.cookie`의 기본 `encode`가 `encodeURIComponent`이므로 — 예: `user%40example.com` → `user@example.com`). 디코드 실패 시 원본 문자열을 그대로 사용(방어적).
3. 나머지 세그먼트는 key를 소문자로 비교:
   - `max-age=<n>` → `options.maxAge = Number(n)`. **단위 변환을 하지 않는다** — Express가 헤더에 실제로 쓰는 `Max-Age` 값은 이미 초 단위이고(`apps/api/src/lib/visitorCookie.ts`의 `VISITOR_COOKIE_MAX_AGE_MS`는 Express `res.cookie`에 넘기기 전 ms 단위일 뿐, Express 내부에서 초로 변환해 헤더에 쓴다), Next `cookies().set()`의 `maxAge` 옵션도 초 단위(Next 공식 문서 확인 — `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md:52,273`: "Sets the cookie's lifespan in **seconds**" / "`maxAge` accepts a value in seconds")이므로 그대로 대입하면 된다. **이 지점에서 ms↔초 변환을 넣으면 버그**(과거 `visitorCookie.ts` 주석이 경고하는 것과 같은 종류의 단위 실수) — developer 단계에서 반드시 주의.
   - `path=<p>` → `options.path = p`
   - `httponly`(값 없음) → `options.httpOnly = true`
   - `secure`(값 없음) → `options.secure = true`
   - `samesite=<s>` → `options.sameSite = s.toLowerCase()` (`"lax"|"strict"|"none"` 중 하나가 아니면 무시)
   - `expires=<...>` → **무시**(Max-Age가 있으면 우선하므로 별도 처리 불필요, 날짜 문자열에 쉼표가 있어도 `;` 분리에는 영향 없음)
4. `Max-Age` 세그먼트가 없으면 `options.maxAge`는 `undefined`(세션 쿠키가 됨) — apps/api가 항상 `maxAge`를 설정하므로 정상 경로에서는 발생하지 않지만 방어적으로 허용.

**`applySetCookieHeaders`**: 배열의 각 원소에 `parseSetCookieHeader`를 적용한 뒤 `(await cookies()).set(name, value, options)` 호출. 빈 배열이면 아무 것도 하지 않는다(호출부가 에러로 취급할지는 호출부 책임).

**Server Action에서의 사용(`apps/web/src/app/gate/actions.ts`, 신규, `'use server'`)**:

```ts
export type CreateVisitorSessionResult =
  | { kind: "ok" }
  | { kind: "failed"; message: string };

export async function createVisitorSession(email: string): Promise<CreateVisitorSessionResult>;
```

동작:
1. `apiPost("/api/sessions", { headers: {"content-type":"application/json"}, body: JSON.stringify({ email }) })` 호출.
2. `result.kind === "ok"`이고 `!result.response.ok`이면 → JSON 파싱 후 `{kind:"failed", message: body.message ?? "오류가 발생했습니다."}`.
3. `result.kind === "ok"`이고 `result.response.ok`(201)이면 → `result.response.headers.getSetCookie()`를 읽는다.
   - 배열 길이가 0(Set-Cookie 누락 — 서버 이상 동작): `{kind:"failed", message:"일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."}`을 반환한다(성공으로 간주하지 않는다 — 쿠키 없이 `nextPath`로 이동시키면 `proxy.ts`가 즉시 `/gate`로 되돌려보내 사용자가 혼란을 겪는다).
   - 배열 길이가 1 이상이면 `applySetCookieHeaders(...)` 호출 후 `{kind:"ok"}`.
4. 위 과정 전체(1~3)를 하나의 try/catch로 감싼다. 예외 발생 시 `{kind:"failed", message:"일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."}`(네트워크 단절, apps/api 무응답, JSON 파싱 실패를 모두 동일하게 처리 — 현재 `GateForm.tsx`의 catch 블록과 동일한 원칙).

`result.kind === "unauthenticated"`(401)는 이 엔드포인트가 인증 불필요 엔드포인트이므로 이론상 발생하지 않지만, `apiPost`의 타입 계약상 항상 처리해야 한다 → `{kind:"failed", message:"일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."}`로 취급(방어적).

**GateForm.tsx 변경**: `submitForm`(기존 이름 유지, 컨벤션에 이미 부합) 내부에서 `fetch` 대신 `await createVisitorSession(email)`을 호출하고, 반환값의 `kind`로 분기한다. `createVisitorSession` 호출 자체가 예외를 던지는 경우(프레임워크 레벨 실패 — 아래 설계 판단 2/3 참고)에 대비해 이 호출도 try/catch로 감싼다(action 내부 catch와 이중 방어).

**구현 리스크(개발 단계에서 실측 필요)**: Next 문서에 따르면 Server Action에서 쿠키를 set/delete하면 현재 페이지(`/gate`)가 서버에서 자동 재렌더링된다. `GatePage`는 유효한 쿠키를 발견하면 자체적으로 `redirect(nextPath)`를 호출하므로, 이 자동 재렌더링이 `GateForm`의 `router.replace(nextPath)`보다 먼저 네비게이션을 일으킬 가능성이 있다. 두 경로 모두 최종 목적지는 동일(`nextPath`)하므로 기능적 문제는 없을 것으로 예상되지만, **developer 단계에서 실제 브라우저 동작(중복 네비게이션, 콘솔 경고 여부)을 반드시 확인**한다. `router.replace(nextPath)` 호출 자체는 안전망으로 그대로 유지한다.

---

### 설계 판단 2 — Server Action 바디 크기 제한: `bodySizeLimit: "6mb"`

이력서 업로드는 최대 5,242,880바이트(5MB, `ResumeUploadForm.tsx`의 `MAX_FILE_SIZE_BYTES`)를 허용한다. Next 16.3 공식 문서 확인(`apps/web/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:29,45`): Server Action 기본 바디 제한은 1MB이며("the maximum size of the request body sent to a Server Action is 1MB"), multipart 바운더리/파트 헤더 오버헤드로 "추가 10~20KB 여유"를 권고한다("an additional 10–20 KB is a reasonable rule of thumb").

**`apps/web/next.config.js` 변경**:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};
module.exports = nextConfig;
```

6MB(약 6,291,456바이트) − 5,242,880바이트 = 약 1MB 여유. multipart 오버헤드 권고치(10~20KB)를 훨씬 초과하는 여유이므로 파일 크기 경계값 부근에서 실패할 일이 없다(과도한 정밀 튜닝 대신 넉넉한 여유값을 선택 — YAGNI).

**초과 시 동작**: 클라이언트 사전 검증(`validateResumeFile`)이 5MB 초과 파일을 애초에 제출 불가 상태로 막으므로, 정상 UI 흐름에서는 6MB 제한에 도달할 수 없다. 이 제한이 실제로 발동하는 경우는 클라이언트 검증을 우회한 직접 POST(개발자 도구, 우회 스크립트 등)뿐이다. Next 프레임워크는 이 경우 Server Action의 애플리케이션 코드(우리가 작성한 try/catch 포함)가 실행되기 **전에** 요청 자체를 거부한다 — 즉 `uploadResume` 액션 내부의 try/catch는 이 실패를 잡지 못한다. **호출부(`ResumeUploadForm.tsx`)가 액션 호출 자체를 try/catch로 감싸야 하며**, 이 예외도 기존과 동일한 안내 문구("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.")로 처리한다.

---

### 설계 판단 3 — 질문 생성: Server Action이 아니라 Route Handler

Next 16.3 공식 문서 확인(`apps/web/node_modules/next/dist/docs/01-app/02-guides/server-actions.md:28`): "Next.js dispatches Server Actions one at a time per client" — 같은 브라우저 탭에서 발생하는 모든 Server Action 호출은 전역적으로 직렬 처리된다(라우트 무관, 클라이언트 디스패처 단위). 문서는 병렬이 필요하면 Route Handler를 쓰라고 명시한다.

**질문 생성(`POST /api/questions/generate`)은 Bedrock 호출로 수십 초가 걸릴 수 있다.** 만약 이걸 Server Action으로 만들면: 이력서 업로드 성공 → 자동 질문 생성 트리거(수십 초 대기) 중에, 사용자가 "다른 파일 업로드"로 리셋 후 새 파일을 다시 업로드하면 — 리셋 자체는 순수 클라이언트 상태 변경이라 즉시 반영되지만, 뒤이은 **새 업로드 Server Action 호출은 아직 끝나지 않은 이전 질문 생성 액션 뒤에서 대기**하게 된다. 사용자는 "업로드 중..." 상태를 보지만 실제로는 네트워크 요청조차 아직 시작되지 않은 채 수십 초간 멈춰 있는 것처럼 보인다(원인 불명의 정지).

또한 두 호출부(`ResumeUploadForm`의 자동 트리거, `EmptyQuestionState`의 "다시 시도")는 `<form action>`이나 `useActionState`를 쓰지 않고, 이미 `useState`로 로컬 상태를 직접 관리하며 페이지 재렌더링(`revalidatePath`)도 필요로 하지 않는다 — Server Action의 핵심 이점(단일 응답에 UI 재렌더링 포함)을 전혀 활용하지 않는 순수 "서버에 물어보고 JSON 받기" 용도다.

**결정: Route Handler로 전환.** `apps/web/src/app/api/questions/generate/route.ts` (신규)

```ts
export async function POST(request: NextRequest): Promise<NextResponse>
```

동작:
1. `request.json()`으로 바디 파싱(실패 시 `NextResponse.json({error:"invalid_request", message:"잘못된 요청입니다."}, {status:400})` — 방어적, 정상 클라이언트는 항상 유효한 JSON을 보내므로 실사용 경로에서는 발생하지 않음).
2. `apiPost("/api/questions/generate", { headers:{"content-type":"application/json"}, body: JSON.stringify(parsedBody) })` 호출.
3. `result.kind === "unauthenticated"` → `NextResponse.json({error:"unauthorized", message:"인증되지 않은 요청입니다."}, {status:401})`(apps/api의 `requireAuthenticatedUser` 401 응답과 동일한 메시지로 통일 — 클라이언트의 기존 401 감지 로직이 수정 없이 그대로 동작).
4. `result.kind === "ok"` → `apps/api` 응답의 상태 코드와 JSON 바디를 그대로 통과시킨다: `NextResponse.json(await result.response.json(), { status: result.response.status })`. JSON 파싱 실패 시 `NextResponse.json({error:"internal_error", message:"일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."}, {status:500})`.
5. 전체를 try/catch로 감싸 예외(apps/api 다운 등)는 5의 500 응답과 동일하게 처리.

**핵심 설계 의도**: 응답 계약(상태 코드, `{error, message}`/`{question, questions}` 바디 형태)을 apps/api와 **완전히 동일하게 유지**한다. 그래야 `ResumeUploadForm.tsx`/`EmptyQuestionState.tsx`의 기존 에러 매핑·401 리다이렉트·상태 전이 로직을 수정 없이 그대로 재사용할 수 있다 — 바뀌는 것은 **호출 URL(절대경로 → 상대경로)과 `credentials:"include"` 제거**뿐이다.

- 변경 전: `fetch(\`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/questions/generate\`, { method:"POST", credentials:"include", ... })`
- 변경 후: `fetch("/api/questions/generate", { method:"POST", ... })` — 동일 출처(same-origin) 요청이므로 브라우저가 쿠키를 기본적으로 포함한다. `credentials:"include"`는 더 이상 필요 없으므로 제거한다(죽은 코드 방치 금지).

---

### 설계 판단 4 — 전환 후 정리 대상

| 대상 | 판단 | 근거 |
|---|---|---|
| `apps/web/.env.example`의 `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_KEY` | **이 스펙 스코프에 포함** | 3곳 전환이 모두 끝나면 브라우저가 이 값을 참조하는 코드가 하나도 남지 않는다. `API_BASE_URL`(non-public, 서버 전용)은 `apiClient.ts`/신규 Server Action/Route Handler가 계속 쓰므로 그대로 유지. **수행 순서**: 3곳 전환 + 테스트 Green 확인 후 마지막 단계로 제거(전환 중간에 지우면 아직 전환 안 된 컴포넌트가 깨짐 — CLAUDE.md 지침대로 정리 시점에 주의). |
| `apps/api/src/app.ts`의 `cors()` + `ALLOWED_ORIGINS` | **이 스펙 스코프에서 제외 — 별도 후속 변경으로 권고** | (1) apps/api는 다른 앱 경계이며 이 스펙은 "apps/web 클라이언트 데이터 계층 전환"이 목적이라 초점이 다르다. (2) 로컬 개발에서 Next(:3000)→Express(:3001) 서버 간 호출은 브라우저가 아닌 Node 프로세스의 `fetch`(undici)이므로 CORS와 무관 — 지금 당장 지워도 로컬 개발엔 영향 없는 것은 맞다. 다만 (3) 이 코드가 죽은 코드가 되는 시점은 "브라우저가 apps/api에 도달할 경로가 완전히 없어졌을 때"인데, 그 전제(EC2 코로케이션 + `127.0.0.1` 바인딩)는 아직 실현되지 않았다(Phase 4, progress.md 5번) — 그 전까지는 apps/api가 여전히 외부에 노출된 채로 배포될 수 있는 환경(예: 로컬에서 `0.0.0.0` 바인딩 + 임시 배포)이 이론상 남아있어, CORS를 지금 제거하면 그 창구가 방어막 없이 열린다. 간단한 변경이므로 CLAUDE.md의 "간단한 버그 수정/명세가 명확한 작은 변경은 워크플로우를 강제하지 않는다" 조항에 따라 3~4단계 전체를 거치지 않고 짧게 처리 가능하되, **Phase 4(EC2 코로케이션) 착수 시점**에 하는 것을 권고한다. |
| Next `serverActions.allowedOrigins` / nginx `X-Forwarded-Host` 설정 | **범위 밖** | 로컬 개발(`localhost:3000`)에서는 기본값(동일 출처만 허용)으로 충분하다. 프로덕션 nginx 리버스 프록시 설정은 Phase 4 EC2 배포 작업의 일부이며 지금 시점에 확정할 인프라 정보가 없다. |

---

## 파일 변경 목록

| 파일 | 변경 |
|---|---|
| `apps/web/src/lib/setCookieForwarding.ts` | 신규 |
| `apps/web/src/app/gate/actions.ts` | 신규, `'use server'` |
| `apps/web/src/app/gate/GateForm.tsx` | 수정 — fetch 제거, `createVisitorSession` 호출로 대체 |
| `apps/web/src/app/resumeActions.ts` | 신규, `'use server'` |
| `apps/web/src/app/ResumeUploadForm.tsx` | 수정 — 업로드는 `uploadResume` 액션 호출, 로컬 제출 핸들러는 이름 충돌 회피를 위해 `uploadResume` → `submitResumeUpload`로 리네임. 질문 생성 자동 트리거(`generateQuestions`)는 상대경로 Route Handler 호출로 변경 |
| `apps/web/src/app/api/questions/generate/route.ts` | 신규 |
| `apps/web/src/app/today/EmptyQuestionState.tsx` | 수정 — `regenerateQuestions`을 상대경로 Route Handler 호출로 변경 |
| `apps/web/next.config.js` | 수정 — `experimental.serverActions.bodySizeLimit` 추가 |
| `apps/web/.env.example` | 수정 — `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_KEY` 제거 |

**이름 충돌 주의**: `ResumeUploadForm.tsx`에 이미 로컬 함수 `uploadResume`(폼 제출 핸들러, `FormEvent` 인자)이 존재한다. 신규 Server Action도 같은 이름(`uploadResume`, `FormData` 인자)으로 설계했으므로 반드시 로컬 핸들러를 `submitResumeUpload`로 리네임한 뒤 Server Action을 `./resumeActions`에서 import한다(CLAUDE.md 동사+목적어 컨벤션에도 부합).

**Server Action 반환 타입 요약**:
```ts
// resumeActions.ts
export type UploadResumeResult =
  | { kind: "success"; source: Source }
  | { kind: "unauthenticated"; redirectTo: string }
  | { kind: "failed"; message: string };
export async function uploadResume(formData: FormData): Promise<UploadResumeResult>;
```
동작: `formData.get("file")`이 `File` 인스턴스가 아니면 즉시 `{kind:"failed", message:"업로드할 파일이 없습니다."}`. 그렇지 않으면 새 `FormData`에 `file`을 다시 append해 `apiPost("/api/sources/resume", { body: forwardedFormData })` 호출(Content-Type을 수동 설정하지 않음 — fetch가 multipart 바운더리를 자동 생성, 기존 동작과 동일). `result.kind==="unauthenticated"` → 그대로 전달. `result.kind==="ok" && !ok` → `{kind:"failed", message: body.message ?? "오류가 발생했습니다."}`. `result.kind==="ok" && ok(201)` → `{kind:"success", source: body.source}`. 전체 try/catch로 감싸 예외는 `{kind:"failed", message:"일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."}`.

**v1(fetch)에서 사라지는 케이스**: "서버 응답이 200번대가 아니고 JSON 파싱 자체가 실패"하는 케이스는 Server Action 반환값이 이미 구조화된 객체이므로 더 이상 성립하지 않는다(이 파싱은 액션 내부에서 일어나고, 실패 시 액션 내부 try/catch가 잡아 `{kind:"failed", message: 일반 오류}`로 흡수한다 — 클라이언트가 별도로 "JSON 파싱 실패"를 구분해서 처리할 필요가 없다).

---

## Acceptance Criteria

### A. 게이트 세션 생성 (Server Action)

**정상 시나리오**

```
Given 등록된 이메일 "user@example.com"을 입력하고
When 제출 버튼을 클릭하면
Then createVisitorSession("user@example.com")이 호출되고,
     apps/api가 201과 Set-Cookie: dic_visitor_email=user%40example.com; Max-Age=15552000; Path=/; HttpOnly; SameSite=Lax를 반환하면
     Next의 cookies().set()이 name="dic_visitor_email", value="user@example.com",
     options={ maxAge:15552000, path:"/", httpOnly:true, sameSite:"lax" }로 호출되고
     router.replace(nextPath)가 호출된다
```

```
Given 프로덕션 환경(NODE_ENV=production)이라 apps/api가 Secure 속성을 추가로 내려주면
When 세션 생성이 성공하면
Then cookies().set() 호출의 options에 secure:true가 포함된다
```

**엣지 케이스**

```
Given 제출이 진행 중(pending)인 상태
When 액션이 아직 resolve되지 않았다면
Then 제출 버튼은 비활성화 상태를 유지한다
```

```
Given 첫 제출이 400 invalid_email_format으로 실패한 뒤
When 입력값을 즉시 수정해 재제출하면(잠금/쿨다운 없음)
Then 두 번째 시도는 정상적으로 createVisitorSession을 다시 호출하고 성공 시 이동한다
```

```
Given apps/api가 201을 반환했지만 Set-Cookie 헤더가 비어 있는 이상 상황이면
When createVisitorSession이 이를 감지하면
Then { kind:"failed", message:"일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." }를 반환하고,
     cookies().set()은 호출되지 않으며, router.replace도 호출되지 않는다
```

**에러 케이스**

```
Given 등록되지 않은 이메일을 입력하고
When apps/api가 401 { error:"email_not_found", message:"등록되지 않은 이메일입니다..." }를 반환하면
Then 그 message가 폼 아래에 그대로 표시되고 router.replace는 호출되지 않는다
```

```
Given apps/api가 네트워크 단절로 무응답이면
When createVisitorSession 내부의 apiPost 호출이 예외를 던지면
Then { kind:"failed", message:"일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." }가 반환되고 그 메시지가 표시된다
```

```
Given Server Action 호출 자체가 프레임워크 레벨에서 실패(액션 ID 불일치 등)하면
When GateForm의 await createVisitorSession(...) 호출이 reject되면
Then 호출부의 catch 블록이 "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."를 표시한다
```

### B. 이력서 업로드 (Server Action)

**정상 시나리오**

```
Given 4.9MB의 유효한 .pdf 파일을 선택하고
When 제출하면
Then submitResumeUpload가 FormData({file})를 만들어 uploadResume(formData)를 호출하고,
     응답이 { kind:"success", source }이면 setUploadedSource(source)가 호출되어 성공 패널이 나타난다
```

```
Given 정확히 5,242,880바이트(5MB) 파일이면
When 선택하면
Then 클라이언트 사전 검증을 통과해 제출 버튼이 활성화된다(경계값 허용, 서버 액션 호출과 무관한 기존 로직 유지)
```

**엣지 케이스**

```
Given 서버가 { kind:"failed", message:"PDF(.pdf) 또는 텍스트(.txt) 파일만 업로드할 수 있습니다." }를 반환하면
When 이 결과를 받으면
Then errorMessage에 그 message가 표시되고 errorSource="server"로 설정되어,
     파일을 재선택하지 않아도 제출 버튼이 즉시 재활성화된다(기존 동작 그대로 유지)
```

```
Given 업로드 요청이 진행 중(pending)인 상태에서
When 제출 버튼을 다시 클릭(더블클릭)해도
Then uploadResume은 1회만 호출된다(기존 isUploading 가드 그대로 유지)
```

**에러 케이스**

```
Given uploadResume이 { kind:"unauthenticated", redirectTo:"/gate?reason=expired&next=%2F" }를 반환하면
When ResumeUploadForm이 이를 받으면
Then router.replace("/gate?reason=expired&next=%2F")가 호출되고 인라인 에러는 표시되지 않는다
```

```
Given 클라이언트 검증을 우회해 6MB를 초과하는 바디가 전송되면
When Next 프레임워크가 액션 실행 전 요청을 거부하면
Then uploadResume(formData) 호출 자체가 reject되고, 호출부 catch가
     "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."를 표시하며 isUploading은 false로 복귀한다
```

```
Given uploadResume 내부에서 apiPost 호출이 예외를 던지면(네트워크 단절)
When 액션 내부 try/catch가 이를 잡으면
Then { kind:"failed", message:"일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." }가 반환되고 화면에 표시된다
```

### C. 질문 생성 (Route Handler) — 자동 트리거 & 수동 재시도

**정상 시나리오**

```
Given 이력서 업로드가 방금 성공(source.id="uploaded-source-id")했고
When ResumeUploadForm의 자동 트리거 useEffect가 발동하면
Then fetch("/api/questions/generate", { method:"POST", headers:{...}, body: JSON.stringify({ sourceId:"uploaded-source-id" }) })가
     1회 호출된다(credentials 옵션 없음, NEXT_PUBLIC_API_BASE_URL 미참조)
```

```
Given Route Handler가 apps/api로부터 201 { questions, question }을 받으면
When Route Handler가 응답하면
Then NextResponse.json({questions, question}, {status:201})를 그대로 반환하고,
     클라이언트는 "질문이 준비됐어요 · 면접 준비를 시작할까요?" 문구로 전환한다(기존 로직 무변경)
```

```
Given /today 페이지에서 질문이 소진되어 EmptyQuestionState가 렌더링되고
When "다시 시도"를 클릭하면
Then fetch("/api/questions/generate", { method:"POST", body: JSON.stringify({}) })가 호출된다(상대경로)
```

**엣지 케이스**

```
Given 자동 트리거 요청이 아직 응답하지 않은 상태에서
When 사용자가 "다른 파일 업로드"로 폼을 리셋한 뒤 그 응답이 뒤늦게 도착하면
Then uploadedSourceRef 가드에 의해 화면 상태는 갱신되지 않는다(기존 stale-response 가드 로직 무변경으로 유지됨을 확인)
```

```
Given React StrictMode로 effect가 2회 실행되어도
When generationRequestedSourceIdRef 가드가 동작하면
Then POST /api/questions/generate 호출은 정확히 1회만 발생한다(기존 가드 로직 무변경으로 유지됨을 확인)
```

**에러 케이스**

```
Given apps/api 호출 결과가 apiPost에서 { kind:"unauthenticated" }이면
When Route Handler가 이를 받으면
Then NextResponse.json({error:"unauthorized", message:"인증되지 않은 요청입니다."}, {status:401})를 반환하고,
     클라이언트는 response.status===401을 감지해 기존과 동일하게
     router.replace("/gate?reason=expired&next=...")로 이동한다(클라이언트 로직 무변경)
```

```
Given Route Handler 내부에서 apps/api 호출이 예외를 던지면(apps/api 프로세스 다운)
When try/catch가 이를 잡으면
Then NextResponse.json({error:"internal_error", message:"일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."}, {status:500})를 반환하고,
     클라이언트는 response.ok===false 분기로 기존과 동일하게 처리한다
```

```
Given 클라이언트의 fetch("/api/questions/generate", ...) 자체가 네트워크 예외를 던지면(Next 서버 프로세스 다운)
When 클라이언트 catch 블록이 이를 잡으면
Then "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."가 표시된다(기존 로직 무변경)
```

### D. `setCookieForwarding.ts` (단위 테스트 대상)

**정상 시나리오**

```
Given rawSetCookie = "dic_visitor_email=user%40example.com; Max-Age=15552000; Path=/; HttpOnly; SameSite=Lax"
When parseSetCookieHeader(rawSetCookie)를 호출하면
Then { name:"dic_visitor_email", value:"user@example.com",
       options:{ maxAge:15552000, path:"/", httpOnly:true, sameSite:"lax" } }를 반환한다
```

```
Given rawSetCookie에 Secure 속성이 추가로 포함되면
When 파싱하면
Then options.secure===true가 포함된다
```

**엣지 케이스**

```
Given rawSetCookie에 Max-Age 속성이 없으면
When 파싱하면
Then options.maxAge는 undefined다
```

```
Given rawSetCookie에 Expires 속성이 포함되어 있어도(쉼표 포함 날짜 문자열)
When 파싱하면
Then Expires는 결과에 포함되지 않고 다른 속성 파싱에도 영향을 주지 않는다
```

**에러 케이스**

```
Given applySetCookieHeaders([])가 호출되면
When 처리하면
Then cookies().set()은 한 번도 호출되지 않는다
```

### E. `next.config.js` bodySizeLimit

```
Given next.config.js에 experimental.serverActions.bodySizeLimit = "6mb"가 설정되어 있으면
When 5MB(5,242,880바이트) 이력서 파일을 업로드하면
Then Server Action 요청이 프레임워크 레벨에서 거부되지 않고 uploadResume 액션 코드가 실행된다
```

---

## 스코프 외 확인 사항 (참고용, AC 아님)

- apps/api `cors()`/`ALLOWED_ORIGINS` 제거는 Phase 4(EC2 코로케이션) 착수 시점의 별도 소규모 변경으로 권고(위 "설계 판단 4" 표 참고). 이 스펙의 developer 단계에서 건드리지 않는다.
- `serverActions.allowedOrigins`(nginx 프록시 대응)는 Phase 4 배포 작업에서 다룬다.
- 기존 3개 테스트 파일(`GateForm.test.tsx`, `ResumeUploadForm.test.tsx`, `EmptyQuestionState.test.tsx`)의 `global.fetch` 모킹 + `vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", ...)` 구조는 test-architect 단계에서 위 AC 기준으로 재작성한다. `EmptyQuestionState.test.tsx`와 `ResumeUploadForm.test.tsx`의 "질문 생성" 관련 테스트는 URL을 상대경로로, `credentials` 단언을 제거하는 정도의 변경으로 대부분 재사용 가능하다. `GateForm.test.tsx`/`ResumeUploadForm.test.tsx`의 업로드/세션 생성 부분은 `global.fetch` 모킹에서 Server Action 모듈(`./actions`, `./resumeActions`) 모킹으로 구조가 바뀐다.

---

**Status**: Specification Complete - Awaiting User Approval
**Next Action**: 명세를 확인하신 후 승인해주시면 @test-architect에게 테스트 작성을 요청하겠습니다.
