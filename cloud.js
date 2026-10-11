/* =========================================================================
   云同步模块 —— WorkBuddy 云服务（Auth + Database）
   -------------------------------------------------------------------------
   职责：
     · 用 publicConfig 初始化 WorkBuddy 云客户端（整个 App 只初始化一次）
     · 邮箱验证码登录 / 注册 / 退出
     · 把本地账本（Store.data）整份快照推到云端；从云端拉回并覆盖本地
   设计：
     · localStorage 仍是主存储与离线兜底；登录后才与云端双向同步
     · 云端表 finance_state：一行一用户，payload JSONB 存整份账本快照
     · owner_id 由数据库 DEFAULT auth.uid() 填充，前端绝不传
   ========================================================================= */

'use strict';

/* ---------------------- 云环境配置（来自 workbuddy_cloud_service 的 publicConfig） ---------------------- */
const CLOUD_PUBLIC_CONFIG = {
  resourceId: 'wbcs_Ic9G1Hr906Nwf1glVIBUy4',
  endpoint: 'https://yucha-finance-app.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_R8aZcmyhb1PrsiJmeLt3hJ_sPDCgzPRZYnePzm3oAwHR0o3S93RMI54',
};

const CLOUD_TABLE = 'finance_state';
/** 登录态缓存的用户邮箱（只用于界面展示，不含敏感凭证） */
const CLOUD_EMAIL_KEY = 'life_assistant_cloud_email';

/* ---------------------- 云客户端（惰性初始化，全 App 单例） ---------------------- */
let cloudClient = null;
/** 当前会话缓存：{ user } 或 null（未登录） */
let cloudSession = null;

/** 初始化云客户端；SDK 未加载或不可用时返回 null（App 继续以纯本地模式运行） */
function ensureCloudClient() {
  if (cloudClient) return cloudClient;
  const WBC = window.WorkBuddyCloud;
  if (!WBC || typeof WBC.createWorkBuddyCloud !== 'function') {
    console.warn('[云同步] SDK 未加载，当前以纯本地模式运行');
    return null;
  }
  try {
    cloudClient = WBC.createWorkBuddyCloud({
      endpoint: CLOUD_PUBLIC_CONFIG.endpoint,
      oauthRelayBaseUrl: CLOUD_PUBLIC_CONFIG.oauthRelayBaseUrl,
      publishableKey: CLOUD_PUBLIC_CONFIG.publishableKey,
    });
    return cloudClient;
  } catch (e) {
    console.error('[云同步] 初始化失败', e);
    return null;
  }
}

/* ---------------------- 界面：侧边栏同步按钮 ---------------------- */
/** 刷新侧边栏「云同步」按钮的状态与文案 */
function renderSyncEntry() {
  const wrap = document.getElementById('syncIconWrap');
  const text = document.getElementById('syncText');
  const btn = document.getElementById('syncBtn');
  if (!wrap || !text || !btn) return;

  const on = isCloudSignedIn();
  wrap.innerHTML = icon(on ? 'cloud' : 'cloud-off');
  text.textContent = on ? '云同步已开启' : '开启云同步';
  btn.classList.toggle('on', on);
  refreshIcons(wrap);
}

/** 刷新金库页「云同步」卡片 */
function renderCloudCard() {
  const card = document.getElementById('cloudSyncCard');
  if (!card) return;
  const badge = document.getElementById('cloudSyncBadge');
  const body = document.getElementById('cloudSyncBody');
  if (!badge || !body) return;

  const signed = isCloudSignedIn();
  const email = getCloudEmail();

  badge.textContent = signed ? '已登录' : '未登录';
  badge.classList.toggle('on', signed);

  if (!signed) {
    body.innerHTML = `
      <p class="sync-desc">登录后，账本会自动保存到云端，手机和电脑用同一个账号即可看到相同数据。</p>
      <div class="sync-actions">
        <button class="btn btn-primary" id="cloudLoginBtn" type="button">
          ${icon('log-in')}登录 / 注册
        </button>
      </div>`;
    body.querySelector('#cloudLoginBtn').addEventListener('click', openLoginModal);
    refreshIcons(body);
    return;
  }

  body.innerHTML = `
    <p class="sync-desc">
      ${icon('circle-check')}已登录：<b>${escapeHtml(email || '当前账号')}</b>
      <br><span class="sync-sub">数据已同步到云端，换设备登录同一账号即可看到。</span>
    </p>
    <div class="sync-actions">
      <button class="btn btn-primary" id="cloudPushBtn" type="button">
        ${icon('cloud-upload')}立即上传
      </button>
      <button class="btn btn-ghost" id="cloudPullBtn" type="button">
        ${icon('cloud-download')}从云端恢复
      </button>
      <button class="btn btn-ghost" id="cloudLogoutBtn" type="button">
        ${icon('log-out')}退出登录
      </button>
    </div>`;
  body.querySelector('#cloudPushBtn').addEventListener('click', () => cloudPush(true));
  body.querySelector('#cloudPullBtn').addEventListener('click', () => cloudPull(true));
  body.querySelector('#cloudLogoutBtn').addEventListener('click', cloudSignOut);
  refreshIcons(body);
}

/* ---------------------- 登录 / 注册（邮箱验证码） ---------------------- */
/** 保存本次「获取验证码」的结果，供后续提交校验使用（不跨事件丢失） */
let pendingEmailOtp = null;

function getCloudEmail() {
  try { return localStorage.getItem(CLOUD_EMAIL_KEY) || ''; } catch (_) { return ''; }
}
function setCloudEmail(email) {
  try {
    if (email) localStorage.setItem(CLOUD_EMAIL_KEY, email);
    else localStorage.removeItem(CLOUD_EMAIL_KEY);
  } catch (_) {}
}

function openLoginModal() {
  openModal(`
    <h3>${icon('cloud')}开启云同步</h3>
    <p>输入邮箱获取验证码即可登录。首次登录会自动为你创建账号。</p>
    <div class="form-field">
      <label class="field-label" for="cloudEmailInput">${icon('mail')}邮箱</label>
      <input class="input" id="cloudEmailInput" type="email" placeholder="you@example.com"
        autocomplete="email" />
    </div>
    <div class="form-field">
      <label class="field-label" for="cloudCodeInput">${icon('key-round')}验证码</label>
      <div class="otp-row">
        <input class="input" id="cloudCodeInput" type="text" inputmode="numeric"
          placeholder="6 位数字" maxlength="6" autocomplete="one-time-code" />
        <button class="btn btn-ghost otp-send" id="cloudSendBtn" type="button">获取验证码</button>
      </div>
      <div class="field-hint" id="cloudHint"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel" type="button">取消</button>
      <button class="btn btn-primary" id="modalOk" type="button">${icon('log-in')}登录</button>
    </div>
  `);

  const emailEl = document.getElementById('cloudEmailInput');
  const codeEl = document.getElementById('cloudCodeInput');
  const sendBtn = document.getElementById('cloudSendBtn');
  const hint = document.getElementById('cloudHint');
  const okBtn = document.getElementById('modalOk');
  emailEl.focus();

  const setHint = (msg, isErr) => {
    hint.textContent = msg || '';
    hint.classList.toggle('err', !!isErr);
  };

  // 「获取验证码」：只负责发送。失败时不进入校验流程，也不谎称已发送。
  sendBtn.addEventListener('click', async () => {
    const email = emailEl.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setHint('请输入正确的邮箱地址', true);
      return;
    }
    const cloud = ensureCloudClient();
    if (!cloud) { setHint('云服务不可用，请检查网络后重试', true); return; }

    sendBtn.disabled = true;
    setHint('发送中…', false);
    try {
      const sent = await cloud.auth.sendOtp({ email });
      if (sent.error) { setHint(sent.error.message || '验证码发送失败', true); sendBtn.disabled = false; return; }
      pendingEmailOtp = {
        email,
        verificationId: sent.data.verificationId,
        isExistingUser: sent.data.isExistingUser,
      };
      setHint('验证码已发送，请查收邮箱（含垃圾邮件）', false);
    } catch (e) {
      setHint('验证码发送失败，请稍后重试', true);
    }
    // 重新获取时重新计时，提交按钮保持可用
    startOtpCountdown(sendBtn, setHint);
  });

  // 「登录」：使用已保存的 challenge 校验，绝不在此处重新发送验证码
  okBtn.addEventListener('click', async () => {
    const email = emailEl.value.trim();
    const code = codeEl.value.trim();
    if (!pendingEmailOtp || pendingEmailOtp.email !== email) {
      setHint('请先点击「获取验证码」', true);
      return;
    }
    if (!code) { setHint('请输入验证码', true); return; }

    const cloud = ensureCloudClient();
    if (!cloud) { setHint('云服务不可用，请检查网络后重试', true); return; }

    okBtn.disabled = true;
    setHint('登录中…', false);
    try {
      const completed = await cloud.auth.verifyOtp({
        email: pendingEmailOtp.email,
        verificationId: pendingEmailOtp.verificationId,
        isExistingUser: pendingEmailOtp.isExistingUser,
        token: code,
      });
      if (completed.error) {
        // 保留已保存的 challenge：用户可直接改验证码重试，无需重新发送
        setHint(completed.error.message || '验证码不正确，请重试', true);
        okBtn.disabled = false;
        return;
      }
      const user = completed.data && completed.data.user ? completed.data.user : null;
      onCloudSignedIn(user);
      closeModal();
      toast('云同步已开启');
    } catch (e) {
      setHint('登录失败，请稍后重试', true);
      okBtn.disabled = false;
    }
  });

  codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') okBtn.click(); });
  document.getElementById('modalCancel').addEventListener('click', closeModal);
}

/** 获取验证码后的 60 秒重发倒计时（只作用于发送按钮，不影响提交） */
let otpCountdownTimer = null;
function startOtpCountdown(btn, setHint) {
  let left = 60;
  btn.disabled = true;
  const orig = btn.textContent;
  clearInterval(otpCountdownTimer);
  const tick = () => {
    btn.textContent = `${left} 秒后重发`;
    if (left <= 0) {
      clearInterval(otpCountdownTimer);
      btn.disabled = false;
      btn.textContent = orig || '重新获取';
      return;
    }
    left -= 1;
  };
  tick();
  otpCountdownTimer = setInterval(tick, 1000);
}

/* ---------------------- 会话 ---------------------- */
function isCloudSignedIn() {
  return !!(cloudSession && cloudSession.user);
}

/** 登录成功后的统一处理：记会话、同步一次数据 */
async function onCloudSignedIn(user) {
  cloudSession = { user };
  setCloudEmail(user && user.email ? user.email : '');
  renderSyncEntry();
  renderCloudCard();
  // 首次登录：以云端为准拉取（云端为空则把本地推上去）
  await cloudPull(false);
}

/** 退出登录：清会话。本地数据保留，不影响离线使用。 */
async function cloudSignOut() {
  const cloud = ensureCloudClient();
  try {
    if (cloud) await cloud.auth.signOut();
  } catch (_) {}
  cloudSession = null;
  setCloudEmail('');
  renderSyncEntry();
  renderCloudCard();
  toast('已退出登录，数据仍保留在本机');
}

/** 启动时恢复会话（不触发同步，只刷新界面） */
async function restoreCloudSession() {
  const cloud = ensureCloudClient();
  if (!cloud) { renderSyncEntry(); renderCloudCard(); return; }
  try {
    const { data: session, error } = await cloud.auth.getSession();
    if (!error && session) {
      cloudSession = { user: session.user || null };
      if (session.user && session.user.email) setCloudEmail(session.user.email);
    } else {
      cloudSession = null;
    }
  } catch (_) {
    cloudSession = null;
  }
  renderSyncEntry();
  renderCloudCard();
}

/* ---------------------- 数据同步：整份账本快照 ---------------------- */
/** 把本地账本推送到云端（upsert：有则更新，无则新建） */
async function cloudPush(showToast) {
  const cloud = ensureCloudClient();
  if (!cloud) { if (showToast) toast('云服务不可用', 'err'); return false; }
  if (!isCloudSignedIn()) { if (showToast) toast('请先登录', 'err'); return false; }

  try {
    // 先查是否已有本行（RLS 保证只查到自己的）
    const { data: rows, error: selErr } = await cloud.database
      .from(CLOUD_TABLE)
      .select('id')
      .limit(1);
    if (selErr) { if (showToast) toast('读取云端失败：' + selErr.message, 'err'); return false; }

    const payload = Store.data;
    let res;
    if (rows && rows.length) {
      // 更新已有行（不传 owner_id）
      res = await cloud.database
        .from(CLOUD_TABLE)
        .update({ payload, updated_at: new Date().toISOString() })
        .eq('id', rows[0].id)
        .select();
    } else {
      // 新建行（owner_id 由数据库 DEFAULT auth.uid() 填充）
      res = await cloud.database
        .from(CLOUD_TABLE)
        .insert({ payload })
        .select();
    }
    if (res.error) { if (showToast) toast('同步失败：' + res.error.message, 'err'); return false; }

    setLastSyncAt();
    if (showToast) toast('已上传到云端');
    renderCloudCard();
    return true;
  } catch (e) {
    console.error('[云同步] 上传失败', e);
    if (showToast) toast('同步失败，请检查网络', 'err');
    return false;
  }
}

/** 从云端拉取并覆盖本地（云端为空时，改为把本地推上去做初始化） */
async function cloudPull(showToast) {
  const cloud = ensureCloudClient();
  if (!cloud) { if (showToast) toast('云服务不可用', 'err'); return false; }
  if (!isCloudSignedIn()) { if (showToast) toast('请先登录', 'err'); return false; }

  try {
    const { data: rows, error } = await cloud.database
      .from(CLOUD_TABLE)
      .select('payload, updated_at')
      .limit(1);
    if (error) { if (showToast) toast('读取云端失败：' + error.message, 'err'); return false; }

    if (!rows || !rows.length) {
      // 云端还没有数据：把本地推上去，完成首次初始化
      return cloudPush(showToast);
    }

    const payload = rows[0].payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      if (showToast) toast('云端数据格式异常，已跳过', 'err');
      return false;
    }

    // 用云端数据覆盖本地，并走一遍迁移/校验，保证结构完整
    Store.data = payload;
    Store.migrate();
    Store.sanitize();
    Store.save();

    // 重新渲染全部界面
    applyAppName();
    if (typeof renderLedger === 'function') renderLedger();
    if (typeof renderStats === 'function') renderStats();
    if (typeof renderVault === 'function') renderVault();

    setLastSyncAt(rows[0].updated_at);
    if (showToast) toast('已从云端恢复');
    renderCloudCard();
    return true;
  } catch (e) {
    console.error('[云同步] 下载失败', e);
    if (showToast) toast('恢复失败，请检查网络', 'err');
    return false;
  }
}

/* ---------------------- 最近同步时间（仅界面展示） ---------------------- */
const CLOUD_SYNCED_KEY = 'life_assistant_cloud_synced_at';
function setLastSyncAt(iso) {
  try { localStorage.setItem(CLOUD_SYNCED_KEY, iso || new Date().toISOString()); } catch (_) {}
}

/* ---------------------- 变更后自动上传（节流） ---------------------- */
let autoPushTimer = null;
/** 本地数据变更后调用：登录状态下延迟 1.5s 自动上传，避免频繁请求 */
function scheduleAutoPush() {
  if (!isCloudSignedIn()) return;
  clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(() => { cloudPush(false); }, 1500);
}

/* ---------------------- 初始化 ---------------------- */
function initCloudSync() {
  const btn = document.getElementById('syncBtn');
  if (btn) btn.addEventListener('click', () => {
    if (isCloudSignedIn()) {
      // 已登录 → 跳到金库页管理同步
      switchPage('vault');
      const card = document.getElementById('cloudSyncCard');
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      openLoginModal();
    }
  });

  renderSyncEntry();
  renderCloudCard();
  restoreCloudSession();
}
