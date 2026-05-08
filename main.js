// Electronメインプロセス
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: 'QualisCreate - テスト設計支援ツール',
    backgroundColor: '#f0f2f5',
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Excelファイル保存ダイアログ
ipcMain.handle('save-excel', async (event, { buffer, filename }) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'テストケースをExcelで保存',
    defaultPath: filename || 'テストケース.xlsx',
    filters: [{ name: 'Excel ファイル', extensions: ['xlsx'] }],
  });

  if (canceled || !filePath) return { success: false };

  try {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// アプリ状態の保存
ipcMain.handle('save-state', async (event, { state }) => {
  const statePath = path.join(app.getPath('userData'), 'qualiscreate-state.json');
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// アプリ状態の読み込み
ipcMain.handle('load-state', async () => {
  const statePath = path.join(app.getPath('userData'), 'qualiscreate-state.json');
  try {
    const data = fs.readFileSync(statePath, 'utf8');
    return { success: true, state: JSON.parse(data) };
  } catch {
    return { success: false };
  }
});
