export type AiEvaluationConfidence = 'high' | 'medium' | 'low';

export interface AiEvaluationCriterion {
  id: string;
  title: string;
  category: string;
  maxScore: number;
  aiScore: number;
  reviewerScore?: number;
  confidence: AiEvaluationConfidence;
  rationale: string;
  evidence: string[];
  risks: string[];
  suggestions: string[];
  reviewerNote: string;
}

export interface AiEvaluationResult {
  projectName: string;
  summary: string;
  criteria: AiEvaluationCriterion[];
  highRisks: string[];
}

export interface AiEvaluationModelCriterion {
  id?: unknown;
  title?: unknown;
  category?: unknown;
  maxScore?: unknown;
  score?: unknown;
  aiScore?: unknown;
  confidence?: unknown;
  rationale?: unknown;
  evidence?: unknown;
  risks?: unknown;
  suggestions?: unknown;
}

export interface AiEvaluationModelResult {
  projectName?: unknown;
  summary?: unknown;
  criteria?: unknown;
  highRisks?: unknown;
}
