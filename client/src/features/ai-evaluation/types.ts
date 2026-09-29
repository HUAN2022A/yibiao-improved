export type AiEvaluationStep = 'tender' | 'criteria' | 'bid' | 'responses' | 'results';

export type AiEvaluationConfidence = 'high' | 'medium' | 'low';
export type AiEvaluationResponseStatus = 'responded' | 'partial' | 'not-found' | 'unclear';

export interface AiEvaluationDocument {
  id: string;
  fileName: string;
  content: string;
  parserLabel?: string;
}

export interface AiEvaluationResponse {
  criterionId: string;
  status: AiEvaluationResponseStatus;
  responseSummary: string;
  evidence: string[];
  sourceLocator?: string;
  risks: string[];
  confidence: AiEvaluationConfidence;
}

export interface AiEvaluationCriterion {
  id: string;
  title: string;
  category: string;
  maxScore: number;
  scoringRule: string;
  isPriceCriterion: boolean;
  sourceExcerpt: string;
  sourceLocator?: string;
  response?: AiEvaluationResponse;
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

export interface AiEvaluationWorkspaceState {
  step: AiEvaluationStep;
  projectName: string;
  tenderDocuments: AiEvaluationDocument[];
  bidDocuments: AiEvaluationDocument[];
  criteria: AiEvaluationCriterion[];
  responses: AiEvaluationResponse[];
  result: AiEvaluationResult | null;
}

export interface AiEvaluationModelCriterion {
  id?: unknown;
  title?: unknown;
  category?: unknown;
  maxScore?: unknown;
  scoringRule?: unknown;
  isPriceCriterion?: unknown;
  sourceExcerpt?: unknown;
  sourceLocator?: unknown;
  score?: unknown;
  aiScore?: unknown;
  confidence?: unknown;
  rationale?: unknown;
  evidence?: unknown;
  risks?: unknown;
  suggestions?: unknown;
  response?: unknown;
}

export interface AiEvaluationModelResponse {
  criterionId?: unknown;
  status?: unknown;
  responseSummary?: unknown;
  evidence?: unknown;
  sourceLocator?: unknown;
  risks?: unknown;
  confidence?: unknown;
}

export interface AiEvaluationCriteriaModelResult {
  projectName?: unknown;
  criteria?: unknown;
}

export interface AiEvaluationResponsesModelResult {
  responses?: unknown;
}

export interface AiEvaluationModelResult {
  projectName?: unknown;
  summary?: unknown;
  criteria?: unknown;
  highRisks?: unknown;
}
