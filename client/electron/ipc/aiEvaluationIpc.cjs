const { ipcMain } = require('electron');

function registerAiEvaluationIpc({ aiEvaluationStore }) {
  ipcMain.handle('ai-evaluation:load-state', () => aiEvaluationStore.loadState());
  ipcMain.handle('ai-evaluation:save-state', (_event, partial) => aiEvaluationStore.saveState(partial));
  ipcMain.handle('ai-evaluation:save-documents', (_event, role, documents) => aiEvaluationStore.saveDocuments(role, documents));
  ipcMain.handle('ai-evaluation:clear', () => aiEvaluationStore.clear());
}

module.exports = {
  registerAiEvaluationIpc,
};
