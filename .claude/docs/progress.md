# 진행 상황

PRD([`prd.md`](./prd.md)) 기준 현재 상태와 다음 액션만 기록합니다. 지난 완료 이력은 git 로그로 추적 가능하므로 여기 누적하지 않습니다.

## 현재 상태

- Phase 0(모노레포 스캐폴딩), Phase 1(Supabase 프로젝트/스키마/CLI 마이그레이션 관리)까지 완료
- Bedrock(`global.anthropic.claude-sonnet-4-6`), Supabase(DB + Storage) 연동 확인됨
- **Phase 2~3 순서 변경**: 백엔드 API를 전부 끝내고 UI를 붙이는 대신, 기능별로 **UI + 백엔드를 함께(vertical slice)** 진행하기로 함. AI 답변 피드백은 답변이 쌓인 뒤에나 의미가 있어 가장 마지막으로 미룸
- "이력서 업로드" 백엔드+UI 모두 완료됨 (`.claude/artifacts/spec/이력서-업로드_spec.md`, `이력서-업로드-UI_spec.md`)
- **이메일 기반 방문자 게이트 v2 완료** (`.claude/artifacts/spec/이메일-방문자-게이트_spec.md`) — 인증(판단+쿠키 발급/관리)을 apps/api로 일원화, `POST /api/sessions`로 RESTful 재명명, 레거시 `requireApiKey`(x-api-key) 완전 제거로 `/api/*` 전체가 게이트 쿠키 인증 하나로 통일됨. 테스트 전부 Green, 커밋 완료(`4c63733`)
- **"AI 질문 생성" 기능 진행 중** — spec-writer/test-architect 완료(TDD Red), developer(구현) 단계는 아직 착수 전 (`.claude/artifacts/spec/질문-생성_spec.md`, `.claude/artifacts/test/질문-생성_test.md`). 이력서 업로드 완료 시 자동으로 Bedrock 질문 생성을 트리거하고, `/today`에서 미답변 질문을 FIFO로 노출 + 소진 시 재시도 흐름까지 명세/테스트에 포함됨. Notion 연동은 이 기능 스코프에 없음(이력서 소스만 지원)

## 다음 액션 (순서대로)

1. ~~이력서 업로드 UI~~ — 완료
2. **AI 질문 생성 API (+ 미리 채워두기 로직)** — spec/test 완료, **developer(구현) 단계부터 재개**
3. **AI 답변 피드백 API**
4. **Notion 연동** — 2차로 미룸 (백엔드+UI 둘 다 필요하고, 질문 생성/피드백 어느 쪽에도 기능적 의존성이 없어 순서상 이유가 없음. 이력서 하나만으로도 vertical slice 검증 가능)

## 라이브러리 도입 결정

- **TanStack Query 도입 보류**: "질문 생성" 기능의 "다시 시도"(재생성) 흐름에서 서버 상태 관리를 `useState`로 처리하기로 함. TanStack Query는 여러 컴포넌트가 같은 서버 데이터를 캐싱/공유/재검증해야 할 때 값어치가 나오는데, 현재는 버튼 클릭 → 단발성 POST → 그 자리에서 결과 렌더링뿐이라 캐싱·공유·재검증 요구가 없음. 현재 `apps/web`에 미설치 상태이기도 함. 여러 화면이 같은 서버 상태를 자주 공유·재검증해야 하는 요구(예: 답변/스트릭 기능 이후)가 쌓이면 그때 별도 인프라 결정으로 재논의.

## 참고

- `frontend-design` Claude Code 플러그인 설치됨 (UI 작업 시 활용)
