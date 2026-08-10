# 클라이언트 데이터 계층 표준화 결정 (TanStack Query 도입)

- **상태**: 확정
- **결정일**: 2026-08-10
- **범위**: `apps/web`의 클라이언트 데이터 접근(읽기/쓰기) 방식
- **관련**: [`progress.md`](./progress.md), [`prd.md`](./prd.md)

## 결정

`apps/web`의 클라이언트 데이터 접근을 **TanStack Query 단일 패러다임으로 표준화**한다.

- 읽기: `useQuery` (+ 서버 `prefetchQuery` → `dehydrate` → `<HydrationBoundary>`로 SSR 초기 데이터 유지)
- 쓰기(데이터 변경): `useMutation` + `invalidateQueries` (변경 후 관련 쿼리 키 무효화로 갱신 전파)
- **혼용 금지**: 표준화를 택한 이상, 클라이언트 쓰기에 Server Actions + `revalidatePath`를 다시 섞지 않는다. 섞으면 없애려던 불일치가 부활한다.

기존 `server-only` 서버 읽기 헬퍼(`apiClient.ts`)로 순수 Server Component가 읽는 경로는 그대로 두되, **클라이언트에서 상호작용/재검증이 필요한 데이터는 TanStack Query로 일원화**한다.

## 배경

당초 `progress.md`에는 "TanStack Query 도입 보류"로 기록돼 있었다. 근거는 "질문 생성"의 재시도 흐름이 단발성 POST라 캐싱·공유·재검증 요구가 없다는 것이었다. 이 결정으로 그 판단을 뒤집는다.

현재 `apps/web`은 두 패턴이 공존한다.

- **서버 읽기**: `src/lib/apiClient.ts`(`server-only`) — `next/headers`로 쿠키를 실어 apps/api 호출, `ApiResult` 판별 유니온 반환.
- **클라이언트 쓰기**: `ResumeUploadForm`/`GateForm` — `"use client"` + 인라인 `fetch(NEXT_PUBLIC_...)` + `useState`(isUploading/error/success).

여기에 필요할 때만 TanStack Query를 덧붙이면 **RSC 읽기 / 인라인 fetch / useQuery 3개 패턴 공존**이 되어, 어느 모델이 적용되는지 매번 판별해야 하는 일관성·해석 비용이 생긴다. 그래서 "언제 덧붙이나"가 아니라 **"클라이언트를 어느 단일 패러다임으로 표준화하나"** 로 논점을 재정의했다.

## 왜 이 앱에서 TanStack Query 쪽인가

1. **분리된 Express API 구조.** RSC의 진짜 강점(DB/ORM을 서버 컴포넌트에서 네트워크 홉 없이 직접 접근)이 나오지 않는다 — RSC든 useQuery든 어차피 apps/api로 HTTP 홉이다. RSC-우선의 우위가 희석된다.
2. **읽는 데이터 대부분이 화면에 띄운 뒤에도 사용자 동작으로 계속 바뀐다.** `/today` 질문(답변 시 전진, 재시도 시 재생성), 스트릭(답변 시 증가), 답변 히스토리(항목 추가) — 한 번 읽고 끝나는 정적 데이터가 거의 없다. 즉 캐시+무효화 모델이 실제로 처리할 일감(바뀌어서 낡아진 데이터를 자동으로 다시 불러와 갱신)이 있다.
3. **일관성이 우선순위이고, 번들 비용은 무시 가능.** 개인용 단일 사용자 도구라, 읽기 컴포넌트가 client component가 되며 늘어나는 JS는 실질 부담이 아니다. 반면 단일 모델이 주는 해석 비용 절감은 그대로 남는다.
4. **prefetch로 SSR 손실 없음.** `prefetchQuery` + `HydrationBoundary`로 초기 데이터를 서버에서 채워 로딩 플래시·워터폴 없이 시작하고, 이후 클라이언트 캐시로 넘긴다. "useQuery로 내리면 SSR을 잃는다"는 우려는 성립하지 않는다.

## 검토했으나 채택하지 않은 대안

### Server Actions + `revalidatePath`/`revalidateTag`

- App Router에서 "한 번의 데이터 변경이 여러 곳을 갱신"의 기본 답이고, 새 클라이언트 의존성이 없다.
- 그러나 이 앱의 읽기는 **쿠키 기반 유저별 인증 요청**이라 `headers()`를 읽는 순간 라우트가 dynamic으로 전환되어 **Next의 Data Cache/ISR에 앉지 않는다.** 결과적으로 revalidate의 의미가 "캐시 만료"가 아니라 **매 요청 풀 서버 재렌더**로 쪼그라든다.
- 또한 낙관적 업데이트·폴링·refetch 시 서버 왕복 제거 같은 클라이언트 상호작용 이점을 제공하지 못한다. (참고: ISR의 시간 기반 `revalidate`와 on-demand `revalidatePath/Tag`는 같은 캐싱 계열의 시간 트리거 vs 이벤트 트리거 관계다. 다만 위 이유로 이 앱에선 그 캐시층 자체가 거의 비활성이다.)

### `unstable_cache`로 유저별 서버 캐싱

- 정석 패턴은 존재한다: `keyParts`에 `userId`를 넣어 유저별 캐시 칸을 분리하고, `revalidateTag(\`...:${userId}\`)`로 그 유저 것만 퍼지.
- 그러나 이 앱과 정면 충돌한다:
  - **캐시 함수 안에서 `cookies()`/`headers()` 사용 불가**(키 결정성 제약). 현재 쿠키 전달 인증(`apiClient`)을 그대로 못 감싼다 → 신원을 밖으로 꺼내고 **서버-투-서버 인증 경로를 신설**해야 한다(현재 apps/api는 이메일 게이트 쿠키 단일 인증).
  - 인자가 캐시 키에 포함되므로 세션 쿠키를 인자로 넘기면 회전/만료 시 키가 갈라진다.
  - **payoff가 얇다**: 단일 사용자 + 자주 바뀌는 데이터라 요청 간 재사용/캐시 히트 윈도가 짧다.
  - `unstable_` 불안정 API(Next 15의 `'use cache'`로 재편 중, 현재 앱은 Next 14.2.x) → churn 리스크. 크로스 유저 유출 footgun.
- 서버 캐싱을 억지로 성립시켜도 **클라이언트 상호작용 이점은 여전히 0**이라, 오히려 "인증된 유저별 상호작용 데이터엔 클라이언트 캐시가 자연스럽다"는 결론을 강화한다.

## 결과 / 구현 시 주의

1. **Isomorphic 쿠키 전달 queryFn 필요.** `apiClient.ts`는 `server-only`(`next/headers`)라 queryFn으로 못 쓴다. queryFn은 서버 prefetch(쿠키 수동 전달)와 클라이언트 refetch(`fetch(..., { credentials: "include" })`) 양쪽에서 동작해야 한다 → 서버/브라우저 겸용 API 클라이언트를 신설. 여기를 대충 하면 이중 페칭이나 prefetch 경로 인증 누락이 생긴다.
2. **`QueryClientProvider` + hydration 세팅**(provider, dehydrate/HydrationBoundary 규약)은 1회성 인프라로 도입.
3. **401 처리 규약 유지.** 기존 `apiClient`의 401 → 게이트 리다이렉트 흐름과 어긋나지 않게 queryFn/전역 에러 핸들링에서 일관되게 처리.
4. 순수 Server Component 읽기까지 강제로 useQuery로 내리지는 않는다 — 상호작용/재검증이 필요한 데이터에 적용.

## 다음 액션

- 이 결정을 구현 명세로 굳힐 때 `spec-writer` → `test-architect` → `developer` 워크플로우를 태운다(여러 파일에 걸친 구조 결정이므로).
- 명세 제목(안): "클라이언트 데이터 계층 표준화 — TanStack Query 도입 + isomorphic API 클라이언트 + prefetch 규약".
