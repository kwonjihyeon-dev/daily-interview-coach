# 진행 상황

PRD([`prd.md`](./prd.md)) 기준 현재 상태와 다음 액션만 기록합니다. 지난 완료 이력은 git 로그로 추적 가능하므로 여기 누적하지 않습니다.

## 현재 상태

Phase 0(모노레포 스캐폴딩)·Phase 1(Supabase 프로젝트/스키마/CLI 마이그레이션)이 끝났고, Phase 2~3은 아래 4개 기능이 백엔드+UI 모두 구현된 상태다 — **이력서 업로드**, **이메일 기반 방문자 게이트 v2**, **AI 질문 생성**, **클라이언트 데이터 계층 서버 우선 전환**. 각 기능의 결정 근거와 구현 내역은 `.claude/artifacts/{spec,test,developer}/` 산출물과 git 로그 참고. 현재 테스트는 web 109 / api 85 전부 Green, typecheck 통과.

**서 있는 결정**

- **Phase 2~3 순서**: 백엔드 API를 전부 끝내고 UI를 붙이는 대신, 기능별로 **UI + 백엔드를 함께(vertical slice)** 진행. AI 답변 피드백은 답변이 쌓인 뒤에나 의미가 있어 가장 마지막
- **Notion 연동은 이 범위 밖** — 질문 생성은 이력서 소스만 지원

**열려 있는 문제**

- ⚠️ **Bedrock 연동이 현재 로컬에서 동작하지 않는다.** 질문 생성이 500으로 실패 — 아래 "전환 후 남은 일" 참고. (이전에 "연동 확인됨"으로 기록돼 있었으나 2026-08-12 재현 실패)
- ⚠️ **prefetch 미답변 카운트 쿼리 미검증** — PostgREST `answers!left` + `.is("answers.id", null)` 조합이 실제 Supabase DB에서 의도대로 도는지 확인 안 됨(테스트는 mock으로만 통과). 위 500의 두 번째 후보 원인이기도 함

## 다음 액션 (순서대로)

1. **`POST /api/questions/generate` 500 원인 규명** — 아래 "전환 후 남은 일" 참고. 다음 기능을 얹기 전에 현재 플로우가 끝까지 도는지부터 확인
2. **게이트 401 안내 누락 버그 수정** — 아래 별도 절
3. **`.claude/artifacts/review/` 문서 2개 갱신** — 아래 별도 절
4. **AI 답변 피드백 API + UI**
5. **Phase 4 배포 — EC2 코로케이션** (nginx로 `/api`를 같은 도메인에, Express는 `127.0.0.1:3001` 바인딩). 착수 전 체크: ① AWS Budget Alert 설정 ② 로컬에서 `next build && next start` 프로덕션 빌드 확인. 상시 과금이므로 기능 구현이 끝난 뒤에 켠다 — 조기 배포로 얻을 환경 차이 검증이 코로케이션(동일 오리진)에선 거의 없음
6. **Notion 연동** — 2차로 미룸 (백엔드+UI 둘 다 필요하고, 질문 생성/피드백 어느 쪽에도 기능적 의존성이 없어 순서상 이유가 없음. 이력서 하나만으로도 vertical slice 검증 가능)

> 완료 항목을 지우면서 번호가 계속 바뀝니다 — 다른 문서에서 "progress.md N번"으로 참조하지 마세요.

**별도 트랙 (순서 무관)**: API Gateway + Lambda 실습 — CDK로 HTTP API + Lambda를 한 번 올려 event 형태 확인 + 콜드스타트 실측 후 `remove`로 정리. 상시 비용 없음

## 클라이언트 데이터 계층 전환 후 남은 일

전환 자체는 완료됐다(web 109/109·api 85/85 Green, typecheck 통과). 산출물: `.claude/artifacts/{spec,test,developer}/클라이언트-데이터-계층-전환_*.md`.

**로컬 검증에서 확인된 것** (2026-08-12): 게이트 세션 생성(Server Action → `Set-Cookie` 파싱 → 브라우저 전달)과 이력서 업로드가 실제로 동작함 — 전환에서 가장 위험했던 쿠키 전달 경로가 검증됨.

**아직 확인 못 한 것**:

- **`POST /api/questions/generate`가 500** — 정상 이메일로 게이트/업로드까지 통과한 뒤 질문 생성에서 실패. **가장 유력한 원인은 AWS 자격증명 부재**: `apps/api/.env`에 `AWS_REGION`/`BEDROCK_MODEL_ID`만 있고 `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`가 없으며 `~/.aws`도 없다. `bedrockClient.ts:14`가 `new BedrockRuntimeClient({ region })`으로 기본 자격증명 체인에 의존하므로 자격증명을 못 찾으면 던진다. **미확정** — `pnpm dev`의 api 터미널에 찍히는 `[questions] generate 처리 중 오류:`(questions.ts:129) 실제 에러로 확인할 것. 자격증명 문제가 아니라면 위 ⚠️ prefetch 쿼리 미검증 건이 다음 후보
- **`bodySizeLimit` 실제 동작** — 5MB 파일 업로드가 프레임워크 레벨에서 거부되지 않는지 (설정값이 `experimental.serverActions.bodySizeLimit`에 정확히 들어간 것은 확인됨)
- **게이트 통과 시 중복 네비게이션 여부** — Server Action의 쿠키 set이 `/gate` 자동 재렌더링을 유발하고, 이게 `GateForm`의 `router.replace`와 겹치는지 (기능적 문제는 없을 것으로 예상하나 콘솔 경고 확인 필요)
- **브라우저가 `localhost:3001`을 직접 호출하지 않는지** — DevTools Network에서 전 플로우 중 `:3001` 요청이 0건이어야 함 (이번 전환의 본질)

**테스트로 방어되지 않는 3개 지점**은 `.claude/artifacts/test/클라이언트-데이터-계층-전환_test.md`의 "v1에서 제거한 테스트 케이스와 그 이유" 절 참고.

**로컬 실행 시 주의**: `apps/web/.env.local`이 필요하다(`API_BASE_URL`). 없으면 모든 요청이 `undefined/api/...`로 나가 "일시적인 오류가 발생했습니다"만 뜬다. `cp apps/web/.env.example apps/web/.env.local` 후 dev 서버 재시작.

## 게이트 401 안내 누락 버그 (수정 필요)

**증상**: `apps/api`가 401을 반환하면 `apiClient`가 `/gate?reason=expired&next=...`로 리다이렉트하는데, `gate/page.tsx`가 쿠키 **형식만** 검사해(`isValidVisitorEmailCookieValue`) 형식이 유효하면 `reason=expired`를 무시하고 즉시 `next`로 되돌려보낸다. 결과적으로 사용자는 **아무 안내 없이 원래 화면으로 튕기고**, 게이트 폼에 도달할 수 없어 스스로 빠져나올 방법이 없다(쿠키를 직접 지워야만 탈출 가능).

**근본 원인**: "유효함"의 정의가 두 개다. `proxy.ts`/`gate/page.tsx`는 형식만(의도적 — 매 네비게이션마다 DB 조회를 피하려고, `proxy.ts` 주석 참고), `apps/api`의 `requireAuthenticatedUser`는 DB 조회. **형식은 맞는데 `users` 테이블에 없는 이메일**일 때 둘이 어긋나며 사용자가 갇힌다.

**수정 방향**: `gate/page.tsx`에서 `reason === "expired"`이면 리다이렉트를 건너뛰고 폼 + 배너를 렌더. 그러면 사용자가 올바른 이메일을 다시 입력해 새 쿠키를 받아 빠져나올 수 있다.

**테스트가 못 잡은 이유**: `page.test.tsx:114`의 배너 테스트가 `cookieStoreMock.get`을 `undefined`로 두고 돌아, 정작 깨지는 조합인 **"형식 유효한 쿠키 있음 + `reason=expired`"** 를 한 번도 실행하지 않는다. 수정 시 이 조합 테스트를 추가할 것.

**배너 문구도 함께 손볼 것**: 현재 "인증이 **만료**되었습니다"인데, `requireAuthenticatedUser`는 "쿠키 없음"과 "등록되지 않은 이메일"을 구분하지 않고 같은 401을 반환하므로 만료가 아닌 경우에도 이 문구가 뜬다. 사실에 맞게 중립적으로.

> CLAUDE.md 기준 "명세가 명확한 작은 버그 수정"이라 3단계 워크플로우 없이 바로 고쳐도 되는 범위.

## `.claude/artifacts/review/` 갱신 필요

review 문서는 감사 리포트가 아니라 **코드 독해 가이드**라 코드가 바뀌면 낡는다. 클라이언트 데이터 계층 전환으로 아래 2개가 어긋났다(backend 계열 3개는 apps/api 무변경이라 영향 없음).

- **`resume-upload/ui.md`** — 5절 "서버와 어떻게 대화하나"가 통째로 뒤집힘(직접 `fetch` → Server Action + Route Handler). 1절 함수 목록·줄 번호도 전부 밀림(`uploadResume`(139) → `submitResumeUpload`(144)). 3절 흐름도의 `제출 클릭 ─uploadResume─▶ POST /api/sources/resume`도 수정 대상
  - ⚠️ 4절 첫 항목("70–71행 렌더 중 직접 ref 대입")은 **이번 전환과 무관하게 이미 틀려 있었다** — React 19에서 렌더 중 ref 대입이 금지되어 진작 `useEffect`로 바뀌었는데 문서만 남았다
- **`question-generation/frontend.md`** — 2절의 "`EmptyQuestionState`는 브라우저가 `NEXT_PUBLIC_API_BASE_URL`로 직접 fetch한다" 서술. 이제 상대경로 Route Handler를 호출

**갱신 시 함께 고려할 것**: 본문에 줄 번호와 코드 인용을 박아두는 현재 형식은 코드가 바뀔 때마다 조용히 낡는다(위 ⚠️가 그 실례). 줄 번호 참조를 걷어낼지 검토.

## 논의 필요 — 다중 사용자 제한을 언제 풀 것인가

**발단** (2026-08-12): 게이트 401 버그를 논의하다가 "등록되지 않은 이메일이면 새 유저 id를 만들어주면 되지 않나"는 안이 나왔다. **이번엔 채택하지 않았다** — 아무 이메일이나 계정을 만들어주면 PRD 3.7의 존재 이유(접근 통제)가 사라지고, 사용자별 데이터 격리·Notion Public OAuth 전환(PRD 3.4 주의사항) 같은 작업이 줄줄이 따라오는 **다중 사용자 지원**이라 PRD가 2차로 미뤄둔 범위이기 때문.

**다만 "언제 풀 것인가"는 미결이다.** 결정할 때 같이 봐야 할 것:

- PRD 2절 "2차 이후"에 다중 사용자가 이미 있음 — 이걸 1차로 당길지
- 당긴다면 게이트를 Cognito 등 정식 인증으로 옮길지, 이메일 게이트를 유지한 채 화이트리스트만 늘릴지 (PRD 3.7은 "사용자·트래픽이 늘어나면 그때 Cognito"라고만 적어둠)
- Notion Internal Token → Public OAuth 전환 필요 (PRD 3.4 경고 블록)
- 사용자별 알림 시간 개인화가 따라오면 EventBridge 고정 cron 구조 재검토 (PRD 3.8)
- EC2 단일 인스턴스 코로케이션(deploy-topology-review.md 3절)은 "사용자 1명" 전제 위의 결정이라 함께 흔들림

**지금 결론**: 1차는 1인 전용 유지. 위 항목들이 서로 엮여 있어 "새 id 자동 생성" 같은 국소 변경으로 접근하면 안 되고, 별도 논의로 다룰 것.

## 참고

- `frontend-design` Claude Code 플러그인 설치됨 (UI 작업 시 활용)
- 클라이언트 데이터 계층은 서버 우선(RSC 읽기 + Server Actions)으로 확정, TanStack Query 도입 안 함 — 근거는 [`deploy-topology-review.md`](./deploy-topology-review.md) 4절
