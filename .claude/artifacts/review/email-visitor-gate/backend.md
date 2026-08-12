# 이메일 방문자 게이트 백엔드 — 핵심 로직

- **목적**: 결함 찾기(audit)가 아니라 **이해(comprehension)** — `auth.ts`가 인증을 어떻게 성립시키는지 지도 그리기
- **대상 파일**: `apps/api/src/routes/auth.ts`
- **관련 스펙**: `이메일-방문자-게이트_spec.md`(v2) "백엔드: POST /api/sessions" 절

## 1. `POST /api/sessions` — 인증 없이 호출 가능한 유일한 엔드포인트

정의상 "아직 인증되지 않은 방문자"가 호출하는 곳이라 `requireAuthenticatedUser`를 걸지 않는다. `app.ts`에 `app.use("/api/sessions", authRouter)`로 마운트.

```
이메일 형식 검증(정규식 + 254자 이하)
  → normalize(trim + lowercase)
  → lookupUserByEmail(users 테이블 조회)
      ├ 쿼리 자체 실패 → 500 internal_error
      ├ 사용자 없음     → 401 email_not_found
      └ 사용자 있음     → 쿠키 발급 + 201 { verified: true }
```

## 2. 핵심 포인트 — 세션 스토어가 없다, 쿠키 = 이메일 평문

비밀번호도 세션 토큰/JWT도 없다. 인증 성공 시 `VISITOR_COOKIE_NAME` 쿠키 값으로 **정규화된 이메일 문자열 자체**를 그대로 저장한다(60행). 별도의 세션 테이블이나 토큰 검증 로직이 존재하지 않는다.

- 이후 모든 보호된 요청은 `requireAuthenticatedUser` 미들웨어가 이 쿠키값을 읽어 **매 요청마다 `users` 테이블을 다시 조회**해서 인증한다 — 쿠키 자체는 신뢰하지 않고, DB에 그 이메일이 여전히 존재하는지로 매번 검증하는 구조(PRD 3.7 "이메일 기반 방문자 게이트"가 문자 그대로 이 구현).
- 즉 접근 권한을 회수하려면 `users` 테이블에서 해당 이메일 행을 지우는 것만으로 충분하다(쿠키 폐기/블랙리스트 별도 불필요).
