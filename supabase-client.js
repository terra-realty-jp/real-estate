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
const _db   = _sbOK ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let _sbUser = null;
const _sbListeners = [];

// ─────────────────────────────────────────────
// 設定確認・ユーザー取得
// ─────────────────────────────────────────────
function sbIsConfigured() { return _sbOK; }
function sbCurrentUser()  { return _sbUser; }

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
// 匿名利用ログ（Phase 3 データ蓄積）
// ─────────────────────────────────────────────
// localStorage: re_usage_stats → { cardId: count, ... } per tool
const _USAGE_LS_PREFIX = 're_usage_';

function sbLogCardUsage(toolId, cardId) {
  if (!cardId) return;
  const key = _USAGE_LS_PREFIX + toolId;
  let stats = {};
  try { stats = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) {}
  stats[cardId] = (stats[cardId] || 0) + 1;
  try { localStorage.setItem(key, JSON.stringify(stats)); } catch(e) {}
  // 非同期でSupabaseにも記録（テーブルがなければ静かに失敗）
  if (_sbOK) {
    _db.from('tool_events').insert({
      tool_id: toolId,
      card_id: cardId,
      created_at: new Date().toISOString()
    }).then(function() {}).catch(function() {});
  }
}

function sbGetTopCards(toolId, limit) {
  const key = _USAGE_LS_PREFIX + toolId;
  let stats = {};
  try { stats = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) {}
  return Object.entries(stats)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, limit || 3)
    .map(function(e) { return { cardId: e[0], count: e[1] }; });
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
