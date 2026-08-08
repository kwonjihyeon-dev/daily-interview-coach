# 진행 상황

PRD([`prd.md`](./prd.md)) 기준 현재 상태와 다음 액션만 기록합니다. 지난 완료 이력은 git 로그로 추적 가능하므로 여기 누적하지 않습니다.

## 현재 상태

- Phase 0(모노레포 스캐폴딩), Phase 1(Supabase 프로젝트/스키마/CLI 마이그레이션 관리)까지 완료
- Bedrock(`global.anthropic.claude-sonnet-4-6`), Supabase(DB + Storage) 연동 확인됨
- **Phase 2~3 순서 변경**: 백엔드 API를 전부 끝내고 UI를 붙이는 대신, 기능별로 **UI + 백엔드를 함께(vertical slice)** 진행하기로 함. AI 답변 피드백은 답변이 쌓인 뒤에나 의미가 있어 가장 마지막으로 미룸
- "이력서 업로드" 백엔드는 구현·테스트·수동 검증까지 완료됨 (`.claude/artifacts/spec/이력서-업로드_spec.md`). UI는 아직 없음
- **이메일 기반 방문자 게이트 v2 완료** (`.claude/artifacts/spec/이메일-방문자-게이트_spec.md`) — 인증(판단+쿠키 발급/관리)을 apps/api로 일원화, `POST /api/sessions`로 RESTful 재명명, 레거시 `requireApiKey`(x-api-key) 완전 제거로 `/api/*` 전체가 게이트 쿠키 인증 하나로 통일됨. 테스트 전부 Green, 커밋 완료(`4c63733`)

## 다음 액션 (순서대로)

1. **이력서 업로드 UI** — 백엔드는 완료됨, 화면만 연결
2. **Notion 연동** — 백엔드 + UI 둘 다 필요
3. **AI 질문 생성 API (+ 미리 채워두기 로직)** — 백엔드 중심, UI는 "오늘의 질문" 화면 최소한만
4. **AI 답변 피드백 API** — 위 항목들 이후로 미룸

## 참고

- `frontend-design` Claude Code 플러그인 설치됨 (UI 작업 시 활용)
