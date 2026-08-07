// 이메일 기반 방문자 게이트 인증(PRD 3.7)을 통과한 요청에 실리는 사용자 컨텍스트.
// requireAuthenticatedUser 미들웨어가 설정하고, 하위 라우트 핸들러가 사용한다.
export interface AuthenticatedUser {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
