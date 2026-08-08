# 테스트 명세: 이메일 기반 방문자 게이트

- 총 테스트 케이스: 71개 (`apps/api` 19개 + `apps/web` 52개)
- 파일:
  - `apps/api/src/lib/userLookup.test.ts` (3)
  - `apps/api/src/routes/auth.test.ts` (9)
  - `apps/api/src/middleware/requireAuthenticatedUser.test.ts` (4, 신규 — 리팩터링 대상의 첫 단위 테스트)
  - `apps/api/src/app.test.ts` (3, 신규 — 라우팅 순서 배선 검증)
  - `apps/web/src/lib/visitorCookie.test.ts` (11)
  - `apps/web/src/lib/sanitizeNextPath.test.ts` (9)
  - `apps/web/src/middleware.test.ts` (7)
  - `apps/web/src/app/api/gate/verify/route.test.ts` (7)
  - `apps/web/src/lib/authenticatedFetch.test.ts` (5)
  - `apps/web/src/app/gate/GateForm.test.tsx` (5)
  - `apps/web/src/app/gate/page.test.tsx` (8)
- 실행 결과:
  - `apps/api`: 4 test files failed(신규) / 1 test file passed(기존 `resume.test.ts`, **21/21 그대로 통과** — 회귀 없음 확인)
  - `apps/web`: 7 test files failed (구현 없음 — 정상, TDD Red). 최초로 테스트 러너를 설정했으므로 기존 통과 테스트는 없음.
  - `pnpm test`(루트, turbo)로도 위 상태 재확인 완료.

**Status**: Test Specification Complete
**Next Action**: 테스트 코드를 확인하신 후 승인해주시면 @developer에게 구현을 요청하겠습니다.

---

## 0. 사전 작업 (이번 단계에서 완료)

### apps/web에 처음 추가한 devDependency (`apps/web/package.json`)

이 저장소에서 `apps/web`은 테스트 러너가 전혀 설정되어 있지 않아 아래를 신규로 추가하고 `pnpm install`로 실제 설치했습니다.

| 패키지 | 버전(range) | 설치된 버전 | 용도 |
| --- | --- | --- | --- |
| `vitest` | `^2.1.4` | `2.1.9` | 테스트 러너. `apps/api`와 동일한 메이저 버전으로 통일 |
| `@testing-library/react` | `^16.0.1` | `16.3.2` | React 컴포넌트 렌더링/쿼리 |
| `@testing-library/user-event` | `^14.5.2` | (semver 범위 내 설치) | 실제 사용자 상호작용 시뮬레이션 |
| `@testing-library/jest-dom` | `^6.5.0` | (semver 범위 내 설치, deprecated 경고 있으나 현재 안정 버전) | `toBeInTheDocument`, `toHaveAttribute`, `toBeDisabled` 등 매처 |
| `jsdom` | `^25.0.1` | (semver 범위 내 설치) | 컴포넌트 테스트용 DOM 환경 |
| `@vitejs/plugin-react` | `^4.3.2` | (semver 범위 내 설치) | Vitest(Vite)에서 JSX/TSX 변환 |

`apps/web/package.json`에 `"test": "vitest run"` 스크립트 추가.

### 새로 만든 설정 파일

- `apps/web/vitest.config.ts` — 기본 `environment: "jsdom"`, `globals: false`(명시적 import 유지, `apps/api`와 통일), `setupFiles: ["./vitest.setup.ts"]`.
- `apps/web/vitest.setup.ts` — `@testing-library/jest-dom/vitest` 매처 등록.
- `next/server`의 `NextRequest`/`NextResponse`를 직접 다루는 파일(`middleware.test.ts`, `app/api/gate/verify/route.test.ts`)은 파일 상단 `// @vitest-environment node` 주석으로 개별적으로 Node 환경을 강제함(jsdom 환경에서 Web 표준 Request/Response 관련 불필요한 충돌 방지).

### 워크스페이스 공통 설정

- 루트 `turbo.json`에 `"test": {}` 태스크 추가, 루트 `package.json`에 `"test": "turbo run test"` 스크립트 추가 — `pnpm test`로 `apps/api`·`apps/web` 테스트를 한 번에 실행 가능.

### 이번 단계에서 추가하지 않은 것

- `apps/api`의 런타임 의존성(`@supabase/supabase-js` 등)은 이미 존재하므로 추가 없음.
- Playwright 등 E2E 프레임워크는 스펙의 "과도하게 복잡한 E2E 설정 지양" 지침에 따라 추가하지 않음.

---

## 1. 테스트가 전제하는 모듈 구조 (developer 구현 가이드)

아래 경로/시그니처는 테스트 코드가 강제하는 계약이다. developer 단계에서 이 경로와 계약을 그대로 따라야 테스트가 GREEN으로 전환된다. 바꾸고 싶다면 먼저 이 문서와 테스트 코드를 함께 수정해야 한다.

### 1-1. `apps/api`

| 모듈(신규/수정) | 역할 | 시그니처 |
| --- | --- | --- |
| `apps/api/src/lib/userLookup.ts` (신규) | `requireAuthenticatedUser`와 `POST /api/auth/verify-email`이 공유하는 조회 헬퍼 | `lookupUserByEmail(email: string): Promise<{ user: { id: string; email: string } \| null; queryFailed: boolean }>` |
| `apps/api/src/routes/auth.ts` (신규) | `POST /api/auth/verify-email` 핸들러를 가진 Express `Router`를 **default export** | — |
| `apps/api/src/middleware/requireAuthenticatedUser.ts` (리팩터링) | 내부 Supabase 직접 쿼리를 `lookupUserByEmail` 호출로 교체. **외부 관찰 동작(401/`unauthorized`)은 절대 불변** | 기존과 동일 |
| `apps/api/src/app.ts` (수정) | `app.use("/api/auth/verify-email", authRouter)`를 `app.use("/api", requireApiKey)` **이전**에 등록 | — |

**`lookupUserByEmail` 내부 Supabase 호출 계약(mock 설계 근거)**: `.single()`이 아니라 **`.maybeSingle()`**을 사용한다고 가정하고 mock을 짰다.

```ts
const { data, error } = await supabase
  .from("users")
  .select("id, email")
  .eq("email", email)
  .maybeSingle();
// data && !error  → { user: data, queryFailed: false }
// !data && !error → { user: null, queryFailed: false }   (0건, PostgREST 표준 동작)
// error           → { user: null, queryFailed: true }    (커넥션 오류 등 실제 실패)
```

`.single()`을 계속 쓰면서 에러 코드(`PGRST116` 등)로 0건/실패를 분기하는 구현도 **관찰 가능한 반환값이 위 표와 동일하면** 테스트를 통과한다 — 테스트는 `lookupUserByEmail`의 반환값만 검증하고 내부 구현 방식은 강제하지 않는다. 단, 이 문서는 가장 단순한 구현 경로로 `.maybeSingle()`을 권장한다.

### 1-2. `apps/web` (신규 — 이 기능으로 처음 생기는 모듈들)

| 모듈 | 역할 | 시그니처 |
| --- | --- | --- |
| `apps/web/src/lib/visitorCookie.ts` | 쿠키 이름/만료/형식 검증 공용 상수·함수 | `VISITOR_COOKIE_NAME: string`(`"dic_visitor_email"`) / `VISITOR_COOKIE_MAX_AGE_SECONDS: number`(`15552000`) / `isValidVisitorEmailCookieValue(value: string \| null \| undefined): boolean` / `buildVisitorCookieOptions(): { httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string; maxAge: number }`(내부에서 `process.env.NODE_ENV`로 `secure` 분기) |
| `apps/web/src/lib/sanitizeNextPath.ts` | 오픈 리다이렉트 방지 `next` 안전성 검증 | `sanitizeNextPath(next: string \| null \| undefined): string` (항상 안전한 경로 또는 `"/"` 반환) |
| `apps/web/src/lib/authenticatedFetch.ts` | apps/api 호출 공용 래퍼 | `authenticatedFetch(path: string, init?: RequestInit, currentPath?: string): Promise<Response>` — `next/headers`의 `cookies()`, `next/navigation`의 `redirect()` 사용. `currentPath` 기본값은 `"/"` |
| `apps/web/src/middleware.ts` | Edge 미들웨어 | `middleware(request: NextRequest): NextResponse` (default export 여부는 테스트가 강제하지 않음 — named export `middleware`, `config`로 import) |
| `apps/web/src/app/gate/page.tsx` | 게이트 Server Component | `export default async function GatePage({ searchParams }: { searchParams: { next?: string; reason?: string } })` — cookies() 확인 후 `redirect()` 또는 `<GateForm />` 반환 |
| `apps/web/src/app/gate/GateForm.tsx` | 게이트 Client Component | named export `GateForm(props: { nextPath: string; reason?: string })` |
| `apps/web/src/app/api/gate/verify/route.ts` | Next Route Handler | named export `POST(request: NextRequest): Promise<NextResponse>` |

**GateForm 접근성 계약**: 이메일 입력은 `getByRole("textbox", { name: "이메일" })`, 제출 버튼은 `getByRole("button", { name: "제출" })`로 조회 가능해야 한다(`<label>` 연결 또는 `aria-label="이메일"` 필요).

**page.tsx ↔ GateForm 책임 분리**: `reason=expired` 배너("인증이 만료되었습니다. 이메일을 다시 입력해주세요.")는 **`page.tsx`(부모)가 렌더링**한다 — 스펙 "게이트 페이지" 절에 명시된 위치. `GateForm`은 폼 제출/에러표시/재시도만 책임지며, 배너 렌더링 로직을 갖지 않아도 된다(`GateForm.test.tsx`는 이를 검증하지 않음).

---

## 2. 테스트 케이스 목록

### 2-1. `apps/api`

#### `lib/userLookup.test.ts` (3) — 정상 1 / 엣지 1 / 에러 1

| # | 테스트명 |
| - | --- |
| 1 | 일치하는 row가 있으면 `{ user, queryFailed: false }`를 반환한다 |
| 2 | 일치하는 row가 없으면(0건) `{ user: null, queryFailed: false }`를 반환한다 |
| 3 | 조회 자체가 실패하면(커넥션 오류 등) `{ user: null, queryFailed: true }`를 반환한다 — `email_not_found`와 절대 혼동되지 않아야 함 |

#### `routes/auth.test.ts` (9) — 정상 1 / 엣지 6 / 에러 2

| # | 테스트명 |
| - | --- |
| 1 | 등록된 이메일이면 200과 `{ verified: true }`만 반환한다(id 미노출) |
| 2 | 대소문자/앞뒤 공백 정규화 후 대조한다 |
| 3 | `email` 필드 자체가 없으면 400 `email_required`, DB 미조회 |
| 4 | 공백만 입력하면 400 `email_required` |
| 5 | 이메일 형식이 아니면 400 `invalid_email_format`, DB 미조회 |
| 6 | 정규화 후 254자 초과면 400 `invalid_email_format`(경계값) |
| 7 | 3회 연속 실패 후 4번째 정상 이메일 → 잠금 없이 정상 성공(재시도 무제한) |
| 8 | `users`에 없는 이메일 → 401 `email_not_found` |
| 9 | `queryFailed: true` → 500 `internal_error` (`email_not_found`로 오분류하지 않음) |

#### `middleware/requireAuthenticatedUser.test.ts` (4, 신규) — 정상 1 / 에러 3

| # | 테스트명 |
| - | --- |
| 1 | `lookupUserByEmail`이 user를 반환하면 `req.user` 설정 후 다음 핸들러로 진행 |
| 2 | `x-user-email` 헤더 없으면 401, `lookupUserByEmail` 미호출 |
| 3 | `user: null`(0건) → 401 `unauthorized` |
| 4 | **`queryFailed: true`여도 500이 아닌 기존과 동일한 401 `unauthorized`** — 리팩터링 동등성 보장 핵심 테스트 |

#### `app.test.ts` (3, 신규) — 배선(라우팅 순서) 검증

| # | 테스트명 |
| - | --- |
| 1 | `POST /api/auth/verify-email`은 `x-api-key` 없이도 도달 가능(requireApiKey보다 먼저 등록) |
| 2 | 기존 `/api/questions/today`는 `x-api-key` 없으면 여전히 401(회귀 방지) |
| 3 | `/api/sources/resume`는 `x-api-key` 없이 도달하되 `x-user-email` 없으면 401(기존 배치 유지) |

### 2-2. `apps/web`

#### `lib/visitorCookie.test.ts` (11) — 정상 4 / 엣지 7

상수(`VISITOR_COOKIE_NAME`, `VISITOR_COOKIE_MAX_AGE_SECONDS`) 검증 1건, `isValidVisitorEmailCookieValue` 정상 1건 + 엣지 7건(undefined/null/빈문자열/형식오류/공백포함/254자 경계 유효/255자 경계 초과 무효), `buildVisitorCookieOptions` 2건(NODE_ENV=production → secure:true / 그 외 → secure:false).

#### `lib/sanitizeNextPath.test.ts` (9) — 정상 2 / 엣지 7

`/history`, `/history?filter=answered` 그대로 보존(2) + `undefined`/`null`/빈문자열/`evil.com`(슬래시 미시작)/`//evil.com`/`https://evil.com`/`/redirect?to=https://evil.com`(중간에 `://` 포함) 전부 `"/"`로 대체(7).

#### `middleware.test.ts` (7) — 정상 3 / 엣지 4

정상: 쿠키 없음 → `/gate?next=%2F` 307 리다이렉트, 쿼리스트링 보존(`/history?filter=answered` → `next=/history?filter=answered`), 유효 쿠키 → `NextResponse.next()`로 통과.
엣지: 변조된 값(`abc123`) 리다이렉트, 255자 초과 값 리다이렉트, "쿠키 자동 폐기 = 쿠키 없음과 동일 처리" 검증, `config.matcher`가 `/gate`/`_next`/`favicon.ico`/`manifest.json`/`sw.js`/`icons` 키워드를 포함하는지 스모크 체크(정확한 정규식 문법은 구현 자유).

#### `app/api/gate/verify/route.test.ts` (7) — 정상 2 / 엣지 2 / 에러 3

정상: 업스트림 200 → 쿠키 발급(`httpOnly`/`sameSite`/`path`/`maxAge` 속성 포함) + `{ ok: true }` 200, 업스트림 호출 시 `API_BASE_URL` 기반 URL·body 위임 검증.
엣지: 이메일 정규화 후 쿠키 값 저장, 업스트림 400 그대로 전달(쿠키 미발급).
에러: 업스트림 401/500 그대로 전달, 업스트림 호출 자체 실패(네트워크 오류) → 502 `upstream_unreachable`.

#### `lib/authenticatedFetch.test.ts` (5) — 정상 2 / 엣지 2 / 에러 1

정상: 쿠키 있으면 `x-user-email` 헤더를 붙여 호출 후 응답 그대로 반환, 기존 `init.headers` 보존.
엣지: 쿠키 없으면 fetch 미호출 + `/gate?next=<currentPath>` 리다이렉트, `currentPath` 생략 시 기본값 `/` 사용.
에러: apps/api가 401 반환 → 쿠키 삭제 + `/gate?reason=expired&next=<currentPath>` 리다이렉트.

#### `app/gate/GateForm.test.tsx` (5) — 정상 1 / 엣지 2 / 에러 2

정상: 제출 성공 시 `/api/gate/verify` 호출 후 `router.replace(nextPath)`.
엣지: 요청 중 제출 버튼 비활성화(중복 제출 방지), 실패 후 즉시 재입력·재제출 가능(잠금 없음).
에러: 서버 `error`/`message`를 폼 아래에 그대로 표시(email_not_found 사례), 업스트림 장애(502) 안내 메시지 표시.

#### `app/gate/page.test.tsx` (8) — 정상 2 / 엣지 6

정상: 유효 쿠키 + `next` → 그 경로로 리다이렉트, `next` 없음 → `/`로 리다이렉트.
엣지: 유효 쿠키 + 안전하지 않은 `next`(절대 URL/프로토콜 상대 URL) → `/`로 대체 리다이렉트(2건), 쿠키 없음 → 리다이렉트 없이 `GateForm`에 정제된 `nextPath` 전달, 쿠키 형식 무효 → `GateForm` 렌더링, `reason=expired` → 배너 표시, `reason` 없음 → 배너 미표시.

---

## 3. 실행 결과 (TDD Red 확인)

### `apps/api`

```
pnpm --filter @daily-interview-coach/api test

 ✓ src/routes/resume.test.ts (21 tests)   ← 기존 테스트, 수정 없이 그대로 통과 (회귀 없음)
 FAIL  src/app.test.ts                     ← 신규: userLookup 모듈 없음
 FAIL  src/lib/userLookup.test.ts          ← 신규: 모듈 없음 (Failed to load url ./userLookup)
 FAIL  src/middleware/requireAuthenticatedUser.test.ts  ← 신규: 실제 미들웨어가 아직
       실제 supabaseClient를 생성해 "supabaseUrl is required" 런타임 에러 발생(리팩터링 전)
 FAIL  src/routes/auth.test.ts             ← 신규: 모듈 없음 (Failed to load url ./auth)

 Test Files  4 failed | 1 passed (5)
      Tests  21 passed (21)
```

### `apps/web`

```
pnpm --filter @daily-interview-coach/web test

 FAIL  src/middleware.test.ts
 FAIL  src/app/api/gate/verify/route.test.ts
 FAIL  src/app/gate/page.test.tsx
 FAIL  src/lib/authenticatedFetch.test.ts
 FAIL  src/lib/sanitizeNextPath.test.ts
 FAIL  src/app/gate/GateForm.test.tsx
 FAIL  src/lib/visitorCookie.test.ts

 Test Files  7 failed (7)
      Tests  no tests
```

모든 신규 테스트는 대상 모듈이 아직 존재하지 않아 `Failed to load url`/`Failed to resolve import` 형태로 실패한다 — 구현이 전혀 없는 현재 상태에서 기대되는 정상적인 실패(TDD Red)다. 기존 `apps/api/src/routes/resume.test.ts`의 21개 테스트는 이번 변경으로 전혀 영향받지 않고 그대로 통과함을 재실행으로 확인했다.
