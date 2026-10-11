/* =========================================================================
   个人生活助手 —— 记账 / 统计 / 金库
   数据存储：localStorage
   ========================================================================= */

'use strict';

/* ---------------------- 常量 ---------------------- */
const STORE_KEY = 'life_assistant_v1';
const DATA_VERSION = 2;
const DEFAULT_LIMIT = 1500;

/* 分类：吃饭 / 奶茶 / 宵夜（原「餐饮」拆分）+ 宿舍 + 交通 / 购物 / 娱乐 / 其它 */
const CATEGORIES = ['吃饭', '奶茶', '宵夜', '宿舍', '交通', '购物', '娱乐', '其它'];
const CATEGORY_ICON = {
  吃饭: '🍚', 奶茶: '🧋', 宵夜: '🍢', 宿舍: '🛏️',
  交通: '🚌', 购物: '🛍️', 娱乐: '🎮', 其它: '📌',
};
const CATEGORY_COLOR = {
  吃饭: '#14b8a6',
  奶茶: '#ec4899',
  宵夜: '#f97316',
  宿舍: '#8b5cf6',
  交通: '#3b82f6',
  购物: '#f59e0b',
  娱乐: '#a855f7',
  其它: '#94a3b8',
};

/* 历史数据兼容：旧「餐饮」统一归入「吃饭」 */
const CATEGORY_ALIAS = { 餐饮: '吃饭' };
function normalizeCategory(cat) {
  return CATEGORY_ALIAS[cat] || cat;
}

/* 账户顺序：微信 → 支付宝 → 银行（微信为默认付款方式） */
const ACCOUNTS = {
  wechat: { name: '微信', icon: '💚' },
  alipay: { name: '支付宝', icon: '💙' },
  bank: { name: '银行', icon: '🏦' },
};
const DEFAULT_ACCOUNT = 'wechat';

const ACCOUNT_COLOR = { wechat: '#22c55e', alipay: '#0ea5e9', bank: '#3b82f6' };

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
const numOr = (v, dft) => (isFinite(Number(v)) ? Number(v) : dft);

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
    let raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch (e) {
      console.warn('localStorage 不可用', e);
    }

    let parsed = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        // 数据损坏：先备份原始串，避免直接丢失
        console.warn('本地数据解析失败，已备份原始串', e);
        try { localStorage.setItem(STORE_KEY + '_backup_' + Date.now(), raw); } catch (_) {}
        parsed = null;
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.reset();
      return this.data;
    }

    this.data = parsed;
    this.migrate();
    this.sanitize();
    return this.data;
  },

  /** 数据版本迁移：v1 → v2（餐饮 → 吃饭；账户键顺序调整不影响数据） */
  migrate() {
    const v = Number(this.data.version || 1);
    if (v < 2) {
      (this.data.transactions || []).forEach((t) => {
        if (t && t.category) t.category = normalizeCategory(t.category);
      });
      this.data.version = DATA_VERSION;
      this.save();
    }
    this.data.version = DATA_VERSION;
  },

  /** 结构校验与兜底：确保关键字段存在且类型正确 */
  sanitize() {
    if (!Array.isArray(this.data.transactions)) this.data.transactions = [];
    if (!this.data.budgets || typeof this.data.budgets !== 'object') this.data.budgets = {};
    if (!this.data.vault || typeof this.data.vault !== 'object') this.data.vault = {};

    this.data.vault = {
      wechat: numOr(this.data.vault.wechat, 0),
      alipay: numOr(this.data.vault.alipay, 0),
      bank: numOr(this.data.vault.bank, 0),
    };

    // 过滤非法交易记录，并补齐缺失字段
    this.data.transactions = this.data.transactions.filter((t) => {
      if (!t || typeof t !== 'object') return false;
      const amt = Number(t.amount);
      if (!isFinite(amt) || amt <= 0) return false;
      if (t.type !== 'expense' && t.type !== 'income') return false;
      if (!t.date || typeof t.date !== 'string') return false;
      t.amount = round2(amt);
      t.account = this.data.vault.hasOwnProperty(t.account) ? t.account : DEFAULT_ACCOUNT;
      t.category = t.type === 'expense' ? normalizeCategory(t.category || '其它') : '';
      t.remark = typeof t.remark === 'string' ? t.remark : '';
      t.createdAt = Number(t.createdAt) || Date.parse(t.date) || Date.now();
      if (!t.id) t.id = uid();
      return true;
    });

    if (!Array.isArray(this.data.customNav)) this.data.customNav = [];
  },

  reset() {
    this.data = {
      version: DATA_VERSION,
      transactions: [],
      budgets: {},                    // { "YYYY-MM": limit }
      vault: { wechat: 0, alipay: 0, bank: 0 },
      customNav: [],                  // 预留扩展功能
    };
    this.save();
  },

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
      return true;
    } catch (e) {
      console.error('保存失败', e);
      toast('保存失败：本地存储空间不足或被禁用');
      return false;
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
    if (v == null) return DEFAULT_LIMIT;
    const n = Number(v);
    return isFinite(n) && n >= 0 ? n : DEFAULT_LIMIT;
  },
  setLimit(month, value) {
    this.data.budgets[month] = round2(numOr(value, DEFAULT_LIMIT));
    this.save();
  },

  /* --- 金库 --- */
  getVault() { return this.data.vault; },
  adjustVault(account, delta) {
    if (!Object.prototype.hasOwnProperty.call(this.data.vault, account)) return;
    const d = numOr(delta, 0);
    this.data.vault[account] = round2(this.data.vault[account] + d);
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

  // 剩余每日平均花费上限 = 剩余可支配 / 本月剩余天数（含当天）
  renderGaugeDaily(month, remain, isCurrent);

  const st = $('#gaugeState');
  st.className = 'gauge-state ' + cls;
  st.textContent = label;
}

/** 计算并展示每日平均花费上限 */
function renderGaugeDaily(month, remain, isCurrent) {
  const el = $('#gaugeDaily');
  if (!el) return;

  // 剩余天数：当前月按「含今天」计算；历史月份按整月天数；未来月份按整月天数
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const now = new Date();

  let remainDays;
  if (month < monthStr()) {
    remainDays = 0;               // 已过去的月份，不再分配
  } else if (month === monthStr()) {
    remainDays = daysInMonth - now.getDate() + 1;   // 含今天
  } else {
    remainDays = daysInMonth;     // 未来月份，整月可用
  }

  if (remainDays <= 0) {
    // 历史月份：不再有可分配额度
    el.textContent = money(0);
    el.style.color = 'var(--text-3)';
    el.title = '该月份已结束';
    return;
  }

  const daily = remain / remainDays;
  el.textContent = (daily < 0 ? '-' : '') + money(Math.abs(daily));
  el.style.color = daily < 0 ? 'var(--danger)' : 'var(--text)';
  el.title = remain >= 0
    ? `剩余 ${money(remain)} ÷ 剩余 ${remainDays} 天`
    : `已超额 ${money(Math.abs(remain))}，本月已无额度可分配`;
}

/* --- 记账表单（支持记账页 / 统计页多处实例） --- */
function initEntryForms() {
  $$('.entry-form').forEach((form) => {
    // .tab 页签与表单是兄弟节点，需从包含它们的卡片/页面范围内查找
    const scope = form.closest('.card') || form.closest('.page') || form.parentElement;
    const tabsOf = () => Array.from(scope.querySelectorAll('.tab'));

    const typeOf = () => (form.dataset.type || 'expense');
    const segsAcc = () => Array.from(form.querySelectorAll('.segs-account .seg'));
    const accountOf = () => {
      const active = segsAcc().find((s) => s.classList.contains('active'));
      return active ? active.dataset.account : DEFAULT_ACCOUNT;
    };

    // 账户切换
    form.querySelectorAll('.segs-account .seg').forEach((s) => {
      s.addEventListener('click', () => {
        segsAcc().forEach((x) => x.classList.toggle('active', x === s));
      });
    });

    // 支出 / 收入 切换
    tabsOf().forEach((t) => {
      t.addEventListener('click', () => applyEntryType(form, t.dataset.type));
    });

    // 提交
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = parseFloat(form.querySelector('.f-amount').value);
      if (!amount || amount <= 0) { toast('请输入有效金额'); return; }

      const type = typeOf();
      const isExpense = type === 'expense';
      const account = accountOf();
      const date = form.querySelector('.f-date').value || todayStr();

      const tx = {
        id: uid(),
        type,
        amount: round2(amount),
        category: isExpense ? form.querySelector('.f-category').value : '',
        account,
        remark: form.querySelector('.f-remark').value.trim(),
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
      form.querySelector('.f-amount').value = '';
      form.querySelector('.f-remark').value = '';
      form.querySelector('.f-date').value = todayStr();

      renderLedger();
      if ($('#page-stats').classList.contains('active')) renderStats();
      if ($('#page-vault').classList.contains('active')) renderVault();
      toast(isExpense ? `已记录支出 ${money(tx.amount)}` : `已记录收入 ${money(tx.amount)}`);
    });

    // 默认状态
    applyEntryType(form, 'expense');
    form.querySelector('.f-date').value = todayStr();
  });
}

/** 切换某个表单的支出/收入状态 */
function applyEntryType(form, type) {
  form.dataset.type = type;
  const isExpense = type === 'expense';
  const scope = form.closest('.card') || form.closest('.page') || form.parentElement;
  scope.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.type === type));
  form.querySelector('.row-category').style.display = isExpense ? '' : 'none';
  form.querySelector('.label-account').textContent = isExpense ? '扣款账户' : '来源账户';
  form.querySelector('.submit-btn').textContent = isExpense ? '记录支出' : '记录收入';
  // 支出默认扣款账户：微信；收入默认来源账户：银行
  const dft = isExpense ? DEFAULT_ACCOUNT : 'bank';
  form.querySelectorAll('.segs-account .seg').forEach((s) =>
    s.classList.toggle('active', s.dataset.account === dft));
}

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
    const cat = isExpense ? normalizeCategory(t.category) : '收入';
    const icon = isExpense ? (CATEGORY_ICON[normalizeCategory(t.category)] || '📌') : '💰';
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
  txs.forEach((t) => {
    const c = normalizeCategory(t.category);
    byCat[c] = (byCat[c] || 0) + t.amount;
  });
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
      const catName = normalizeCategory(t.category);
      const icon = isExpense ? (CATEGORY_ICON[catName] || '📌') : '💰';
      const acc = ACCOUNTS[t.account] || { name: t.account, icon: '' };
      return `
        <li class="bill-item">
          <div class="bill-cat">${icon}</div>
          <div class="bill-main">
            <div class="bill-top"><span class="bill-title">${escapeHtml(isExpense ? catName : '收入')}</span></div>
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
  renderStorageNote();

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
    const catName = normalizeCategory(t.category);
    const icon = isExpense ? (CATEGORY_ICON[catName] || '📌') : '💰';
    const acc = ACCOUNTS[t.account] || { name: t.account, icon: '' };
    return `
      <li class="bill-item">
        <div class="bill-cat">${icon}</div>
        <div class="bill-main">
          <div class="bill-top"><span class="bill-title">${escapeHtml(isExpense ? catName : '收入')}</span></div>
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

/* --- 本地存储状态提示 --- */
function renderStorageNote() {
  const el = $('#storageNote');
  if (!el) return;
  let bytes = 0;
  try { bytes = (localStorage.getItem(STORE_KEY) || '').length; } catch (_) {}
  const kb = (bytes / 1024).toFixed(1);
  const count = Store.data.transactions.length;
  el.textContent = `数据已保存在本机浏览器 · ${count} 笔记录 · 约 ${kb} KB`;
}

/* --- 导出 / 导入备份（防止换浏览器或清理数据导致丢失） --- */
function exportData() {
  const payload = {
    app: 'life-assistant',
    exportedAt: new Date().toISOString(),
    data: Store.data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `记账数据备份_${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出备份文件');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const data = parsed && parsed.data ? parsed.data : parsed;
        if (!data || !Array.isArray(data.transactions)) throw new Error('格式不正确');
        Store.data = data;
        Store.migrate();
        Store.sanitize();
        Store.save();
        renderLedger();
        renderStats();
        renderVault();
        toast(`已导入 ${Store.data.transactions.length} 笔记录`);
      } catch (err) {
        toast('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

$('#exportBtn').addEventListener('click', exportData);
$('#importBtn').addEventListener('click', importData);

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
  state.ledgerMonth = monthStr();
  state.statsDate = todayStr();

  $('#ledgerMonth').value = state.ledgerMonth;
  $('#statsDate').value = state.statsDate;

  initEntryForms();
  switchPage('ledger');
  renderLedger();
}

document.addEventListener('DOMContentLoaded', init);
if (document.readyState !== 'loading') init();
