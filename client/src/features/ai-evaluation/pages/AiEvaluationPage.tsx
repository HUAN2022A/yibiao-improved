import { useMemo, useState } from 'react';
import { aiClient } from '../../../shared/ai/aiClient';
import {
  FloatingToolbar,
  MarkdownRenderer,
  ProgressBar,
  ToolbarArrowLeftIcon,
  ToolbarSparkleIcon,
  useToast,
} from '../../../shared/ui';
import type { FloatingToolbarGroup } from '../../../shared/ui';
import { aiEvaluationSystemPrompt, buildAiEvaluationUserPrompt } from '../prompts/aiEvaluationPrompts';
import type {
  AiEvaluationConfidence,
  AiEvaluationCriterion,
  AiEvaluationModelCriterion,
  AiEvaluationModelResult,
  AiEvaluationResult,
} from '../types';

const sampleScoringRules = `一、技术方案完整性（30分）
方案内容完整、实施路径清晰、对项目重点难点理解准确，最高得30分；每缺少一项关键内容扣5分。

二、项目实施计划（25分）
进度计划合理得15分；质量保障措施完整得5分；风险控制措施完整得5分。

三、项目团队（25分）
项目经理具备同类项目经验得10分；团队专业配置齐全得10分；岗位分工明确得5分。

四、售后服务（20分）
提供7×24小时服务得8分；故障响应不超过2小时得7分；有完整培训方案得5分。`;

const sampleBidContent = `本项目拟采用“调研—设计—实施—试运行—验收”五阶段实施路线，并设置周计划与里程碑复核机制。项目周期为120日历天，其中需求调研15天、系统设计20天、开发实施55天、试运行20天、验收10天。

质量方面执行三级评审制度，交付物由编制人自检、项目组交叉复核、质量负责人终审。针对需求变更、进度延误和数据迁移分别制定风险登记、每周跟踪和应急回退措施。

项目经理张某具有8年信息化项目经验，曾负责两个同类项目。团队配置项目经理、架构师、开发工程师、测试工程师和实施工程师，并说明了各岗位职责。

项目验收后提供一年运维服务，设立服务热线。一般问题4小时内响应，重大故障2小时内响应。项目实施期间安排管理员培训和用户操作培训。材料未明确说明是否提供7×24小时服务。`;

const confidenceLabels: Record<AiEvaluationConfidence, string> = {
  high: '高置信',
  medium: '中置信',
  low: '低置信',
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

function normalizeCriterion(value: AiEvaluationModelCriterion, index: number): AiEvaluationCriterion | null {
  const title = toText(value.title);
  if (!title) return null;

  const maxScore = Math.max(0, toScore(value.maxScore));
  const rawScore = value.score ?? value.aiScore;
  const aiScore = roundScore(Math.min(maxScore, Math.max(0, toScore(rawScore))));
  const confidence: AiEvaluationConfidence = value.confidence === 'high' || value.confidence === 'low'
    ? value.confidence
    : 'medium';

  return {
    id: toText(value.id, `criterion-${index + 1}`),
    title,
    category: toText(value.category, '综合评分'),
    maxScore: roundScore(maxScore),
    aiScore,
    confidence,
    rationale: toText(value.rationale, '模型未提供评分理由。'),
    evidence: toTextList(value.evidence, ['未找到明确响应']),
    risks: toTextList(value.risks),
    suggestions: toTextList(value.suggestions),
    reviewerNote: '',
  };
}

function normalizeResult(value: AiEvaluationModelResult, fallbackProjectName: string): AiEvaluationResult {
  const rawCriteria = Array.isArray(value?.criteria) ? value.criteria : [];
  const criteria = rawCriteria
    .map((item, index) => normalizeCriterion((item || {}) as AiEvaluationModelCriterion, index))
    .filter((item): item is AiEvaluationCriterion => Boolean(item));

  if (criteria.length === 0) {
    throw new Error('AI 未返回有效评分项，请检查评分办法后重试');
  }

  return {
    projectName: toText(value.projectName, fallbackProjectName || '未命名项目'),
    summary: toText(value.summary, '评审已完成，请结合分项证据进行人工复核。'),
    criteria,
    highRisks: toTextList(value.highRisks),
  };
}

function AiEvaluationPage() {
  const { showToast } = useToast();
  const [projectName, setProjectName] = useState('');
  const [scoringRules, setScoringRules] = useState('');
  const [bidContent, setBidContent] = useState('');
  const [result, setResult] = useState<AiEvaluationResult | null>(null);
  const [running, setRunning] = useState(false);

  const totals = useMemo(() => {
    const criteria = result?.criteria || [];
    return {
      ai: roundScore(criteria.reduce((sum, item) => sum + item.aiScore, 0)),
      reviewed: roundScore(criteria.reduce((sum, item) => sum + (item.reviewerScore ?? item.aiScore), 0)),
      maximum: roundScore(criteria.reduce((sum, item) => sum + item.maxScore, 0)),
      riskCount: criteria.reduce((sum, item) => sum + item.risks.length, 0) + (result?.highRisks.length || 0),
    };
  }, [result]);

  const fillSample = () => {
    setProjectName('智慧园区运维平台项目');
    setScoringRules(sampleScoringRules);
    setBidContent(sampleBidContent);
    setResult(null);
    showToast('已填入演示材料，可直接开始评标', 'info');
  };

  const startEvaluation = async () => {
    if (!scoringRules.trim()) {
      showToast('请先填写招标评分办法', 'error');
      return;
    }
    if (!bidContent.trim()) {
      showToast('请先填写投标文件或响应内容', 'error');
      return;
    }

    setRunning(true);
    try {
      const response = await aiClient.requestJson<AiEvaluationModelResult>({
        messages: [
          { role: 'system', content: aiEvaluationSystemPrompt },
          { role: 'user', content: buildAiEvaluationUserPrompt({ projectName, scoringRules, bidContent }) },
        ],
        response_format: { type: 'json_object' },
        schemaName: 'ai_evaluation_result',
        max_retries: 2,
        progressLabel: 'AI 正在逐项评审',
        failureMessage: 'AI 评标失败',
        logTitle: 'AI评标',
      });
      setResult(normalizeResult(response, projectName.trim()));
      showToast('AI 评标完成，请复核分数和证据', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'AI 评标失败，请稍后重试', 'error');
    } finally {
      setRunning(false);
    }
  };

  const updateCriterion = (criterionId: string, patch: Partial<AiEvaluationCriterion>) => {
    setResult((current) => current ? {
      ...current,
      criteria: current.criteria.map((item) => item.id === criterionId ? { ...item, ...patch } : item),
    } : current);
  };

  const toolbarGroups: FloatingToolbarGroup[] = result ? [
    {
      id: 'navigation',
      actions: [{
        id: 'back',
        label: '返回修改材料',
        icon: <ToolbarArrowLeftIcon />,
        onClick: () => setResult(null),
      }],
    },
    {
      id: 'rerun',
      actions: [{
        id: 'rerun-evaluation',
        label: running ? '正在评标...' : '重新 AI 评标',
        icon: <ToolbarSparkleIcon />,
        variant: 'ai',
        disabled: running,
        onClick: () => void startEvaluation(),
      }],
    },
  ] : [
    {
      id: 'evaluation',
      actions: [{
        id: 'start-evaluation',
        label: running ? '正在评标...' : '开始 AI 评标',
        icon: <ToolbarSparkleIcon />,
        variant: 'ai',
        disabled: running,
        onClick: () => void startEvaluation(),
      }],
    },
  ];

  return (
    <div className="ai-evaluation-page">
      <header className="ai-evaluation-header">
        <div>
          <span className="ai-evaluation-kicker">AI 评标</span>
          <h2>{result ? result.projectName : '投标文件模拟评审'}</h2>
          <p>{result ? '逐项核对评分理由与原文证据，人工分数将优先计入确认总分。' : '录入评分办法和投标响应内容，由 AI 给出可追溯的分项建议分。'}</p>
        </div>
        <div className="ai-evaluation-stepper" aria-label="评标步骤">
          <span className={!result ? 'is-active' : 'is-complete'}><b>1</b>准备材料</span>
          <i />
          <span className={result ? 'is-active' : ''}><b>2</b>评分复核</span>
        </div>
      </header>

      {running ? (
        <section className="ai-evaluation-running" aria-live="polite">
          <div><strong>正在分析评分标准与响应证据</strong><span>模型会逐项核对，耗时取决于材料长度。</span></div>
          <ProgressBar value={68} active label="AI 评标进行中" />
        </section>
      ) : null}

      <main className="ai-evaluation-scroll">
        {!result ? (
          <div className="ai-evaluation-input-layout">
            <section className="ai-evaluation-panel ai-evaluation-project-panel">
              <div className="ai-evaluation-panel-head">
                <div><span>项目资料</span><h3>准备评标输入</h3></div>
                <button type="button" className="secondary-action" onClick={fillSample} disabled={running}>填入示例</button>
              </div>
              <label className="ai-evaluation-field">
                <span>项目名称 <small>选填</small></span>
                <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="例如：智慧园区运维平台项目" disabled={running} />
              </label>
            </section>

            <section className="ai-evaluation-panel ai-evaluation-text-panel">
              <div className="ai-evaluation-panel-head">
                <div><span>评分依据</span><h3>招标评分办法</h3></div>
                <em>{scoringRules.length.toLocaleString('zh-CN')} 字符</em>
              </div>
              <textarea value={scoringRules} onChange={(event) => setScoringRules(event.target.value)} placeholder="粘贴评分因素、分值、评分档次、计算公式等内容..." disabled={running} />
            </section>

            <section className="ai-evaluation-panel ai-evaluation-text-panel">
              <div className="ai-evaluation-panel-head">
                <div><span>评审对象</span><h3>投标文件或响应内容</h3></div>
                <em>{bidContent.length.toLocaleString('zh-CN')} 字符</em>
              </div>
              <textarea value={bidContent} onChange={(event) => setBidContent(event.target.value)} placeholder="粘贴需要评审的投标文件正文、关键章节或响应内容..." disabled={running} />
            </section>
          </div>
        ) : (
          <div className="ai-evaluation-result-layout">
            <section className="ai-evaluation-summary-grid">
              <article><span>AI 建议总分</span><strong>{totals.ai}</strong><small>/ {totals.maximum} 分</small></article>
              <article className="is-reviewed"><span>人工确认总分</span><strong>{totals.reviewed}</strong><small>/ {totals.maximum} 分</small></article>
              <article className={totals.riskCount ? 'is-risk' : ''}><span>待关注风险</span><strong>{totals.riskCount}</strong><small>项</small></article>
            </section>

            <section className="ai-evaluation-panel ai-evaluation-overview">
              <div className="ai-evaluation-panel-head"><div><span>总体结论</span><h3>评审摘要</h3></div></div>
              <div className="markdown-viewer"><MarkdownRenderer allowRawHtml={false}>{result.summary}</MarkdownRenderer></div>
              {result.highRisks.length ? (
                <div className="ai-evaluation-high-risks"><strong>优先复核</strong><ul>{result.highRisks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div>
              ) : null}
            </section>

            <div className="ai-evaluation-criteria">
              {result.criteria.map((criterion, index) => {
                const finalScore = criterion.reviewerScore ?? criterion.aiScore;
                const scorePercent = criterion.maxScore > 0 ? finalScore / criterion.maxScore * 100 : 0;
                return (
                  <article className="ai-evaluation-criterion" key={criterion.id}>
                    <div className="ai-evaluation-criterion-head">
                      <span className="ai-evaluation-index">{String(index + 1).padStart(2, '0')}</span>
                      <div><small>{criterion.category}</small><h3>{criterion.title}</h3></div>
                      <span className={`ai-evaluation-confidence is-${criterion.confidence}`}>{confidenceLabels[criterion.confidence]}</span>
                      <div className="ai-evaluation-score"><strong>{finalScore}</strong><span>/ {criterion.maxScore}</span></div>
                    </div>
                    <ProgressBar value={scorePercent} tone={criterion.risks.length ? 'warning' : 'success'} label={`${criterion.title} 得分 ${finalScore}，满分 ${criterion.maxScore}`} />
                    <div className="ai-evaluation-criterion-body">
                      <section><h4>评分理由</h4><div className="markdown-viewer"><MarkdownRenderer allowRawHtml={false}>{criterion.rationale}</MarkdownRenderer></div></section>
                      <section><h4>响应证据</h4><ul>{criterion.evidence.map((item) => <li key={item}>{item}</li>)}</ul></section>
                      {criterion.risks.length ? <section className="is-risk"><h4>失分风险</h4><ul>{criterion.risks.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
                      {criterion.suggestions.length ? <section className="is-suggestion"><h4>改进建议</h4><ul>{criterion.suggestions.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
                    </div>
                    <div className="ai-evaluation-review">
                      <label><span>人工确认分</span><input type="number" min="0" max={criterion.maxScore} step="0.5" value={criterion.reviewerScore ?? ''} placeholder={String(criterion.aiScore)} onChange={(event) => {
                        const value = event.target.value;
                        updateCriterion(criterion.id, { reviewerScore: value === '' ? undefined : roundScore(Math.min(criterion.maxScore, Math.max(0, Number(value)))) });
                      }} /></label>
                      <label><span>复核备注</span><input value={criterion.reviewerNote} placeholder="记录调分依据或待确认事项" onChange={(event) => updateCriterion(criterion.id, { reviewerNote: event.target.value })} /></label>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <FloatingToolbar groups={toolbarGroups} label="AI 评标操作" />
    </div>
  );
}

export default AiEvaluationPage;
