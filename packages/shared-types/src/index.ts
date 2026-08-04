export type SourceType = "resume" | "notion";

export interface Source {
  id: string;
  userId: string;
  type: SourceType;
  rawText: string;
  sourceUrl: string | null;
  createdAt: string;
}

export type QuestionOrigin = "seed" | "ai";

export interface Question {
  id: string;
  userId: string;
  sourceId: string | null;
  category: string;
  text: string;
  origin: QuestionOrigin;
  createdAt: string;
}

export interface Answer {
  id: string;
  questionId: string;
  userId: string;
  body: string;
  answeredAt: string;
}

export interface AnswerFeedback {
  id: string;
  answerId: string;
  feedbackText: string;
  requestedAt: string;
}

export interface Streak {
  userId: string;
  current: number;
  longest: number;
  lastDate: string | null;
}
