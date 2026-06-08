// =============================================
// Supabase クライアント — 全ツール共通モジュール
// =============================================
// 【セットアップ手順】
// 1. https://supabase.com でプロジェクトを作成（無料）
// 2. Settings > API > Project URL をコピー → SUPABASE_URL に貼る
// 3. Settings > API > anon public をコピー → SUPABASE_ANON_KEY に貼る
// 4. Supabase の SQL Editor で schema.sql を実行する
// 5. Authentication > Email でメール認証を有効にする
// =============================================

const SUPABASE_URL      = 'https://egiklnkfwynogawdfnjw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3M5DgUWoMnXvelUiILMiAQ_aQQeGFlf';

// ─────────────────────────────────────────────
// 内部状態
// ─────────────────────────────────────────────
const _sbOK = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
// supabase-js のCDN読み込みが失敗してもページ全体を壊さない（getSupabaseClientがnullを返すだけにする）。
let _db = null;
try {
  if (_sbOK && typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    _db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (e) { _db = null; }
let _sbUser = null;
const _sbListeners = [];

// ─────────────────────────────────────────────
// 設定確認・ユーザー取得
// ─────────────────────────────────────────────
function sbIsConfigured() { return _sbOK; }
function sbCurrentUser()  { return _sbUser; }
function getSupabaseClient() { return _db; }

// ─────────────────────────────────────────────
// 初期化（各ツールのscript先頭で await sbInit() する）
// ─────────────────────────────────────────────
async function sbInit() {
  if (!_sbOK) return null;
  try {
    const { data: { session } } = await _db.auth.getSession();
    _sbUser = session?.user ?? null;
    _db.auth.onAuthStateChange((_event, session) => {
      _sbUser = session?.user ?? null;
      _sbListeners.forEach(fn => fn(_sbUser));
    });
  } catch (e) {
    console.warn('[Supabase] init error:', e.message);
  }
  return _sbUser;
}

// 認証状態変化のコールバック登録
function sbOnAuthChange(fn) { _sbListeners.push(fn); }

// ─────────────────────────────────────────────
// 認証操作
// ─────────────────────────────────────────────
async function sbSignIn(email, pass) {
  const { data, error } = await _db.auth.signInWithPassword({ email, password: pass });
  if (error) throw error;
  _sbUser = data.user;
  return data.user;
}

async function sbSignUp(email, pass) {
  const { data, error } = await _db.auth.signUp({ email, password: pass });
  if (error) throw error;
  return data;
}

async function sbSignOut() {
  if (_db) await _db.auth.signOut();
  _sbUser = null;
}

// ─────────────────────────────────────────────
// DB操作（ログイン中のユーザーデータのみ操作）
// ─────────────────────────────────────────────
async function sbLoad(table) {
  if (!_sbOK || !_sbUser) return [];
  try {
    const { data, error } = await _db
      .from(table)
      .select('*')
      .eq('user_id', _sbUser.id)
      .order('created_at', { ascending: true });
    if (error) { console.error('[Supabase] load:', table, error.message); return []; }
    return data || [];
  } catch (e) {
    console.error('[Supabase] load exception:', table, e.message);
    return [];
  }
}

async function sbUpsert(table, row) {
  if (!_sbOK || !_sbUser) return null;
  try {
    const { data, error } = await _db
      .from(table)
      .upsert({ ...row, user_id: _sbUser.id }, { onConflict: 'id' })
      .select()
      .single();
    if (error) { console.error('[Supabase] upsert:', table, error.message); return null; }
    return data;
  } catch (e) {
    console.error('[Supabase] upsert exception:', table, e.message);
    return null;
  }
}

async function sbDelete(table, id) {
  if (!_sbOK || !_sbUser) return;
  try {
    const { error } = await _db
      .from(table)
      .delete()
      .eq('id', id)
      .eq('user_id', _sbUser.id);
    if (error) console.error('[Supabase] delete:', table, error.message);
  } catch (e) {
    console.error('[Supabase] delete exception:', table, e.message);
  }
}

// ─────────────────────────────────────────────
// 稲毛区 相場データ（inage_properties）
// ─────────────────────────────────────────────
// 戻り値: { '穴川': { house:196000, mansion:212000, land:186000, sqm:202000, year:2025, quarter:3 }, ... }
// DB の price_per_sqm は 万円/㎡ で保存 → ×10000 で 円/㎡ に変換
async function sbGetTownPrices(townNames) {
  if (!_sbOK || !_db) return null;
  try {
    const { data, error } = await _db
      .from('inage_properties')
      .select('town_name,property_type,price_per_sqm,trade_year,trade_quarter')
      .in('town_name', townNames)
      .order('trade_year', { ascending: false })
      .order('trade_quarter', { ascending: false })
      .limit(800);
    if (error) { console.warn('[Supabase] sbGetTownPrices:', error.message); return null; }
    if (!data || data.length === 0) return null;

    // 全四半期のqNumリスト（古い順）
    const allQNums = [...new Set(data.map(r => r.trade_year * 10 + r.trade_quarter))].sort((a,b) => a-b);
    // 直近2四半期（価格中央値計算用）
    const recentQNums = allQNums.slice(-2);
    // 最古2四半期（トレンド比較用）
    const oldestQNums = allQNums.slice(0, 2);

    const recentGroups = {}, oldestGroups = {}, countByTown = {};
    let maxYear = 0, maxQ = 0;
    data.forEach(function(r) {
      const qNum = r.trade_year * 10 + r.trade_quarter;
      // 総件数カウント（全四半期）
      if (r.price_per_sqm) countByTown[r.town_name] = (countByTown[r.town_name] || 0) + 1;
      // 直近2四半期の価格
      if (recentQNums.includes(qNum) && r.price_per_sqm) {
        const key = r.town_name + '::' + r.property_type;
        if (!recentGroups[key]) recentGroups[key] = [];
        recentGroups[key].push(Math.round(r.price_per_sqm * 10000));
        if (r.trade_year > maxYear || (r.trade_year === maxYear && r.trade_quarter > maxQ)) {
          maxYear = r.trade_year; maxQ = r.trade_quarter;
        }
      }
      // 最古2四半期の価格（トレンド計算用）
      if (oldestQNums.includes(qNum) && r.price_per_sqm) {
        const key = r.town_name + '::' + r.property_type;
        if (!oldestGroups[key]) oldestGroups[key] = [];
        oldestGroups[key].push(Math.round(r.price_per_sqm * 10000));
      }
    });

    const result = {};
    Object.keys(recentGroups).forEach(function(key) {
      const parts = key.split('::');
      const town = parts[0], type = parts[1];
      const vals = recentGroups[key].slice().sort((a,b) => a-b);
      if (vals.length < 2) return; // 直近で1件のみの種別は信頼性が低いため採用しない（誤った相場表示を防ぐ）
      const med = vals[Math.floor(vals.length / 2)];
      if (!result[town]) result[town] = { year: maxYear, quarter: maxQ };
      result[town][type] = med;
    });

    // sqm（すべて表示用）= 土地ベースの一戸建て・土地の平均（直近）。
    // マンションは専有床面積ベースで土地単価と性質が異なり過大になるため overall からは除外し、
    // 一戸建て・土地が無い町のみ、やむを得ずマンションで代替する。
    Object.keys(result).forEach(function(town) {
      const r = result[town];
      const landish = [r.house, r.land].filter(Boolean);
      const vals = landish.length ? landish : [r.mansion].filter(Boolean);
      if (vals.length) r.sqm = Math.round(vals.reduce((a,b) => a+b, 0) / vals.length);
    });

    // count（Supabase内の総取引件数）を付与
    Object.keys(result).forEach(function(town) {
      result[town].count = countByTown[town] || 0;
    });

    // trendLabel: 最古2四半期 vs 直近2四半期の中央値を比較して算出
    Object.keys(result).forEach(function(town) {
      const recentPrices = [], oldPrices = [];
      ['house','mansion','land'].forEach(function(type) {
        const rKey = town + '::' + type;
        const oKey = town + '::' + type;
        if (recentGroups[rKey]) recentPrices.push(...recentGroups[rKey]);
        if (oldestGroups[oKey]) oldPrices.push(...oldestGroups[oKey]);
      });
      if (recentPrices.length >= 2 && oldPrices.length >= 2) {
        const recentMed = recentPrices.sort((a,b)=>a-b)[Math.floor(recentPrices.length/2)];
        const oldMed    = oldPrices.sort((a,b)=>a-b)[Math.floor(oldPrices.length/2)];
        const change = (recentMed - oldMed) / oldMed;
        if (change > 0.03)       result[town].trend = 'up';
        else if (change < -0.03) result[town].trend = 'down';
        else                     result[town].trend = 'flat';
      }
    });

    return Object.keys(result).length > 0 ? result : null;
  } catch (e) {
    console.warn('[Supabase] sbGetTownPrices exception:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// 稲毛区 価格推移データ（四半期別）
// ─────────────────────────────────────────────
// 戻り値: [{ label:'2025Q2', year:2025, quarter:2, mansion:198000, house:175000, land:160000, count:8 }, ...]
// 円/㎡で返す（表示側で /10000 して万円/㎡ に変換）
async function sbGetTownTrend(townName) {
  if (!_sbOK || !_db) return null;
  try {
    const { data, error } = await _db
      .from('inage_properties')
      .select('property_type,price_per_sqm,trade_year,trade_quarter')
      .eq('town_name', townName)
      .order('trade_year', { ascending: true })
      .order('trade_quarter', { ascending: true })
      .limit(500);
    if (error) { console.warn('[Supabase] sbGetTownTrend:', error.message); return null; }
    if (!data || data.length === 0) return null;

    const groups = {};
    data.forEach(function(r) {
      if (!r.price_per_sqm) return;
      const key = r.trade_year + 'Q' + r.trade_quarter;
      if (!groups[key]) groups[key] = { year: r.trade_year, quarter: r.trade_quarter, prices: {} };
      if (!groups[key].prices[r.property_type]) groups[key].prices[r.property_type] = [];
      groups[key].prices[r.property_type].push(Math.round(r.price_per_sqm * 10000));
    });

    const median = function(arr) {
      if (!arr || !arr.length) return null;
      const s = arr.slice().sort(function(a,b){return a-b;});
      return s[Math.floor(s.length / 2)];
    };

    return Object.values(groups)
      .sort(function(a,b){ return (a.year*10+a.quarter) - (b.year*10+b.quarter); })
      .map(function(g) {
        return {
          label: g.year + 'Q' + g.quarter,
          year: g.year,
          quarter: g.quarter,
          mansion: median(g.prices.mansion),
          house:   median(g.prices.house),
          land:    median(g.prices.land),
          count:   Object.values(g.prices).reduce(function(s,a){return s+a.length;}, 0),
        };
      });
  } catch(e) {
    console.warn('[Supabase] sbGetTownTrend exception:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 千葉市各区 相場データ（ward_properties）
// ─────────────────────────────────────────────
// 戻り値: sbGetTownPrices と同形式。wardName='若葉区' など区名で絞り込む
async function sbGetWardPrices(wardName, townNames) {
  if (!_sbOK || !_db) return null;
  try {
    let q = _db
      .from('ward_properties')
      .select('town_name,property_type,price_per_sqm,trade_year,trade_quarter')
      .eq('ward', wardName)
      .order('trade_year', { ascending: false })
      .order('trade_quarter', { ascending: false })
      .limit(800);
    if (townNames && townNames.length) q = q.in('town_name', townNames);
    const { data, error } = await q;
    if (error) { console.warn('[Supabase] sbGetWardPrices:', error.message); return null; }
    if (!data || data.length === 0) return null;

    const allQNums = [...new Set(data.map(r => r.trade_year * 10 + r.trade_quarter))].sort((a,b) => a-b);
    const recentQNums = allQNums.slice(-2);
    const oldestQNums = allQNums.slice(0, 2);
    const recentGroups = {}, oldestGroups = {}, countByTown = {};
    let maxYear = 0, maxQ = 0;

    data.forEach(function(r) {
      const qNum = r.trade_year * 10 + r.trade_quarter;
      if (r.price_per_sqm) countByTown[r.town_name] = (countByTown[r.town_name] || 0) + 1;
      if (recentQNums.includes(qNum) && r.price_per_sqm) {
        const key = r.town_name + '::' + r.property_type;
        if (!recentGroups[key]) recentGroups[key] = [];
        recentGroups[key].push(Math.round(r.price_per_sqm * 10000));
        if (r.trade_year > maxYear || (r.trade_year === maxYear && r.trade_quarter > maxQ)) {
          maxYear = r.trade_year; maxQ = r.trade_quarter;
        }
      }
      if (oldestQNums.includes(qNum) && r.price_per_sqm) {
        const key = r.town_name + '::' + r.property_type;
        if (!oldestGroups[key]) oldestGroups[key] = [];
        oldestGroups[key].push(Math.round(r.price_per_sqm * 10000));
      }
    });

    const result = {};
    Object.keys(recentGroups).forEach(function(key) {
      const parts = key.split('::');
      const town = parts[0], type = parts[1];
      const vals = recentGroups[key].slice().sort((a,b) => a-b);
      if (vals.length < 2) return; // 直近で1件のみの種別は信頼性が低いため採用しない（誤った相場表示を防ぐ）
      const med = vals[Math.floor(vals.length / 2)];
      if (!result[town]) result[town] = { year: maxYear, quarter: maxQ };
      result[town][type] = med;
    });
    Object.keys(result).forEach(function(town) {
      const r = result[town];
      // すべて表示用 sqm は土地・戸建て（土地面積ベース）のみで算出。マンション専有単価は混ぜない。
      const landish = [r.house, r.land].filter(Boolean);
      const vals = landish.length ? landish : [r.mansion].filter(Boolean);
      if (vals.length) r.sqm = Math.round(vals.reduce((a,b) => a+b, 0) / vals.length);
      r.count = countByTown[town] || 0;
    });
    Object.keys(result).forEach(function(town) {
      const recentPrices = [], oldPrices = [];
      ['house','mansion','land'].forEach(function(type) {
        const rKey = town + '::' + type;
        if (recentGroups[rKey]) recentPrices.push(...recentGroups[rKey]);
        if (oldestGroups[rKey]) oldPrices.push(...oldestGroups[rKey]);
      });
      if (recentPrices.length >= 2 && oldPrices.length >= 2) {
        const recentMed = recentPrices.sort((a,b)=>a-b)[Math.floor(recentPrices.length/2)];
        const oldMed = oldPrices.sort((a,b)=>a-b)[Math.floor(oldPrices.length/2)];
        const change = (recentMed - oldMed) / oldMed;
        result[town].trend = change > 0.03 ? 'up' : change < -0.03 ? 'down' : 'flat';
      }
    });
    return Object.keys(result).length > 0 ? result : null;
  } catch (e) {
    console.warn('[Supabase] sbGetWardPrices exception:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// 他5区 価格推移データ（四半期別）
// sbGetTownTrend の ward_properties 版
// 戻り値: [{ label:'2025Q2', year:2025, quarter:2, mansion:198000, house:175000, land:160000, count:8 }, ...]
// 円/㎡で返す（表示側で /10000 して万円/㎡ に変換）
// ─────────────────────────────────────────────
async function sbGetWardTrend(wardName, townName) {
  if (!_sbOK || !_db) return null;
  try {
    const { data, error } = await _db
      .from('ward_properties')
      .select('property_type,price_per_sqm,trade_year,trade_quarter')
      .eq('ward', wardName)
      .eq('town_name', townName)
      .order('trade_year', { ascending: true })
      .order('trade_quarter', { ascending: true })
      .limit(500);
    if (error) { console.warn('[Supabase] sbGetWardTrend:', error.message); return null; }
    if (!data || data.length === 0) return null;

    const groups = {};
    data.forEach(function(r) {
      if (!r.price_per_sqm) return;
      const key = r.trade_year + 'Q' + r.trade_quarter;
      if (!groups[key]) groups[key] = { year: r.trade_year, quarter: r.trade_quarter, prices: {} };
      if (!groups[key].prices[r.property_type]) groups[key].prices[r.property_type] = [];
      groups[key].prices[r.property_type].push(Math.round(r.price_per_sqm * 10000));
    });

    const median = function(arr) {
      if (!arr || !arr.length) return null;
      const s = arr.slice().sort(function(a,b){return a-b;});
      return s[Math.floor(s.length / 2)];
    };

    return Object.values(groups)
      .sort(function(a,b){ return (a.year*10+a.quarter) - (b.year*10+b.quarter); })
      .map(function(g) {
        const count = Object.values(g.prices).reduce(function(sum,arr){ return sum + arr.length; }, 0);
        return {
          label:   g.year + 'Q' + g.quarter,
          year:    g.year,
          quarter: g.quarter,
          mansion: median(g.prices['mansion']) || null,
          house:   median(g.prices['house'])   || null,
          land:    median(g.prices['land'])    || null,
          count:   count,
        };
      })
      .filter(function(q){ return q.mansion || q.house || q.land; });
  } catch (e) {
    console.warn('[Supabase] sbGetWardTrend exception:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// 稲毛区 買い手候補数（匿名集計）
// ─────────────────────────────────────────────
// area_buyer_count テーブルから町丁目×物件種別の件数を取得（認証不要・RLS SELECT許可）
async function sbGetBuyerCount(townName, propertyType) {
  if (!_sbOK || !_db) return null;
  try {
    let q = _db.from('area_buyer_count').select('id', { count: 'exact', head: true }).eq('town_name', townName);
    if (propertyType && propertyType !== 'all') q = q.eq('property_type', propertyType);
    const { count, error } = await q;
    if (error) { console.warn('[Supabase] sbGetBuyerCount:', error.message); return null; }
    return count || 0;
  } catch (e) {
    console.warn('[Supabase] sbGetBuyerCount exception:', e.message);
    return null;
  }
}

// 買い手候補を登録（匿名・area_buyer_count INSERT）
async function sbInsertBuyerInterest(townName, propertyType, budgetMax) {
  if (!_sbOK || !_db) return false;
  try {
    const { error } = await _db.from('area_buyer_count').insert({
      town_name: townName,
      property_type: propertyType || 'any',
      budget_max: budgetMax || null,
      session_id: _getSessionId()
    });
    if (error) { console.warn('[Supabase] sbInsertBuyerInterest:', error.message); return false; }
    return true;
  } catch (e) {
    console.warn('[Supabase] sbInsertBuyerInterest exception:', e.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// 匿名利用ログ（Phase 4-A データ収集戦略）
// ─────────────────────────────────────────────
// localStorage: re_usage_stats → { cardId: count, ... } per tool
// localStorage: re_session_id  → 匿名ブラウザセッションID（永続）
// localStorage: re_calc_log    → 直近20件の計算ログ（Phase 4-C 相談CTA連携用）
const _USAGE_LS_PREFIX = 're_usage_';
const _SESSION_LS_KEY  = 're_session_id';
const _CALC_LOG_KEY    = 're_calc_log';

// 匿名セッションID取得（ブラウザごとに1つ・永続・個人特定不可）
function _getSessionId() {
  let sid = '';
  try { sid = localStorage.getItem(_SESSION_LS_KEY) || ''; } catch(e) {}
  if (!sid) {
    try {
      sid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(_SESSION_LS_KEY, sid);
    } catch(e) { sid = 'unknown'; }
  }
  return sid;
}

// カード使用ログ（呼び出し側: logCardUsage(toolId, cardId, action, resultLabel)）
// action: 'calc' / 'share' / 'fav'
// resultLabel: ヒーロー数値の文字列（例: '350万円'）— Phase 4-C 相談CTA連携用
function sbLogCardUsage(toolId, cardId, action, resultLabel) {
  if (!cardId) return;
  action = action || 'calc';
  // localStorageに使用回数を積む
  const key = _USAGE_LS_PREFIX + toolId;
  let stats = {};
  try { stats = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) {}
  stats[cardId] = (stats[cardId] || 0) + 1;
  try { localStorage.setItem(key, JSON.stringify(stats)); } catch(e) {}
  // 直近計算ログに積む（Phase 4-C 用）
  if (action === 'calc' && resultLabel) {
    try {
      var log = JSON.parse(localStorage.getItem(_CALC_LOG_KEY) || '[]');
      log.unshift({ toolId: toolId, cardId: cardId, result: resultLabel, ts: Date.now() });
      if (log.length > 20) log = log.slice(0, 20);
      localStorage.setItem(_CALC_LOG_KEY, JSON.stringify(log));
    } catch(e) {}
  }
  // Supabaseに非同期送信（カラムがなければ静かに失敗）
  if (_sbOK) {
    var payload = {
      tool_id: toolId,
      card_id: cardId,
      action: action,
      session_id: _getSessionId(),
      created_at: new Date().toISOString()
    };
    if (resultLabel) payload.result_label = resultLabel;
    _db.from('card_usage_log').insert(payload).then(function() {}).catch(function() {});
  }
}

// よく使うカードTOP N を返す
function sbGetTopCards(toolId, limit) {
  const key = _USAGE_LS_PREFIX + toolId;
  let stats = {};
  try { stats = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) {}
  return Object.entries(stats)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, limit || 3)
    .map(function(e) { return { cardId: e[0], count: e[1] }; });
}

// 直近の計算ログを返す（Phase 4-C 相談CTA用）
function sbGetRecentCalcLog(limit) {
  try {
    var log = JSON.parse(localStorage.getItem(_CALC_LOG_KEY) || '[]');
    return log.slice(0, limit || 5);
  } catch(e) { return []; }
}

// カード名（表示用）を card_id から生成
function _cardLabel(cardId) {
  if (!cardId) return '';
  // 'card-calcXxx' or 'card-xxx' → 文字列加工
  return cardId.replace(/^card-/, '').replace(/^calc/, '').replace(/([A-Z])/g, ' $1').trim();
}

// ─────────────────────────────────────────────
// Phase 4-C: 相談CTA メール本文生成
// ─────────────────────────────────────────────
// 各ツールのCTAボタンの onclick で呼ぶ: updateCTALink(anchorEl, toolId)
// → 直近3件の計算結果をメール本文に自動付加して差別化された初回提案を実現
function updateCTALink(anchorEl, toolId) {
  try {
    var log = sbGetRecentCalcLog(3);
    if (!log.length) return; // ログがなければhrefそのまま
    var toolNames = {1:'AI査定', 2:'空き家活用', 3:'売主買主マッチング', 4:'賃貸管理', 5:'投資分析'};
    var lines = ['【使用ツール: ' + (toolNames[toolId] || 'ツール' + toolId) + '】', '直近の計算履歴:'];
    log.forEach(function(item, i) {
      lines.push((i+1) + '. ' + _cardLabel(item.cardId) + ': ' + item.result);
    });
    lines.push('', '上記の計算をもとにご相談したいことがあります。');
    var body = lines.join('\n');
    var subject = encodeURIComponent('不動産についてご相談したい（計算結果あり）');
    var bodyEnc = encodeURIComponent(body);
    anchorEl.href = 'mailto:terra.realty.iam@gmail.com?subject=' + subject + '&body=' + bodyEnc;
  } catch(e) {}
}

// ─────────────────────────────────────────────
// 認証ヘッダーバーのレンダリング
// ─────────────────────────────────────────────
function sbRenderAuthBar(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!_sbOK) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  if (_sbUser) {
    el.innerHTML = `
      <span style="color:rgba(255,255,255,0.6);font-size:12px">
        ✓ <strong style="color:#c9a84c">${_sbUser.email}</strong> でログイン中
        <span style="margin-left:8px;padding:2px 8px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.3);border-radius:100px;color:#4ade80;font-size:10px;font-weight:700">☁ クラウド同期ON</span>
      </span>
      <button onclick="sbDoSignOut()" style="margin-left:auto;padding:4px 14px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.18);border-radius:6px;color:rgba(255,255,255,0.7);font-size:12px;cursor:pointer;font-family:inherit;transition:background .2s" onmouseover="this.style.background='rgba(255,255,255,0.13)'" onmouseout="this.style.background='rgba(255,255,255,0.07)'">ログアウト</button>
    `;
  } else {
    el.innerHTML = `
      <span style="color:rgba(255,255,255,0.45);font-size:12px">☁ ログインするとデータがクラウドに保存されどの端末からでもアクセスできます</span>
      <button onclick="sbShowAuthModal({onLogin:()=>location.reload()})" style="margin-left:auto;padding:5px 16px;background:linear-gradient(135deg,#c9a84c,#a8892e);border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0">ログイン / 新規登録</button>
    `;
  }
}

async function sbDoSignOut() {
  await sbSignOut();
  location.reload();
}

// ─────────────────────────────────────────────
// 認証モーダル
// ─────────────────────────────────────────────
let _sbAuthMode = 'signin';
let _sbOnLogin  = null;
let _sbRequired = false;

function sbShowAuthModal({ required = false, onLogin = null } = {}) {
  _sbRequired = required;
  _sbOnLogin  = onLogin;
  _sbEnsureModal();
  document.getElementById('_sb_overlay').style.display = 'flex';
  _sbApplyMode('signin');
}

function sbHideAuthModal() {
  const el = document.getElementById('_sb_overlay');
  if (el) el.style.display = 'none';
}

function _sbApplyMode(mode) {
  _sbAuthMode = mode;
  const isUp = mode === 'signup';
  document.getElementById('_sb_title').textContent = isUp ? '新規登録（無料）' : 'ログイン';
  document.getElementById('_sb_btn').textContent   = isUp ? '登録する' : 'ログインする';
  document.getElementById('_sb_toggle').innerHTML  = isUp
    ? 'すでにアカウントをお持ちの方は <a href="#" onclick="_sbApplyMode(\'signin\');return false">ログイン</a>'
    : 'アカウントをお持ちでない方は <a href="#" onclick="_sbApplyMode(\'signup\');return false">新規登録（無料）</a>';
  const errEl = document.getElementById('_sb_err');
  if (errEl) { errEl.textContent = ''; errEl.style.color = '#f87171'; }
}

async function _sbDoAuth() {
  const email = (document.getElementById('_sb_email') || {}).value?.trim();
  const pass  = (document.getElementById('_sb_pass')  || {}).value;
  const errEl = document.getElementById('_sb_err');
  const btn   = document.getElementById('_sb_btn');
  if (!email || !pass) { if(errEl) errEl.textContent = 'メールアドレスとパスワードを入力してください'; return; }
  if (btn) { btn.disabled = true; btn.textContent = '処理中…'; }
  if (errEl) errEl.textContent = '';
  try {
    if (_sbAuthMode === 'signup') {
      await sbSignUp(email, pass);
      if (errEl) { errEl.style.color = '#4ade80'; errEl.textContent = '確認メールを送信しました。メール内のリンクをクリックして登録を完了してください。'; }
    } else {
      await sbSignIn(email, pass);
      sbHideAuthModal();
      if (_sbOnLogin) _sbOnLogin(_sbUser);
    }
  } catch (e) {
    if (errEl) {
      errEl.style.color = '#f87171';
      errEl.textContent = e.message.includes('Invalid login')
        ? 'メールアドレスまたはパスワードが正しくありません'
        : e.message.includes('already registered')
        ? 'このメールアドレスはすでに登録済みです'
        : e.message.includes('Password should be')
        ? 'パスワードは6文字以上で入力してください'
        : e.message;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = _sbAuthMode === 'signup' ? '登録する' : 'ログインする'; }
  }
}

function _sbEnsureModal() {
  if (document.getElementById('_sb_overlay')) return;

  const css = document.createElement('style');
  css.textContent = `
    #_sb_overlay{position:fixed;inset:0;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:blur(8px)}
    #_sb_box{background:#12122a;border:1px solid rgba(201,168,76,0.35);border-radius:18px;padding:40px 36px;width:400px;max-width:calc(100vw - 32px);color:#fff;font-family:'Noto Sans JP',sans-serif;box-shadow:0 24px 80px rgba(0,0,0,0.6)}
    #_sb_logo{font-size:22px;font-weight:900;color:#c9a84c;margin-bottom:4px;letter-spacing:-0.5px}
    #_sb_title{font-size:18px;font-weight:700;margin:0 0 6px;color:#fff}
    #_sb_desc{margin:0 0 24px;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.65}
    #_sb_box input{width:100%;box-sizing:border-box;padding:12px 14px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:9px;color:#fff;font-size:14px;margin-bottom:12px;outline:none;font-family:inherit;transition:border-color .2s}
    #_sb_box input:focus{border-color:#c9a84c;background:rgba(255,255,255,0.09)}
    #_sb_btn{width:100%;padding:13px;background:linear-gradient(135deg,#c9a84c,#a8892e);border:none;border-radius:9px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;margin-top:4px;font-family:inherit;transition:opacity .2s}
    #_sb_btn:hover{opacity:.88}#_sb_btn:disabled{opacity:.5;cursor:not-allowed}
    #_sb_toggle{margin-top:18px;text-align:center;font-size:13px;color:rgba(255,255,255,0.4);line-height:1.6}
    #_sb_toggle a{color:#c9a84c;text-decoration:underline;cursor:pointer}
    #_sb_err{font-size:12px;margin-top:8px;min-height:16px;line-height:1.5}
    #_sb_skip{display:block;width:100%;text-align:center;margin-top:16px;font-size:12px;color:rgba(255,255,255,0.28);cursor:pointer;background:none;border:none;font-family:inherit;padding:4px}
    #_sb_skip:hover{color:rgba(255,255,255,0.5)}
    #_sb_benefits{background:rgba(201,168,76,0.07);border:1px solid rgba(201,168,76,0.2);border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:12px;color:rgba(255,255,255,0.65);line-height:1.8}
  `;
  document.head.appendChild(css);

  const overlay = document.createElement('div');
  overlay.id = '_sb_overlay';
  overlay.innerHTML = `
    <div id="_sb_box">
      <div id="_sb_logo">🏠 TERRA REALTY</div>
      <h2 id="_sb_title">ログイン</h2>
      <p id="_sb_desc">クラウドに保存してどの端末からでもデータにアクセスできます。</p>
      <div id="_sb_benefits">
        ✓ データがクラウドに安全に保存される<br>
        ✓ スマホ・PC・タブレット間で同期<br>
        ✓ ブラウザを変えてもデータが消えない
      </div>
      <input type="email"    id="_sb_email" placeholder="メールアドレス"    autocomplete="email">
      <input type="password" id="_sb_pass"  placeholder="パスワード（6文字以上）" autocomplete="current-password">
      <div id="_sb_err"></div>
      <button id="_sb_btn" onclick="_sbDoAuth()">ログインする</button>
      <div id="_sb_toggle">アカウントをお持ちでない方は <a href="#" onclick="_sbApplyMode('signup');return false">新規登録（無料）</a></div>
      <button id="_sb_skip" onclick="sbHideAuthModal()" ${_sbRequired ? 'style="display:none"' : ''}>ログインせずに使う（データはこの端末のみ）</button>
    </div>
  `;
  document.body.appendChild(overlay);
}
