# 테스트 명세: 이메일 기반 방문자 게이트 (v2 — apps/api 중심 재설계)

이 문서는 v1 테스트 명세(`route.ts`/Route Handler 프록시 기준)를 대체한다. v2 재설계(인증 판단
+ 쿠키 발급/관리를 전부 `apps/api`가 소유)에 따라 기존 테스트 중 일부를 유지·수정·삭제하고,
CORS/쿠키 발급/SSR 헬퍼에 대한 테스트를 신규로 작성했다.

**⚠️ SSR 헬퍼 설계 확정(진행 중 변경)**: 최초 작성했던 `apps/web/src/lib/forwardedApiFetch.ts`
(단일 함수, `Response`를 그대로 반환)는 최종 설계가 아니다. 확정된 설계는 **`apps/web/src/lib/apiClient.ts`**
— 클래스가 아닌 함수형, `apiGet`/`apiPost`/`apiPut`/`apiDelete` 4개의 named export, 반환 타입은
`Response`가 아니라 판별 유니온 `ApiResult`(`{ kind: "ok"; response } | { kind: "unauthenticated"; redirectTo }`).
`forwardedApiFetch.test.ts`는 삭제하고 `apiClient.test.ts`로 다시 작성했다.

**⚠️ 승인 직전 스펙 추가 반영 2건(진행 중 변경)**: 사용자가 승인 전 스펙에 추가로 반영을 요청한
두 가지를 이번 test-architect 단계에서 마무리했다(아래 0-3/0-4절):
1. 게이트 엔드포인트 RESTful 재명명: `POST /api/auth/verify-email` → **`POST /api/sessions`**,
   성공 상태코드 `200` → **`201`**(아키텍처 결정 사항 #8).
2. 레거시 `requireApiKey`(고정 `x-api-key`) **완전 삭제** — `/api/questions/today`도
   `requireAuthenticatedUser`(쿠키 기반)로 전환(아키텍처 결정 사항 #7).

아래 모든 절은 이 최종 상태 기준으로 갱신되어 있다.

- 총 테스트 케이스: `apps/api` 54개(17개 Red / 37개 Green) + `apps/web` 55개(선언 기준,
  `apiClient.test.ts` 15개는 모듈 부재로 파일 자체가 로드 실패 — 아래 3절 참고)
- 실행 결과:
  - `apps/api`: **5 test files 중 4 files, 17 tests 실패(Red, 정상)** / `resume.test.ts`(21개)는
    **그대로 통과 유지**(회귀 없음 확인)
  - `apps/web`: **6 test files 중 2 files 실패(Red, 정상)** — `GateForm.test.tsx`(4/7 실패),
    `apiClient.test.ts`(모듈 자체가 없어 파일 전체 실패). 나머지 4개 파일(`middleware`,
    `sanitizeNextPath`, `visitorCookie`, `gate/page`)은 **그대로 통과**(영향 없음 확인).
  - 삭제 대상(`app/api/gate/verify/route.*`, `lib/authenticatedFetch.*`, `lib/forwardedApiFetch.test.ts`)은
    파일 자체를 제거해 실행 결과에서 빠짐(정상 — 더 이상 실패할 대상이 없음).

**Status**: Test Specification Complete (TDD Red)
**Next Action**: 테스트 코드를 확인하신 후 승인해주시면 @developer에게 구현을 요청하겠습니다.

---

## 0. v1 → v2 변경 처리 요약

| 파일 | 처리 | 비고 |
| --- | --- | --- |
| `apps/api/src/routes/resume.test.ts` | 유지(무변경) | `requireAuthenticatedUser` 전체 모킹 — 영향 없음, 21/21 통과 재확인 |
| `apps/api/src/lib/userLookup.test.ts` | **필드명만 수정** | `queryFailed` → `isFailedQuery` 리네임(아래 0-1 참고). 로직/개수(3개) 변화 없음 |
| `apps/api/src/routes/auth.test.ts` | 수정 | `isFailedQuery` 리네임 + 성공 시 `Set-Cookie` 검증 5건 추가 + 경로 `/api/sessions`·상태코드 `201` 재명명(9→13개, 아래 0-3절) |
| `apps/api/src/middleware/requireAuthenticatedUser.test.ts` | **전면 재작성** | 헤더(`x-user-email`) 기준 → 쿠키(`Cookie: dic_visitor_email=...`) 기준(4→7개) |
| `apps/api/src/app.test.ts` | **전면 재작성** | "x-user-email 헤더 없으면 401" → "Cookie 헤더 없으면 401" + CORS 정책 6건 신규 + `requireApiKey` 완전 삭제/`/api/questions/today` 쿠키 전환 반영(3→10개, 아래 0-4절) |
| `apps/web/src/lib/visitorCookie.test.ts` | **일부 삭제** | `buildVisitorCookieOptions`/`VISITOR_COOKIE_MAX_AGE_SECONDS` 테스트 제거(11→9개). `VISITOR_COOKIE_NAME`/`isValidVisitorEmailCookieValue`만 유지 |
| `apps/web/src/lib/sanitizeNextPath.test.ts` | 유지(무변경) | 로직 변경 없음 |
| `apps/web/src/middleware.test.ts` | 유지(무변경) | 로직 변경 없음 |
| `apps/web/src/app/gate/page.test.tsx` | 유지(무변경) | 로직 변경 없음 |
| `apps/web/src/app/gate/GateForm.test.tsx` | **전면 재작성** | `/api/gate/verify` mock → `${NEXT_PUBLIC_API_BASE_URL}/api/auth/verify-email`을 `credentials:"include"`로 직접 호출 검증. 502 개념 삭제, try/catch 통합 에러 케이스로 대체(5→7개) |
| `apps/web/src/app/api/gate/verify/route.ts` + `route.test.ts` | **삭제** | Route Handler 프록시 폐기 |
| `apps/web/src/lib/authenticatedFetch.ts` + `authenticatedFetch.test.ts` | **삭제** | `apiClient.ts`로 대체(리다이렉트 책임 없음) |
| `apps/web/src/lib/forwardedApiFetch.test.ts` | **작성 후 삭제**(설계 확정으로 대체) | 중간 산출물(단일 함수, `Response` 반환) — 최종 설계가 `apiClient.ts`(함수형 4-export, 판별 유니온 반환)로 확정되며 폐기 |
| `apps/web/src/lib/apiClient.test.ts` | **신규**(최종 SSR 헬퍼 설계) | `apiGet`/`apiPost`/`apiPut`/`apiDelete` + `ApiResult` 판별 유니온(15개) |
| `apps/api` CORS 정책 | **신규**(`app.test.ts`에 통합) | 허용/비허용 origin, `ALLOWED_ORIGINS` 미설정 시 fail-closed, Origin 헤더 없는 비브라우저 호출 통과(6개) |

### 0-1. ⚠️ 필드명 변경: `queryFailed` → `isFailedQuery` (진행 중 반영)

작업 도중 스펙이 갱신되어 `lookupUserByEmail`의 반환 타입 `{ user, queryFailed }`가
**`{ user, isFailedQuery }`로 리네임**되었다(순수 네이밍 변경, 동작 계약은 동일). 이번 작업에서
손댄 모든 테스트 파일(`userLookup.test.ts`, `auth.test.ts`, `requireAuthenticatedUser.test.ts`,
`app.test.ts`)은 이미 `isFailedQuery`로 통일되어 있다.

**developer 인계 시 반드시 알려야 할 것**: 현재 실제 구현 파일(`apps/api/src/lib/userLookup.ts`,
`apps/api/src/routes/auth.ts`, `apps/api/src/middleware/requireAuthenticatedUser.ts`)은 **아직
`queryFailed`를 그대로 사용 중**이다. 이 리네임은 test-architect 범위 밖(구현 변경)이므로,
developer가 이번 기능을 구현할 때 위 3개 구현 파일의 필드명도 `isFailedQuery`로 함께 바꿔야
테스트가 GREEN으로 전환된다. 이 필드명 불일치가 `userLookup.test.ts`(3개 전부)와
`requireAuthenticatedUser.test.ts`(정상 시나리오 1개, `isFailedQuery` 관련 1개)가 지금 Red인 이유
중 하나다.

### 0-2. ⚠️ 네이밍 컨벤션 추가: `handle` 접두사 금지(동사+목적어로 명명) + 불리언 `is` 접두사

작업 도중 `CLAUDE.md`에 네이밍 컨벤션이 추가/예정되었다.

1. **함수명은 `handle` 접두사 대신 동사+목적어**로 짓는다. 예: `handleSubmit` → `submitForm`.
   명세 파일의 `GateForm` 예시 코드도 이미 `submitForm`으로 갱신되었다. 이 테스트 단계에서
   영향 범위를 확인한 결과:
   - `apps/web/src/app/gate/GateForm.test.tsx`: **영향 없음** — RTL 테스트는
     `getByRole("textbox"/"button", { name: ... })`로만 상호작용하며 함수 이름을 직접
     참조하는 코드가 없다(그렙으로 재확인함).
   - 이번 작업에서 새로 쓴 모든 테스트 파일(`apiClient.test.ts`, `app.test.ts`,
     `auth.test.ts`, `requireAuthenticatedUser.test.ts`)에도 `handle*` 이름을 가진 함수를
     참조하는 코드가 없다(그렙으로 재확인함).
   - 참고(이번 작업 범위 아님): `apps/api/src/routes/resume.ts`의 `handleResumeUpload`도
     `uploadResume`로 이미 리네임되어 있고 기존 `resume.test.ts`(21개)는 영향 없음이 확인된
     상태다 — test-architect가 손댈 필요 없음.
   - **여전히 실제 구현 파일에는 반영되지 않은 것**: `apps/web/src/app/gate/GateForm.tsx`의
     `handleSubmit`은 developer 단계에서 `submitForm`으로 리네임해야 한다(테스트 자체는
     함수명을 참조하지 않으므로 이 리네임 여부와 무관하게 GREEN/RED가 갈리지 않는다 — 순수
     내부 리팩터링).
2. **불리언을 나타내는 변수명은 `is` 접두사**를 쓴다(예: `isFailedQuery`, `isValidVisitorEmailCookieValue`
   의 반환값을 받는 변수 등). 이번 작업에서 다룬 테스트 코드의 불리언 변수/필드는 이미 이
   컨벤션을 따르고 있다(`isFailedQuery`, `isSubmitting` 등) — 별도 수정 불필요.

**`CLAUDE.md` 파일 자체의 수정은 test-architect(이 서브에이전트)의 권한/스코프 밖이다** — 조직
가드레일상 프로젝트 컨벤션 문서(`CLAUDE.md`) 변경은 사용자 본인의 직접 승인/작업이 필요하며,
서브에이전트 지시만으로는 이 문서를 대신 수정하지 않는다. 이 절은 컨벤션이 테스트 코드에
미치는 실질적 영향(위 1, 2)만 기록한다.

### 0-3. ⚠️ 엔드포인트 RESTful 재명명: `POST /api/auth/verify-email` → `POST /api/sessions`

승인 직전 사용자 요청으로 스펙이 갱신되어, 게이트 엔드포인트가 "이메일 검증"이라는 동작
대신 "세션 생성"이라는 자원으로 재명명되었다(아키텍처 결정 사항 #8). 라우터 파일 경로
(`apps/api/src/routes/auth.ts`)와 내부 함수/변수명은 그대로 유지 — URL과 성공 상태코드만
바뀐다.

| 변경 전(v2 초안) | 변경 후(최종) |
| --- | --- |
| `POST /api/auth/verify-email` | `POST /api/sessions` |
| 성공 `200` | 성공 `201`(다른 생성 엔드포인트 `/api/sources/resume`와 동일 컨벤션) |
| 400/401/500 응답 바디/코드 | **변경 없음** |

**영향받은 테스트**:
- `apps/api/src/routes/auth.test.ts`: 요청 경로를 전부 `/api/sessions`로, 성공 시 기대
  상태코드를 전부 `201`로 수정했다(엣지 케이스 중 400을 검증하는 것들은 상태코드 변경 없음).
- `apps/api/src/app.test.ts`: 경로를 참조하는 라우팅/CORS 테스트를 전부 갱신했다(0-4절과
  함께 처리, 아래 참고).
- `apps/web/src/app/gate/GateForm.test.tsx`: `fetch` 호출 대상 URL 하드코딩 부분(1곳)과,
  모킹된 성공 응답의 상태코드(`jsonResponse(200, ...)` → `jsonResponse(201, ...)`, 3곳)를
  갱신했다. `GateForm`은 `response.ok`만으로 성공/실패를 판단하므로 정확한 성공
  상태코드(200 vs 201) 자체가 컴포넌트 동작에 영향을 주지는 않지만, 모킹은 실제 계약과
  일치시켰다.
- `apps/web/src/lib/apiClient.test.ts`: 이 파일은 `/api/questions/today`, `/api/sources/resume`,
  `/api/answers` 등 게이트와 무관한 경로만 예시로 쓰므로 **영향 없음**(그렙으로 확인함).

### 0-4. ⚠️ 레거시 `requireApiKey`(고정 API 키) 완전 삭제

승인 직전 사용자 요청으로 스펙에 추가된 두 번째 변경(아키텍처 결정 사항 #7): `app.ts`의
`requireApiKey` 함수와 `app.use("/api", requireApiKey)` 등록을 완전히 삭제하고,
`/api/questions/today`도 `requireAuthenticatedUser`(쿠키 기반)로 전환한다. 결과적으로
`/api/*` 전체가 인증 방식 하나(게이트 쿠키)로 통일된다.

**`apps/api/src/app.test.ts`를 전면 재작성한 이유**: v2 초안에서 "requireApiKey보다 먼저
등록되는지" 순서를 검증하던 테스트들은 `requireApiKey` 자체가 사라지므로 더 이상 의미가
없다. 새로 구성한 라우팅 테스트 4건(구 3건):

| # | 테스트명 | 비고 |
| - | --- | --- |
| 1 | `POST /api/sessions`는 인증(쿠키) 없이도 도달 가능하다 | (구) "requireApiKey보다 먼저 등록" 순서 검증 → 순서 개념 자체가 사라져 단순 스모크 테스트로 축소 |
| 2 | 게이트 쿠키가 없으면 `GET /api/questions/today`는 401을 반환한다 | (구) "x-api-key 헤더가 없으면 401" **대체** — 401인 이유가 "x-api-key 부재"에서 "쿠키 부재"로 바뀜(에러 바디는 동일) |
| 3 | **[신규]** 유효한 게이트 쿠키가 있으면 x-api-key 헤더 없이도 `GET /api/questions/today`가 200을 반환한다 | `requireApiKey` 완전 삭제 이후를 보장하는 AC(스펙 "Acceptance Criteria" 하단 2건) 반영 |
| 4 | `/api/sources/resume`는 Cookie 헤더가 없으면 401을 반환한다 | 로직 변경 없음(이미 `requireAuthenticatedUser`를 직접 체이닝하는 패턴이었음), 설명 주석만 갱신 |

CORS `describe` 블록(6건)은 여전히 `/api/questions/today`/`POST /api/sessions`을 호출
대상으로 쓰며 실행 결과(401/CORS 헤더 유무) 자체는 바뀌지 않지만, "왜 401인가"를 설명하는
주석은 "x-api-key 부재" → "게이트 쿠키 부재"로 전부 갱신했다.

**developer 인계 노트**: `apps/api/.env.example`의 `API_KEY=`는 `requireApiKey` 삭제로 더
이상 어디에서도 참조되지 않으므로 제거 대상이다(스펙에 이미 명시됨, test-architect는 `.env.example`
자체를 건드리지 않았다 — 5절 참고).

---

## 1. 신규/변경 계약 (developer 구현 가이드)

### 1-1. `apps/api`

| 모듈 | 역할 | 시그니처/계약 |
| --- | --- | --- |
| `apps/api/src/lib/userLookup.ts` (필드명 변경) | 조회 헬퍼 | `lookupUserByEmail(email): Promise<{ user: {id,email} \| null; isFailedQuery: boolean }>` (기존 `queryFailed`에서 리네임) |
| `apps/api/src/routes/auth.ts` (변경, **파일 경로/내부 함수명은 유지**) | `POST /api/sessions`(구 `/api/auth/verify-email`) | 성공(**201**, 구 200) 시 `res.cookie(VISITOR_COOKIE_NAME, normalizedEmail, buildVisitorCookieOptions())`를 `res.status(201).json(...)` 호출 **이전**에 실행. 실패(400/401/500) 시 쿠키 미발급, 바디/코드는 v1과 동일 |
| `apps/api/src/lib/visitorCookie.ts` (신규) | 쿠키 발급 옵션 | `VISITOR_COOKIE_NAME = "dic_visitor_email"`, `VISITOR_COOKIE_MAX_AGE_MS = 15552000 * 1000`(밀리초 — 단위 변환 주의), `buildVisitorCookieOptions()` |
| `apps/api/src/middleware/requireAuthenticatedUser.ts` (변경) | 인증 미들웨어 | `req.header("x-user-email")` → `req.cookies?.[VISITOR_COOKIE_NAME]`. 하위호환 없음(헤더 완전 제거) |
| `apps/api/src/app.ts` (변경) | 전역 미들웨어 + 라우트 등록 | `cors({ origin(origin, cb) {...}, credentials: true })`와 `cookieParser()`를 라우팅 이전에 전역 등록. **`requireApiKey` 함수 정의와 `app.use("/api", requireApiKey)` 등록을 완전히 삭제**. `app.use("/api/sessions", authRouter)`는 순서 제약 없이 자유롭게 등록(더 이상 `requireApiKey`보다 먼저일 필요가 없음 — 그 자체가 없어짐). `app.get("/api/questions/today", ...)` 앞에 `requireAuthenticatedUser`를 직접 체이닝(`/api/sources/resume`와 동일 패턴) |

**CORS `origin` 콜백 계약(테스트가 강제)**:
- `origin` 헤더 없음(비브라우저) → 항상 허용(`callback(null, true)`), 단 CORS 헤더 자체가
  응답에 실리지 않아도 무방(브라우저가 아니므로 어차피 확인하지 않음).
- `ALLOWED_ORIGINS`(쉼표 구분, trim) 목록에 정확히 일치하는 origin만 CORS 헤더 부여.
- `ALLOWED_ORIGINS` 미설정/빈 문자열 → 모든 브라우저발 origin 차단(헤더 미부여) — fail-closed.
- 허용되지 않아도 요청 자체는 500이 아니라 정상 처리(CORS 헤더만 생략).

**쿠키 Set-Cookie 계약(테스트가 정확한 문자열까지 검증)**:
- name: `dic_visitor_email`, value: 정규화된 이메일(trim+lowercase, URL 디코딩 후 비교)
- `HttpOnly` 존재, `SameSite=Lax`(대소문자 무관 비교), `Path=/`
- **`Max-Age=15552000`(초 단위 정확히)** — `res.cookie`의 `maxAge`는 ms 단위이므로
  `15552000 * 1000`을 넘겨야 한다. 초 단위를 그대로 넘기면 `Max-Age=15552`(약 4.3시간)로
  잘못 발급되는 버그가 생기며, 테스트가 이를 정확히 잡아낸다.
- `NODE_ENV=production`일 때만 `Secure` 속성 추가.
- 실패 응답(400/401/500)에는 `Set-Cookie` 헤더 자체가 없어야 한다.

### 1-2. `apps/web`

| 모듈 | 역할 | 시그니처/계약 |
| --- | --- | --- |
| `apps/web/src/lib/visitorCookie.ts` (축소) | 형식 검사 전용 | `VISITOR_COOKIE_NAME`, `isValidVisitorEmailCookieValue`만 유지. `buildVisitorCookieOptions`/`VisitorCookieOptions`/`VISITOR_COOKIE_MAX_AGE_SECONDS` 제거 |
| `apps/web/src/app/gate/GateForm.tsx` (변경) | 폼 제출 | `fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/sessions`(구 `/api/auth/verify-email`), { method:"POST", credentials:"include", headers:{"content-type":"application/json"}, body: JSON.stringify({email}) })`. 성공 응답은 `201`(구 `200`)이지만 `GateForm`은 `response.ok`만 확인하므로 정확한 상태코드 자체는 컴포넌트 로직에 영향 없음. `fetch`+`response.json()`을 하나의 try/catch로 묶어 네트워크 단절/CORS 차단/JSON 파싱 실패를 모두 "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."로 통일 표시. **주의**: 제출 핸들러 함수명은 `handleSubmit`이 아니라 **`submitForm`**(네이밍 컨벤션 갱신 — `handle` 접두사 대신 동사+목적어, 아래 0-2절) |
| `apps/web/src/lib/apiClient.ts` (신규, **최종 설계 — 함수형**) | SSR 전용 헬퍼 | `import "server-only"` 최상단 필수. 공개 인터페이스는 4개: `apiGet`/`apiPost`/`apiPut`/`apiDelete(path: string, init?: RequestInit, currentPath?: string): Promise<ApiResult>`. 내부 공용 로직(`request`)은 export하지 않음(모듈 스코프로 캡슐화). `ApiResult = { kind: "ok"; response: Response } \| { kind: "unauthenticated"; redirectTo: string }`. `next/headers`의 `headers().get("cookie")`(없으면 `""`)를 그대로 `cookie` 헤더에 실어 `${process.env.API_BASE_URL}${path}`를 호출. 응답이 401이면 `redirect()`를 직접 호출하지 않고 `{ kind: "unauthenticated", redirectTo: "/gate?reason=expired&next=" + encodeURIComponent(currentPath) }`를 반환(기본 `currentPath = "/"`, `next/navigation`은 이 모듈에서 **아예 import하지 않음** — 호출부 책임) |

**GateForm 접근성 계약(변경 없음)**: `getByRole("textbox", { name: "이메일" })` / `getByRole("button", { name: "제출" })`. (RTL 테스트는 role/label로 상호작용하므로 `submitForm` 리네임의 영향 없음 — 함수명을 직접 참조하는 테스트 코드 자체가 없다)

**`apps/web/src/app/api/gate/verify/route.ts`, `apps/web/src/lib/authenticatedFetch.ts`, `apps/web/src/lib/forwardedApiFetch.ts`(중간 산출물, 실제로 만들어진 적 없음)는 더 이상
대상이 아니다** — developer 단계에서 새로 만들 필요 없음(오히려 남아있다면 삭제 대상).

**신규 dependency**: `apps/web/package.json`에 `server-only`(`^0.0.1`) 추가 후 `pnpm install`로 설치
완료(test-architect 단계에서 미리 추가 — 이유는 0-2절 하단 참고).

---

## 2. 테스트 케이스 목록

### 2-1. `apps/api`

#### `lib/userLookup.test.ts` (3, 무변경 로직 / 필드명만 리네임) — 정상 1 / 엣지 1 / 에러 1

| # | 테스트명 | 상태 |
| - | --- | --- |
| 1 | 일치하는 row가 있으면 `{ user, isFailedQuery: false }`를 반환한다 | Red(구현이 아직 `queryFailed` 사용) |
| 2 | 일치하는 row가 없으면(0건) `{ user: null, isFailedQuery: false }`를 반환한다 | Red |
| 3 | 조회 자체가 실패하면(커넥션 오류 등) `{ user: null, isFailedQuery: true }`를 반환한다 | Red |

#### `routes/auth.test.ts` (13, 9→13) — 정상 3(+2) / 엣지 7(+1) / 에러 3(+1)

**요청 경로는 전부 `/api/sessions`(구 `/api/auth/verify-email`), 성공 상태코드는 전부 `201`
(구 `200`)로 갱신되어 있다.** 이 재명명으로 인해 아래 1/4/10번(구현이 아직 200을 반환)이
새로 Red가 되었다 — 승인 전에는 Green이었던 항목이다.

| # | 테스트명 | 상태 |
| - | --- | --- |
| 1 | 등록된 이메일이면 **201**과 `{ verified: true }`만 반환한다(id 미노출) | Red(구현이 아직 200/구 경로) |
| 2 | **[신규]** 성공(**201**) 시 `dic_visitor_email` Set-Cookie를 name/httpOnly/sameSite/path/maxAge(정확히 15552000초) 기준으로 발급한다(개발 환경: secure 없음) | Red |
| 3 | **[신규]** `NODE_ENV=production`이면 Set-Cookie에 `secure` 속성이 포함된다 | Red |
| 4 | 대소문자/앞뒤 공백 정규화 후 대조한다(상태코드 **201** 확인 포함) | Red(구현이 아직 200) |
| 5 | **[신규]** 정규화 성공 시 쿠키 값도 정규화된(trim+lowercase) 이메일이다 | Red |
| 6 | `email` 필드 자체가 없으면 400 `email_required`, DB 미조회 | Green |
| 7 | 공백만 입력하면 400 `email_required` | Green |
| 8 | 이메일 형식이 아니면 400 `invalid_email_format`, DB 미조회 | Green |
| 9 | 정규화 후 254자 초과면 400 `invalid_email_format`(경계값) | Green |
| 10 | 3회 연속 실패 후 4번째 정상 이메일 → 잠금 없이 정상 성공(재시도 무제한, 상태코드 **201** 확인 포함) | Red(구현이 아직 200) |
| 11 | `users`에 없는 이메일 → 401 `email_not_found`, **쿠키 미발급** | Green(쿠키 미발급 단언은 이미 자연히 만족) |
| 12 | `isFailedQuery: true` → 500 `internal_error`(`email_not_found`로 오분류하지 않음), **쿠키 미발급** | Red(필드명 리네임 미반영) |
| 13 | **[신규]** `email_required`(400)로 실패하면 쿠키를 발급하지 않는다 | Green |

> 경로 자체는 마운트 위치(`app.use("/api/sessions", authRouter)`)만 바뀌므로, 라우터
> 내부 로직(`routes/auth.ts`)이 마운트 경로를 참조하지 않는 한 400/401/500 케이스는 경로
> 변경만으로는 깨지지 않는다(실제로 6~9, 11번은 여전히 Green) — 승인 전 상태코드
> 200→201 변경만 새로운 Red를 유발했다.

#### `middleware/requireAuthenticatedUser.test.ts` (7, 전면 재작성, 4→7) — 정상 1 / 엣지 2 / 에러 4

| # | 테스트명 | 상태 |
| - | --- | --- |
| 1 | `dic_visitor_email` 쿠키 값과 일치하는 user를 반환하면 `req.user` 설정 후 진행 | Red(구현이 아직 헤더 기준) |
| 2 | Cookie에 `dic_visitor_email`이 아닌 다른 쿠키만 있으면 401, 미호출 | Green(우연히 만족 — 헤더 기준이든 쿠키 기준이든 값 자체가 없어 401) |
| 3 | `dic_visitor_email=`(빈 값)이면 헤더/쿠키 부재와 동일하게 401, 미호출 | Green(우연히 만족) |
| 4 | Cookie 헤더 자체가 없으면 401, 미호출 | Green |
| 5 | **[신규]** `x-user-email` 헤더만 있고 Cookie가 없으면 401(하위호환 없음 — 헤더는 더 이상 확인하지 않음) | Red(구현이 아직 헤더를 확인) |
| 6 | `user: null`(0건) → 401 `unauthorized` | Green |
| 7 | `isFailedQuery: true`여도 500이 아닌 401 `unauthorized`(리팩터링 동등성 보장 핵심 테스트) | Green(미들웨어는 `user` 유무만 보고 분기하므로 필드명과 무관하게 통과) |

> 이 파일은 `cookie-parser`(신규 dependency, `apps/api/package.json`에 추가)를 로컬 테스트
> 앱에도 등록해 `req.cookies`를 채운다 — app.ts의 전역 등록 여부와 독립적으로 미들웨어 자체를
> 격리 검증한다.

#### `app.test.ts` (10, 3→10, **전면 재작성**) — 라우트 배선 4(0-4절) + CORS 정책 6(정상 2 / 엣지 2 / 에러 2)

`requireApiKey`가 완전히 삭제되므로(스펙 결정 #7) 순서 검증 개념 자체가 사라졌다. 아래
1~4번이 구 3건을 대체한다(0-4절에 상세 배경).

| # | 테스트명 | 상태 |
| - | --- | --- |
| 1 | `POST /api/sessions`는 인증(쿠키) 없이도 도달 가능하다(게이트 엔드포인트는 정의상 미인증) | Red(구현이 아직 200/구 경로) |
| 2 | **[대체]** 게이트 쿠키가 없으면 `GET /api/questions/today`는 401을 반환한다(구: "x-api-key 헤더가 없으면 401") | Green(구현이 여전히 `requireApiKey`로 401을 내므로 우연히 통과 — developer가 쿠키 기준으로 바꿔도 계속 통과해야 함) |
| 3 | **[신규]** 유효한 게이트 쿠키가 있으면 x-api-key 헤더 없이도 `GET /api/questions/today`가 200을 반환한다(`requireApiKey` 완전 삭제 이후, 스펙 AC 반영) | Red(구현이 아직 `requireApiKey`를 거치므로 x-api-key 없이는 무조건 401) |
| 4 | `/api/sources/resume`는 Cookie 헤더가 없으면 401을 반환한다(로직 변경 없음, 설명 주석만 갱신) | Green |
| 5 | `ALLOWED_ORIGINS`에 포함된 Origin 요청 → `Access-Control-Allow-Origin`/`-Credentials` 헤더 포함 | Red(cors 미등록) |
| 6 | 쉼표로 구분된 여러 `ALLOWED_ORIGINS` 중 하나와 일치하면 허용(trim) | Red |
| 7 | Origin 헤더 없는 비브라우저 호출은 CORS와 무관하게 정상 처리(설명 주석: "x-api-key 부재" → "게이트 쿠키 부재"로 갱신) | Green(현재도 차단하지 않으므로 우연히 만족 — cors 도입 후에도 계속 통과해야 하는 회귀 테스트) |
| 8 | `ALLOWED_ORIGINS` 미설정(fail-closed) → CORS 헤더 미부여 | Green(우연히 만족, 회귀 테스트로 유지) |
| 9 | 허용 목록에 없는 Origin → 500이 아니라 CORS 헤더 생략으로 처리(설명 주석 갱신) | Green(우연히 만족, 회귀 테스트로 유지) |
| 10 | 허용되지 않는 Origin에서 `POST /api/sessions` 호출해도 요청 자체는 **201**(구 200), CORS 헤더만 없음 | Red(구현이 아직 200/구 경로) |

> 7~9번은 "cors 미들웨어가 아직 없다"는 현재 상태에서 이미 참이라 우연히 Green이지만,
> **cors 도입 후에도 반드시 계속 통과해야 하는 회귀 방지 테스트**다(허용되지 않은 origin이
> 500을 유발하거나, 비브라우저 호출이 차단되는 회귀를 막는다). 2/4/7/8/9번은 "레거시
> `requireApiKey`가 아직 삭제되지 않은 현재 구현"에서도 결과적으로 같은 401/차단 동작이
> 나오기 때문에 우연히 Green이지만, `requireApiKey` 삭제 + 쿠키 통일 이후에도 반드시 같은
> 결과를 내야 하는 회귀 방지 테스트로 남긴다.

#### `routes/resume.test.ts` (21, 무변경) — 전체 회귀 없음 확인, 그대로 통과

---

### 2-2. `apps/web`

#### `lib/visitorCookie.test.ts` (9, 11→9) — 정상 2 / 엣지 7

`VISITOR_COOKIE_NAME` 상수 검증 1건 + `isValidVisitorEmailCookieValue` 정상 1건 + 엣지 7건
(undefined/null/빈문자열/형식오류/공백포함/254자 경계 유효/255자 경계 초과 무효).
`buildVisitorCookieOptions` 관련 2건은 **삭제**(apps/api로 이전).

#### `lib/sanitizeNextPath.test.ts` (9, 무변경) — 그대로 통과

#### `middleware.test.ts` (7, 무변경) — 그대로 통과

#### `app/gate/page.test.tsx` (8, 무변경) — 그대로 통과

#### `app/gate/GateForm.test.tsx` (7, 전면 재작성, 5→7) — 정상 1 / 엣지 2 / 에러 4

| # | 테스트명 | 상태 |
| - | --- | --- |
| 1 | 이메일 제출 시 `${NEXT_PUBLIC_API_BASE_URL}/api/sessions`(구 `/api/auth/verify-email`)을 `credentials:"include"`로 직접 호출, 성공(모킹 응답 **201**) 시 `router.replace(nextPath)` | Red(구현이 아직 `/api/gate/verify` 상대경로 호출) |
| 2 | 제출 중(pending) 버튼 비활성화 | Green |
| 3 | 실패 후 즉시 재입력·재제출 가능(잠금 없음) | Green |
| 4 | 서버 `error`/`message`를 폼 아래에 그대로 표시(`email_not_found` 사례) | Green |
| 5 | **[변경]** apps/api 자체가 무응답(네트워크 단절)이면 fetch 예외 → 안내 메시지(v1의 502 `upstream_unreachable` 상태코드 개념 삭제) | Red(구현에 try/catch 없음) |
| 6 | **[신규]** CORS 정책 위반으로 브라우저가 fetch를 예외 처리해도 네트워크 단절과 동일한 안내(구분 불가가 알려진 제약사항) | Red |
| 7 | **[신규]** 응답 JSON 파싱 실패(deserialize 실패)도 동일한 안내 메시지(fetch+json()을 하나의 try/catch로 처리) | Red |

#### `lib/apiClient.test.ts` (15, 신규 — 최종 SSR 헬퍼 설계) — 정적 계약 3 / 정상 7(`it.each` 4건 포함) / 엣지 3 / 에러 2

| # | 테스트명 | 상태 |
| - | --- | --- |
| 1 | 파일 최상단에 `import "server-only"`가 있다(소스 텍스트 정적 검사) | Red(모듈 없음) |
| 2 | `next/navigation`을 import하지 않는다(소스 텍스트 정적 검사 — `redirect()`는 호출부 책임) | Red |
| 3 | 내부 공용 함수 `request`를 export하지 않는다(소스 텍스트 정적 검사 — 캡슐화 계약) | Red |
| 4 | `apiGet`/`apiPost`/`apiPut`/`apiDelete`가 각각 GET/POST/PUT/DELETE 메서드로 `fetch`를 호출한다(`it.each` 4건) | Red |
| 5 | 들어온 요청의 Cookie 헤더를 그대로 apps/api 요청에 실어 보낸다 | Red |
| 6 | 401이 아닌 응답이면 `{ kind: "ok", response }`를 반환한다 | Red |
| 7 | 404 등 401이 아닌 에러 응답도 가공 없이 `{ kind: "ok", response }`로 전달한다 | Red |
| 8 | `currentPath`를 생략하면 기본값 `"/"`를 기준으로 `redirectTo`를 만든다(401 상황) | Red |
| 9 | `currentPath`를 지정하면 `redirectTo`에 그 경로가 인코딩되어 반영된다 | Red |
| 10 | `init`으로 전달한 기존 헤더/바디를 유지하면서 `cookie` 헤더를 추가한다 | Red |
| 11 | Cookie 헤더 자체가 없으면(`headers().get("cookie")`가 `null`) 빈 문자열을 그대로 전달한다 | Red |
| 12 | 401 응답을 받아도 `next/navigation`의 `redirect()`를 직접 호출하지 않는다(동적 mock으로 재확인 — 정적 계약 2번과 이중 검증) | Red |

> `apiClient` 모듈 자체가 아직 없어 파일 로드 시점에 전체가 실패한다(개별 `it` 단위 실패가
> 아니라 파일 단위 실패로 보고됨, `it.each` 4건 포함 실제로는 15개 `it`) — 모듈이 생기는 즉시
> 전부 정상적으로 수집·실행된다. `server-only` 패키지는 실제로 설치했으므로(`apps/web/package.json`)
> 모듈이 생기면 그 즉시 정상 동작한다(빈 모듈로 모킹하는 방식은 Vite의 정적 import 분석 단계
> 에서 실패해 동작하지 않음을 확인했다 — 아래 4절 참고).

#### `app/api/gate/verify/route.test.ts`, `lib/authenticatedFetch.test.ts`, `lib/forwardedApiFetch.test.ts` — **삭제됨**(파일 자체 제거, 실행 대상 아님)

---

## 3. 실행 결과 (TDD Red 확인, 재현 명령 포함)

### `apps/api`

```
pnpm --filter @daily-interview-coach/api test

 ❯ src/lib/userLookup.test.ts (3 tests | 3 failed)        ← isFailedQuery 리네임 미반영(구현이 queryFailed 유지)
 ❯ src/middleware/requireAuthenticatedUser.test.ts (7 tests | 2 failed)  ← 쿠키 기준 재작성 미반영
 ❯ src/routes/auth.test.ts (13 tests | 7 failed)          ← Set-Cookie 미발급 + isFailedQuery 리네임
                                                             + 200→201/구경로 미반영(신규 Red 3건)
 ✓ src/routes/resume.test.ts (21 tests)                   ← 무변경, 전부 통과(회귀 없음)
 ❯ src/app.test.ts (10 tests | 5 failed)                  ← CORS 미등록(2건) + requireApiKey 미삭제
                                                             + 200→201/구경로 미반영(신규 Red 3건)

 Test Files  4 failed | 1 passed (5)
      Tests  17 failed | 37 passed (54)
```

**직전(승인 요청 시점) 대비 변화**: 11 Red/42 Green → **17 Red/37 Green**(총 53→54개 — `app.test.ts`에
"유효한 쿠키 있으면 200" 케이스 1건이 신규로 추가됨). 늘어난 Red 6건은 전부 이번에 반영한
두 변경(엔드포인트 재명명 + `requireApiKey` 삭제) 때문이며, 새로운 버그나 회귀가 아니다 —
"승인 전에는 Green이었지만 스펙이 바뀌어 구현도 함께 바뀌어야 Green으로 돌아오는" 항목들이다.

### `apps/web`

```
pnpm --filter @daily-interview-coach/web test

 ✓ src/middleware.test.ts (7 tests)
 ❯ src/lib/apiClient.test.ts (0 test)                     ← 모듈 자체가 없어 파일 로드 실패
 ✓ src/lib/sanitizeNextPath.test.ts (9 tests)
 ✓ src/lib/visitorCookie.test.ts (9 tests)                ← buildVisitorCookieOptions 테스트 제거 반영
 ✓ src/app/gate/page.test.tsx (8 tests)
 ❯ src/app/gate/GateForm.test.tsx (7 tests | 4 failed)    ← 직접 호출/에러통합 미반영(경로도 /api/sessions로 갱신)

 Test Files  2 failed | 4 passed (6)
      Tests  4 failed | 36 passed (40)
```

`apps/web`의 Red/Green 카운트는 엔드포인트 재명명 반영 전후로 **변화 없음**(4 Red/36 Green) —
`GateForm.test.tsx`는 애초에 경로 하드코딩 부분이 이미 Red였던 테스트 안에 있었기 때문에,
경로만 `/api/sessions`로 바뀌었을 뿐 Red/Green 여부 자체는 그대로다.

두 실행 모두 재현했다. 신규/수정 테스트는 대상 구현이 아직 v1 상태(또는 부재)이므로 기대대로
Red다. "그대로 유지" 대상으로 분류된 4개 web 테스트 파일과 `resume.test.ts`(21개)는 이번
변경으로 전혀 영향받지 않고 그대로 통과함을 재실행으로 확인했다.

**`apiClient.test.ts` 검증 방법(임시 스텁 사용, 최종 결과물에는 구현 코드 없음)**: test-architect는
구현 코드를 작성하지 않지만, 테스트 자체의 assertion 로직이 실제로 올바른지(단순 오탈자로 인한
거짓 Green/거짓 Red가 없는지) 확인하기 위해 스펙의 코드 스니펫을 그대로 옮긴 임시 `apiClient.ts`
스텁을 잠시 만들어 `pnpm --filter web test`로 15개 전부 GREEN임을 확인한 뒤 즉시 삭제했다.
저장소에는 스텁 파일이 남아있지 않다(`git status`로 재확인).

---

## 4. 이번 단계에서 추가한 것 (test-architect 범위 내 최소 변경)

- **`apps/api/package.json`**: `cookie-parser`(dependencies), `@types/cookie-parser`(devDependencies)
  추가 후 `pnpm install`로 실제 설치 완료. `requireAuthenticatedUser.test.ts`가 격리된 로컬
  Express 앱에서 `req.cookies`를 채우려면 필요(프로덕션 `app.ts`도 동일 패키지를 쓰게 될 것 —
  스펙 "CORS/쿠키 파싱" 절). `cors`/`@types/cors`는 테스트 파일이 직접 import하지 않으므로
  이번 단계에서는 추가하지 않았다(app.ts 구현 시 developer가 추가).
- **`apps/web/package.json`**: `server-only`(`^0.0.1`, dependencies) 추가 후 `pnpm install`로 실제
  설치 완료. **처음에는 `vi.mock("server-only", () => ({}))`로 빈 모듈 모킹만으로 우회하려
  시도했으나, Vite의 정적 import 분석 단계(`vite:import-analysis` 플러그인)가 `vi.mock`의 런타임
  개입보다 먼저 바깥 스코프에서 그 특수문자열(bare specifier)을 실제로 해석하려 시도해 즉시
  `Failed to resolve import "server-only"` 에러를 내는 것을 확인**했다 — 그래서 실제 패키지를
  설치하는 쪽으로 방향을 바꿨다(패키지 자체가 611바이트로 매우 작고, developer 단계에서도
  어차피 실제 프로덕션 의존성으로 필요하므로 선반영에 리스크가 없다고 판단).
- **`apps/api/src/test-utils/setCookie.ts`(신규, 테스트 헬퍼)**: `Set-Cookie` 헤더 파싱
  (`parseSetCookie`)과 이름으로 찾기(`findSetCookie`)를 한 곳에 응집시켰다. `routes/auth.test.ts`
  가 이를 재사용하며, 향후 쿠키 발급/검증이 필요한 테스트(로그아웃, 쿠키 갱신 등)가 추가될 때
  파싱 로직을 파일마다 중복 작성하지 않아도 된다. `describe`/`it`이 없어 vitest가 테스트
  파일로 수집하지 않는다(파일명이 `*.test.ts`가 아님).

## 5. developer 인계 시 반드시 전달할 것

1. `apps/api/src/lib/userLookup.ts`, `routes/auth.ts`, `middleware/requireAuthenticatedUser.ts`의
   `queryFailed` 필드를 **`isFailedQuery`로 리네임**해야 한다(0-1절).
2. **[신규]** `apps/api/src/routes/auth.ts`의 마운트 경로를 `/api/sessions`로 변경(라우터
   파일 경로/내부 함수명은 유지, `app.ts`에서 `app.use("/api/sessions", authRouter)`), 성공
   응답 상태코드를 `200` → `201`로 변경(0-3절). 400/401/500은 그대로.
3. **[신규]** `apps/api/src/app.ts`에서 **`requireApiKey` 함수 정의와 `app.use("/api", requireApiKey)`
   등록을 완전히 삭제**하고, `app.get("/api/questions/today", ...)` 앞에 `requireAuthenticatedUser`
   를 직접 체이닝한다(`/api/sources/resume`와 동일 패턴, 0-4절). 이후 `/api/*` 전체가 게이트
   쿠키 인증 하나로 통일된다.
4. `apps/api/src/app.ts`에 `cors`(+`@types/cors`, 신규 설치 필요)와 `cookie-parser`(이미 설치됨)를
   라우팅 이전에 전역 등록.
5. `apps/api/src/lib/visitorCookie.ts`(신규)와 `routes/auth.ts`의 `res.cookie(...)` 추가 —
   **`maxAge`는 밀리초 단위**(`15552000 * 1000`)로 넘겨야 한다.
6. `apps/web/src/app/gate/GateForm.tsx`를 apps/api 직접 호출(`fetch` 대상은 **`/api/sessions`**,
   `credentials:"include"`) + try/catch 통합 에러 처리로 변경. 제출 핸들러 함수명은
   `submitForm`으로 명명(0-2절 — `handle` 접두사 컨벤션 금지).
7. `apps/web/src/lib/apiClient.ts` **신규 작성**(⚠️ `forwardedApiFetch.ts`가 아니다 — 그 설계는
   중간 산출물로 폐기됨). 클래스가 아닌 함수형, 공개 인터페이스는 `apiGet`/`apiPost`/`apiPut`/
   `apiDelete` 4개뿐(내부 `request`는 export하지 않음), 반환 타입은 `Response`가 아니라 판별
   유니온 `ApiResult`. 파일 최상단에 `import "server-only";` 필수. `next/navigation`은
   import하지 않는다(401이어도 `redirect()`를 직접 호출하지 않고 `{ kind: "unauthenticated",
   redirectTo }`를 반환 — 실제 `redirect()` 호출은 호출부 책임). `server-only` 패키지는 이미
   `apps/web/package.json`에 추가·설치되어 있다.
8. `apps/web/src/lib/visitorCookie.ts`에서 `buildVisitorCookieOptions`/`VisitorCookieOptions`/
   `VISITOR_COOKIE_MAX_AGE_SECONDS` export 제거.
9. `apps/web/src/app/api/gate/verify/route.ts`, `apps/web/src/lib/authenticatedFetch.ts`는 이미
   파일이 삭제되었으므로 다시 만들지 않는다. `forwardedApiFetch.ts`도 처음부터 만들어진 적이
   없으므로(테스트만 작성했다가 삭제) 신경 쓸 필요 없다.
10. `apps/api/.env.example`에 `ALLOWED_ORIGINS` 추가, **`API_KEY=` 제거**(`requireApiKey` 삭제로
    더 이상 참조되지 않음, 0-4절). `apps/web/.env.example`은 주석만 갱신(스펙 "환경변수" 절).
    `NEXT_PUBLIC_API_KEY`는 이미 코드에서 참조되지 않는 별개 잔재라 제거해도/유지해도 무방
    (developer 판단) — 이번 test-architect 단계에서는 `.env.example` 자체를 건드리지 않았다
    (테스트 대상이 아님).
11. **`CLAUDE.md`에 아래 두 네이밍 컨벤션이 추가될 예정이다(0-2절)** — test-architect는 이
    문서를 직접 수정할 권한이 없으므로(조직 가드레일: 서브에이전트 지시만으로 `CLAUDE.md`
    변경 불가, 사용자 본인 승인 필요), developer가 실제 반영 시 참고하거나 사용자에게 반영을
    요청해야 한다:
    - 함수명은 `handle` 접두사 대신 동사+목적어(`handleSubmit` → `submitForm`).
    - 불리언 변수/필드명은 `is` 접두사(예: `isFailedQuery`, `isSubmitting`).
