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

1. **Phase 2 첫 기능 "이력서 업로드" — `@developer` 착수 대기 중.** 아래 계획대로 바로 진행 가능:
   - 명세: [`이력서-업로드_spec.md`](../artifacts/spec/이력서-업로드_spec.md) (v4, 승인됨)
   - 테스트: [`이력서-업로드_test.md`](../artifacts/test/이력서-업로드_test.md) + `apps/api/src/routes/resume.test.ts` (21개 케이스, TDD Red 확인됨 — `./resume` 모듈 없어서 로드 실패하는 게 정상)
   - **런타임 의존성 추가 필요** (`apps/api/package.json` dependencies): `multer`(멀티파트 업로드 파싱), `@supabase/supabase-js`(DB 쿼리 + Storage 둘 다), `pdf-parse`(PDF 텍스트 추출)
   - **DB 접근 방식 결정**: `pg` 등 직접 Postgres 커넥션(raw SQL) 대신, `@supabase/supabase-js`의 `.from('sources').insert()`로 통일. 이유: Storage(파일 업로드/삭제)는 SQL로 대체 불가능해 어차피 이 라이브러리가 필요하므로, DB 쿼리도 같은 라이브러리로 묶어 의존성을 하나로 줄임 (PRD 3.6의 "Supavisor 직접 연결" 원안에서 변경)
   - 구현 파일: `apps/api/src/routes/resume.ts`, `apps/api/src/lib/supabaseClient.ts`, (인증 미들웨어는 테스트에서 모킹 처리했으므로 최소 stub만) `apps/api/src/middleware/requireAuthenticatedUser.ts`
   - 인증 방식은 PRD 3.7(이메일 기반 방문자 게이트, `x-user-email` 헤더 → `users` 테이블 DB 조회 → `req.user`)을 전제로 테스트가 작성됨 — 단, 그 인증 미들웨어 자체의 실제 구현(가드 페이지, 쿠키 발급 등)은 별도 기능이라 아직 스펙/구현 없음. 이번 developer 단계에서는 모킹된 상태로 이력서 업로드 로직만 구현
2. 이메일 기반 방문자 게이트(PRD 3.7) 자체의 구현 — 별도 기능으로 아직 spec-writer 단계도 착수 안 함. 이력서 업로드 구현 완료 후 순서 정하기
3. Notion 연동, AI 질문 생성 API, AI 답변 피드백 API — Phase 2 나머지, 아직 착수 전
4. Phase 3~5(프론트 UI, AWS 인프라/배포, 운영 준비)는 아직 시작 전
