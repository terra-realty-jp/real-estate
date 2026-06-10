// IndexNow 一括送信スクリプト
// sitemap.xml の全URLを api.indexnow.org に送信し、Bing/Naver/Seznam/Yandex に即時クロール通知する。
// Google/Bing の旧 sitemap ping (www.google.com/ping) は2023-24年に廃止されたため、その代替。
// Bing のインデックスは ChatGPT / Copilot 等のAI検索の情報源にもなる。
//
// 実行: node scripts/submit-indexnow.js
// GitHub Actions (sitemap-ping.yml) から main への push 時に自動実行される。

const fs = require('fs');
const path = require('path');
const https = require('https');

const HOST = 'terra-realty-jp.github.io';
// 旧キー(f4156ab7...)は初回送信時の検証失敗がIndexNow側にキャッシュされたためローテーション(2026-06-11)
const KEY = '8285bd3e067c72d3aebd286ccc2e7374';
const KEY_LOCATION = `https://${HOST}/real-estate/${KEY}.txt`;

const sitemap = fs.readFileSync(path.join(__dirname, '..', 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1].trim());

if (urls.length === 0) {
  console.error('sitemap.xml からURLを抽出できませんでした');
  process.exit(1);
}
console.log(`sitemap.xml から ${urls.length} 件のURLを抽出`);

const payload = JSON.stringify({
  host: HOST,
  key: KEY,
  keyLocation: KEY_LOCATION,
  urlList: urls
});

const req = https.request({
  hostname: 'api.indexnow.org',
  path: '/indexnow',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    // 200 = OK / 202 = 受理（キー検証は後で行われる）
    // 403 = キー検証失敗。検証結果はIndexNow側に一定期間キャッシュされるため、
    //       キーファイル公開直後は403が返ることがある。週次cron＋push時の再送信で自己回復するので警告扱い。
    console.log(`IndexNow 応答: HTTP ${res.statusCode} ${body}`);
    if (res.statusCode === 403) {
      console.warn('警告: キー検証がまだ通っていません。次回の自動送信で再試行されます。');
      return;
    }
    if (res.statusCode !== 200 && res.statusCode !== 202) process.exit(1);
  });
});
req.on('error', e => { console.error('送信エラー:', e.message); process.exit(1); });
req.write(payload);
req.end();
