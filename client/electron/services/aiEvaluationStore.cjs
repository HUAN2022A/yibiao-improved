const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getAiEvaluationDir, getAiEvaluationSourcesDir } = require('../utils/paths.cjs');

const steps = new Set(['tender', 'criteria', 'bid', 'responses', 'results']);

function now() {
  return new Date().toISOString();
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonOrNull(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function normalizeDocuments(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    id: String(item?.id || crypto.randomUUID()),
    fileName: String(item?.fileName || '未命名文件'),
    content: String(item?.content || ''),
    parserLabel: item?.parserLabel ? String(item.parserLabel) : undefined,
  })).filter((item) => item.content.trim());
}

function createAiEvaluationStore({ app, db }) {
  const sourcesDir = getAiEvaluationSourcesDir(app);

  function ensureMetaRow() {
    const timestamp = now();
    db.prepare(`
      INSERT OR IGNORE INTO ai_evaluation_meta (
        id, step, project_name, created_at, updated_at
      ) VALUES (1, 'tender', '', ?, ?)
    `).run(timestamp, timestamp);
    return db.prepare('SELECT * FROM ai_evaluation_meta WHERE id = 1').get();
  }

  function readDocuments(value) {
    return safeJsonParse(value, []).map((item) => {
      const markdownPath = String(item?.markdownPath || '');
      const absolutePath = markdownPath ? path.join(getAiEvaluationDir(app), markdownPath) : '';
      return {
        id: String(item?.id || ''),
        fileName: String(item?.fileName || '未命名文件'),
        content: absolutePath && fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf-8').trim() : '',
        parserLabel: item?.parserLabel ? String(item.parserLabel) : undefined,
      };
    }).filter((item) => item.id && item.content.trim());
  }

  function loadState() {
    const row = ensureMetaRow();
    return {
      step: steps.has(row.step) ? row.step : 'tender',
      projectName: String(row.project_name || ''),
      tenderDocuments: readDocuments(row.tender_documents_json),
      bidDocuments: readDocuments(row.bid_documents_json),
      criteria: safeJsonParse(row.criteria_json, []),
      responses: safeJsonParse(row.responses_json, []),
      result: safeJsonParse(row.result_json, null),
    };
  }

  function saveState(partial = {}) {
    ensureMetaRow();
    const assignments = [];
    const values = [];
    const fields = [
      ['step', 'step', (value) => steps.has(value) ? value : 'tender'],
      ['projectName', 'project_name', (value) => String(value || '')],
      ['criteria', 'criteria_json', jsonOrNull],
      ['responses', 'responses_json', jsonOrNull],
      ['result', 'result_json', jsonOrNull],
    ];
    fields.forEach(([inputField, column, normalize]) => {
      if (!hasOwn(partial, inputField)) return;
      assignments.push(`${column} = ?`);
      values.push(normalize(partial[inputField]));
    });
    if (!assignments.length) return { success: true };
    assignments.push('updated_at = ?');
    values.push(now());
    db.prepare(`UPDATE ai_evaluation_meta SET ${assignments.join(', ')} WHERE id = 1`).run(...values);
    return { success: true };
  }

  function saveDocuments(role, value) {
    const documentRole = role === 'bid' ? 'bid' : 'tender';
    const documents = normalizeDocuments(value);
    const row = ensureMetaRow();
    const column = documentRole === 'bid' ? 'bid_documents_json' : 'tender_documents_json';
    const previous = safeJsonParse(row[column], []);
    const roleDir = path.join(sourcesDir, documentRole);
    fs.mkdirSync(roleDir, { recursive: true });

    const metadata = documents.map((document) => {
      const fileKey = crypto.createHash('sha1').update(document.id).digest('hex');
      const relativePath = path.join('sources', documentRole, `${fileKey}.md`).replace(/\\/g, '/');
      fs.writeFileSync(path.join(getAiEvaluationDir(app), relativePath), `${document.content.trim()}\n`, 'utf-8');
      return {
        id: document.id,
        fileName: document.fileName,
        markdownPath: relativePath,
        markdownChars: document.content.length,
        parserLabel: document.parserLabel || null,
        importedAt: now(),
      };
    });

    const retainedPaths = new Set(metadata.map((item) => item.markdownPath));
    previous.forEach((item) => {
      if (!item?.markdownPath || retainedPaths.has(item.markdownPath)) return;
      const filePath = path.join(getAiEvaluationDir(app), item.markdownPath);
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    });

    db.prepare(`UPDATE ai_evaluation_meta SET ${column} = ?, updated_at = ? WHERE id = 1`)
      .run(metadata.length ? JSON.stringify(metadata) : null, now());
    return { success: true };
  }

  function clear() {
    fs.rmSync(getAiEvaluationDir(app), { recursive: true, force: true });
    db.prepare('DELETE FROM ai_evaluation_meta').run();
    return loadState();
  }

  return {
    clear,
    loadState,
    saveDocuments,
    saveState,
  };
}

module.exports = {
  createAiEvaluationStore,
};
