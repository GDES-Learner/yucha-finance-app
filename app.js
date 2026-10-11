/* =========================================================================
   个人生活助手 —— 记账 / 统计 / 金库
   数据存储：localStorage
   ========================================================================= */

'use strict';

/* ---------------------- 常量 ---------------------- */
const STORE_KEY = 'life_assistant_v1';
const DEFAULT_LIMIT = 1500;

const CATEGORIES = ['餐饮', '交通', '购物', '娱乐', '其它'];
const CATEGORY_ICON = { 餐饮: '🍚', 交通: '🚌', 购物: '🛍️', 娱乐: '🎮', 其它: '📌' };
const CATEGORY_COLOR = {
  餐饮: '#14b8a6',
  交通: '#3b82f6',
  购物: '#f59e0b',
  娱乐: '#a855f7',
  其它: '#94a3b8',
};

const ACCOUNTS = {
  bank: { name: '银行', icon: '🏦' },
  alipay: { name: '支付宝', icon: '💙' },
  wechat: { name: '微信', icon: '💚' },
};

const ACCOUNT_COLOR = { bank: '#3b82f6', alipay: '#0ea5e9', wechat: '#22c55e' };

/* ---------------------- 工具函数 ---------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const pad2 = (n) => String(n).padStart(2, '0');

/** 本地日期 YYYY-MM-DD（避免 UTC 偏移） */
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** 本地月份 YYYY-MM */
function monthStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
const dateOf = (s) => (s || '').slice(0, 10);
const monthOf = (s) => (s || '').slice(0, 7);

const money = (n) => '¥' + (Number(n) || 0).toFixed(2);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function formatDateCN(s) {
  const d = dateOf(s);
  const [y, m, day] = d.split('-');
  const week = ['日', '一', '二', '三', '四', '五', '六'];
  const w = new Date(`${d}T00:00:00`).getDay();
  return `${y}/${m}/${day} 周${week[w]}`;
}

/* ---------------------- 数据层 ---------------------- */
const Store = {
  data: null,

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      this.data = raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('读取本地数据失败，已重置', e);
      this.data = null;
    }
    if (!this.data || typeof this.data !== 'object') this.reset();
    // 结构兜底
    this.data.transactions = this.data.transactions || [];
    this.data.budgets = this.data.budgets || {};
    this.data.vault = Object.assign({ bank: 0, alipay: 0, wechat: 0 }, this.data.vault);
    return this.data;
  },

  reset() {
    this.data = {
      transactions: [],
      budgets: {},                    // { "YYYY-MM": limit }
      vault: { bank: 0, alipay: 0, wechat: 0 },
      customNav: [],                  // 预留扩展功能
    };
    this.save();
  },

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    } catch (e) {
      toast('保存失败：本地存储不可用');
    }
  },

  /* --- 交易 --- */
  addTransaction(tx) {
    this.data.transactions.push(tx);
    this.save();
  },
  removeTransaction(id) {
    const i = this.data.transactions.findIndex((t) => t.id === id);
    if (i > -1) { this.data.transactions.splice(i, 1); this.save(); return true; }
    return false;
  },
  getTransactions(month) {
    return this.data.transactions
      .filter((t) => monthOf(t.date) === month)
      .sort((a, b) => (b.date + String(b.createdAt)).localeCompare(a.date + String(a.createdAt)));
  },
  getByDate(date) {
    return this.data.transactions
      .filter((t) => dateOf(t.date) === date)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  /* --- 预算 --- */
  getLimit(month) {
    const v = this.data.budgets[month];
    return v == null ? DEFAULT_LIMIT : Number(v);
  },
  setLimit(month, value) {
    this.data.budgets[month] = Number(value);
    this.save();
  },

  /* --- 金库 --- */
  getVault() { return this.data.vault; },
  adjustVault(account, delta) {
    if (!this.data.vault.hasOwnProperty(account)) return;
    this.data.vault[account] = round2(this.data.vault[account] + delta);
    this.save();
  },
  totalAssets() {
    const v = this.data.vault;
    return round2(v.bank + v.alipay + v.wechat);
  },
};

/* ---------------------- 状态 ---------------------- */
const state = {
  page: 'ledger',
  entryType: 'expense',
  account: 'wechat',
  ledgerMonth: monthStr(),
  statsDate: todayStr(),
};

/* ---------------------- Toast ---------------------- */
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}

/* ---------------------- 弹窗 ---------------------- */
function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modalMask').classList.add('show');
}
function closeModal() {
  $('#modalMask').classList.remove('show');
  $('#modal').innerHTML = '';
}
$('#modalMask').addEventListener('click', (e) => { if (e.target.id === 'modalMask') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* =========================================================================
   页面路由
   ========================================================================= */
function switchPage(page) {
  state.page = page;
  $$('.nav-item[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
  if (page === 'stats') renderStats();
  if (page === 'vault') renderVault();
}

$$('.nav-item[data-page]').forEach((btn) => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

/* =========================================================================
   记账页
   ========================================================================= */

/* --- 环形仪表盘 --- */
const GAUGE_CIRC = 2 * Math.PI * 90; // r=90

function renderGauge() {
  const month = state.ledgerMonth;
  const isCurrent = month === monthStr();

  // 本月支出（与账单月份联动，默认本月）
  const txs = Store.getTransactions(month);
  const spent = round2(txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const limit = Store.getLimit(month);
  const remain = round2(limit - spent);
  const ratio = limit > 0 ? spent / limit : (spent > 0 ? 1 : 0);
  const pct = Math.round(ratio * 100);

  // 环形填充
  const fill = $('#gaugeFill');
  const shown = Math.min(ratio, 1); // 环最多填满，超额用颜色表达
  fill.style.strokeDashoffset = String(GAUGE_CIRC * (1 - shown));

  // 颜色分级
  let color = 'var(--teal)', cls = '', label = '正常';
  if (ratio > 1) { color = 'var(--danger)'; cls = 'danger'; label = '已超额支出'; }
  else if (ratio >= 0.7) { color = 'var(--warn)'; cls = 'warn'; label = '接近上限，注意控制'; }
  fill.style.stroke = color;

  const pctEl = $('#gaugePct');
  pctEl.textContent = pct + '%';
  pctEl.style.color = color;

  $('#gaugeSpent').textContent = money(spent);
  $('#gaugeLimit').textContent = money(limit);
  $('#gaugeRemain').textContent = (remain >= 0 ? '' : '-') + money(Math.abs(remain));
  $('#gaugeRemain').style.color = remain < 0 ? 'var(--danger)' : 'var(--teal-dark)';
  $('#gaugeSub').textContent = isCurrent ? '本月已花 / 上限' : `${month} 已花 / 上限`;

  const st = $('#gaugeState');
  st.className = 'gauge-state ' + cls;
  st.textContent = label;
}

/* --- 记账表单 --- */
function setEntryType(type) {
  state.entryType = type;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.type === type));
  const isExpense = type === 'expense';
  $('#rowCategory').style.display = isExpense ? '' : 'none';
  $('#labelAccount').textContent = isExpense ? '扣款账户' : '来源账户';
  $('#submitBtn').textContent = isExpense ? '记录支出' : '记录收入';
  if (!isExpense) setAccount('bank'); else setAccount(state.account);
}

function setAccount(acc) {
  state.account = acc;
  $$('#segsAccount .seg').forEach((s) => s.classList.toggle('active', s.dataset.account === acc));
}

$$('.tab').forEach((t) => t.addEventListener('click', () => setEntryType(t.dataset.type)));
$$('#segsAccount .seg').forEach((s) => s.addEventListener('click', () => setAccount(s.dataset.account)));

$('#entryForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseFloat($('#fAmount').value);
  if (!amount || amount <= 0) { toast('请输入有效金额'); return; }

  const type = state.entryType;
  const account = state.account;
  const date = $('#fDate').value || todayStr();
  const isExpense = type === 'expense';

  const tx = {
    id: uid(),
    type,
    amount: round2(amount),
    category: isExpense ? $('#fCategory').value : '',
    account,
    remark: $('#fRemark').value.trim(),
    date,
    createdAt: Date.now(),
  };

  Store.addTransaction(tx);
  // 联动金库：支出扣款，收入入账
  Store.adjustVault(account, isExpense ? -tx.amount : tx.amount);

  // 若记录日期所在月份非当前查看月份，自动跳转
  const txMonth = monthOf(date);
  if (txMonth !== state.ledgerMonth) {
    state.ledgerMonth = txMonth;
    $('#ledgerMonth').value = txMonth;
  }

  // 表单重置
  $('#fAmount').value = '';
  $('#fRemark').value = '';
  $('#fDate').value = todayStr();

  renderLedger();
  toast(isExpense ? `已记录支出 ${money(tx.amount)}` : `已记录收入 ${money(tx.amount)}`);
});

/* --- 账单列表 --- */
function renderBillList(month) {
  const list = $('#billList');
  const txs = Store.getTransactions(month);

  const expense = round2(txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const income = round2(txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0));
  $('#listSummary').innerHTML = txs.length
    ? `<span>共 <b>${txs.length}</b> 笔</span>
       <span>支出 <b>${money(expense)}</b></span>
       <span>收入 <b>${money(income)}</b></span>
       <span>结余 <b>${money(income - expense)}</b></span>`
    : '';

  if (!txs.length) {
    list.innerHTML = `<li class="empty">本月暂无记录，去记一笔吧 ✍️</li>`;
    return;
  }

  list.innerHTML = txs.map((t) => {
    const isExpense = t.type === 'expense';
    const cat = isExpense ? t.category : '收入';
    const icon = isExpense ? (CATEGORY_ICON[t.category] || '📌') : '💰';
    const acc = ACCOUNTS[t.account] || { name: t.account, icon: '' };
    return `
      <li class="bill-item" data-id="${t.id}">
        <div class="bill-cat">${icon}</div>
        <div class="bill-main">
          <div class="bill-top"><span class="bill-title">${escapeHtml(cat)}</span></div>
          ${t.remark ? `<div class="bill-remark">${escapeHtml(t.remark)}</div>` : ''}
          <div class="bill-meta">
            <span class="bill-tag">${acc.icon} ${escapeHtml(acc.name)}</span>
            <span class="bill-date">${formatDateCN(t.date)}</span>
          </div>
        </div>
        <div class="bill-amt ${isExpense ? 'out' : 'in'}">${isExpense ? '-' : '+'}${money(t.amount).slice(1)}</div>
        <div class="bill-actions">
          ${isExpense ? `<button class="btn-mini" data-act="account">改账户</button>` : ''}
          <button class="btn-mini del" data-act="del">删除</button>
        </div>
      </li>`;
  }).join('');
}

/* --- 账单操作（事件委托） --- */
$('#billList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.bill-item').dataset.id;
  if (btn.dataset.act === 'del') deleteTx(id);
  if (btn.dataset.act === 'account') openChangeAccount(id);
});

function deleteTx(id) {
  const tx = Store.data.transactions.find((t) => t.id === id);
  if (!tx) return;
  // 回滚金库
  Store.adjustVault(tx.account, tx.type === 'expense' ? tx.amount : -tx.amount);
  Store.removeTransaction(id);
  renderLedger();
  if (state.page === 'stats') renderStats();
  if (state.page === 'vault') renderVault();
  toast('已删除该笔记录');
}

/* --- 改账户 --- */
function openChangeAccount(id) {
  const tx = Store.data.transactions.find((t) => t.id === id);
  if (!tx) return;
  const opts = Object.entries(ACCOUNTS).map(([k, v]) =>
    `<div class="seg ${k === tx.account ? 'active' : ''}" data-acc="${k}">${v.icon} ${v.name}</div>`
  ).join('');

  openModal(`
    <h3>修改扣款账户</h3>
    <p>当前：${ACCOUNTS[tx.account].name} · ${money(tx.amount)}。切换后，系统会把原账户金额加回，再从新账户扣除等额金额。</p>
    <div class="segmented" id="modalSegs" style="margin-bottom:18px">${opts}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-primary" id="modalOk">确认修改</button>
    </div>
  `);

  let picked = tx.account;
  $('#modalSegs').addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    picked = seg.dataset.acc;
    $$('#modalSegs .seg').forEach((s) => s.classList.toggle('active', s === seg));
  });
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    if (picked === tx.account) { closeModal(); return; }
    const oldAcc = tx.account;
    // 1) 原账户加回  2) 新账户扣除
    Store.adjustVault(oldAcc, tx.amount);
    Store.adjustVault(picked, -tx.amount);
    tx.account = picked;
    Store.save();
    closeModal();
    renderLedger();
    if (state.page === 'vault') renderVault();
    toast(`已改为「${ACCOUNTS[picked].name}」，金额已同步调整`);
  });
}

/* --- 修改月度上限 --- */
$('#editLimitBtn').addEventListener('click', () => {
  const month = state.ledgerMonth;
  const cur = Store.getLimit(month);
  openModal(`
    <h3>修改资金上限</h3>
    <p>${month} 的月度消费上限（默认 ¥${DEFAULT_LIMIT}）</p>
    <div class="form-row">
      <label>上限</label>
      <input type="number" id="limitInput" step="0.01" min="0" value="${cur}" />
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-primary" id="modalOk">保存</button>
    </div>
  `);
  $('#limitInput').focus();
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    const v = parseFloat($('#limitInput').value);
    if (isNaN(v) || v < 0) { toast('请输入有效数值'); return; }
    Store.setLimit(month, round2(v));
    closeModal();
    renderGauge();
    toast('资金上限已更新');
  });
  $('#limitInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#modalOk').click();
  });
});

/* =========================================================================
   统计页
   ========================================================================= */
function renderStats() {
  const date = state.statsDate;
  const txs = Store.getByDate(date).filter((t) => t.type === 'expense');

  const byCat = {};
  txs.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const total = round2(Object.values(byCat).reduce((s, v) => s + v, 0));

  $('#statsTitle').textContent = txs.length
    ? `${formatDateCN(date)} 支出分类占比`
    : '当日支出分类占比';
  $('#statsTotal').textContent = money(total);

  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const svg = $('#donutSvg');
  const legend = $('#statsLegend');

  const R = 78, C = 2 * Math.PI * R;

  if (!entries.length) {
    svg.innerHTML = `<circle cx="110" cy="110" r="${R}" stroke="#eef2f5" stroke-width="26"></circle>`;
    legend.innerHTML = `<li class="empty" style="padding:0">当天没有支出记录</li>`;
  } else {
    let offset = 0;
    const arcs = entries.map(([cat, amt]) => {
      const frac = amt / total;
      const len = C * frac;
      const color = CATEGORY_COLOR[cat] || '#94a3b8';
      const el = `<circle class="donut-seg" cx="110" cy="110" r="${R}"
          stroke="${color}" stroke-width="26"
          stroke-dasharray="${len} ${C - len}"
          stroke-dashoffset="${-offset}"><title>${cat} ${money(amt)}</title></circle>`;
      offset += len;
      return el;
    }).join('');
    svg.innerHTML = `<circle cx="110" cy="110" r="${R}" stroke="#f1f4f6" stroke-width="26"></circle>${arcs}`;

    legend.innerHTML = entries.map(([cat, amt]) => {
      const frac = amt / total;
      const color = CATEGORY_COLOR[cat] || '#94a3b8';
      return `
        <li class="legend-item">
          <span class="legend-dot" style="background:${color}"></span>
          <span class="legend-name">${CATEGORY_ICON[cat] || ''} ${escapeHtml(cat)}</span>
          <span class="legend-bar"><i style="width:${(frac * 100).toFixed(1)}%;background:${color}"></i></span>
          <span class="legend-amt">${money(amt)}</span>
          <span class="legend-pct">${(frac * 100).toFixed(1)}%</span>
        </li>`;
    }).join('');
  }

  // 当日账单
  const dayList = Store.getByDate(date);
  const ul = $('#statsBillList');
  if (!dayList.length) {
    ul.innerHTML = `<li class="empty">当天暂无账单</li>`;
  } else {
    ul.innerHTML = dayList.map((t) => {
      const isExpense = t.type === 'expense';
      const icon = isExpense ? (CATEGORY_ICON[t.category] || '📌') : '💰';
      const acc = ACCOUNTS[t.account] || { name: t.account, icon: '' };
      return `
        <li class="bill-item">
          <div class="bill-cat">${icon}</div>
          <div class="bill-main">
            <div class="bill-top"><span class="bill-title">${escapeHtml(isExpense ? t.category : '收入')}</span></div>
            ${t.remark ? `<div class="bill-remark">${escapeHtml(t.remark)}</div>` : ''}
            <div class="bill-meta"><span class="bill-tag">${acc.icon} ${escapeHtml(acc.name)}</span></div>
          </div>
          <div class="bill-amt ${isExpense ? 'out' : 'in'}">${isExpense ? '-' : '+'}${money(t.amount).slice(1)}</div>
        </li>`;
    }).join('');
  }
}

$('#statsDate').addEventListener('change', (e) => {
  state.statsDate = e.target.value || todayStr();
  renderStats();
});

/* =========================================================================
   金库页
   ========================================================================= */
function renderVault() {
  const v = Store.getVault();
  $('#totalAssets').textContent = money(Store.totalAssets());

  $('#vaultGrid').innerHTML = Object.entries(ACCOUNTS).map(([key, info]) => {
    const bal = v[key] || 0;
    return `
      <div class="vault-card">
        <div class="vault-head">
          <span class="vault-icon">${info.icon}</span>
          <span class="vault-name">${info.name}</span>
        </div>
        <div class="vault-amount ${bal < 0 ? 'neg' : ''}">${money(bal)}</div>
        <div class="vault-actions">
          <button class="btn-mini" data-vault-act="set" data-acc="${key}">改余额</button>
        </div>
      </div>`;
  }).join('');

  // 账户流水（全部交易，按时间倒序，取最近 50 条）
  const all = Store.data.transactions
    .slice()
    .sort((a, b) => (b.date + String(b.createdAt)).localeCompare(a.date + String(a.createdAt)))
    .slice(0, 50);

  const ul = $('#vaultBillList');
  if (!all.length) {
    ul.innerHTML = `<li class="empty">暂无流水记录</li>`;
    return;
  }
  ul.innerHTML = all.map((t) => {
    const isExpense = t.type === 'expense';
    const icon = isExpense ? (CATEGORY_ICON[t.category] || '📌') : '💰';
    const acc = ACCOUNTS[t.account] || { name: t.account, icon: '' };
    return `
      <li class="bill-item">
        <div class="bill-cat">${icon}</div>
        <div class="bill-main">
          <div class="bill-top"><span class="bill-title">${escapeHtml(isExpense ? t.category : '收入')}</span></div>
          ${t.remark ? `<div class="bill-remark">${escapeHtml(t.remark)}</div>` : ''}
          <div class="bill-meta">
            <span class="bill-tag">${acc.icon} ${escapeHtml(acc.name)}</span>
            <span class="bill-date">${formatDateCN(t.date)}</span>
          </div>
        </div>
        <div class="bill-amt ${isExpense ? 'out' : 'in'}">${isExpense ? '-' : '+'}${money(t.amount).slice(1)}</div>
      </li>`;
  }).join('');
}

$('#vaultGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-vault-act="set"]');
  if (!btn) return;
  const key = btn.dataset.acc;
  const info = ACCOUNTS[key];
  const cur = Store.getVault()[key] || 0;
  openModal(`
    <h3>调整「${info.name}」余额</h3>
    <p>直接设置该账户当前余额（允许为负数）</p>
    <div class="form-row">
      <label>余额</label>
      <input type="number" id="vaultInput" step="0.01" value="${cur}" />
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-primary" id="modalOk">保存</button>
    </div>
  `);
  $('#vaultInput').focus();
  $('#vaultInput').select();
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    const nv = parseFloat($('#vaultInput').value);
    if (isNaN(nv)) { toast('请输入有效数值'); return; }
    Store.data.vault[key] = round2(nv);
    Store.save();
    closeModal();
    renderVault();
    toast(`${info.name} 余额已更新`);
  });
  $('#vaultInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#modalOk').click(); });
});

/* =========================================================================
   添加功能（预留扩展位）
   ========================================================================= */
$('#addFuncBtn').addEventListener('click', () => {
  openModal(`
    <h3>添加功能</h3>
    <p>这里是为后续功能预留的扩展入口。可以把你想要的新模块告诉我，我来帮你加上。</p>
    <div class="modal-actions">
      <button class="btn btn-primary" id="modalOk">知道了</button>
    </div>
  `);
  $('#modalOk').addEventListener('click', closeModal);
});

/* ---------------------- 安全转义 ---------------------- */
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* =========================================================================
   统一渲染 & 初始化
   ========================================================================= */
function renderLedger() {
  renderGauge();
  renderBillList(state.ledgerMonth);
}

$('#ledgerMonth').addEventListener('change', (e) => {
  state.ledgerMonth = e.target.value || monthStr();
  renderLedger();
});

function init() {
  Store.load();
  if (!Store.data.transactions.length && !Object.keys(Store.data.budgets).length) {
    // 首次使用：预置一个示例结构（不塞假数据，保持干净）
  }
  state.ledgerMonth = monthStr();
  state.statsDate = todayStr();
  state.account = 'wechat';

  $('#ledgerMonth').value = state.ledgerMonth;
  $('#statsDate').value = state.statsDate;
  $('#fDate').value = todayStr();

  setEntryType('expense');
  switchPage('ledger');
  renderLedger();
}

document.addEventListener('DOMContentLoaded', init);
if (document.readyState !== 'loading') init();
