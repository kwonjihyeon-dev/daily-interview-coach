# 진행 상황

PRD([`prd.md`](./prd.md)) 기준 현재 상태와 다음 액션만 기록합니다. 지난 완료 이력은 git 로그로 추적 가능하므로 여기 누적하지 않습니다.

## 현재 상태

- Phase 0(모노레포 스캐폴딩), Phase 1(Supabase 프로젝트/스키마/CLI 마이그레이션 관리)까지 완료
- Bedrock(`global.anthropic.claude-sonnet-4-6`), Supabase(DB + Storage) 연동 확인됨
- **Phase 2~3 순서 변경**: 백엔드 API를 전부 끝내고 UI를 붙이는 대신, 기능별로 **UI + 백엔드를 함께(vertical slice)** 진행하기로 함. AI 답변 피드백은 답변이 쌓인 뒤에나 의미가 있어 가장 마지막으로 미룸
- "이력서 업로드" 백엔드+UI 모두 완료됨 (`.claude/artifacts/spec/이력서-업로드_spec.md`, `이력서-업로드-UI_spec.md`)
- **이메일 기반 방문자 게이트 v2 완료** (`.claude/artifacts/spec/이메일-방문자-게이트_spec.md`) — 인증(판단+쿠키 발급/관리)을 apps/api로 일원화, `POST /api/sessions`로 RESTful 재명명, 레거시 `requireApiKey`(x-api-key) 완전 제거로 `/api/*` 전체가 게이트 쿠키 인증 하나로 통일됨. 테스트 전부 Green, 커밋 완료(`4c63733`)
- **"AI 질문 생성" 기능 완료** (`.claude/artifacts/spec/질문-생성_spec.md`, `.claude/artifacts/test/질문-생성_test.md`, `developer/질문-생성_developer.md`) — 이력서 업로드 완료 시 자동으로 Bedrock 질문 생성을 트리거하고, `/today`에서 미답변 질문을 FIFO로 노출 + 소진 시 재시도. api 85/85·web 95/95 테스트 Green, typecheck 통과. Notion 연동은 이 기능 스코프에 없음(이력서 소스만 지원). ⚠️ prefetch 미답변 카운트 쿼리(PostgREST `answers!left` + `.is("answers.id", null)`)는 실제 Supabase DB 동작이 아직 미검증(테스트는 mock으로만 통과) — 실제 구동 확인 필요

## 다음 액션 (순서대로)

1. ~~이력서 업로드 UI~~ — 완료
2. ~~AI 질문 생성 API (+ 미리 채워두기 로직)~~ — 완료 (⚠️ prefetch 미답변 카운트 쿼리 실제 DB 검증은 남음)
3. **AI 답변 피드백 API**
4. **Notion 연동** — 2차로 미룸 (백엔드+UI 둘 다 필요하고, 질문 생성/피드백 어느 쪽에도 기능적 의존성이 없어 순서상 이유가 없음. 이력서 하나만으로도 vertical slice 검증 가능)

## 참고

- `frontend-design` Claude Code 플러그인 설치됨 (UI 작업 시 활용)
- 클라이언트 데이터 계층은 TanStack Query로 표준화하기로 결정 — 근거는 [`client-data-strategy.md`](./client-data-strategy.md)
