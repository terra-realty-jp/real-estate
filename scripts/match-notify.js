/**
 * 新着物件 → 投資家マッチング通知
 * 毎日実行。前日以降に登録された pending 物件を取得し、
 * 条件が合う investor_profiles にメール送信する。
 *
 * 必要な環境変数:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
 *
 * Supabase テーブル（要作成）:
 *   property_listings, investor_profiles
 */

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DRY_RUN = process.env.DRY_RUN === 'true';
const FROM_EMAIL = 'terra@terra-realty.jp'; // Resend で認証済みドメインに変更すること
const FROM_NAME = 'TERRA REALTY 稲毛区マッチング';
const BASE_URL = 'https://terra-realty-jp.github.io/real-estate';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY が未設定');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  realtime: { transport: WebSocket }
});

const TYPE_LABEL = {
  apartment_building: '一棟アパート',
  mansion_building: '一棟マンション',
  mansion_unit: '区分マンション',
  house: '戸建（投資用）',
  land: '土地',
};

const STATUS_LABEL = {
  full_rent: '満室',
  partial_rent: '一部空室',
  vacant: '空室',
  owner_occupied: '自己利用中',
};

async function main() {
  console.log(`[match-notify] 開始 DRY_RUN=${DRY_RUN}`);

  // 1. 昨日以降に登録された pending 物件を取得
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h前（重複送信防止のためバッファ）
  const { data: listings, error: lErr } = await supabase
    .from('property_listings')
    .select('*')
    .eq('status', 'pending')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (lErr) {
    // テーブル未作成・権限エラーは失敗扱いにしない（まだ運用前の正常状態）
    console.log(`[INFO] property_listings 取得スキップ: ${lErr.message}`);
    console.log('[INFO] Supabase で property_listings テーブルを作成するとマッチングが動作します。');
    return;
  }
  if (!listings || listings.length === 0) { console.log('新着物件なし。終了。'); return; }
  console.log(`新着物件: ${listings.length}件`);

  // 2. アクティブな投資家プロフィールを取得
  const { data: investors, error: iErr } = await supabase
    .from('investor_profiles')
    .select('*')
    .eq('is_active', true)
    .not('email', 'is', null);

  if (iErr) {
    console.log(`[INFO] investor_profiles 取得スキップ: ${iErr.message}`);
    return;
  }
  if (!investors || investors.length === 0) { console.log('通知対象の投資家なし。終了。'); return; }
  console.log(`登録投資家: ${investors.length}人`);

  let totalSent = 0;

  for (const listing of listings) {
    // 3. 条件マッチング
    const matched = investors.filter(inv => {
      // エリア一致
      if (inv.town_interests && inv.town_interests.length > 0) {
        if (!inv.town_interests.includes(listing.town_name)) return false;
      }
      // 物件種別一致
      if (inv.property_types && inv.property_types.length > 0) {
        if (!inv.property_types.includes(listing.property_type)) return false;
      }
      // 予算チェック
      if (inv.budget_max && listing.hope_price > inv.budget_max) return false;
      // 利回りチェック
      if (inv.min_yield && listing.gross_yield && listing.gross_yield < inv.min_yield) return false;
      return true;
    });

    if (matched.length === 0) {
      console.log(`[${listing.town_name}/${listing.property_type}] マッチ投資家なし`);
      continue;
    }
    console.log(`[${listing.town_name}/${listing.property_type}] マッチ ${matched.length}人`);

    // 4. 各投資家にメール送信
    for (const inv of matched) {
      const subject = `【TERRA】${listing.town_name}に新着物件 ${listing.hope_price}万円 表面${listing.gross_yield || '—'}%`;
      const body = buildEmailBody(listing, inv);

      if (DRY_RUN) {
        console.log(`  [DRY] → ${inv.email} : ${subject}`);
        continue;
      }

      if (!RESEND_API_KEY) {
        console.log(`  [SKIP] RESEND_API_KEY 未設定 → ${inv.email}`);
        continue;
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [inv.email], subject, html: body }),
      });

      if (res.ok) {
        console.log(`  ✓ 送信済 → ${inv.email}`);
        totalSent++;
      } else {
        const err = await res.text();
        console.error(`  ✗ 送信失敗 → ${inv.email} : ${err}`);
      }
    }

    // 5. 物件ステータスを notified に更新
    if (!DRY_RUN) {
      await supabase.from('property_listings').update({ status: 'notified' }).eq('id', listing.id);
    }
  }

  console.log(`[match-notify] 完了 送信数: ${totalSent}`);
}

function buildEmailBody(listing, inv) {
  const yieldStr = listing.gross_yield ? `${listing.gross_yield}%` : '—';
  const statusStr = STATUS_LABEL[listing.current_status] || listing.current_status;
  const typeStr = TYPE_LABEL[listing.property_type] || listing.property_type;
  const rentStr = listing.monthly_rent ? `${listing.monthly_rent}万円/月` : '—';

  return `
<div style="font-family:'Noto Sans JP',sans-serif;max-width:560px;margin:0 auto;background:#fafaf8;padding:0">
  <div style="background:#c0522b;padding:24px 28px">
    <div style="color:rgba(255,255,255,0.8);font-size:11px;letter-spacing:2px;margin-bottom:4px">TERRA REALTY</div>
    <div style="color:#fff;font-size:20px;font-weight:900">新着物件のご案内</div>
  </div>
  <div style="padding:24px 28px">
    <p style="font-size:13px;color:#6b6058;margin-bottom:20px;line-height:1.7">
      ご登録いただいた条件に合う新着物件が登録されました。<br>
      資料請求・詳細確認はTERRAまでご連絡ください。
    </p>

    <div style="background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:12px;padding:20px;margin-bottom:20px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:8px 0;color:#6b6058;width:40%">エリア</td><td style="padding:8px 0;font-weight:700">${listing.town_name}</td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="padding:8px 0;color:#6b6058">物件種別</td><td style="padding:8px 0;font-weight:700">${typeStr}</td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="padding:8px 0;color:#6b6058">希望価格</td><td style="padding:8px 0;font-weight:700;font-size:18px;color:#c0522b">${listing.hope_price.toLocaleString()}万円</td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="padding:8px 0;color:#6b6058">表面利回り</td><td style="padding:8px 0;font-weight:700;color:#c0522b">${yieldStr}</td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="padding:8px 0;color:#6b6058">現況</td><td style="padding:8px 0">${statusStr}</td></tr>
        <tr style="border-top:1px solid #f0ede8"><td style="padding:8px 0;color:#6b6058">現況家賃収入</td><td style="padding:8px 0">${rentStr}</td></tr>
        ${listing.age_years ? `<tr style="border-top:1px solid #f0ede8"><td style="padding:8px 0;color:#6b6058">築年数</td><td style="padding:8px 0">築${listing.age_years}年</td></tr>` : ''}
        ${listing.notes ? `<tr style="border-top:1px solid #f0ede8"><td style="padding:8px 0;color:#6b6058">備考</td><td style="padding:8px 0;font-size:12px">${listing.notes}</td></tr>` : ''}
      </table>
    </div>

    <a href="mailto:terra.realty.iam@gmail.com?subject=${encodeURIComponent(`【物件照会】${listing.town_name} ${listing.hope_price}万円`)}"
       style="display:block;text-align:center;background:#c0522b;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-size:15px;font-weight:700;margin-bottom:16px">
      この物件の詳細を問い合わせる →
    </a>

    <div style="background:#f5ede8;border-radius:10px;padding:14px;font-size:11px;color:#6b6058;line-height:1.8">
      📍 <strong>周辺相場の確認はこちら：</strong>
      <a href="${BASE_URL}/inage/map.html" style="color:#c0522b">${listing.town_name}エリア 相場マップ</a><br>
      📊 <strong>収益シミュレーター：</strong>
      <a href="${BASE_URL}/tools/5-toushi-bunseki.html" style="color:#c0522b">投資分析ツール</a>
    </div>

    <p style="font-size:10px;color:#9ca3af;margin-top:20px;line-height:1.8;text-align:center">
      このメールはTERRA REALTYの投資家通知サービスへの登録に基づき送信しています。<br>
      配信停止をご希望の場合は <a href="mailto:terra.realty.iam@gmail.com?subject=配信停止希望" style="color:#9ca3af">こちら</a> までご連絡ください。
    </p>
  </div>
</div>`;
}

main().catch(e => { console.error('予期しないエラー:', e); process.exit(1); });
