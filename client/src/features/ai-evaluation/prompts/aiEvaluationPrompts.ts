export const aiEvaluationSystemPrompt = `你是一名严谨的中国招投标评审专家，负责对招标文件和投标方案做证据可追溯的模拟评标。

通用规则：
1. 招标文件是评分依据的唯一来源；投标文件只用于判断响应，不得反向修改评分规则。
2. 必须严格区分“招标要求”“投标证据”和“模型判断”，不能把推断写成事实。
3. 没有明确证据时使用“未发现明确响应”或“无法判断”，不得虚构页码、章节号、参数、证书、人员或承诺。
4. 所有分数都不能超过评分点满分；价格或公式评分只有在公式和必要参数完整时才计算。
5. sourceLocator 只能填写材料中实际出现的章节、条款、表格等位置；材料没有位置线索时留空。
6. 始终使用简体中文，只输出要求的合法 JSON，不输出 Markdown 代码块或解释。`;

export function buildCriteriaExtractionPrompt(tenderMarkdown: string) {
  return `请从以下完整招标文件中提取可用于评标的结构化评分点。

提取要求：
1. 覆盖技术、商务、服务、价格和其他明确计分部分；同一评分表中的二级项应拆成独立评分点。
2. 每个评分点填写名称、分类、满分、原文评分规则、原文摘录和来源位置。
3. 评分规则必须保留档次、扣分、加分、公式和客观计算条件；没有提及时写“没有提及”。
4. 无法确认具体分值的内容不要臆造满分，maxScore 填 0 并在 scoringRule 中说明“未明确”。
5. isPriceCriterion 仅在该评分点明确属于报价/价格计算时为 true。

返回结构：
{
  "projectName": "项目名称，没有提及则为空",
  "criteria": [
    {
      "id": "criterion-1",
      "title": "评分点名称",
      "category": "技术/商务/服务/价格/其他",
      "maxScore": 10,
      "scoringRule": "完整评分规则",
      "isPriceCriterion": false,
      "sourceExcerpt": "招标文件中的原文摘录",
      "sourceLocator": "章节、条款、表格位置"
    }
  ]
}

招标文件 Markdown：
${tenderMarkdown.trim()}`;
}

export function buildResponseExtractionPrompt(criteria: string, bidDocuments: string) {
  return `请根据评分点清单，逐项检查投标方案中的响应内容和证据。

要求：
1. 每个评分点必须返回一项，criterionId 必须与输入清单完全一致。
2. status 只能是 responded、partial、not-found、unclear。未检索到明确原文时使用 not-found，不等于证明投标文件绝对没有该内容。
3. responseSummary 只总结投标文件实际写出的内容；evidence 必须是可核对的原文短摘录或明确段落内容，不得编造页码。
4. sourceLocator 仅填写投标文件实际能确认的章节、标题或表格位置；没有线索留空。
5. risks 只写与该评分点相关的缺项、矛盾或需要人工核验事项。

返回结构：
{
  "responses": [
    {
      "criterionId": "criterion-1",
      "status": "responded",
      "responseSummary": "投标方案实际响应摘要",
      "evidence": ["投标文件原文证据"],
      "sourceLocator": "章节或表格位置",
      "risks": [],
      "confidence": "high"
    }
  ]
}

评分点清单：
${criteria}

投标方案 Markdown（各文件之间用文件名分隔）：
${bidDocuments}`;
}

export function buildScoringPrompt(projectName: string, criteria: string, responses: string) {
  return `请基于已确认的招标评分点和投标响应证据，完成一次可复核的模拟评标。

评分要求：
1. 每个评分点都要返回，id 必须与输入中的评分点 id 完全一致；不得修改评分依据或响应证据。
2. score 在 0 到 maxScore 之间。按评分规则逐项给出建议分，不得用主观印象替代规则。
3. rationale 必须同时说明满足了哪些规则、缺少哪些要素以及因此如何扣分；没有明确证据时应保守评分并降低置信度。
4. evidence 只能来自已提供的投标响应证据；找不到时填写“未找到明确响应”。
5. highRisks 汇总需要人工优先核验的缺项、矛盾、公式参数缺失和来源不确定事项。

返回结构：
{
  "projectName": "项目名称",
  "summary": "总体评审摘要",
  "criteria": [
    {
      "id": "criterion-1",
      "score": 7,
      "confidence": "medium",
      "rationale": "评分理由",
      "evidence": ["投标证据"],
      "risks": ["失分或核验风险"],
      "suggestions": ["改进建议"]
    }
  ],
  "highRisks": []
}

项目名称：${projectName.trim() || '未填写'}

招标评分点：
${criteria}

逐项响应：
${responses}`;
}
