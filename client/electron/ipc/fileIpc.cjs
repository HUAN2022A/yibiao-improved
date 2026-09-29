const { ipcMain } = require('electron');

function registerFileIpc({ fileService }) {
  ipcMain.handle('file:select-duplicate-check-files', (_event, options) => fileService.selectDuplicateCheckFiles(options));
  ipcMain.handle('file:import-document', (_event, options) => fileService.importDocument(options));
}

module.exports = {
  registerFileIpc,
};
