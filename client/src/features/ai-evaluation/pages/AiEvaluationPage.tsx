import { useEffect, useMemo, useRef, useState } from 'react';
import { aiClient } from '../../../shared/ai/aiClient';
import {
  FloatingToolbar,
  isLibreOfficeRequiredMessage,
  MarkdownRenderer,
  ProgressBar,
  ToolbarArrowLeftIcon,
  ToolbarArrowRightIcon,
  ToolbarSparkleIcon,
  UploadBoard,
  UploadEmpty,
  UploadFilePill,
  UploadRow,
  useDocumentParseNotice,
  useToast,
} from '../../../shared/ui';
import type { FloatingToolbarGroup } from '../../../shared/ui';
import {
  aiEvaluationSystemPrompt,
  buildCriteriaExtractionPrompt,
  buildResponseExtractionPrompt,
  buildScoringPrompt,
} from '../prompts/aiEvaluationPrompts';
import type {
  AiEvaluationConfidence,
  AiEvaluationCriterion,
  AiEvaluationCriteriaModelResult,
  AiEvaluationDocument,
  AiEvaluationModelCriterion,
  AiEvaluationModelResponse,
  AiEvaluationModelResult,
  AiEvaluationResponse,
  AiEvaluationResponseStatus,
  AiEvaluationResponsesModelResult,
  AiEvaluationResult,
  AiEvaluationStep,
  AiEvaluationWorkspaceState,
} from '../types';

const stepLabels: Array<{ id: AiEvaluationStep; label: string }> = [
  { id: 'tender', label: '招标文件' },
  { id: 'criteria', label: '评分点' },
  { id: 'bid', label: '方案文件' },
  { id: 'responses', label: '响应提取' },
  { id: 'results', label: '评分结果' },
];

const confidenceLabels: Record<AiEvaluationConfidence, string> = {
  high: '高置信',
  medium: '中置信',
  low: '低置信',
};

const responseStatusLabels: Record<AiEvaluationResponseStatus, string> = {
  responded: '已响应',
  partial: '部分响应',
  'not-found': '未发现明确响应',
  unclear: '无法判断',
};

function toText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toTextList(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => toText(item)).filter(Boolean);
}

function toScore(value: unknown, fallback = 0) {
  const score = Number(value);
  return Number.isFinite(score) ? score : fallback;
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeConfidence(value: unknown): AiEvaluationConfidence {
  return value === 'high' || value === 'low' ? value : 'medium';
}

function normalizeResponseStatus(value: unknown): AiEvaluationResponseStatus {
  return value === 'responded' || value === 'partial' || value === 'not-found' || value === 'unclear'
    ? value
    : 'not-found';
}

function normalizeResponse(value: unknown, criterionId: string): AiEvaluationResponse {
  const item = (value || {}) as AiEvaluationModelResponse;
  const evidence = toTextList(item.evidence, ['未找到明确响应']);
  return {
    criterionId,
    status: normalizeResponseStatus(item.status),
    responseSummary: toText(item.responseSummary, '未发现明确响应。'),
    evidence: evidence.length ? evidence : ['未找到明确响应'],
    sourceLocator: toText(item.sourceLocator) || undefined,
    risks: toTextList(item.risks),
    confidence: normalizeConfidence(item.confidence),
  };
}

function normalizeCriterion(value: unknown, index: number): AiEvaluationCriterion | null {
  const item = (value || {}) as AiEvaluationModelCriterion;
  const title = toText(item.title);
  if (!title) return null;
  const maxScore = roundScore(Math.max(0, toScore(item.maxScore)));
  const rawScore = item.score ?? item.aiScore;
  const aiScore = roundScore(Math.min(maxScore, Math.max(0, toScore(rawScore))));
  return {
    id: toText(item.id, `criterion-${index + 1}`),
    title,
    category: toText(item.category, '综合评分'),
    maxScore,
    scoringRule: toText(item.scoringRule, '评分规则未明确。'),
    isPriceCriterion: item.isPriceCriterion === true,
    sourceExcerpt: toText(item.sourceExcerpt, '未找到明确招标原文摘录。'),
    sourceLocator: toText(item.sourceLocator) || undefined,
    response: item.response ? normalizeResponse(item.response, toText(item.id, `criterion-${index + 1}`)) : undefined,
    aiScore,
    confidence: normalizeConfidence(item.confidence),
    rationale: toText(item.rationale, '尚未完成评分。'),
    evidence: toTextList(item.evidence, ['未找到明确响应']),
    risks: toTextList(item.risks),
    suggestions: toTextList(item.suggestions),
    reviewerNote: '',
  };
}

function normalizeCriteria(value: AiEvaluationCriteriaModelResult): AiEvaluationCriterion[] {
  const rawCriteria = Array.isArray(value?.criteria) ? value.criteria : [];
  const usedIds = new Set<string>();
  return rawCriteria.map(normalizeCriterion).filter((item): item is AiEvaluationCriterion => Boolean(item)).map((item, index) => {
    const requestedId = item.id || `criterion-${index + 1}`;
    let id = requestedId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${requestedId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return { ...item, id };
  });
}

function normalizeResponses(value: AiEvaluationResponsesModelResult, criteria: AiEvaluationCriterion[]) {
  const rawResponses = Array.isArray(value?.responses) ? value.responses : [];
  const byId = new Map(rawResponses.map((item) => [toText((item as AiEvaluationModelResponse)?.criterionId), item]));
  return criteria.map((criterion) => normalizeResponse(byId.get(criterion.id), criterion.id));
}

function mergeScoringResult(
  value: AiEvaluationModelResult,
  criteria: AiEvaluationCriterion[],
  responses: AiEvaluationResponse[],
  fallbackProjectName: string,
): AiEvaluationResult {
  const rawCriteria = Array.isArray(value?.criteria) ? value.criteria : [];
  const byId = new Map(rawCriteria.map((item) => [toText((item as AiEvaluationModelCriterion)?.id), item]));
  const responseById = new Map(responses.map((item) => [item.criterionId, item]));
  return {
    projectName: toText(value.projectName, fallbackProjectName || '未命名项目'),
    summary: toText(value.summary, '评审已完成，请结合分项证据进行人工复核。'),
    highRisks: toTextList(value.highRisks),
    criteria: criteria.map((base) => {
      const raw = (byId.get(base.id) || {}) as AiEvaluationModelCriterion;
      const response = responseById.get(base.id);
      const score = roundScore(Math.min(base.maxScore, Math.max(0, toScore(raw.score ?? raw.aiScore, 0))));
      return {
        ...base,
        scoringRule: toText(raw.scoringRule, base.scoringRule),
        sourceExcerpt: toText(raw.sourceExcerpt, base.sourceExcerpt),
        sourceLocator: toText(raw.sourceLocator, base.sourceLocator || '') || undefined,
        response,
        aiScore: score,
        confidence: normalizeConfidence(raw.confidence),
        rationale: toText(raw.rationale, '模型未提供评分理由。'),
        evidence: toTextList(raw.evidence, response?.evidence || ['未找到明确响应']),
        risks: toTextList(raw.risks, response?.risks || []),
        suggestions: toTextList(raw.suggestions),
      };
    }),
  };
}

function documentMarkdown(documents: AiEvaluationDocument[]) {
  return documents.map((document) => `\n===== 文件：${document.fileName} =====\n${document.content}`).join('\n');
}

function documentId(role: string) {
  return `${role}-${globalThis.crypto.randomUUID()}`;
}

function AiEvaluationPage() {
  const { showToast } = useToast();
  const { showDocumentParseNotice } = useDocumentParseNotice();
  const [step, setStep] = useState<AiEvaluationStep>('tender');
  const [projectName, setProjectName] = useState('');
  const [tenderDocuments, setTenderDocuments] = useState<AiEvaluationDocument[]>([]);
  const [bidDocuments, setBidDocuments] = useState<AiEvaluationDocument[]>([]);
  const [tenderMarkdown, setTenderMarkdown] = useState('');
  const [criteria, setCriteria] = useState<AiEvaluationCriterion[]>([]);
  const [responses, setResponses] = useState<AiEvaluationResponse[]>([]);
  const [result, setResult] = useState<AiEvaluationResult | null>(null);
  const [running, setRunning] = useState<AiEvaluationStep | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const latestWorkspaceRef = useRef<Pick<AiEvaluationWorkspaceState, 'step' | 'projectName' | 'criteria' | 'responses' | 'result'>>({
    step,
    projectName,
    criteria,
    responses,
    result,
  });

  latestWorkspaceRef.current = { step, projectName, criteria, responses, result };

  useEffect(() => {
    let canceled = false;
    void window.yibiao.aiEvaluation.loadState().then((saved) => {
      if (canceled) return;
      setStep(saved.step);
      setProjectName(saved.projectName);
      setTenderDocuments(saved.tenderDocuments);
      setTenderMarkdown(saved.tenderDocuments[0]?.content || '');
      setBidDocuments(saved.bidDocuments);
      setCriteria(saved.criteria);
      setResponses(saved.responses);
      setResult(saved.result);
      setWorkspaceReady(true);
    }).catch((error) => {
      if (!canceled) showToast(error instanceof Error ? error.message : '评标工作区加载失败', 'error');
    }).finally(() => {
      if (!canceled) setWorkspaceLoading(false);
    });
    return () => {
      canceled = true;
    };
  }, [showToast]);

  useEffect(() => {
    if (!workspaceReady) return undefined;
    const timer = window.setTimeout(() => {
      void window.yibiao.aiEvaluation.saveState(latestWorkspaceRef.current).catch((error) => {
        console.error('[ai-evaluation] 保存工作区失败', error);
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [criteria, projectName, responses, result, step, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady) return undefined;
    return () => {
      void window.yibiao.aiEvaluation.saveState(latestWorkspaceRef.current).catch(() => undefined);
    };
  }, [workspaceReady]);

  const totals = useMemo(() => {
    const items = result?.criteria || [];
    const maximum = roundScore(items.reduce((sum, item) => sum + item.maxScore, 0));
    return {
      ai: roundScore(items.reduce((sum, item) => sum + item.aiScore, 0)),
      reviewed: roundScore(items.reduce((sum, item) => sum + (item.reviewerScore ?? item.aiScore), 0)),
      maximum,
      riskCount: items.reduce((sum, item) => sum + item.risks.length + (item.response?.risks.length || 0), 0) + (result?.highRisks.length || 0),
    };
  }, [result]);

  const importDocuments = async (role: 'tender' | 'bid', filePaths?: string[]) => {
    try {
      setRunning(role);
      const importer = window.yibiao?.file.importDocument;
      if (typeof importer !== 'function') throw new Error('文件解析接口尚未加载，请重启应用后重试');
      const imported = await importer({
        documentLabel: role === 'tender' ? '招标文件' : '投标方案文件',
        multiple: role === 'bid',
        filePaths,
        assetScopePrefix: `ai-evaluation-${role}`,
      });
      if (!imported?.success) {
        const message = imported?.message || '未选择文件';
        if (isLibreOfficeRequiredMessage(message)) showDocumentParseNotice(message);
        else showToast(message, 'error');
        return;
      }
      const documents = (imported.documents || []).map((item) => ({
        id: documentId(role),
        fileName: item.file_name,
        content: item.file_content,
        parserLabel: item.parser_label,
      }));
      if (!documents.length) throw new Error('文件解析结果为空');
      if (role === 'tender') {
        const nextDocuments = documents.slice(0, 1);
        await window.yibiao.aiEvaluation.saveDocuments('tender', nextDocuments);
        await window.yibiao.aiEvaluation.saveState({ step: 'tender', criteria: [], responses: [], result: null });
        setTenderDocuments(nextDocuments);
        setTenderMarkdown(documents[0].content);
        setCriteria([]);
        setResponses([]);
        setResult(null);
        setStep('tender');
      } else {
        const nextDocuments = [...bidDocuments];
        documents.forEach((document) => {
          if (!nextDocuments.some((item) => item.fileName === document.fileName && item.content === document.content)) nextDocuments.push(document);
        });
        await window.yibiao.aiEvaluation.saveDocuments('bid', nextDocuments);
        await window.yibiao.aiEvaluation.saveState({ step: 'bid', responses: [], result: null });
        setBidDocuments(nextDocuments);
        setResponses([]);
        setResult(null);
        setStep('bid');
      }
      showToast(imported.message || '文件解析完成', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件解析失败';
      if (isLibreOfficeRequiredMessage(message)) showDocumentParseNotice(message);
      else showToast(message, 'error');
    } finally {
      setRunning(null);
    }
  };

  const extractCriteria = async () => {
    if (!tenderMarkdown.trim()) {
      showToast('请先上传招标文件', 'error');
      setStep('tender');
      return;
    }
    setRunning('criteria');
    try {
      const response = await aiClient.requestJson<AiEvaluationCriteriaModelResult>({
        messages: [
          { role: 'system', content: aiEvaluationSystemPrompt },
          { role: 'user', content: buildCriteriaExtractionPrompt(tenderMarkdown) },
        ],
        response_format: { type: 'json_object' },
        schemaName: 'ai_evaluation_criteria',
        max_retries: 2,
        progressLabel: '正在提取招标评分点',
        failureMessage: '评分点提取失败',
        logTitle: 'AI评标-评分点提取',
      });
      const nextCriteria = normalizeCriteria(response);
      if (!nextCriteria.length) throw new Error('AI 未提取到有效评分点，请检查招标文件中的评标办法');
      const nextProjectName = projectName || toText(response.projectName);
      await window.yibiao.aiEvaluation.saveState({
        step: 'criteria',
        projectName: nextProjectName,
        criteria: nextCriteria,
        responses: [],
        result: null,
      });
      setCriteria(nextCriteria);
      setProjectName(nextProjectName);
      setResponses([]);
      setResult(null);
      setStep('criteria');
      showToast(`已提取 ${nextCriteria.length} 个评分点，请核对满分和评分规则`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '评分点提取失败，请稍后重试', 'error');
    } finally {
      setRunning(null);
    }
  };

  const extractResponses = async () => {
    if (!criteria.length) {
      showToast('请先提取并确认评分点', 'error');
      setStep('criteria');
      return;
    }
    if (!bidDocuments.length) {
      showToast('请先上传投标方案文件', 'error');
      setStep('bid');
      return;
    }
    setRunning('responses');
    try {
      const response = await aiClient.requestJson<AiEvaluationResponsesModelResult>({
        messages: [
          { role: 'system', content: aiEvaluationSystemPrompt },
          {
            role: 'user',
            content: buildResponseExtractionPrompt(
              JSON.stringify(criteria.map(({ id, title, category, maxScore, scoringRule, sourceExcerpt, sourceLocator }) => ({ id, title, category, maxScore, scoringRule, sourceExcerpt, sourceLocator })), null, 2),
              documentMarkdown(bidDocuments),
            ),
          },
        ],
        response_format: { type: 'json_object' },
        schemaName: 'ai_evaluation_responses',
        max_retries: 2,
        progressLabel: '正在逐项提取方案响应',
        failureMessage: '方案响应提取失败',
        logTitle: 'AI评标-响应提取',
      });
      const nextResponses = normalizeResponses(response, criteria);
      const nextCriteria = criteria.map((criterion) => ({ ...criterion, response: nextResponses.find((item) => item.criterionId === criterion.id) }));
      await window.yibiao.aiEvaluation.saveState({
        step: 'responses',
        criteria: nextCriteria,
        responses: nextResponses,
        result: null,
      });
      setResponses(nextResponses);
      setCriteria(nextCriteria);
      setResult(null);
      setStep('responses');
      showToast('方案响应提取完成，请复核证据和来源位置', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '方案响应提取失败，请稍后重试', 'error');
    } finally {
      setRunning(null);
    }
  };

  const scoreEvaluation = async () => {
    if (!criteria.length || !responses.length) {
      showToast('请先完成评分点和响应提取', 'error');
      return;
    }
    setRunning('results');
    try {
      const response = await aiClient.requestJson<AiEvaluationModelResult>({
        messages: [
          { role: 'system', content: aiEvaluationSystemPrompt },
          {
            role: 'user',
            content: buildScoringPrompt(
              projectName,
              JSON.stringify(criteria.map(({ response: _response, aiScore: _aiScore, reviewerScore: _reviewerScore, reviewerNote: _reviewerNote, ...criterion }) => criterion), null, 2),
              JSON.stringify(responses, null, 2),
            ),
          },
        ],
        response_format: { type: 'json_object' },
        schemaName: 'ai_evaluation_result',
        max_retries: 2,
        progressLabel: '正在依据评分规则生成分项得分',
        failureMessage: 'AI 评分失败',
        logTitle: 'AI评标-最终评分',
      });
      const nextResult = mergeScoringResult(response, criteria, responses, projectName);
      await window.yibiao.aiEvaluation.saveState({ step: 'results', result: nextResult });
      setResult(nextResult);
      setStep('results');
      showToast('AI 评标完成，请复核分数和证据', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'AI 评分失败，请稍后重试', 'error');
    } finally {
      setRunning(null);
    }
  };

  const updateCriterion = (criterionId: string, patch: Partial<AiEvaluationCriterion>) => {
    setCriteria((current) => current.map((item) => item.id === criterionId ? { ...item, ...patch } : item));
    setResult(null);
  };

  const updateResponse = (criterionId: string, patch: Partial<AiEvaluationResponse>) => {
    setResponses((current) => current.map((item) => item.criterionId === criterionId ? { ...item, ...patch } : item));
    setCriteria((current) => current.map((item) => item.id === criterionId && item.response ? { ...item, response: { ...item.response, ...patch } } : item));
    setResult(null);
  };

  const removeDocument = async (role: 'tender' | 'bid', id: string) => {
    try {
      if (role === 'tender') {
        await window.yibiao.aiEvaluation.saveDocuments('tender', []);
        await window.yibiao.aiEvaluation.saveState({ step: 'tender', criteria: [], responses: [], result: null });
        setTenderDocuments([]);
        setTenderMarkdown('');
        setCriteria([]);
        setResponses([]);
        setResult(null);
        setStep('tender');
      } else {
        const nextDocuments = bidDocuments.filter((item) => item.id !== id);
        await window.yibiao.aiEvaluation.saveDocuments('bid', nextDocuments);
        await window.yibiao.aiEvaluation.saveState({ responses: [], result: null });
        setBidDocuments(nextDocuments);
        setResponses([]);
        setResult(null);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '移除文件失败', 'error');
    }
  };

  const goBack = () => {
    const index = stepLabels.findIndex((item) => item.id === step);
    if (index > 0) setStep(stepLabels[index - 1].id);
  };

  const nextAction = step === 'tender' ? extractCriteria
    : step === 'criteria' ? () => setStep('bid')
      : step === 'bid' ? extractResponses
        : step === 'responses' ? scoreEvaluation
          : scoreEvaluation;
  const nextLabel = step === 'tender' ? '提取评分点' : step === 'criteria' ? '确认评分点' : step === 'bid' ? '提取方案响应' : step === 'responses' ? '生成打分' : '重新评分';
  const toolbarGroups: FloatingToolbarGroup[] = [
    ...(step !== 'tender' ? [{
      id: 'back',
      actions: [{ id: 'back-stage', label: '返回上一步', icon: <ToolbarArrowLeftIcon />, onClick: goBack }],
    }] : []),
    {
      id: 'next',
      actions: [{
        id: 'next-stage',
        label: running ? '处理中...' : nextLabel,
        icon: step === 'results' ? <ToolbarSparkleIcon /> : <ToolbarArrowRightIcon />,
        variant: step === 'results' ? 'ai' : 'primary',
        disabled: workspaceLoading || running !== null || (step === 'criteria' && !criteria.length) || (step === 'bid' && !bidDocuments.length) || (step === 'responses' && !responses.length),
        onClick: () => void nextAction(),
      }],
    },
  ];

  return (
    <div className="ai-evaluation-page">
      <header className="ai-evaluation-header">
        <div>
          <span className="ai-evaluation-kicker">AI 评标</span>
          <h2>{result?.projectName || projectName || '从招标评分点到方案打分'}</h2>
          <p>先以招标文件建立评分依据，再逐项核对方案响应和证据，最后生成可复核的模拟分数。</p>
        </div>
        <nav className="ai-evaluation-stepper" aria-label="评标步骤">
          {stepLabels.map((item, index) => {
            const activeIndex = stepLabels.findIndex((current) => current.id === step);
            const complete = index < activeIndex;
            return (
              <span key={item.id} className={item.id === step ? 'is-active' : complete ? 'is-complete' : ''}>
                <button type="button" onClick={() => complete || item.id === step ? setStep(item.id) : undefined} disabled={workspaceLoading || (!complete && item.id !== step)}>
                  <b>{index + 1}</b>{item.label}
                </button>
                {index < stepLabels.length - 1 ? <i /> : null}
              </span>
            );
          })}
        </nav>
      </header>

      {workspaceLoading || running ? (
        <section className="ai-evaluation-running" aria-live="polite">
          <div><strong>{workspaceLoading ? '正在加载评标工作区' : running === 'tender' || running === 'bid' ? '正在解析文档' : running === 'criteria' ? '正在提取评分点' : running === 'responses' ? '正在提取方案响应' : '正在生成分项评分'}</strong><span>{workspaceLoading ? '正在恢复上次保存的材料和评审进度。' : '材料较长时可能需要稍等片刻。'}</span></div>
          <ProgressBar value={68} active label="AI 评标进行中" />
        </section>
      ) : null}

      <main className="ai-evaluation-scroll">
        {step === 'tender' ? (
          <div className="ai-evaluation-stage-layout">
            <UploadBoard kicker="STEP 01" title="上传招标文件" subtitle="复用客户端统一文档解析，将 Word、PDF、Excel 或 Markdown 转为 Markdown。">
              <UploadRow
                index="01"
                title="招标文件"
                note="必选，单份"
                onDropFiles={(files) => {
                  const paths = Array.from(files).map((file) => window.yibiao?.file.getPathForFile(file) || '').filter(Boolean);
                  if (paths.length) void importDocuments('tender', paths);
                }}
                dropDisabled={running !== null}
                actions={<button type="button" className="primary-action" onClick={() => void importDocuments('tender')} disabled={running !== null}>{running === 'tender' ? '解析中...' : tenderDocuments.length ? '重新上传' : '上传文件'}</button>}
              >
                {tenderDocuments.length ? tenderDocuments.map((document) => (
                  <UploadFilePill key={document.id} badge="MD" name={document.fileName} meta={[document.parserLabel, `${document.content.length.toLocaleString('zh-CN')} 字`].filter(Boolean).join(' · ')} onRemove={() => removeDocument('tender', document.id)} removeDisabled={running !== null} />
                )) : (
                  <UploadEmpty title="等待招标文件" hint="评分点、分值和评分公式都会以招标文件为依据。"><button type="button" className="text-button" onClick={() => void importDocuments('tender')} disabled={running !== null}>选择招标文件</button></UploadEmpty>
                )}
              </UploadRow>
            </UploadBoard>
            <section className="ai-evaluation-panel ai-evaluation-project-panel">
              <div className="ai-evaluation-panel-head"><div><span>项目资料</span><h3>项目名称</h3></div><em>选填</em></div>
              <input className="ai-evaluation-wide-input" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="AI 会优先从招标文件识别项目名称" disabled={running !== null} />
            </section>
            <section className="ai-evaluation-panel ai-evaluation-preview-panel">
              <div className="ai-evaluation-panel-head"><div><span>解析预览</span><h3>招标文件 Markdown</h3></div><em>{tenderMarkdown ? `${tenderMarkdown.length.toLocaleString('zh-CN')} 字` : '等待上传'}</em></div>
              {tenderMarkdown ? <div className="ai-evaluation-markdown-preview"><MarkdownRenderer allowRawHtml={false}>{tenderMarkdown}</MarkdownRenderer></div> : <div className="ai-evaluation-empty">导入后可在这里检查解析结果，再提取评分点。</div>}
            </section>
          </div>
        ) : null}

        {step === 'criteria' ? (
          <div className="ai-evaluation-stage-layout">
            <section className="ai-evaluation-panel ai-evaluation-stage-intro"><div><span>STEP 02 · 招标依据</span><h3>核对 AI 提取的评分点</h3><p>这里的内容来自招标文件。可以修改名称、满分和规则，确认后再进入方案响应提取。</p></div><em>{criteria.length} 个评分点</em></section>
            <div className="ai-evaluation-edit-list">
              {criteria.map((criterion, index) => (
                <article className="ai-evaluation-edit-card" key={criterion.id}>
                  <div className="ai-evaluation-edit-card-head"><span className="ai-evaluation-index">{String(index + 1).padStart(2, '0')}</span><strong>{criterion.category}</strong><label className="ai-evaluation-inline-check"><input type="checkbox" checked={criterion.isPriceCriterion} onChange={(event) => updateCriterion(criterion.id, { isPriceCriterion: event.target.checked })} />价格/公式项</label></div>
                  <div className="ai-evaluation-edit-grid"><label><span>评分点名称</span><input value={criterion.title} onChange={(event) => updateCriterion(criterion.id, { title: event.target.value })} /></label><label><span>分类</span><input value={criterion.category} onChange={(event) => updateCriterion(criterion.id, { category: event.target.value })} /></label><label><span>满分</span><input type="number" min="0" step="0.5" value={criterion.maxScore} onChange={(event) => updateCriterion(criterion.id, { maxScore: roundScore(Math.max(0, Number(event.target.value) || 0)) })} /></label></div>
                  <label className="ai-evaluation-edit-field"><span>评分规则</span><textarea value={criterion.scoringRule} onChange={(event) => updateCriterion(criterion.id, { scoringRule: event.target.value })} /></label>
                  <div className="ai-evaluation-source-note"><strong>招标原文依据</strong><p>{criterion.sourceExcerpt}</p>{criterion.sourceLocator ? <small>来源位置：{criterion.sourceLocator}</small> : <small>来源位置：材料未提供明确定位</small>}</div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {step === 'bid' ? (
          <div className="ai-evaluation-stage-layout">
            <UploadBoard kicker="STEP 03" title="上传投标方案文件" subtitle="可一次选择多个文件，系统会在响应提取时按文件名保留来源边界。">
              <UploadRow
                index="01"
                title="投标方案"
                note="必选，可多份"
                onDropFiles={(files) => {
                  const paths = Array.from(files).map((file) => window.yibiao?.file.getPathForFile(file) || '').filter(Boolean);
                  if (paths.length) void importDocuments('bid', paths);
                }}
                dropDisabled={running !== null}
                actions={<button type="button" className="primary-action" onClick={() => void importDocuments('bid')} disabled={running !== null}>{running === 'bid' ? '解析中...' : '继续上传'}</button>}
              >
                {bidDocuments.length ? <div className="ai-evaluation-file-list">{bidDocuments.map((document) => <UploadFilePill key={document.id} badge="MD" name={document.fileName} meta={[document.parserLabel, `${document.content.length.toLocaleString('zh-CN')} 字`].filter(Boolean).join(' · ')} onRemove={() => removeDocument('bid', document.id)} removeDisabled={running !== null} />)}</div> : <UploadEmpty title="等待投标方案文件" hint="上传后会根据已确认的评分点提取逐项响应。"><button type="button" className="text-button" onClick={() => void importDocuments('bid')} disabled={running !== null}>选择方案文件</button></UploadEmpty>}
              </UploadRow>
            </UploadBoard>
            <section className="ai-evaluation-panel ai-evaluation-stage-intro"><div><span>当前评分依据</span><h3>{criteria.length} 个评分点已确认</h3><p>方案文件只用于寻找响应证据，评分规则仍以招标文件中的评分点为准。</p></div><button type="button" className="secondary-action" onClick={() => setStep('criteria')}>返回修改评分点</button></section>
            {bidDocuments.length ? <section className="ai-evaluation-panel ai-evaluation-preview-panel"><div className="ai-evaluation-panel-head"><div><span>文件清单</span><h3>已解析方案文件</h3></div><em>{bidDocuments.length} 份</em></div><div className="ai-evaluation-file-summary">{bidDocuments.map((document) => <div key={document.id}><strong>{document.fileName}</strong><span>{document.content.length.toLocaleString('zh-CN')} 字 · {document.parserLabel || '本地解析'}</span></div>)}</div></section> : null}
          </div>
        ) : null}

        {step === 'responses' ? (
          <div className="ai-evaluation-stage-layout">
            <section className="ai-evaluation-panel ai-evaluation-stage-intro"><div><span>STEP 04 · 方案响应</span><h3>逐项复核响应内容和证据</h3><p>模型仅能确认电子文件中的内容；页码、盖章和扫描件等无法确定的信息请保留为人工核验事项。</p></div><em>{responses.length} 项响应</em></section>
            <div className="ai-evaluation-response-list">
              {criteria.map((criterion, index) => {
                const response = responses.find((item) => item.criterionId === criterion.id) || normalizeResponse(undefined, criterion.id);
                return <article className="ai-evaluation-response-card" key={criterion.id}><div className="ai-evaluation-response-head"><span className="ai-evaluation-index">{String(index + 1).padStart(2, '0')}</span><div><small>{criterion.category} · 满分 {criterion.maxScore}</small><h3>{criterion.title}</h3></div><span className={`ai-evaluation-status is-${response.status}`}>{responseStatusLabels[response.status]}</span></div><div className="ai-evaluation-response-grid"><label><span>响应状态</span><select value={response.status} onChange={(event) => updateResponse(criterion.id, { status: event.target.value as AiEvaluationResponseStatus })}>{Object.entries(responseStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>置信度</span><select value={response.confidence} onChange={(event) => updateResponse(criterion.id, { confidence: event.target.value as AiEvaluationConfidence })}>{Object.entries(confidenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>方案来源位置</span><input value={response.sourceLocator || ''} onChange={(event) => updateResponse(criterion.id, { sourceLocator: event.target.value || undefined })} placeholder="章节、标题或表格位置" /></label></div><label className="ai-evaluation-edit-field"><span>响应摘要</span><textarea value={response.responseSummary} onChange={(event) => updateResponse(criterion.id, { responseSummary: event.target.value })} /></label><label className="ai-evaluation-edit-field"><span>响应证据（每行一条）</span><textarea value={response.evidence.join('\n')} onChange={(event) => updateResponse(criterion.id, { evidence: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} /></label>{response.risks.length ? <div className="ai-evaluation-risk-note"><strong>待核验风险</strong><ul>{response.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div> : null}</article>;
              })}
            </div>
          </div>
        ) : null}

        {step === 'results' && result ? (
          <div className="ai-evaluation-result-layout">
            <section className="ai-evaluation-summary-grid"><article><span>AI 建议总分</span><strong>{totals.ai}</strong><small>/ {totals.maximum} 分</small></article><article className="is-reviewed"><span>人工确认总分</span><strong>{totals.reviewed}</strong><small>/ {totals.maximum} 分</small></article><article className={totals.riskCount ? 'is-risk' : ''}><span>待关注风险</span><strong>{totals.riskCount}</strong><small>项</small></article></section>
            <section className="ai-evaluation-panel ai-evaluation-overview"><div className="ai-evaluation-panel-head"><div><span>总体结论</span><h3>评审摘要</h3></div></div><div className="markdown-viewer"><MarkdownRenderer allowRawHtml={false}>{result.summary}</MarkdownRenderer></div>{result.highRisks.length ? <div className="ai-evaluation-high-risks"><strong>优先复核</strong><ul>{result.highRisks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div> : null}</section>
            <div className="ai-evaluation-criteria">{result.criteria.map((criterion, index) => { const finalScore = criterion.reviewerScore ?? criterion.aiScore; const scorePercent = criterion.maxScore > 0 ? finalScore / criterion.maxScore * 100 : 0; const response = criterion.response; return <article className="ai-evaluation-criterion" key={criterion.id}><div className="ai-evaluation-criterion-head"><span className="ai-evaluation-index">{String(index + 1).padStart(2, '0')}</span><div><small>{criterion.category} · {response ? responseStatusLabels[response.status] : '未提取响应'}</small><h3>{criterion.title}</h3></div><span className={`ai-evaluation-confidence is-${criterion.confidence}`}>{confidenceLabels[criterion.confidence]}</span><div className="ai-evaluation-score"><strong>{finalScore}</strong><span>/ {criterion.maxScore}</span></div></div><ProgressBar value={scorePercent} tone={criterion.risks.length ? 'warning' : 'success'} label={`${criterion.title} 得分 ${finalScore}，满分 ${criterion.maxScore}`} /><div className="ai-evaluation-rule-strip"><strong>评分规则</strong><span>{criterion.scoringRule}</span></div><div className="ai-evaluation-criterion-body"><section><h4>评分理由</h4><div className="markdown-viewer"><MarkdownRenderer allowRawHtml={false}>{criterion.rationale}</MarkdownRenderer></div></section><section><h4>响应证据</h4><ul>{(criterion.evidence.length ? criterion.evidence : ['未找到明确响应']).map((item) => <li key={item}>{item}</li>)}</ul>{response?.sourceLocator ? <small>方案来源：{response.sourceLocator}</small> : null}</section>{criterion.risks.length ? <section className="is-risk"><h4>失分风险</h4><ul>{criterion.risks.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}{criterion.suggestions.length ? <section className="is-suggestion"><h4>改进建议</h4><ul>{criterion.suggestions.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}</div><div className="ai-evaluation-review"><label><span>人工确认分</span><input type="number" min="0" max={criterion.maxScore} step="0.5" value={criterion.reviewerScore ?? ''} placeholder={String(criterion.aiScore)} onChange={(event) => { const value = event.target.value; const next = value === '' ? undefined : roundScore(Math.min(criterion.maxScore, Math.max(0, Number(value)))); setResult((current) => current ? { ...current, criteria: current.criteria.map((item) => item.id === criterion.id ? { ...item, reviewerScore: next } : item) } : current); }} /></label><label><span>复核备注</span><input value={criterion.reviewerNote} placeholder="记录调分依据或待确认事项" onChange={(event) => setResult((current) => current ? { ...current, criteria: current.criteria.map((item) => item.id === criterion.id ? { ...item, reviewerNote: event.target.value } : item) } : current)} /></label></div></article>; })}</div>
          </div>
        ) : null}
      </main>
      <FloatingToolbar groups={toolbarGroups} label="AI 评标操作" />
    </div>
  );
}

export default AiEvaluationPage;
