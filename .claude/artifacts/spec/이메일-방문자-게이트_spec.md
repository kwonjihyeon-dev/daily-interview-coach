# 기능 명세: 이메일 기반 방문자 게이트 (v2 — apps/api 중심 재설계)

## 개요

`daily-interview-coach`는 사용자 본인 1인 전용 도구지만, URL만 알면 누구나 접속해 고정 유저 1명의 데이터에 뒤섞여 쓸 수 있는 상태다. v1은 Next.js가 BFF처럼 쿠키 발급·세션 관리를 대신 수행했으나, 클라이언트가 `apps/web` 하나뿐인 이 프로젝트에서는 BFF 패턴의 이점(여러 클라이언트 대응)을 누릴 수 없다. **이 v2 재설계는 인증(판단 + 쿠키 발급/관리)을 전부 `apps/api`가 소유하도록 이전**하고, `apps/web`은 (a) 브라우저가 `apps/api`를 직접 호출하도록 안내하는 얇은 프론트엔드 껍데기, (b) 페이지 접근 전 쿠키 형식만 훑어보는 미들웨어, (c) SSR 시 쿠키를 그대로 전달하는 가벼운 헬퍼로 역할이 축소된다.

이 문서는 v1 스펙을 완전히 대체한다.

## 아키텍처 결정 사항

| #   | 결정                                            | 구현 영향                                                                                                                                          |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 브라우저가 `apps/api`를 직접 호출               | `GateForm`이 `fetch(${NEXT_PUBLIC_API_BASE_URL}/api/sessions, { credentials: "include" })`로 직접 호출. Next.js Route Handler 프록시 제거 |
| 2   | 쿠키는 `apps/api`가 발급                        | `POST /api/sessions` 성공 시 `res.cookie(...)` 호출                                                                                       |
| 3   | `apps/api`에 CORS 필요                          | `cors` 패키지, `ALLOWED_ORIGINS` env var(쉼표 구분), `credentials: true`                                                                           |
| 4   | `requireAuthenticatedUser`가 `Cookie` 헤더 파싱 | `cookie-parser` 미들웨어 전역 등록 + `req.cookies[VISITOR_COOKIE_NAME]` 참조. `x-user-email` 헤더 지원 완전 제거(하위호환 없음)                    |
| 5   | Next.js `middleware.ts` 유지, 역할 축소         | 실질적으로 코드 변경 없음 — v1부터 이미 "형식 검사만, DB 재조회는 안 함"이었으므로 동작 변화 없음                                                  |
| 6   | SSR 중 apps/api 호출용 가벼운 헬퍼              | `apiGet`/`apiPost`/`apiPut`/`apiDelete`(함수형, apiClient.ts) 신설 — 401 감지 시 `{ kind: "unauthenticated", redirectTo }`를 반환, 실제 `redirect()` 호출은 호출부 책임                                 |
| 7   | 레거시 `requireApiKey`(고정 API 키) 제거        | `app.ts`의 `requireApiKey` 함수와 `app.use("/api", requireApiKey)` 삭제. `/api/questions/today`도 `requireAuthenticatedUser`로 전환 — 이제 모든 `/api/*` 라우트가 게이트 인증(쿠키) 하나로 통일된다 |
| 8   | 게이트 엔드포인트를 RESTful하게 재명명          | `POST /api/auth/verify-email` → `POST /api/sessions`("이메일 검증"이라는 동작이 아니라 "세션 생성"이라는 자원으로 모델링). 성공 상태코드도 `200` → `201 Created`로 변경(다른 생성 엔드포인트인 `/api/sources/resume`와 동일한 컨벤션) |

## 상세 명세

### 전체 아키텍처 원칙 (변경)

```
[게이트 검증 흐름]
브라우저 ──(credentials:"include", 직접 호출)──▶ apps/api
                                                    │ Cookie 헤더 파싱 → users 테이블 대조
                                                    ▼
                                              Set-Cookie 응답 (성공 시)

[페이지 접근 흐름]
브라우저 ──(쿠키 자동 전송)──▶ Next.js 미들웨어 (형식 검사만) ──▶ 페이지 렌더링

[SSR 중 apps/api 호출이 필요한 경우]
Next.js 서버 프로세스 ──(들어온 요청의 Cookie 헤더를 그대로 전달)──▶ apps/api
```

v1의 "브라우저 JS는 apps/api의 존재를 모른다"는 원칙은 폐기한다. `NEXT_PUBLIC_API_BASE_URL`(비밀값 아님, 공개 URL)을 브라우저가 알고 직접 호출하는 것이 표준 패턴이다. 이 원칙 폐기는 이번 게이트 엔드포인트에만 명시적으로 적용된다 — 다른 기능이 브라우저 직접 호출로 전환할지는 각 기능의 자체 스펙에서 결정한다.

### CORS 설정 (`apps/api`, 신규)

-   패키지: `cors` (+ `@types/cors`).
-   `apps/api/src/app.ts` 최상단(라우트 등록보다 먼저)에 전역 등록:
    ```ts
    app.use(
        cors({
            origin(origin, callback) {
                if (!origin) {
                    callback(null, true);
                    return;
                } // Origin 헤더 없는 비브라우저 호출(curl 등)은 그대로 통과 — PRD 3.7 기존 수용 한계
                const allowed = (process.env.ALLOWED_ORIGINS ?? '')
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                callback(null, allowed.includes(origin));
            },
            credentials: true,
        })
    );
    ```
-   차단 시 500 에러가 아니라 CORS 헤더 생략으로 처리한다 — 요청 자체는 정상 처리되지만 브라우저가 응답 접근을 차단한다.
-   `ALLOWED_ORIGINS` 미설정/빈 문자열이면 허용 목록이 0개이므로 모든 브라우저발 요청이 차단된다(fail-closed 기본값).
-   와일드카드/서브도메인 패턴 매칭은 지원하지 않는다(정확한 문자열 일치만, YAGNI).
-   CORS는 보안 경계가 아니다 — 비브라우저 클라이언트(curl 등)는 Origin 헤더가 없으므로 CORS와 무관하게 계속 apps/api를 직접 호출할 수 있다(PRD 3.7 기존 수용 한계, 새로 생기는 위험 아님).

### 쿠키 명세 (발급자만 변경)

| 속성       | 값                                                                                                                               | 비고                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 이름       | `dic_visitor_email`                                                                                                              | 동일                                                                        |
| 값         | 정규화된(trim+lowercase) 이메일 문자열                                                                                           | 동일                                                                        |
| `httpOnly` | `true`                                                                                                                           | 동일                                                                        |
| `secure`   | `true`(프로덕션) / `false`(그 외) — 이제 `apps/api`의 `NODE_ENV`로 판단                                                          | 판단 주체만 이동                                                            |
| `sameSite` | `"lax"`                                                                                                                          | 동일. 로컬 개발(둘 다 `localhost`, 포트만 다름)에서는 정상 동작 확인됨      |
| `path`     | `/`                                                                                                                              | 동일                                                                        |
| `maxAge`   | Express `res.cookie`는 밀리초 단위 — `15552000 * 1000 = 15552000000`을 넘겨야 실제 `Max-Age` 헤더가 180일(15,552,000초)로 나간다 | **단위 변환 주의** — 초 단위를 그대로 넘기면 180초로 발급되는 버그가 생긴다 |
| `Domain`   | 명시하지 않음(host-only)                                                                                                         | 프로덕션 전제조건 참고                                                      |

발급 코드는 신규 `apps/api/src/lib/visitorCookie.ts`에 위치:

```ts
export const VISITOR_COOKIE_NAME = 'dic_visitor_email';
export const VISITOR_COOKIE_MAX_AGE_MS = 15552000 * 1000;

export function buildVisitorCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
        maxAge: VISITOR_COOKIE_MAX_AGE_MS,
    };
}
```

### ⚠️ 프로덕션 도메인 전제조건 (알려진 제약사항 — 결정 유보)

로컬 개발에서는 `apps/web`(`localhost:3000`)과 `apps/api`(`localhost:3001`)가 같은 호스트명(`localhost`)이라 쿠키 스코프가 공유되지만(쿠키는 포트를 구분하지 않음), 프로덕션 도메인이 서로 다른 registrable domain(예: `myapp.vercel.app` vs `xxxx.execute-api.amazonaws.com`)이면 이 아키텍처가 그대로 동작하지 않는다:

1. `apps/api`가 발급한 쿠키가 `apps/web` 쪽 요청에 실려가지 않아, Next.js `middleware.ts`가 쿠키를 아예 보지 못한다.
2. `SameSite=Lax` 쿠키는 크로스사이트 `fetch` 요청에는 실리지 않으므로, 게이트 통과 후에도 인증이 유지되지 않을 수 있다.

**권고**: 프로덕션에서는 `apps/web`/`apps/api`가 같은 registrable domain의 서브도메인(예: `app.example.com` / `api.example.com`)이어야 하며, `apps/api`가 쿠키에 `Domain=.example.com`을 명시해야 두 서브도메인이 쿠키를 공유한다. 이 결정은 프로덕션 도메인이 확정되는 시점에 별도로 다룬다. `ALLOWED_ORIGINS`와 쿠키 `Domain` 속성은 프로덕션 도메인 확정 시 반드시 재검토가 필요한 항목으로 `.claude/docs/progress.md`에 후속 작업으로 남긴다.

### 백엔드: `POST /api/sessions` (변경 — 엔드포인트 RESTful 재명명 + 쿠키 발급 추가)

기존 `POST /api/auth/verify-email`을 대체한다. "이메일을 검증한다"는 동작(verb) 대신 "세션을 생성한다"는 자원(resource)으로 모델링 — 성공하면 실제로 서버 쿠키 기반 세션이 생성되므로 이 쪽이 실제 동작과 더 일치한다. 라우터 파일 경로(`routes/auth.ts`)와 내부 함수/변수명은 바꾸지 않는다(엔드포인트 URL만 변경 — 파일을 옮기거나 이름을 바꾸는 것은 이번 변경의 목적이 아님, YAGNI).

입력 검증 순서(email_required → invalid_email_format → DB 조회)와 에러 코드/메시지는 v1과 완전히 동일하다. 변경되는 것은 URL과 성공 상태코드뿐:

```
성공(201) 시: res.cookie(VISITOR_COOKIE_NAME, normalizedEmail, buildVisitorCookieOptions())를
             res.status(201).json({ verified: true }) 호출 전에 실행한다.
             (200 → 201로 변경 — "자원(세션)이 생성됨"을 나타냄, /api/sources/resume와 동일 컨벤션)
```

실패(400/401/500) 응답은 쿠키를 발급하지 않으며 바디/상태코드 모두 v1과 동일(400/401/500 자체는 변경 없음 — 201로 바뀌는 것은 성공 응답뿐).

**라우팅 순서**: `requireApiKey`가 완전히 삭제되므로("아키텍처 결정 사항" #7) 더 이상 순서를 신경 쓸 이유가 없다 — `app.use("/api/sessions", authRouter)`는 다른 라우트와 마찬가지로 자유롭게 등록한다.

### 백엔드: `requireAuthenticatedUser` (변경 — 쿠키 파싱)

```ts
export async function requireAuthenticatedUser(req, res, next) {
    const email = req.cookies?.[VISITOR_COOKIE_NAME];

    if (!email) {
        res.status(401).json({ error: 'unauthorized', message: '인증되지 않은 요청입니다.' });
        return;
    }
    // 이하 lookupUserByEmail 호출 로직은 완전히 동일
}
```

-   `req.cookies`는 `cookie-parser`가 채운다 — `apps/api/src/app.ts`에 `app.use(cookieParser())`를 `express.json()` 부근(라우팅 이전)에 전역 등록해야 한다.
-   기존 `/api/questions/today`도 이번에 `requireAuthenticatedUser`로 전환한다("아키텍처 결정 사항" #7). `/api/sources/resume`가 이미 하던 것과 동일한 패턴 — 라우터 자신이 핸들러 체인 맨 앞에서 `requireAuthenticatedUser`를 직접 사용.
-   빈 문자열(`Cookie: dic_visitor_email=`)은 헤더/쿠키 부재와 동일하게 처리한다(falsy 체크로 이미 커버됨) — `lookupUserByEmail`을 호출하지 않는다.
-   `x-user-email` 헤더는 더 이상 확인하지 않는다. 하위호환 fallback 없음(명시적 결정).
-   외부 관찰 동작(401/`unauthorized`, `isFailedQuery`도 401로 처리)은 v1과 동일 — 값의 출처(헤더→쿠키)만 바뀐다.

### 백엔드: `app.ts` — 레거시 `requireApiKey` 삭제 (신규 스코프)

```
- requireApiKey 함수 정의 삭제
- app.use("/api", requireApiKey) 삭제
- app.get("/api/questions/today", ...) 앞에 requireAuthenticatedUser를 직접 체이닝
  (resume.ts와 동일한 패턴: router.get("/", requireAuthenticatedUser, handler) 또는
   app.get("/api/questions/today", requireAuthenticatedUser, handler))
```

-   `API_KEY` 환경변수는 이제 코드 어디에서도 참조되지 않으므로 `apps/api/.env.example`에서 제거한다.
-   이 변경 이후 `/api/*` 전체가 예외 없이 게이트 인증(쿠키) 하나로 통일된다 — 라우트별로 인증 방식이 갈리던 과도기 상태가 끝난다.
-   `apps/web`의 `NEXT_PUBLIC_API_KEY`는 이미 코드에서 참조되지 않는 별개의 잔재였다(기존 스코프 외 판단 유지) — `API_KEY`(백엔드)가 삭제된다고 해서 자동으로 함께 정리해야 하는 것은 아니지만, 이제 백엔드에 대응하는 값 자체가 없어졌으므로 함께 제거해도 무방하다. developer 판단에 맡긴다.

### `apps/web/src/middleware.ts` — 변경 없음

로직·코드 동일. v1부터 이미 "쿠키 형식만 검사, DB 재조회는 apps/api에 위임"이었으므로 이번 재설계로 실질적 동작 변화가 없다. 주석에서 "브라우저는 apps/api를 모른다" 같은 이제는 틀린 서술만 갱신한다.

### 게이트 페이지(`gate/page.tsx`) — 변경 없음

로직 동일(쿠키 형식 검사 → 이미 유효하면 리다이렉트, 아니면 `GateForm` 렌더링, `reason=expired` 배너 조건부 렌더링). 다만 이 배너를 트리거하는 주체가 사라졌다 — 아래 "스코프 외" 참고.

### 게이트 폼(`GateForm`, 변경 — 직접 호출)

```ts
async function submitForm(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/sessions`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const body = await response.json();

        if (!response.ok) {
            setErrorMessage(body.message ?? '오류가 발생했습니다.');
            setIsSubmitting(false);
            return;
        }
        router.replace(nextPath);
    } catch {
        // 네트워크 단절, apps/api 무응답, CORS 차단, JSON 파싱 실패를 모두 동일하게 처리
        setErrorMessage('일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        setIsSubmitting(false);
    }
}
```

-   `fetch` 호출과 `response.json()` 파싱을 하나의 try/catch로 묶어 네트워크 실패·JSON 파싱 실패를 모두 포괄한다.
-   v1의 `502 upstream_unreachable` 상태코드 개념은 사라진다 — Route Handler가 없어 상태코드를 만들어낼 주체가 없기 때문. 사용자에게 보여지는 문구는 동일하게 유지한다.
-   브라우저는 CORS 위반과 순수 네트워크 단절을 코드로 구분할 수 없다(브라우저가 JS에 CORS 실패 상세를 노출하지 않음) — 알려진 제약사항으로 기록.

### 신규: `apps/web/src/lib/apiClient.ts` (SSR 전용 헬퍼, 함수형)

```ts
import 'server-only';
import { headers } from 'next/headers';

export type ApiResult = { kind: 'ok'; response: Response } | { kind: 'unauthenticated'; redirectTo: string };

async function request(
    method: string,
    path: string,
    init?: RequestInit,
    currentPath: string = '/'
): Promise<ApiResult> {
    const cookieHeader = headers().get('cookie') ?? '';
    const response = await fetch(`${process.env.API_BASE_URL}${path}`, {
        ...init,
        method,
        headers: {
            ...(init?.headers as Record<string, string> | undefined),
            cookie: cookieHeader,
        },
    });

    if (response.status === 401) {
        return { kind: 'unauthenticated', redirectTo: `/gate?reason=expired&next=${encodeURIComponent(currentPath)}` };
    }
    return { kind: 'ok', response };
}
// request는 export하지 않음 — 모듈 밖에서 접근 불가(캡슐화). get/post/put/delete만 공개 인터페이스.

export const get = (path: string, init?: RequestInit, currentPath?: string) => request('GET', path, init, currentPath);
export const post = (path: string, init?: RequestInit, currentPath?: string) =>
    request('POST', path, init, currentPath);
export const put = (path: string, init?: RequestInit, currentPath?: string) => request('PUT', path, init, currentPath);
export const del = (path: string, init?: RequestInit, currentPath?: string) =>
    request('DELETE', path, init, currentPath);
```

**설계 결정**:

-   **클래스가 아니라 함수형으로 설계한다.** 이유: (1) 이 모듈은 인스턴스 간 구분할 상태(state)가 전혀 없다 — `this`에 저장되는 값이 없으므로 클래스의 존재 이유가 없다. (2) `private`/`protected`는 TypeScript 컴파일 타임에만 존재하고 컴파일된 JS에서는 사라지므로(`(obj as any).method()`로 우회 가능), 캡슐화가 필요하면 **`export`하지 않는 모듈 스코프 함수**가 런타임까지 실제로 강제되는 더 확실한 방법이다. (3) 확장이 필요해지면 클래스 상속(단일 부모만 가능)보다 함수를 감싸는 합성(composition, 여러 개를 자유롭게 조합 가능)이 더 유연하다 — 예: `retry(get)`, `log(withRetry(get))`. 이번 스펙에서 실제로 이런 래퍼를 만들지는 않는다(YAGNI), 다만 함수형 설계가 이 확장 경로를 열어둔다.
-   **`import "server-only"` 필수.** 이 모듈이 Client Component에 잘못 import되면(예: 나중에 다른 개발자가 브라우저에서도 재사용하려고 시도) 빌드 시점에 명확한 에러를 낸다 — `next/headers`는 서버 전용 API라 원래도 실패하지만, `server-only` 패키지가 더 이르고 명확한 에러 메시지를 준다.
-   **401을 감지해도 `redirect()`를 직접 호출하지 않는다.** 대신 `{ kind: "unauthenticated", redirectTo }`를 반환한다. 이유: `redirect()`는 내부적으로 특수 에러를 던지는 방식으로 동작하는데, 호출부가 이 함수 호출을 감싸는 넓은 `try/catch`를 쓰면 그 신호까지 삼켜져 리다이렉트가 조용히 무효화될 위험이 있다. 판별 유니온(`ApiResult`)으로 반환하면 그런 위험이 없고, 대신 **TypeScript가 `result.response` 접근 전에 `kind` 체크를 강제**하므로(체크 안 하면 컴파일 에러) 호출부가 처리를 깜빡할 위험도 구조적으로 막힌다.
-   Server Component/Route Handler/Server Action 컨텍스트에서 들어온 요청의 `Cookie` 헤더를 그대로(가공 없이) apps/api에 전달한다.
-   `Cookie` 헤더가 아예 없는 경우도 방어적으로 처리하지 않고 그대로(`""`) 전달한다 — apps/api가 401로 응답하고, 그 결과는 `{ kind: "unauthenticated", ... }`로 자연스럽게 이어진다.
-   **호출부 사용 예시** (문서화 목적, 실제 사용처는 아직 없음):
    ```ts
    const result = await get('/api/questions/today');
    if (result.kind === 'unauthenticated') {
        redirect(result.redirectTo); // redirect()는 여기, 호출부의 최상위에서만 호출 — 넓은 try/catch로 감싸지 말 것
    }
    const data = await result.response.json();
    ```

### 삭제되는 파일

-   `apps/web/src/app/api/gate/verify/route.ts` + `route.test.ts`
-   `apps/web/src/lib/authenticatedFetch.ts` + `authenticatedFetch.test.ts`

### 수정되는 파일 (요약)

-   `apps/web/src/lib/visitorCookie.ts`: `buildVisitorCookieOptions`/`VisitorCookieOptions`/`VISITOR_COOKIE_MAX_AGE_SECONDS` 제거. `VISITOR_COOKIE_NAME`/`isValidVisitorEmailCookieValue`만 유지.
-   `apps/api/src/routes/auth.ts`: 마운트 경로 `/api/sessions`로 변경, 성공 분기에 `res.cookie(...)` 추가 + 상태코드 `200`→`201`.
-   `apps/api/src/middleware/requireAuthenticatedUser.ts`: 헤더→쿠키.
-   `apps/api/src/app.ts`: `cors()`, `cookieParser()` 전역 등록. `requireApiKey` 함수 및 등록 삭제. `/api/questions/today`에 `requireAuthenticatedUser` 체이닝.

### 환경변수

**`apps/api/.env.example`** — 추가 및 제거:

```
# CORS 허용 origin 목록(쉼표로 구분, 공백 허용). 미설정/빈 값이면 모든 브라우저발 요청이
# 차단된다(fail-closed). 로컬: http://localhost:3000  프로덕션: 도메인 확정 후 추가.
ALLOWED_ORIGINS=http://localhost:3000
```

`API_KEY=`는 제거한다 — `requireApiKey` 삭제로 더 이상 어디에서도 참조되지 않는다.

**`apps/web/.env.example`** — 주석만 갱신(값은 유지):

```
# 브라우저가 apps/api를 직접 호출하는 데 쓰는 base URL. 비밀값이 아니므로 NEXT_PUBLIC_
# 접두사로 클라이언트에 노출한다. GateForm이 credentials:"include"로 이 값을 사용한다.
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_API_KEY=

# Next.js 서버 프로세스 자신이 SSR 중 apps/api를 호출할 때 쓰는 base URL(apiClient.ts의 apiGet/apiPost 등).
API_BASE_URL=http://localhost:3001
```

-   `NEXT_PUBLIC_API_KEY`는 코드베이스 어디에서도 참조되지 않는 기존 잔재(구 고정 API 키 시대 유산)로 보인다. 이번 기능과 무관하므로 손대지 않는다(범위 밖).

### 스코프 외 (v1 대비 축소된 항목 포함)

-   **`reason=expired` 자동 트리거 제거.** `gate/page.tsx`의 배너 렌더링 자체는 남지만, v1에서 이를 트리거했던 `authenticatedFetch`가 삭제되므로 이번 기능만으로는 아무도 `/gate?reason=expired`로 보내지 않는다. 향후 브라우저가 apps/api를 직접 호출하며 401을 받는 기능이 생기면, 그 기능의 스펙에서 이 리다이렉트 컨벤션을 따를지 결정한다.
-   수동 로그아웃 버튼, 이메일 자체 인증, `verify-email` Rate limit/CAPTCHA, 쿠키 미지원 브라우저 대응, 셀프서비스 가입, 미들웨어의 실시간 DB 재검증 — v1과 동일하게 스코프 외.
-   프로덕션 쿠키 `Domain` 속성 및 `ALLOWED_ORIGINS`의 실제 프로덕션 값 — 도메인 확정 후 별도 결정.
-   `apps/api/src/routes/resume.test.ts`(21개) 수정 — 불필요함을 확인함(전체 모킹으로 격리되어 있음).

## Acceptance Criteria

### 정상 시나리오

```
Given users 테이블에 등록된 이메일 "user@example.com"이 있고, ALLOWED_ORIGINS=http://localhost:3000이며,
      방문자가 쿠키 없이 "/"에 접근했다
When 미들웨어가 "/gate?next=%2F"로 리다이렉트하고, 방문자가 GateForm에서 "user@example.com"을 제출한다
     (브라우저가 credentials:"include"로 http://localhost:3001/api/sessions을 직접 호출)
Then apps/api가 201과 { verified: true }를 반환하며, 응답에
     Set-Cookie: dic_visitor_email=user@example.com; HttpOnly; SameSite=Lax; Path=/; Max-Age=15552000
     이 포함된다(프로덕션 기준 Secure 추가)
And 브라우저가 이 쿠키를 저장하고 GateForm은 router.replace("/")로 이동한다
```

```
Given 방문자가 "/history"에 접근하려다 "/gate?next=%2Fhistory"로 리다이렉트됐다
When 유효한 이메일을 제출해 검증에 성공한다
Then "/history"로 이동한다("/"가 아님) — 로직 v1과 동일
```

```
Given 방문자가 유효한 형식의 dic_visitor_email 쿠키를 이미 보유하고 있다
When 보호된 경로에 접근한다
Then 미들웨어가 리다이렉트하지 않고 통과시킨다(변경 없음)
```

```
Given 방문자가 이미 유효한 형식의 쿠키를 보유한 상태다
When "/gate"에 직접 접근한다
Then 즉시 "/"(또는 안전성 검증된 next)로 리다이렉트된다(변경 없음)
```

```
Given ALLOWED_ORIGINS=http://localhost:3000
When Origin: http://localhost:3000에서 POST /api/sessions이 온다(브라우저의 실제 CORS 프리플라이트 포함)
Then 응답에 Access-Control-Allow-Origin: http://localhost:3000, Access-Control-Allow-Credentials: true가 포함된다
```

```
Given Server Component 렌더링 중 들어온 요청의 Cookie 헤더가 "dic_visitor_email=user@example.com"이다
When apiGet("/api/questions/today")가 호출된다
Then apps/api로 나가는 실제 요청의 Cookie 헤더 값이 "dic_visitor_email=user@example.com"과 정확히 일치한다
```

### 엣지 케이스

```
Given users 테이블에는 "user@example.com"(소문자)으로 저장돼 있고, 방문자가 " User@Example.com "을 입력한다
When 브라우저가 직접 apps/api를 호출해 제출한다
Then trim()+toLowerCase() 정규화 후 대조해 200을 반환하고, 쿠키 값도 정규화된 "user@example.com"이다
```

```
Given 방문자의 dic_visitor_email 쿠키 값이 "abc123"(이메일 형식 아님)으로 변조되어 있다
When 보호된 경로에 접근한다
Then 미들웨어가 무효로 간주해 "/gate?next=..."로 리다이렉트한다(변경 없음)
```

```
Given 방문자가 형식상 유효한 쿠키를 갖고 있지만 관리자가 users 테이블에서 해당 row를 삭제했다
When 브라우저(또는 SSR 헬퍼)가 apps/api를 호출한다
Then apps/api가 401 unauthorized를 반환한다
And 이 401에 대한 리다이렉트(/gate?reason=expired) 처리는 이번 기능이 자동으로 수행하지 않는다 —
    호출부(향후 기능)가 직접 판단해야 한다(v1의 authenticatedFetch가 전담했던 동작이 폐기됨)
```

```
Given dic_visitor_email 쿠키가 발급 후 180일이 지나 브라우저가 자동 폐기했다
When 방문자가 보호된 경로에 접근한다
Then 미들웨어가 쿠키 없음으로 처리해 "/gate?next=..."로 리다이렉트한다(변경 없음)
```

```
Given 방문자가 "/gate?next=https://evil.com" 또는 "/gate?next=//evil.com"으로 접근해 유효한 이메일을 제출한다
When 검증에 성공한다
Then next 값이 안전하지 않은 것으로 판정되어 "/"로 리다이렉트된다(sanitizeNextPath 로직 변경 없음)
```

```
Given 방문자가 잘못된 이메일로 3회 연속 실패했다
When 네 번째로 올바른 이메일을 직접 apps/api에 제출한다
Then 시도 횟수와 무관하게 정상 성공하고 쿠키가 발급된다(잠금·쿨다운 없음, 변경 없음)
```

```
Given ALLOWED_ORIGINS가 미설정이거나 빈 문자열이다
When Origin: http://localhost:3000에서 요청이 온다
Then 응답에 Access-Control-Allow-Origin 헤더가 포함되지 않아 브라우저가 응답 접근을 차단한다
     (요청 자체는 apps/api 내부적으로 정상 처리되나 브라우저 JS는 결과를 읽지 못한다)
```

```
Given 요청의 Cookie 헤더에 dic_visitor_email이 아닌 다른 쿠키만 존재한다(예: "other=1")
When requireAuthenticatedUser가 실행된다
Then 401 unauthorized를 반환하고 lookupUserByEmail을 호출하지 않는다
```

```
Given 요청의 Cookie 헤더가 "dic_visitor_email="(빈 값)이다
When requireAuthenticatedUser가 실행된다
Then 헤더/쿠키 부재와 동일하게 401 unauthorized를 반환하고 lookupUserByEmail을 호출하지 않는다
```

### 에러 케이스

```
Given 방문자가 GateForm에 공백만 입력하고 제출한다
When 브라우저가 직접 POST /api/sessions을 호출한다
Then 400과 error="email_required"를 받고, 쿠키는 발급되지 않으며, 입력 필드는 편집 가능한 상태로 유지된다
```

```
Given 방문자가 "not-an-email"을 입력한다
When 직접 호출한다
Then 400과 error="invalid_email_format"을 받는다(검증 로직 v1과 동일)
```

```
Given 방문자가 users 테이블에 없는 "nobody@example.com"을 제출한다
When 직접 호출한다
Then apps/api가 401과 error="email_not_found"를 반환하고, GateForm이 이를 그대로 표시하며 쿠키는 발급되지 않는다
     (Next.js를 경유하지 않고 브라우저가 apps/api의 응답을 직접 받는다는 점만 v1과 다름)
```

```
Given Supabase 커넥션 오류로 users 테이블 조회 자체가 실패한다
When 유효한 형식의 이메일로 직접 호출한다
Then lookupUserByEmail이 isFailedQuery=true를 반환하고 500 error="internal_error"를 받는다(변경 없음)
```

```
Given apps/api 서버 자체가 응답하지 않는다(네트워크 단절)
When 방문자가 유효한 이메일로 제출한다
Then GateForm의 fetch가 예외를 던지고, catch 블록이 "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."를 표시한다
And 쿠키는 발급되지 않으며, 이 경로에는 더 이상 502/upstream_unreachable이라는 상태코드/에러코드가 존재하지 않는다
```

```
Given apps/web의 origin이 ALLOWED_ORIGINS에 포함되지 않아 CORS 정책 위반이 발생한다
When 방문자가 이메일을 제출한다
Then 브라우저가 fetch를 예외로 처리하므로 GateForm은 위 네트워크 단절과 동일한 안내 메시지를 표시한다
     (브라우저가 CORS 실패의 구체적 원인을 JS에 노출하지 않아 코드로 두 경우를 구분할 수 없음 — 알려진 제약사항)
```

```
Given 요청에 Cookie 헤더 자체가 없다(예: 미들웨어 매처가 커버하지 않는 경로로 직접 apps/api 호출)
When requireAuthenticatedUser가 실행된다
Then 401 unauthorized를 반환하고 lookupUserByEmail을 호출하지 않는다(x-user-email 헤더 부재와 동등한 후속 케이스)
```

```
Given lookupUserByEmail이 isFailedQuery=true(DB 조회 자체 실패)를 반환한다
When Cookie 헤더에 형식상 유효한 이메일이 있는 상태로 requireAuthenticatedUser가 실행된다
Then /api/sessions과 달리 500이 아닌 기존과 동일한 401 unauthorized를 반환한다(동작 동등성 유지)
```

```
Given requireApiKey가 완전히 삭제되었다
When x-api-key 헤더 없이(그리고 게이트 쿠키도 없이) GET /api/questions/today를 호출한다
Then 더 이상 x-api-key 부재가 아니라 게이트 쿠키 부재를 이유로 401 unauthorized를 반환한다
     (에러 바디는 기존과 동일 — 인증 방식만 통일됨)
```

```
Given requireApiKey가 삭제된 이후
When 유효한 dic_visitor_email 쿠키로 GET /api/questions/today를 호출한다
Then x-api-key 헤더 없이도(더 이상 검사하지 않으므로) 200을 반환한다
```

## 일관성 검증 결과

-   `packages/shared-types/src/index.ts`의 `Source`/`Question`/`Answer`/`AnswerFeedback`/`Streak`와 이름·필드 충돌 없음.
-   `apps/api/src/types/express.d.ts`의 `AuthenticatedUser`, `req.user = { id, email }` 관례 — 변경 없음.
-   `apps/api/src/routes/resume.test.ts`(21개): 직접 확인 결과 영향 없음 — 미들웨어 전체를 모킹하므로 내부 구현(헤더→쿠키)이 이 테스트에 노출되지 않는다. 수정 불필요.
-   `apps/api/src/app.test.ts`: `requireApiKey` 전제로 작성된 테스트("x-api-key 헤더 없이도 도달 가능", "x-api-key 헤더가 없으면 401 unauthorized" 등)를 전부 걷어내고, `/api/questions/today`가 `requireAuthenticatedUser`(쿠키) 기준으로 동작하는지로 다시 작성해야 한다. CORS 테스트들이 `/api/questions/today`를 호출 대상으로 쓰는 부분은 여전히 401을 받는 것 자체는 맞지만 "이유"가 x-api-key 부재 → 쿠키 부재로 바뀌므로 주석 갱신이 필요하다(assertion 자체는 대부분 `res.status).toBe(401)`만 보므로 코드 변경은 작지만, 왜 401인지 설명하는 주석은 갱신 대상).
-   `apps/api/src/middleware/requireAuthenticatedUser.test.ts`: 전면 재작성 필요(헤더 설정 → 쿠키 설정으로).
-   `apps/api/src/routes/auth.test.ts`: 요청 경로를 `/api/sessions`로, 성공 시 기대 상태코드를 `201`로 전부 수정해야 한다.
-   `apps/web/src/app/gate/GateForm.tsx`(및 대응 테스트): fetch 대상 경로가 `/api/sessions`로 바뀌므로, mock 서버/스텁이 이 경로를 가정하는 곳이 있다면 함께 수정.
-   용어: `email_not_found`/`email_required`/`invalid_email_format`은 여전히 게이트 전용 에러 코드이며 `requireAuthenticatedUser`의 `unauthorized`를 대체하지 않는다(v1과 동일한 경계).

---

**Status**: Specification Complete - Approved
