# 진행 상황

PRD([`prd.md`](./prd.md))의 마일스톤(6. 마일스톤) 기준 현재 상태. Phase 단위 진전이나 인프라 설정이 있을 때 갱신합니다.

## 완료

- ✅ 레포 생성: [`daily-interview-coach`](https://github.com/kwonjihyeon-dev/daily-interview-coach)
- ✅ Phase 0 모노레포 스캐폴딩 (turborepo/pnpm, apps/web, apps/api, packages/*) — 커밋 및 푸시 완료
- ✅ Notion Integration Token 발급 + 대상 페이지 연결 완료 (`apps/api/.env`에 저장)

## 다음 액션

1. ~~`ap-northeast-2`에서 Bedrock Claude 모델 액세스 신청~~ → 완료 (Anthropic use case 폼 제출, Claude Sonnet 4.6 호출 확인됨). Sonnet 5는 계정/리전 무관하게 `AccessDeniedException` — 모델 자체 롤아웃 제한으로 판단, 추후 재시도 필요 (PRD 3.1.1 참고)
2. Supabase 프로젝트 생성 → Phase 1(스키마 마이그레이션)로 이어짐
