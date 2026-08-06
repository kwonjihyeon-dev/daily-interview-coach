# 진행 상황

PRD([`prd.md`](./prd.md))의 마일스톤(6. 마일스톤) 기준 현재 상태. Phase 단위 진전이나 인프라 설정이 있을 때 갱신합니다.

## 완료

- ✅ 레포 생성: [`daily-interview-coach`](https://github.com/kwonjihyeon-dev/daily-interview-coach)
- ✅ Phase 0 모노레포 스캐폴딩 (turborepo/pnpm, apps/web, apps/api, packages/*) — 커밋 및 푸시 완료
- ✅ Notion Integration Token 발급 + 대상 페이지 연결 완료 (`apps/api/.env`에 저장)
- ✅ Bedrock Claude 모델 액세스 신청 완료 — `global.anthropic.claude-sonnet-4-6`로 확정 (PRD 3.1.1). Sonnet 5는 계정 레벨 제한으로 보류, 추후 재시도
- ✅ Supabase 프로젝트 생성 (`daily-interview-coach`, ap-northeast-2 인접 리전)
- ✅ Phase 1 스키마 마이그레이션 — users/sources/questions/answers/answer_feedback/streaks/push_subscriptions 7개 테이블, RLS 활성화, 고정 유저 1명 + 기본 질문 40개(프론트엔드 방향 커스터마이징) 시드 완료
- ✅ Supabase CLI 설치 및 프로젝트 링크, 스키마를 `supabase/migrations/`에 파일로 버전관리 시작 (Docker 기반 풀 로컬 스택은 이 프로젝트 규모엔 과하다고 판단해 생략 — `db pull` 대신 이미 실행한 DDL을 그대로 마이그레이션 파일로 저장 + `migration repair`로 원격 히스토리 동기화). 시드 데이터는 의도적으로 파일로 관리하지 않음(실제 이메일 노출 방지)

## 다음 액션

1. Phase 2 착수 — 이력서 업로드 + Notion 연동 + AI 질문 생성 API, AI 답변 피드백 API (Bedrock 연동)
2. Phase 3~5(프론트 UI, AWS 인프라/배포, 운영 준비)는 아직 시작 전
