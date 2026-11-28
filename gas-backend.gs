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
//
// 【更新時】既存のデプロイを「デプロイを管理」→ 編集 →「新バージョン」で更新すると
//  URL を変えずに反映できます（HTML 側の GAS_URL は変更不要）。
//
// 【セキュリティ対策（2026-11）】
//  - URL は公開されているため誰でも POST できる前提で作る
//  - 受け付けるシート名（tool）をホワイトリストで制限
//  - 項目数・文字数・リクエストサイズに上限
//  - 「=」「+」「-」「@」で始まる値は数式として実行されないよう先頭に ' を付ける
//  - 同時書き込みで行が壊れないよう LockService で排他

var ALLOWED_TOOLS = ['tool1_satei', 'tool2_akiya', 'tool3_matching', 'tool5_toushi'];
var MAX_BODY_BYTES = 20000;   // 1リクエストの上限
var MAX_FIELDS = 40;          // 項目数の上限
var MAX_VALUE_LEN = 2000;     // 1項目の文字数上限
var MAX_KEY_LEN = 40;         // 項目名の文字数上限

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > MAX_BODY_BYTES) return json_({ status: 'error', message: 'too large' });

    var payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return json_({ status: 'error', message: 'invalid payload' });
    }

    var sheetName = String(payload.tool || '');
    if (ALLOWED_TOOLS.indexOf(sheetName) === -1) {
      return json_({ status: 'error', message: 'unknown tool' });
    }

    var keys = Object.keys(payload).slice(0, MAX_FIELDS).map(function (k) {
      return sanitize_(k).slice(0, MAX_KEY_LEN);
    });
    var origKeys = Object.keys(payload).slice(0, MAX_FIELDS);

    lock.waitLock(10000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

    // 1行目がなければヘッダーを作成
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['受信日時'].concat(keys));
    }

    var values = [new Date().toLocaleString('ja-JP')].concat(origKeys.map(function (k) {
      var v = payload[k];
      if (v !== null && typeof v === 'object') v = JSON.stringify(v);
      return sanitize_(v == null ? '' : String(v)).slice(0, MAX_VALUE_LEN);
    }));
    sheet.appendRow(values);

    return json_({ status: 'ok' });
  } catch (err) {
    // 詳細なエラー内容は外部に返さない（ログにのみ残す）
    console.error(err);
    return json_({ status: 'error' });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// 数式インジェクション対策: スプレッドシートが数式として解釈する先頭文字を無効化
function sanitize_(s) {
  s = String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 動作確認用（Apps Scriptエディタから手動実行してログを確認）
function testDoPost() {
  var dummy = {
    postData: {
      contents: JSON.stringify({
        tool: 'tool1_satei',
        日付: '2026/05/07',
        名前: '=IMPORTXML("https://example.com","//a")',  // 数式にならず文字列として保存されることを確認
        エリア: '東京23区',
        査定価格_万円: 4500
      })
    }
  };
  var result = doPost(dummy);
  Logger.log(result.getContent());
}
