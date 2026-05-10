// manual.html を PDF に変換するスクリプト
// 実行: node generate-manual.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false },
  });

  const htmlPath = path.join(__dirname, 'manual.html');
  await win.loadFile(htmlPath);

  // フォント・画像描画を待つ
  await new Promise(r => setTimeout(r, 1500));

  const pdfData = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `
      <div style="width:100%;text-align:center;font-size:9px;color:#94a3b8;font-family:sans-serif;padding-bottom:6px;">
        <span class="pageNumber"></span> / <span class="totalPages"></span>
      </div>`,
  });

  const outPath = path.join(__dirname, 'QualisCreate_ユーザーマニュアル.pdf');
  fs.writeFileSync(outPath, pdfData);
  console.log('✅ PDF を出力しました:', outPath);
  app.quit();
});
