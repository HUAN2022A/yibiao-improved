const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createSqliteDatabase, schemaVersion } = require('../electron/services/sqliteDatabase.cjs');
const { createAiEvaluationStore } = require('../electron/services/aiEvaluationStore.cjs');

function checkAiEvaluationStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '易标-AI评标-'));
  const testApp = Object.assign(new EventEmitter(), { getPath: () => directory });
  let database;
  try {
    database = createSqliteDatabase(testApp);
    let store = createAiEvaluationStore({ app: testApp, db: database.db });
    assert.deepEqual(store.loadState(), {
      step: 'tender',
      projectName: '',
      tenderDocuments: [],
      bidDocuments: [],
      criteria: [],
      responses: [],
      result: null,
    });

    store.saveDocuments('tender', [{ id: 'tender-1', fileName: '中文招标文件.docx', content: '# 评分办法', parserLabel: '本地解析' }]);
    store.saveDocuments('bid', [{ id: 'bid-1', fileName: '投标方案.docx', content: '# 技术方案', parserLabel: '本地解析' }]);
    store.saveState({
      step: 'responses',
      projectName: '测试项目',
      criteria: [{ id: 'criterion-1', title: '技术方案', maxScore: 10 }],
      responses: [{ criterionId: 'criterion-1', status: 'responded' }],
      result: null,
    });

    database.close();
    database = createSqliteDatabase(testApp);
    store = createAiEvaluationStore({ app: testApp, db: database.db });
    const restored = store.loadState();
    assert.equal(restored.step, 'responses');
    assert.equal(restored.projectName, '测试项目');
    assert.equal(restored.tenderDocuments[0].content, '# 评分办法');
    assert.equal(restored.bidDocuments[0].content, '# 技术方案');
    assert.equal(restored.criteria[0].id, 'criterion-1');
    assert.equal(restored.responses[0].status, 'responded');

    database.db.exec('DROP TABLE ai_evaluation_meta');
    database.db.pragma('user_version = 35');
    database.close();
    database = createSqliteDatabase(testApp);
    assert.equal(database.db.pragma('user_version', { simple: true }), schemaVersion);
    store = createAiEvaluationStore({ app: testApp, db: database.db });
    assert.equal(store.loadState().step, 'tender');

    const cleared = store.clear();
    assert.equal(cleared.tenderDocuments.length, 0);
    assert.equal(fs.existsSync(path.join(directory, 'workspace', 'ai-evaluation')), false);
    console.log('AI 评标工作区：中文路径、文档与结构化状态回读、v35 升级及清空检查通过。');
  } finally {
    database?.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

checkAiEvaluationStore();
