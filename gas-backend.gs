// 不動産かんたんツール — Google Apps Script バックエンド
//
// 【セットアップ手順】
// 1. https://sheets.google.com で新しいスプレッドシートを作成
// 2. メニュー「拡張機能」→「Apps Script」を開く
// 3. このファイルの内容を全て貼り付けて保存
// 4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
//    - 実行ユーザー: 自分
//    - アクセスできるユーザー: 全員
// 5. デプロイ後に表示されるURLをコピーして各HTMLファイルの
//    GAS_URL = '' の '' の中に貼り付ける

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = payload.tool || 'data';

    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    const keys = Object.keys(payload);

    // 1行目がなければヘッダーを作成
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['受信日時', ...keys]);
    }

    const values = [new Date().toLocaleString('ja-JP'), ...keys.map(k => String(payload[k] ?? ''))];
    sheet.appendRow(values);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 動作確認用（Apps Scriptエディタから手動実行してログを確認）
function testDoPost() {
  const dummy = {
    postData: {
      contents: JSON.stringify({
        tool: 'tool1_satei',
        日付: '2026/05/07',
        名前: 'テスト太郎',
        エリア: '東京23区',
        査定価格_万円: 4500
      })
    }
  };
  const result = doPost(dummy);
  Logger.log(result.getContent());
}
