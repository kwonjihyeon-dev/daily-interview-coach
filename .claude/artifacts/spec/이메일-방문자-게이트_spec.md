# 기능 명세: 이메일 기반 방문자 게이트

## 개요

`daily-interview-coach`는 사용자 본인 1인 전용 도구지만, URL만 알면 누구나 접속해 기존 유저 데이터(이력서, 답변, 피드백)에 뒤섞여 쓸 수 있는 상태다. 이 기능은 브라우저 방문자가 앱의 어떤 화면에도 접근하기 전에 **이메일 입력 → `users` 테이블 대조 → httpOnly+Secure 쿠키 발급**의 게이트를 통과하게 하고, 이후 모든 화면이 이 쿠키를 근거로 `apps/api`를 호출할 수 있게 하는 **프론트엔드(Next.js) + 최소한의 백엔드(apps/api) 보강**을 다룬다.

`apps/api/src/middleware/requireAuthenticatedUser.ts`(`x-user-email` 헤더 → `users` 테이블 대조 → 401/`req.user`)는 이미 구현되어 있고 **변경하지 않는다.** 이 스펙은 그 앞단, 즉 "브라우저가 처음 왔을 때 이메일을 어떻게 확인하고, 확인 후 무엇을 들고 다니는가"를 정의한다. Phase 3의 모든 화면(온보딩, 오늘의 질문 등)은 이 기능이 완료된 뒤에야 실제로 동작할 수 있다.

## 아키텍처 결정 사항 (열린 질문 7개에 대한 답)

| # | 질문 | 결정 | 근거 |
| --- | --- | --- | --- |
| 1 | Next.js가 `users` 테이블을 조회하는 방법 | **(b) `apps/api`에 새 엔드포인트 `POST /api/auth/verify-email`을 추가하고 Next.js는 이걸 호출** | (a)는 `SUPABASE_SERVICE_ROLE_KEY`(강력한 관리자 키)를 `apps/web`에도 중복 보관해야 하고, DB 조회 로직이 두 코드베이스에 흩어져 드리프트 위험이 생김. PRD 3.3이 이미 "API 경계를 명확히 두기 위해" `apps/web`/`apps/api`를 분리했으므로, DB 접근은 `apps/api`로만 좁히는 쪽이 그 결정과 일관됨. 다만 기존 `requireAuthenticatedUser`의 조회 로직을 그대로 복사하지 않고, `apps/api` 내부에 공유 헬퍼(`lookupUserByEmail`)로 추출해 두 곳(기존 미들웨어 + 신규 엔드포인트)이 재사용한다 |
| 2 | 이메일이 `users`에 없을 때 문구/재시도 | "등록되지 않은 이메일입니다. 접근 권한이 있는 이메일인지 확인해주세요." 재시도 **횟수 제한 없음**, 즉시 재입력 가능 | 1인 개인 프로젝트, 별도 계정 잠금·쿨다운을 둘 이유가 없음(YAGNI). 다만 엔드포인트 자체가 "이 이메일이 등록돼 있는가"를 무제한으로 확인해줄 수 있다는 점은 알려진 제약사항으로 하단에 명시 |
| 3 | 쿠키 만료 정책 | **고정 180일(15,552,000초), 발급 시점부터 절대 만료.** 요청마다 갱신(sliding)하지 않음 | 매일 쓰는 습관 앱이라 반복적인 재로그인 없이 오래 편하게 써야 한다는 실사용 편의성 요구가 있음. 그렇다고 무기한 유지하면 "재검증 기회" 자체가 사라져 DB에서 유저를 지워도 영원히 통과되는 상황이 생김 — 180일(약 6개월)마다 재입력을 강제해 최소한의 재검증 지점을 둔다 |
| 4 | 로그아웃 기능 | **사용자가 직접 누르는 "로그아웃" 버튼(만료 전에 즉시 쿠키를 지우는 수동 기능)은 스코프 외.** 반면 **쿠키 `maxAge`(180일) 도달에 따른 자동 세션 종료(쿠키가 만료되어 미들웨어가 `/gate`로 리다이렉트하는 것)는 별도 구현이 필요 없는, 이 기능에 이미 포함된 동작**이다. 이 둘은 서로 다른 메커니즘이므로 "로그아웃"이라는 한 단어로 뭉뚱그리지 않는다 | 1인 사용자라 계정을 즉시 전환하거나 만료 전에 강제로 세션을 끊어야 할 요구가 없음(YAGNI). 자동 만료는 쿠키 표준 속성(`maxAge`)만으로 이미 동작하므로 "로그아웃 기능을 만들지 않는다"는 결정과 모순되지 않음 — 만들지 않는 것은 어디까지나 "사용자가 능동적으로 누르는 버튼"이다. 필요해지면 수동 로그아웃 버튼은 별도 기능(쿠키 삭제 Route Handler + UI 버튼)으로 추가하면 됨 |
| 5 | 가드 페이지 경로 / 리다이렉트 방식 | 경로 `/gate`. `apps/web/src/middleware.ts`가 보호 대상 경로 전체에서 쿠키 부재/형식 이상을 감지하면 `307` 리다이렉트로 `/gate?next=<인코딩된 원래 경로>` 이동 | Next.js 표준 미들웨어 패턴. `/gate` 자체와 정적 자산(`_next`, `favicon.ico`, `manifest.json`, `sw.js`, `icons/*`)은 매처에서 제외해 리다이렉트 루프 방지 |
| 6 | 통과 후 원래 페이지 복귀 여부 | **복귀함.** `next` 쿼리 파라미터로 원래 경로를 들고 다니고, 검증 성공 시 그 경로로 이동. 파라미터가 없거나 안전하지 않으면 `/`로 폴백 | 사용자가 예: PWA 푸시 알림을 눌러 특정 화면으로 오려다 게이트에 걸린 경우, 홈으로 보내면 다시 이동해야 하는 불필요한 단계가 생김 |
| 7 | 쿠키 값이 이메일 그대로라 devtools로 보이는 것이 문제인가 | **문제 아님으로 판단, 별도 암호화/서명 없음** | (a) 서버(`apps/api`의 `requireAuthenticatedUser`)가 요청마다 `users` 테이블로 재검증하므로, 쿠키 값을 다른 문자열로 바꿔도 그 문자열이 실제 `users.email`과 일치하지 않으면 401로 막힌다 — 변조로 다른 정상 계정을 흉내낼 수 없다. (b) `users` 테이블에는 사실상 유저가 1명뿐이라, 그 1명의 이메일 값을 안다고 해서 얻는 것(다른 사람 데이터 열람 등)이 없다 — 애초에 데이터가 1인분뿐. (c) 이메일 자체가 비밀번호 수준의 비밀값이 아니라는 점은 PRD 3.7에 이미 기록된 한계이며 이 프로젝트 규모에서 감수하기로 한 결정 |

## 상세 명세

### 전체 아키텍처 원칙

**브라우저 JS는 `apps/api`의 존재를 모른다.** 모든 `apps/api` 호출은 Next.js 서버(Route Handler/Server Component)를 경유한다. 이는 이번 기능이 확립하는 전제이며, 향후 화면(이력서 업로드 UI 등)도 이 원칙을 따라 브라우저 → Next.js Route Handler → `apps/api`로 프록시해야 한다.

```
브라우저 ──(쿠키만 자동 전송)──▶ Next.js 서버
                                     │ (쿠키 값을 x-user-email 헤더로 변환)
                                     ▼
                                  apps/api  ──▶ users 테이블 재검증
```

### 백엔드 보강: `POST /api/auth/verify-email` (신규)

```
POST /api/auth/verify-email
Content-Type: application/json
Body: { "email": string }
```

| 순서 | 검증 | 실패 시 상태코드 | 에러 코드 | 메시지 |
| --- | --- | --- | --- | --- |
| 1 | `email` 필드 존재, `trim()` 후 길이 > 0 | 400 | `email_required` | "이메일을 입력해주세요." |
| 2 | `trim()` + `toLowerCase()` 정규화 후, 정규식 `^[^\s@]+@[^\s@]+\.[^\s@]+$` 매치 && 길이 ≤ 254자 | 400 | `invalid_email_format` | "올바른 이메일 형식이 아닙니다." |
| 3 | `users` 테이블에서 정규화된 이메일과 정확히 일치(`=`)하는 row 존재 (`lookupUserByEmail` 헬퍼 사용) — DB 조회 자체가 실패(커넥션 오류 등)한 경우와 "결과 0건"을 구분 | 조회 실패: 500 / 0건: 401 | 조회 실패: `internal_error` / 0건: `email_not_found` | 500: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." / 401: "등록되지 않은 이메일입니다. 접근 권한이 있는 이메일인지 확인해주세요." |
| 4 | 성공 | — | — | — |

**성공 응답 (200)**: `{ "verified": true }` (유저 `id`는 응답에 포함하지 않는다 — 쿠키/헤더 값은 이메일 문자열만으로 충분하고, 클라이언트에 내부 식별자를 노출할 이유가 없다)

**공유 헬퍼**: `apps/api/src/lib/userLookup.ts`에 `lookupUserByEmail(email: string): Promise<{ user: { id: string; email: string } | null; queryFailed: boolean }>`를 추가한다.
- `requireAuthenticatedUser`는 이 헬퍼로 내부 쿼리를 교체하되, **외부에서 관찰되는 동작은 절대 바꾸지 않는다** — `user === null` 이든 `queryFailed === true` 이든 기존과 동일하게 401 `unauthorized`로 응답한다(기존 `resume.test.ts`가 그대로 통과해야 함).
- `/api/auth/verify-email`은 같은 헬퍼를 쓰지만 `queryFailed`와 `user === null`을 구분해 500/401을 다르게 응답한다.

**라우팅 순서**: `app.ts`에서 `app.use("/api/auth/verify-email", authRouter)`는 `/api/sources/resume`와 같은 위치(=`app.use("/api", requireApiKey)` **이전**)에 등록한다. 이 엔드포인트는 정의상 미인증 방문자가 호출하므로 구버전 `requireApiKey`나 `requireAuthenticatedUser`를 통과할 수 없다.

**알려진 제약사항**: 이 엔드포인트를 `apps/api` 주소를 직접 알아낸 외부인이 반복 호출하면 "어떤 이메일이 등록돼 있는지" 알아내는 이메일 열거(enumeration)에 쓰일 수 있다. Rate limit·CAPTCHA는 이번 스코프에 넣지 않는다 — `apps/api`가 현재도 인증 없이 직접 호출 가능하다는 전제(PRD 3.7의 기존 수용된 한계) 위에 있고, 개인 프로젝트 노출도 대비 실용적 선택으로 판단.

### 쿠키 명세

| 속성 | 값 |
| --- | --- |
| 이름 | `dic_visitor_email` |
| 값 | 정규화된(trim+lowercase) 이메일 문자열 (평문, 서명·암호화 없음 — 근거는 결정 사항 #7) |
| `httpOnly` | `true` |
| `secure` | `true` (프로덕션). 로컬 개발(`NODE_ENV !== "production"`)에서는 `false` — `http://localhost`에서 `Secure` 쿠키가 저장되지 않는 브라우저 조합이 있어 개발 편의를 위해 예외 |
| `sameSite` | `"lax"` |
| `path` | `/` |
| `maxAge` | `15552000` (180일, 초 단위), 절대 만료(발급 시점 기준, 요청마다 갱신 안 함) |

**참고**: `maxAge`가 지나 브라우저가 쿠키를 자동 폐기하면, 다음 방문 시 미들웨어가 쿠키 부재로 판단해 `/gate`로 리다이렉트한다 — 이는 결정 사항 #4에서 설명한 "자동 세션 종료"이며 이 표의 `maxAge` 설정만으로 이미 동작이 보장된다(추가 로직 불필요).

### `apps/web/src/middleware.ts`

- 매처: `/gate`, `/_next/*`, `/favicon.ico`, `/manifest.json`, `/sw.js`, `/icons/*`를 제외한 모든 경로.
- 쿠키 `dic_visitor_email`을 읽어 다음 조건을 **모두** 만족해야 "유효"로 간주(형식만 검사, DB 재조회는 하지 않음 — Edge 미들웨어에서 매 네비게이션마다 DB 호출을 하면 모든 페이지 전환에 지연이 생기므로, 실제 재검증은 `apps/api` 호출 시점에 위임):
  - 값이 존재하고 빈 문자열이 아님
  - 정규식 `^[^\s@]+@[^\s@]+\.[^\s@]+$` 매치
  - 길이 ≤ 254자
- 유효하지 않으면 `307` 리다이렉트: `/gate?next=<encodeURIComponent(원래 pathname+search)>`.
- 유효하면 `NextResponse.next()`로 통과.

### 게이트 페이지 (`apps/web/src/app/gate/page.tsx`)

- **Server Component.** 렌더링 전에 쿠키를 확인 — 이미 유효한(형식 검사 통과) 쿠키가 있으면 폼을 그리지 않고 즉시 `next`(안전성 검증 후) 또는 `/`로 리다이렉트한다.
- 유효 쿠키가 없으면 `<GateForm nextPath={sanitizedNext} reason={searchParams.reason} />` (Client Component)를 렌더링한다.
- `next` 안전성 검증(서버 사이드에서 수행, 오픈 리다이렉트 방지): 다음을 모두 만족해야 통과, 하나라도 위반하면 `/`로 대체.
  - 정확히 `/`로 시작
  - `//`로 시작하지 않음 (프로토콜 상대 URL 차단)
  - `://` 문자열을 포함하지 않음 (절대 URL 차단)
- `reason=expired`가 있으면 폼 위에 안내 배너("인증이 만료되었습니다. 이메일을 다시 입력해주세요.")를 표시한다. 그 외에는 배너 없음.

### 게이트 폼 (`GateForm`, Client Component)

- 이메일 입력 필드 1개 + 제출 버튼. 클라이언트 측 `required` + `type="email"`은 UX 보조일 뿐이며, 실제 검증은 서버(Route Handler → `apps/api`)에서 수행한다.
- 제출 시 `POST /api/gate/verify` (Next.js 자체 Route Handler, 아래 참고)로 `{ email }`을 보낸다.
- 성공(`200`): `router.replace(nextPath)`로 이동. 페이지 새로고침 없이 클라이언트 라우팅.
- 실패: 응답의 `error`/`message`를 그대로 폼 아래에 표시하고, 입력 필드는 그대로 편집 가능한 상태로 유지한다. **재시도 횟수 제한 없음.**
- 요청 중(pending)에는 제출 버튼을 비활성화해 중복 제출만 막는다(이중 요청 방지 목적, 시도 횟수 제한과는 무관).

### Next.js Route Handler (`apps/web/src/app/api/gate/verify/route.ts`)

- `POST`: body `{ email: string }`를 받아 `apps/api`의 `POST /api/auth/verify-email`을 서버 사이드에서 호출(base URL은 환경변수 `API_BASE_URL`, 하드코딩하지 않음).
- 업스트림 응답이 `200`이면: 쿠키 `dic_visitor_email`을 정규화된 이메일 값으로 발급(위 쿠키 명세 속성 적용)하고 `{ ok: true }`를 `200`으로 반환.
- 업스트림 응답이 `4xx`/`5xx`이면: 같은 상태코드와 `{ error, message }`를 그대로 클라이언트에 전달(쿠키 발급 안 함).
- 업스트림 호출 자체가 실패(네트워크 오류 등, `apps/api`가 응답하지 않는 경우): `502`, `{ "error": "upstream_unreachable", "message": "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." }`.

### 인증된 apps/api 호출 래퍼 (`apps/web/src/lib/authenticatedFetch.ts`)

- 이후 모든 기능(이력서 업로드 등)이 `apps/api`를 호출할 때 이 함수를 거친다.
- 동작: 쿠키 `dic_visitor_email` 값을 읽어 `x-user-email` 헤더로 실어 `apps/api`에 요청.
- 쿠키가 없으면: `apps/api`를 호출하지 않고 즉시 `/gate?next=<현재 경로>`로 리다이렉트(방어적 처리 — 정상 흐름에서는 미들웨어가 먼저 걸러내지만, Server Action 등 미들웨어 매처가 커버하지 않는 실행 경로에 대한 안전장치).
- `apps/api`가 `401`을 반환하면(쿠키는 형식상 유효했으나 그 사이 `users`에서 삭제된 경우 등): 쿠키를 삭제하고 `/gate?reason=expired&next=<현재 경로>`로 리다이렉트.

### 스코프 외

- **수동 "로그아웃" 버튼** (즉시 쿠키를 지우는 사용자 조작 기능, 결정 사항 #4). ※ 쿠키 `maxAge`(180일) 만료에 의한 **자동** 세션 종료는 이 스코프 외 항목과 다른 것으로, 이미 이 기능에 포함되어 동작한다 — 별도 구현이 필요한 것은 "사용자가 만료 전에 직접 끊는 버튼"뿐이다.
- 이메일 자체 인증(매직 링크, OTP 등) — 여전히 "존재 여부만 대조"하는 모델 유지.
- `verify-email` 엔드포인트에 대한 Rate limit/CAPTCHA.
- 쿠키를 지원하지 않거나 차단한 브라우저에 대한 감지·안내 — 알려진 제약사항으로만 기록.
- `users` 테이블에 신규 이메일을 추가하는 셀프서비스 가입 플로우(수동 DB 작업으로 유지).
- 미들웨어 단계에서의 실시간 DB 재검증(성능상 의도적으로 생략, 위 근거 참고).

## Acceptance Criteria

### 정상 시나리오

```
Given users 테이블에 등록된 이메일 "user@example.com"이 있고, 방문자가 쿠키 없이 "/"에 접근했다
When 미들웨어가 이를 감지해 "/gate?next=%2F"로 리다이렉트하고, 방문자가 "user@example.com"을 입력해 제출한다
Then POST /api/gate/verify가 200을 반환하고, dic_visitor_email 쿠키가 httpOnly=true, secure=true(프로덕션 기준), sameSite=lax, maxAge=15552000으로 발급된다
And 방문자는 "/"로 이동한다
```

```
Given users 테이블에 등록된 이메일이 있고, 방문자가 "/history"에 접근하려다 게이트로 리다이렉트됐다("/gate?next=%2Fhistory")
When 이메일을 정확히 입력해 제출한다
Then 검증 성공 후 "/history"로 이동한다 ("/"가 아님)
```

```
Given 방문자가 dic_visitor_email 쿠키를 이미 보유하고 있고 그 값이 이메일 형식을 만족한다
When 보호된 경로("/" 등)에 접근한다
Then 미들웨어가 리다이렉트하지 않고 요청을 그대로 통과시킨다
```

```
Given 방문자가 이미 유효한 형식의 dic_visitor_email 쿠키를 보유한 상태다
When "/gate"에 직접(주소창 입력 등으로) 접근한다
Then 폼이 렌더링되지 않고 즉시 "/"로 리다이렉트된다
```

```
Given 유효한 쿠키를 가진 방문자의 Next.js 서버가 apps/api를 호출해야 하는 상황이다
When authenticatedFetch가 호출된다
Then 실제 apps/api 요청 헤더에 "x-user-email: <쿠키에 저장된 정규화 이메일값>"이 정확히 포함된다
```

### 엣지 케이스

```
Given users 테이블에는 "user@example.com"(소문자)으로 저장돼 있고, 방문자가 " User@Example.com "(대소문자 혼용, 앞뒤 공백)을 입력한다
When 제출한다
Then 서버가 trim() + toLowerCase()로 정규화한 뒤 대조해 200을 반환하고, 발급되는 쿠키 값도 정규화된 "user@example.com"이다
```

```
Given 방문자가 dic_visitor_email 쿠키를 갖고 있지만 그 값이 "abc123"(이메일 형식이 아님)로 변조되어 있다
When 보호된 경로에 접근한다
Then 미들웨어가 이를 무효로 간주해 "/gate?next=..."로 리다이렉트한다
```

```
Given 방문자가 형식상 유효한 쿠키("user@example.com")를 갖고 있지만, 그 사이 관리자가 users 테이블에서 해당 row를 삭제했다
When Next.js 서버가 authenticatedFetch로 apps/api를 호출한다
Then apps/api가 401을 반환하고, authenticatedFetch가 쿠키를 삭제한 뒤 "/gate?reason=expired&next=..."로 리다이렉트한다
And 게이트 페이지에 "인증이 만료되었습니다. 이메일을 다시 입력해주세요." 배너가 표시된다
```

```
Given dic_visitor_email 쿠키가 발급된 지 180일(maxAge=15552000초)이 지나 브라우저가 쿠키를 자동으로 폐기한 상태다
When 방문자가 보호된 경로에 접근한다
Then (쿠키가 더 이상 요청에 실려오지 않으므로) 미들웨어는 "쿠키 없음"과 동일하게 처리해 "/gate?next=..."로 리다이렉트한다
And 이 동작은 별도의 로그아웃 기능 구현 없이 maxAge 속성만으로 발생한다 (결정 사항 #4)
```

```
Given 방문자가 "/gate?next=https://evil.com"으로 접근해 유효한 이메일을 제출한다
When 검증에 성공한다
Then next 값이 "://"를 포함해 안전하지 않은 것으로 판정되어 "/"로 리다이렉트된다 (evil.com으로 이동하지 않는다)
```

```
Given 방문자가 "/gate?next=//evil.com"으로 접근해 유효한 이메일을 제출한다
When 검증에 성공한다
Then next 값이 "//"로 시작해 안전하지 않은 것으로 판정되어 "/"로 리다이렉트된다
```

```
Given 방문자가 게이트 폼에 공백만 입력하고 제출한다
When POST /api/gate/verify가 호출된다
Then 400과 error="email_required", message="이메일을 입력해주세요."를 받고, 쿠키는 발급되지 않으며, 입력 필드는 편집 가능한 상태로 유지된다
```

```
Given 방문자가 게이트 폼에 "not-an-email"(형식이 이메일이 아님)을 입력하고 제출한다
When POST /api/gate/verify가 호출된다
Then 400과 error="invalid_email_format"을 받고, 쿠키는 발급되지 않으며, 재입력해 즉시 다시 제출할 수 있다
```

```
Given 방문자가 잘못된 이메일로 3회 연속 실패했다
When 네 번째로 올바른 이메일을 제출한다
Then 시도 횟수와 무관하게 정상적으로 검증에 성공하고 쿠키가 발급된다 (잠금·쿨다운 없음)
```

### 에러 케이스

```
Given 방문자가 users 테이블에 존재하지 않는 이메일 "nobody@example.com"을 제출한다
When POST /api/auth/verify-email이 호출된다
Then apps/api가 401과 error="email_not_found", message="등록되지 않은 이메일입니다. 접근 권한이 있는 이메일인지 확인해주세요."를 반환한다
And Next.js는 이를 그대로 전달하고 쿠키를 발급하지 않는다
And 게이트 폼은 재입력 가능한 상태로 유지된다
```

```
Given Supabase 커넥션 오류로 users 테이블 조회 자체가 실패하는 상태다
When 유효한 형식의 이메일로 POST /api/auth/verify-email이 호출된다
Then lookupUserByEmail이 queryFailed=true를 반환하고, 엔드포인트는 500과 error="internal_error"를 반환한다 (email_not_found로 오분류되지 않는다)
And 쿠키는 발급되지 않는다
```

```
Given POST /api/auth/verify-email 요청 body에 email 필드 자체가 없다 (비정상 클라이언트의 직접 호출 등)
When 요청을 보낸다
Then 400과 error="email_required"를 받는다
```

```
Given apps/api 서버 자체가 응답하지 않는 상태다(네트워크 단절 등)
When 방문자가 게이트 폼에서 유효한 이메일을 제출한다
Then Next.js의 /api/gate/verify가 502와 error="upstream_unreachable"을 반환하고, 게이트 페이지에 "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."가 표시된다
And 쿠키는 발급되지 않는다
```

```
Given 방문자가 쿠키 없이 "/gate"가 아닌 임의의 보호된 경로("/history?filter=answered")에 접근한다
When 미들웨어가 이를 처리한다
Then "/gate?next=%2Fhistory%3Ffilter%3Danswered"로 307 리다이렉트되고 (쿼리스트링까지 보존), 검증 성공 시 그 경로로 정확히 복귀한다
```

## 일관성 검증 결과

- `packages/shared-types/src/index.ts`의 `Source`/`Question`/`Answer`/`AnswerFeedback`/`Streak`와 이름·필드 충돌 없음. 이 기능은 새로운 도메인 엔티티를 프론트엔드에 노출하지 않으므로(쿠키/헤더는 이메일 원시 문자열) `shared-types`에 신규 타입 추가가 필요 없다.
- `apps/api/src/types/express.d.ts`의 `AuthenticatedUser` 타입, `req.user = { id, email }` 관례를 그대로 유지하며 변경하지 않는다.
- 기존 `requireAuthenticatedUser`의 외부 동작(401/`unauthorized` 처리)은 리팩터링 후에도 동일해야 하며, 기존 `apps/api/src/routes/resume.test.ts`가 수정 없이 계속 통과해야 한다 — developer 단계에서 반드시 확인할 항목으로 명시한다.
- 용어: 이력서 업로드 스펙(`이력서-업로드_spec.md`)이 이미 "인증되지 않은 요청입니다."(401 `unauthorized`, `requireAuthenticatedUser` 경로)를 참조하고 있으므로, 이번 기능에서 정의하는 `email_not_found`/`email_required`/`invalid_email_format`은 **게이트 페이지 자체(`/api/gate/verify`, `/api/auth/verify-email`)에 한정된 별도 에러 코드**이며 `requireAuthenticatedUser`의 `unauthorized`를 대체하지 않음을 명확히 한다.

---
**Status**: Specification Complete - Approved
