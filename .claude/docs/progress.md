# 진행 상황

PRD([`prd.md`](./prd.md)) 기준 현재 상태와 다음 액션만 기록합니다. 지난 완료 이력은 git 로그로 추적 가능하므로 여기 누적하지 않습니다.

## 현재 상태

- Phase 0(모노레포 스캐폴딩), Phase 1(Supabase 프로젝트/스키마/CLI 마이그레이션 관리)까지 완료
- Bedrock(`global.anthropic.claude-sonnet-4-6`), Supabase(DB + Storage) 연동 확인됨
- **Phase 2~3 순서 변경**: 백엔드 API를 전부 끝내고 UI를 붙이는 대신, 기능별로 **UI + 백엔드를 함께(vertical slice)** 진행하기로 함. AI 답변 피드백은 답변이 쌓인 뒤에나 의미가 있어 가장 마지막으로 미룸
- "이력서 업로드" 백엔드는 구현·테스트·수동 검증까지 완료됨 (`.claude/artifacts/spec/이력서-업로드_spec.md`). UI는 아직 없음

## 다음 액션 (순서대로)

1. **이메일 기반 방문자 게이트 (PRD 3.7)** — 가드 페이지 + 쿠키 발급. 아직 spec-writer 단계도 착수 전. 다른 모든 UI가 이 인증 흐름 없이는 브라우저에서 동작 안 하므로 최우선
2. **이력서 업로드 UI** — 백엔드는 완료됨, 화면만 연결
3. **Notion 연동** — 백엔드 + UI 둘 다 필요
4. **AI 질문 생성 API (+ 미리 채워두기 로직)** — 백엔드 중심, UI는 "오늘의 질문" 화면 최소한만
5. **AI 답변 피드백 API** — 위 항목들 이후로 미룸

## 참고

- `frontend-design` Claude Code 플러그인 설치됨 (UI 작업 시 활용)
