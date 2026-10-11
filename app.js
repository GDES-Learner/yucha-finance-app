/* =========================================================================
   个人生活助手 —— 记账 / 统计 / 金库
   设计：Apple Liquid Glass 材质 + Lucide 线性图标
   数据存储：localStorage（关闭浏览器不丢失）
   ========================================================================= */

'use strict';

/* ---------------------- 常量 ---------------------- */
const STORE_KEY = 'life_assistant_v1';
const DATA_VERSION = 3;
const DEFAULT_LIMIT = 1500;

/* 分类：吃饭 / 奶茶 / 宵夜（原「餐饮」拆分）+ 宿舍 + 交通 / 购物 / 娱乐 / 其它 */
const CATEGORIES = ['吃饭', '奶茶', '宵夜', '宿舍', '交通', '购物', '娱乐', '其它'];

/* Lucide 图标名（替代 emoji，保持内容层统一线性风格） */
const CATEGORY_ICON = {
  吃饭: 'utensils', 奶茶: 'cup-soda', 宵夜: 'moon', 宿舍: 'bed-double',
  交通: 'bus', 购物: 'shopping-bag', 娱乐: 'gamepad-2', 其它: 'package',
};

/* 分类色板：低饱和、与设计系统一致 */
const CATEGORY_COLOR = {
  吃饭: '#17a073',
  奶茶: '#c76a9a',
  宵夜: '#d0803c',
  宿舍: '#7b6bc4',
  交通: '#4a7fc1',
  购物: '#c99a2e',
  娱乐: '#a3679f',
  其它: '#8798a0',
};

/* 每个分类色对应的浅色底（图标 chip 背景） */
const CATEGORY_TINT = {
  吃饭: '#e6f5ef',
  奶茶: '#f8ecf3',
  宵夜: '#fbeee2',
  宿舍: '#efedf9',
  交通: '#e8f0f9',
  购物: '#f9f2e0',
  娱乐: '#f4ecf3',
  其它: '#eef1f1',
};

/* 历史数据兼容：旧「餐饮」统一归入「吃饭」 */
const CATEGORY_ALIAS = { 餐饮: '吃饭' };
function normalizeCategory(cat) {
  return CATEGORY_ALIAS[cat] || cat;
}

/* 该笔支出是否计入当月环形图（未设置的历史记录默认计入） */
function isCounted(tx) {
  return !(tx && tx.counted === false);
}

/* 账户顺序：微信 → 支付宝 → 银行（微信为默认付款方式）
   微信在金库中拆分为「零钱 / 零钱通」；记账扣款默认走「零钱」。 */
const ACCOUNTS = {
  wechat: {
    name: '微信', icon: 'message-square-text',
    subAccounts: [
      { key: 'wechat_change', name: '零钱', icon: 'coins', isDefault: true },
      { key: 'wechat_lct', name: '零钱通', icon: 'piggy-bank' },
    ],
  },
  alipay: { name: '支付宝', icon: 'smartphone' },
  bank: { name: '银行', icon: 'landmark' },
};
const DEFAULT_ACCOUNT = 'wechat';

/* 金库余额键：微信拆为 wechat_change（零钱）/ wechat_lct（零钱通），其余账户同名 */
const VAULT_KEYS = ['wechat_change', 'wechat_lct', 'alipay', 'bank'];
const VAULT_META = {
  wechat_change: { name: '零钱', icon: 'coins', parent: 'wechat' },
  wechat_lct: { name: '零钱通', icon: 'piggy-bank', parent: 'wechat' },
  alipay: { name: '支付宝', icon: 'smartphone' },
  bank: { name: '银行', icon: 'landmark' },
};
/* 交易里的 account → 金库扣减键（微信默认扣「零钱」） */
const ACCOUNT_TO_VAULT_KEY = { wechat: 'wechat_change', alipay: 'alipay', bank: 'bank' };
function vaultKeyOf(account) {
  return ACCOUNT_TO_VAULT_KEY[account] || account;
}

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

/** 月份加减：'YYYY-MM' + n 个月，Date 自动处理跨年进位/借位 */
function addMonths(ym, n) {
  const [y, m] = (ym || monthStr()).split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

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

/* ---------------------- Lucide 图标 ---------------------- */
/** 生成一个 Lucide 图标占位元素（<i data-lucide>） */
function icon(name, cls) {
  return `<i data-lucide="${name}"${cls ? ` class="${cls}"` : ''}></i>`;
}
/** 渲染所有尚未实例化的 Lucide 图标（幂等，可重复调用） */
function refreshIcons(root) {
  try {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons({
        attrs: { 'stroke-width': 1.9 },
        nameAttr: 'data-lucide',
        ...(root ? { root } : {}),
      });
    }
  } catch (e) {
    // 图标库缺失时静默降级为无图标，不影响任何数据功能
    console.warn('图标渲染失败（不影响功能）', e);
  }
}

/* 分类图标 chip（浅色底 + 分类色图标） */
function catChip(cat, size) {
  const name = normalizeCategory(cat);
  const ic = CATEGORY_ICON[name] || 'package';
  const fg = CATEGORY_COLOR[name] || '#8798a0';
  const bg = CATEGORY_TINT[name] || '#eef1f1';
  return `<span class="cat-chip${size === 'lg' ? ' cat-lg' : ''}" style="--chip-bg:${bg};--chip-fg:${fg}">${icon(ic)}</span>`;
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

  /** 数据版本迁移：v1→v2（餐饮→吃饭）；v2→v3（微信拆为零钱/零钱通） */
  migrate() {
    const v = Number(this.data.version || 1);

    if (v < 2) {
      (this.data.transactions || []).forEach((t) => {
        if (t && t.category) t.category = normalizeCategory(t.category);
      });
    }

    if (v < 3) {
      // 旧版 vault.wechat 余额整体迁入「零钱」，零钱通从 0 开始
      const old = this.data.vault || {};
      const legacyWechat = numOr(old.wechat, 0);
      this.data.vault = {
        wechat_change: legacyWechat,
        wechat_lct: numOr(old.wechat_lct, 0),
        alipay: numOr(old.alipay, 0),
        bank: numOr(old.bank, 0),
      };
      // 交易记录里的 account 保持 'wechat' 不变（默认扣零钱）
    }

    this.data.version = DATA_VERSION;
    this.save();
  },

  /** 结构校验与兜底：确保关键字段存在且类型正确 */
  sanitize() {
    if (!Array.isArray(this.data.transactions)) this.data.transactions = [];
    if (!this.data.budgets || typeof this.data.budgets !== 'object') this.data.budgets = {};
    if (!this.data.vault || typeof this.data.vault !== 'object') this.data.vault = {};

    // 金库键标准化（兼容任何残缺结构）
    const v = this.data.vault;
    this.data.vault = {
      wechat_change: numOr(v.wechat_change, numOr(v.wechat, 0)),
      wechat_lct: numOr(v.wechat_lct, 0),
      alipay: numOr(v.alipay, 0),
      bank: numOr(v.bank, 0),
    };

    // 过滤非法交易记录，并补齐缺失字段
    this.data.transactions = this.data.transactions.filter((t) => {
      if (!t || typeof t !== 'object') return false;
      const amt = Number(t.amount);
      if (!isFinite(amt) || amt <= 0) return false;
      if (t.type !== 'expense' && t.type !== 'income') return false;
      if (!t.date || typeof t.date !== 'string') return false;
      t.amount = round2(amt);
      t.account = ACCOUNTS.hasOwnProperty(t.account) ? t.account : DEFAULT_ACCOUNT;
      t.category = t.type === 'expense' ? normalizeCategory(t.category || '其它') : '';
      t.counted = t.counted !== false;   // 默认计入环形图
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
      vault: { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 },
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
      toast('保存失败：本地存储空间不足或被禁用', 'err');
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

  /** 调整金库余额。key 可以是「金库键」（wechat_change / wechat_lct / alipay / bank），
   *  也可以是交易账户键（wechat → 默认落到零钱）。 */
  adjustVault(key, delta) {
    const vaultKey = vaultKeyOf(key);
    if (!Object.prototype.hasOwnProperty.call(this.data.vault, vaultKey)) return;
    const d = numOr(delta, 0);
    this.data.vault[vaultKey] = round2(this.data.vault[vaultKey] + d);
    this.save();
  },

  /** 微信账户余额 = 零钱 + 零钱通 */
  wechatTotal() {
    const v = this.data.vault;
    return round2(v.wechat_change + v.wechat_lct);
  },

  totalAssets() {
    const v = this.data.vault;
    return round2(v.wechat_change + v.wechat_lct + v.alipay + v.bank);
  },
};

/* ---------------------- 状态 ---------------------- */
const state = {
  page: 'ledger',
  entryType: 'expense',
  account: 'wechat',
  ledgerMonth: monthStr(),
  statsDate: todayStr(),
  summaryYear: new Date().getFullYear(), // 月度总结浏览年份（动态当年）
  summaryMonth: monthStr(),              // 月度总结选中月份 'YYYY-MM'
};

/* ---------------------- Toast ---------------------- */
let toastTimer = null;
function toast(msg, kind) {
  const el = $('#toast');
  if (!el) return;
  el.innerHTML = icon(kind === 'err' ? 'circle-alert' : 'check') +
    `<span>${escapeHtml(msg)}</span>`;
  el.classList.toggle('err', kind === 'err');
  el.classList.add('show');
  refreshIcons(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ---------------------- 弹窗 ---------------------- */
function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modalMask').classList.add('show');
  refreshIcons($('#modal'));
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

/* --- 环形仪表盘（r=90 → 周长） --- */
const GAUGE_CIRC = 2 * Math.PI * 90;

function renderGauge() {
  const month = state.ledgerMonth;
  const isCurrent = month === monthStr();

  // 本月支出（与账单月份联动，默认本月）；仅统计「计入环形图」的支出
  const txs = Store.getTransactions(month);
  const countedExpenses = txs.filter((t) => t.type === 'expense' && isCounted(t));
  const spent = round2(countedExpenses.reduce((s, t) => s + t.amount, 0));
  const limit = Store.getLimit(month);
  const remain = round2(limit - spent);
  const ratio = limit > 0 ? spent / limit : (spent > 0 ? 1 : 0);
  const pct = Math.round(ratio * 100);

  // 环形填充
  const fill = $('#gaugeFill');
  const shown = Math.min(ratio, 1); // 环最多填满，超额用颜色表达
  fill.style.strokeDashoffset = String(GAUGE_CIRC * (1 - shown));

  // 颜色分级
  let color = 'var(--brand-500)', cls = '', label = '正常';
  if (ratio > 1) { color = 'var(--danger)'; cls = 'danger'; label = '已超额支出'; }
  else if (ratio >= 0.7) { color = 'var(--warn)'; cls = 'warn'; label = '接近上限，注意控制'; }
  fill.style.stroke = color;

  const pctEl = $('#gaugePct');
  pctEl.textContent = pct + '%';
  pctEl.style.color = color;

  $('#gaugeSpent').textContent = money(spent);
  $('#gaugeLimit').textContent = money(limit);
  $('#gaugeRemain').textContent = (remain >= 0 ? '' : '-') + money(Math.abs(remain));
  $('#gaugeRemain').style.color = remain < 0 ? 'var(--danger)' : 'var(--brand-700)';
  $('#gaugeSub').textContent = isCurrent ? '本月已花 / 上限' : `${month} 已花 / 上限`;

  // 剩余每日平均花费上限 = 剩余可支配 / 本月剩余天数（含当天）
  renderGaugeDaily(month, remain, isCurrent);

  const st = $('#gaugeState');
  st.className = 'gauge-state ' + cls;
  st.innerHTML = icon(cls === 'danger' ? 'circle-alert' : (cls === 'warn' ? 'trending-up' : 'shield-check')) + label;
  refreshIcons(st);

  // 概览卡片
  const income = round2(txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0));
  const rawExpense = round2(txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const ovE = $('#ovExpense');
  if (ovE) {
    ovE.textContent = money(rawExpense);
    $('#ovIncome').textContent = money(income);
    const ovR = $('#ovRemain');
    ovR.textContent = (remain >= 0 ? '' : '-') + money(Math.abs(remain));
    ovR.style.color = remain < 0 ? 'var(--danger)' : 'var(--ink-900)';
    $('#ovExpenseFoot').textContent = rawExpense > spent
      ? `含未计入 ${money(rawExpense - spent)}`
      : '计入预算的支出';
    $('#ovIncomeFoot').textContent = income > 0 ? '已入账收入' : '本月暂无收入';
    $('#ovRemainFoot').textContent = remain >= 0 ? '本月可用' : '已超额';
  }
  const sub = $('#ledgerSub');
  if (sub) sub.textContent = `掌握 ${month} 每一笔收支`;
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
    el.style.color = 'var(--ink-400)';
    el.title = '该月份已结束';
    return;
  }

  const daily = remain / remainDays;
  el.textContent = (daily < 0 ? '-' : '') + money(Math.abs(daily));
  el.style.color = daily < 0 ? 'var(--danger)' : 'var(--ink-900)';
  el.title = remain >= 0
    ? `剩余 ${money(remain)} ÷ 剩余 ${remainDays} 天`
    : `已超额 ${money(Math.abs(remain))}，本月已无额度可分配`;
}

/* --- 分类选择器（图标网格 + 隐藏原生 select 同步） --- */
function buildCatPicker(form) {
  const picker = form.querySelector('[data-cat-picker]');
  const native = form.querySelector('select.f-category');
  if (!picker || !native) return;

  // 隐藏的原生下拉：保留给测试与无 JS 降级，值始终与选择同步
  native.innerHTML = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');

  picker.innerHTML = CATEGORIES.map((c, i) => `
    <button type="button" class="cat-opt${i === 0 ? ' selected' : ''}" data-cat="${c}" aria-pressed="${i === 0}">
      ${catChip(c)}
      <span class="cat-opt-name">${c}</span>
    </button>`).join('');

  native.value = CATEGORIES[0];

  picker.querySelectorAll('.cat-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      picker.querySelectorAll('.cat-opt').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      native.value = btn.dataset.cat;          // 同步给隐藏 select（表单提交读取）
    });
  });
}

/* --- 账户选择（分段控件，带图标） --- */
function buildAccountSegs(form) {
  const wrap = form.querySelector('.segs-account');
  if (!wrap) return;

  wrap.innerHTML = Object.entries(ACCOUNTS).map(([key, info]) => `
      <button type="button" class="seg${key === DEFAULT_ACCOUNT ? ' active' : ''}" data-account="${key}">
        ${icon(info.icon)}
        <span class="seg-name">${info.name}</span>
      </button>`).join('');

  // 账户切换
  wrap.querySelectorAll('.seg').forEach((s) => {
    s.addEventListener('click', () => {
      wrap.querySelectorAll('.seg').forEach((x) => x.classList.toggle('active', x === s));
    });
  });
}

/* --- 记账表单（支持记账页 / 统计页多处实例） --- */
function initEntryForms() {
  $$('.entry-form').forEach((form) => {
    // .tab 页签与表单是兄弟节点，需从包含它们的卡片/页面范围内查找
    const scope = form.closest('.card') || form.closest('.page') || form.parentElement;

    buildCatPicker(form);
    buildAccountSegs(form);

    const tabsOf = () => Array.from(scope.querySelectorAll('.tab'));
    const segsAcc = () => Array.from(form.querySelectorAll('.segs-account .seg'));
    const accountOf = () => {
      const active = segsAcc().find((s) => s.classList.contains('active'));
      return active ? active.dataset.account : DEFAULT_ACCOUNT;
    };

    // 支出 / 收入 切换
    tabsOf().forEach((t) => {
      t.addEventListener('click', () => applyEntryType(form, t.dataset.type));
    });

    // 金额输入：清除错误态
    const amountWrap = form.querySelector('[data-amount-wrap]');
    const amountInput = form.querySelector('.f-amount');
    amountInput.addEventListener('input', () => amountWrap && amountWrap.classList.remove('invalid'));

    // 提交
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const raw = amountInput.value.trim();
      const amount = parseFloat(raw);
      if (!raw || !isFinite(amount) || amount <= 0) {
        if (amountWrap) {
          amountWrap.classList.add('invalid');
          // 重新触发抖动动画
          void amountWrap.offsetWidth;
        }
        toast('请输入有效金额', 'err');
        amountInput.focus();
        return;
      }
      if (amountWrap) amountWrap.classList.remove('invalid');

      const type = form.dataset.type || 'expense';
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
        counted: true,               // 是否计入当月环形图（默认计入）
        createdAt: Date.now(),
      };

      // 提交按钮反馈（忙碌 → 成功）
      const btn = form.querySelector('.submit-btn');
      const btnSpan = btn.querySelector('span');
      const btnIcon = btn.querySelector('i');
      const prevText = btnSpan ? btnSpan.textContent : '';
      btn.setAttribute('aria-busy', 'true');
      if (btnSpan) btnSpan.textContent = '记录中…';
      if (btnIcon) btnIcon.setAttribute('data-lucide', 'loader-circle');
      refreshIcons(btn);

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
      amountInput.value = '';
      form.querySelector('.f-remark').value = '';
      form.querySelector('.f-date').value = todayStr();

      renderLedger();
      if ($('#page-stats').classList.contains('active')) renderStats();
      if ($('#page-vault').classList.contains('active')) renderVault();

      // 恢复按钮
      btn.removeAttribute('aria-busy');
      if (btnSpan) btnSpan.textContent = prevText;
      if (btnIcon) btnIcon.setAttribute('data-lucide', 'check');
      refreshIcons(btn);

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

  const rowCat = form.querySelector('.row-category');
  if (rowCat) rowCat.style.display = isExpense ? '' : 'none';

  const lbl = form.querySelector('.label-account');
  if (lbl) {
    lbl.innerHTML = icon('credit-card') + (isExpense ? '扣款账户' : '来源账户');
    refreshIcons(lbl);
  }

  const btn = form.querySelector('.submit-btn');
  if (btn) {
    const span = btn.querySelector('span');
    if (span) span.textContent = isExpense ? '记录支出' : '记录收入';
  }

  // 支出默认扣款账户：微信；收入默认来源账户：银行
  const dft = isExpense ? DEFAULT_ACCOUNT : 'bank';
  form.querySelectorAll('.segs-account .seg').forEach((s) =>
    s.classList.toggle('active', s.dataset.account === dft));
}

/* --- 账单行（记账页 / 统计页 / 金库页共用） --- */
function billRow(t, opts) {
  const o = opts || {};
  const isExpense = t.type === 'expense';
  const cat = isExpense ? normalizeCategory(t.category) : '收入';
  const acc = ACCOUNTS[t.account] || { name: t.account, icon: 'wallet' };
  const counted = isCounted(t);

  const chip = isExpense
    ? catChip(cat, o.large ? 'lg' : '')
    : `<span class="cat-chip" style="--chip-bg:var(--income-soft);--chip-fg:var(--income)">${icon('banknote')}</span>`;

  const actions = [];
  if (isExpense && o.interactive) {
    actions.push(`<button class="btn-mini ${counted ? 'on' : 'off'}" data-act="toggle-count"
        title="${counted ? '点击后该笔不计入当月环形图' : '点击后该笔计入当月环形图'}">
        ${icon(counted ? 'check' : 'x')}${counted ? '已计入' : '未计入'}</button>`);
    actions.push(`<button class="btn-mini" data-act="account" title="修改扣款账户">
        ${icon('arrow-left-right')}改账户</button>`);
  }
  if (o.interactive) {
    actions.push(`<button class="btn-mini del" data-act="del" title="删除这笔记录">
        ${icon('trash-2')}删除</button>`);
  }

  return `
    <li class="bill-item${isExpense && !counted ? ' excluded' : ''}"${t.id ? ` data-id="${t.id}"` : ''}>
      <div class="bill-cat">${chip}</div>
      <div class="bill-main">
        <div class="bill-top">
          <span class="bill-title">${escapeHtml(cat)}</span>
          ${isExpense && !counted ? `<span class="bill-flag">${icon('eye-off')}不计入</span>` : ''}
        </div>
        ${t.remark ? `<div class="bill-remark">${escapeHtml(t.remark)}</div>` : ''}
        <div class="bill-meta">
          <span class="bill-tag">${icon(acc.icon)}${escapeHtml(acc.name)}</span>
          <span class="bill-date">${formatDateCN(t.date)}</span>
        </div>
      </div>
      <div class="bill-amt ${isExpense ? 'out' : 'in'}">${isExpense ? '-' : '+'}${money(t.amount).slice(1)}</div>
      ${actions.length ? `<div class="bill-actions">${actions.join('')}</div>` : ''}
    </li>`;
}

/* --- 账单列表 --- */
function renderBillList(month) {
  const list = $('#billList');
  const txs = Store.getTransactions(month);

  const expense = round2(txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const income = round2(txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0));
  const countedExpense = round2(txs.filter((t) => t.type === 'expense' && isCounted(t)).reduce((s, t) => s + t.amount, 0));
  const excludedExpense = round2(expense - countedExpense);
  $('#listSummary').innerHTML = txs.length
    ? `<span>共 <b>${txs.length}</b> 笔</span>
       <span>支出 <b>${money(expense)}</b></span>
       <span>计入环形图 <b>${money(countedExpense)}</b></span>
       ${excludedExpense > 0 ? `<span>不计入 <b>${money(excludedExpense)}</b></span>` : ''}
       <span>收入 <b class="income">${money(income)}</b></span>
       <span>结余 <b>${money(income - expense)}</b></span>`
    : '';

  if (!txs.length) {
    list.innerHTML = `
      <li class="empty">
        <span class="empty-icon">${icon('notebook-pen')}</span>
        <span class="empty-title">本月暂无记录</span>
        <span class="empty-desc">在上方表单记一笔，账单会实时出现在这里</span>
      </li>`;
    refreshIcons(list);
    return;
  }

  list.innerHTML = txs.map((t) => billRow(t, { interactive: true })).join('');
  refreshIcons(list);
}

/* --- 账单操作（事件委托） --- */
$('#billList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.bill-item').dataset.id;
  if (btn.dataset.act === 'del') confirmDelete(id);
  if (btn.dataset.act === 'account') openChangeAccount(id);
  if (btn.dataset.act === 'toggle-count') toggleCounted(id);
});

/** 切换某笔支出是否计入当月环形图 */
function toggleCounted(id) {
  const tx = Store.data.transactions.find((t) => t.id === id);
  if (!tx || tx.type !== 'expense') return;
  tx.counted = !isCounted(tx);
  Store.save();
  renderLedger();
  if (state.page === 'stats') renderStats();
  toast(tx.counted ? '该笔已计入当月花费' : '该笔已改为不计入当月花费');
}

/** 删除前二次确认，避免误删 */
function confirmDelete(id) {
  const tx = Store.data.transactions.find((t) => t.id === id);
  if (!tx) return;
  const cat = tx.type === 'expense' ? normalizeCategory(tx.category) : '收入';
  openModal(`
    <h3>${icon('circle-alert')}确认删除</h3>
    <p>将删除「${escapeHtml(cat)} · ${money(tx.amount)}」这笔记录，并把金额回滚到对应账户。此操作不可撤销。</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">取消</button>
      <button class="btn btn-danger-soft" id="modalOk">删除</button>
    </div>
  `);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => { closeModal(); deleteTx(id); });
}

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
    `<button type="button" class="seg${k === tx.account ? ' active' : ''}" data-acc="${k}">
       ${icon(v.icon)}<span class="seg-name">${v.name}</span>
     </button>`
  ).join('');

  openModal(`
    <h3>${icon('arrow-left-right')}修改扣款账户</h3>
    <p>当前：${ACCOUNTS[tx.account].name} · ${money(tx.amount)}。切换后，系统会把原账户金额加回，再从新账户扣除等额金额。</p>
    <div class="segmented" id="modalSegs">${opts}</div>
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
    <h3>${icon('target')}修改资金上限</h3>
    <p>${month} 的月度消费上限（默认 ¥${DEFAULT_LIMIT}）</p>
    <div class="form-field">
      <label class="field-label">上限金额</label>
      <input type="number" class="input" id="limitInput" step="0.01" min="0" value="${cur}" />
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
    if (isNaN(v) || v < 0) { toast('请输入有效数值', 'err'); return; }
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
    legend.innerHTML = `
      <li class="empty" style="padding:0">
        <span class="empty-icon">${icon('chart-pie')}</span>
        <span class="empty-title">当天没有支出记录</span>
        <span class="empty-desc">换个日期，或在上方快捷记账中记一笔</span>
      </li>`;
  } else {
    let offset = 0;
    const arcs = entries.map(([cat, amt]) => {
      const frac = amt / total;
      const len = C * frac;
      const color = CATEGORY_COLOR[cat] || '#8798a0';
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
      const color = CATEGORY_COLOR[cat] || '#8798a0';
      return `
        <li class="legend-item">
          <span class="legend-dot" style="background:${color}"></span>
          <span class="legend-name">${icon(CATEGORY_ICON[cat] || 'package')}${escapeHtml(cat)}</span>
          <span class="legend-bar"><i style="width:${(frac * 100).toFixed(1)}%;background:${color}"></i></span>
          <span class="legend-amt">${money(amt)}</span>
          <span class="legend-pct">${(frac * 100).toFixed(1)}%</span>
        </li>`;
    }).join('');
  }
  refreshIcons(legend);

  // 分类支出排行（按当月数据，反映长期结构）
  renderStatsRank();
  // 近 7 日收支趋势
  renderStatsTrend(date);

  // 当日账单
  const dayList = Store.getByDate(date);
  const ul = $('#statsBillList');
  if (!dayList.length) {
    ul.innerHTML = `
      <li class="empty">
        <span class="empty-icon">${icon('receipt-text')}</span>
        <span class="empty-title">当天暂无账单</span>
      </li>`;
  } else {
    ul.innerHTML = dayList.map((t) => billRow(t, {})).join('');
  }
  refreshIcons(ul);

  // 月度总结（12 月网格 + 明细 + 年度对比图）
  renderMonthlySummary();
}

/** 分类支出排行：按当前查看月份聚合 */
function renderStatsRank() {
  const el = $('#statsRank');
  if (!el) return;
  const txs = Store.getTransactions(monthOf(state.statsDate) || state.ledgerMonth)
    .filter((t) => t.type === 'expense');

  const byCat = {};
  txs.forEach((t) => {
    const c = normalizeCategory(t.category);
    byCat[c] = (byCat[c] || 0) + t.amount;
  });
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6);

  if (!entries.length) {
    el.innerHTML = `
      <li class="empty" style="padding:var(--sp-6) 0">
        <span class="empty-icon">${icon('list-ordered')}</span>
        <span class="empty-title">本月还没有支出</span>
      </li>`;
    refreshIcons(el);
    return;
  }

  const max = entries[0][1] || 1;
  el.innerHTML = entries.map(([cat, amt], i) => {
    const color = CATEGORY_COLOR[cat] || '#8798a0';
    return `
      <li class="rank-item">
        <span class="rank-no">${i + 1}</span>
        <span class="rank-name">${icon(CATEGORY_ICON[cat] || 'package')}${escapeHtml(cat)}</span>
        <span class="rank-track"><i style="width:${((amt / max) * 100).toFixed(1)}%;background:${color}"></i></span>
        <span class="rank-amt">${money(amt)}</span>
      </li>`;
  }).join('');
  refreshIcons(el);
}

/** 近 7 日收支趋势（以选中日期为终点） */
function renderStatsTrend(endDate) {
  const el = $('#statsTrend');
  if (!el) return;

  const end = new Date(`${endDate}T00:00:00`);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end.getTime());
    d.setDate(end.getDate() - i);
    days.push(todayStr(d));
  }

  const agg = days.map((ds) => {
    const list = Store.getByDate(ds);
    return {
      date: ds,
      exp: round2(list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)),
      inc: round2(list.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)),
    };
  });

  const max = Math.max(1, ...agg.map((a) => Math.max(a.exp, a.inc)));
  const week = ['日', '一', '二', '三', '四', '五', '六'];

  el.innerHTML = agg.map((a) => {
    const d = new Date(`${a.date}T00:00:00`);
    const expH = Math.round((a.exp / max) * 100);
    const incH = Math.round((a.inc / max) * 100);
    return `
      <div class="trend-col" title="${a.date} 支出${money(a.exp)} 收入${money(a.inc)}">
        <div class="trend-bars">
          <span class="trend-bar exp" style="height:${Math.max(expH, a.exp > 0 ? 4 : 2)}%"></span>
          <span class="trend-bar inc" style="height:${Math.max(incH, a.inc > 0 ? 4 : 2)}%"></span>
        </div>
        <span class="trend-x">${week[d.getDay()]}</span>
      </div>`;
  }).join('');
}

$('#statsDate').addEventListener('change', (e) => {
  state.statsDate = e.target.value || todayStr();
  renderStats();
});

/* =========================================================================
   月度总结：12 月网格 + 选中月分类明细（环比）+ 12 月支出对比图
   ========================================================================= */

/** 某年 12 个月的支出总额（全部支出，忽略 counted 标记） */
function monthTotals(year) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${pad2(m)}`;
    const txs = Store.getTransactions(ym).filter((t) => t.type === 'expense');
    out.push({
      month: m,
      ym,
      total: round2(txs.reduce((s, t) => s + t.amount, 0)),
      count: txs.length,
    });
  }
  return out;
}

/** 某月按分类的支出合计（全部支出，忽略 counted 标记） */
function monthCategoryTotals(ym) {
  const txs = Store.getTransactions(ym).filter((t) => t.type === 'expense');
  const byCat = {};
  txs.forEach((t) => {
    const c = normalizeCategory(t.category);
    byCat[c] = (byCat[c] || 0) + t.amount;
  });
  return {
    byCat,
    total: round2(txs.reduce((s, t) => s + t.amount, 0)),
    count: txs.length,
  };
}

/** 环比 delta 片段：prev 为 0 → 新增；相等 → 持平；否则 ↑↓ 金额 + 百分比 */
function deltaHtml(cur, prev) {
  if (prev === 0 && cur === 0) return `<span class="msum-delta flat">${icon('minus')}—</span>`;
  if (prev === 0) return `<span class="msum-delta up">${icon('trending-up')}新增</span>`;
  const d = round2(cur - prev);
  if (d === 0) return `<span class="msum-delta flat">${icon('minus')}持平</span>`;
  const pct = Math.abs((d / prev) * 100).toFixed(1);
  const up = d > 0;
  return `<span class="msum-delta ${up ? 'up' : 'down'}">
    ${icon(up ? 'trending-up' : 'trending-down')}${up ? '+' : '-'}${money(Math.abs(d)).slice(1)}
    <b>${up ? '+' : '-'}${pct}%</b></span>`;
}

function renderMonthlySummary() {
  const grid = $('#msumGrid');
  if (!grid) return;

  const year = state.summaryYear;
  const totals = monthTotals(year);

  // 年份标题
  const yearEl = $('#msumYear');
  if (yearEl) yearEl.textContent = String(year);
  const chartTitle = $('#msumChartTitle');
  if (chartTitle) chartTitle.textContent = `${year} 年各月支出对比`;

  // ---- 12 个月按钮（2 行 × 6 列） ----
  grid.innerHTML = totals.map((t) => {
    const hasData = t.count > 0;
    const active = t.ym === state.summaryMonth;
    return `
      <button type="button"
        class="month-btn${active ? ' active' : ''}${hasData ? '' : ' empty'}"
        data-month="${t.ym}" aria-pressed="${active}"
        title="${t.month}月 ${hasData ? money(t.total) : '暂无支出'}">
        <span class="month-btn-m">${t.month}月</span>
        <span class="month-btn-amt">${hasData ? money(t.total) : '—'}</span>
      </button>`;
  }).join('');

  // ---- 详情面板 ----
  const panel = $('#msumPanel');
  const ym = state.summaryMonth;
  const cur = monthCategoryTotals(ym);
  const prev = monthCategoryTotals(addMonths(ym, -1));

  if (cur.count === 0) {
    panel.hidden = false;
    panel.innerHTML = `
      <div class="msum-panel-head">
        <span class="msum-panel-title">${icon('calendar-range')}${ym} 月度明细</span>
        <span class="msum-panel-total">${money(0)}</span>
      </div>
      <div class="empty" style="padding:var(--sp-6) 0">
        <span class="empty-icon">${icon('chart-column')}</span>
        <span class="empty-title">${ym} 暂无支出记录</span>
        <span class="empty-desc">换一个月份，或到记账页记一笔</span>
      </div>`;
  } else {
    panel.hidden = false;
    const rows = CATEGORIES
      .map((cat) => ({ cat, amt: round2(cur.byCat[cat] || 0), prevAmt: round2(prev.byCat[cat] || 0) }))
      .filter((r) => r.amt > 0)
      .sort((a, b) => b.amt - a.amt);
    const max = rows.length ? rows[0].amt : 1;

    const body = rows.map((r) => {
      const color = CATEGORY_COLOR[r.cat] || '#8798a0';
      return `
        <li class="rank-item msum-row">
          <span class="rank-name">${icon(CATEGORY_ICON[r.cat] || 'package')}${escapeHtml(r.cat)}</span>
          <span class="rank-track"><i style="width:${((r.amt / max) * 100).toFixed(1)}%;background:${color}"></i></span>
          <span class="rank-amt">${money(r.amt)}</span>
          ${deltaHtml(r.amt, r.prevAmt)}
        </li>`;
    }).join('');

    panel.innerHTML = `
      <div class="msum-panel-head">
        <span class="msum-panel-title">${icon('git-compare')}${ym} 月度明细
          <em>对比 ${addMonths(ym, -1)}</em></span>
        <span class="msum-panel-total">${money(cur.total)} ${deltaHtml(cur.total, prev.total)}</span>
      </div>
      <ul class="rank-list msum-rows">${body}</ul>
      <div class="msum-panel-foot">${cur.count} 笔支出 · 全部支出合计 ${money(cur.total)}</div>`;
  }

  // ---- 12 个月对比条形图 ----
  const chart = $('#msumChart');
  const maxTotal = Math.max(1, ...totals.map((t) => t.total));
  chart.innerHTML = totals.map((t) => {
    const h = Math.round((t.total / maxTotal) * 100);
    const active = t.ym === state.summaryMonth;
    return `
      <button type="button" class="msum-col${active ? ' active' : ''}" data-month="${t.ym}"
        title="${t.month}月 ${money(t.total)}">
        <span class="msum-col-val">${t.total > 0 ? Math.round(t.total) : ''}</span>
        <span class="msum-col-bar-wrap"><i class="msum-col-bar"
          style="height:${t.total > 0 ? Math.max(h, 3) : 2}%"></i></span>
        <span class="msum-col-x">${t.month}月</span>
      </button>`;
  }).join('');

  refreshIcons(grid);
  refreshIcons(panel);
  refreshIcons(chart);
}

/** 月度总结交互：年份切换 + 月份选择（事件委托，只绑一次） */
function initMonthlySummary() {
  const card = $('#monthlySummaryCard');
  if (!card) return;
  card.addEventListener('click', (e) => {
    const yearBtn = e.target.closest('#msumPrevYear, #msumNextYear');
    if (yearBtn) {
      state.summaryYear += (yearBtn.id === 'msumNextYear' ? 1 : -1);
      state.summaryMonth = `${state.summaryYear}-01`; // 切年后落到该年 1 月
      renderMonthlySummary();
      return;
    }
    const monthBtn = e.target.closest('.month-btn, .msum-col');
    if (monthBtn && monthBtn.dataset.month) {
      state.summaryMonth = monthBtn.dataset.month;
      renderMonthlySummary();
    }
  });
}

/* =========================================================================
   金库页
   ========================================================================= */
function renderVault() {
  const v = Store.getVault();
  $('#totalAssets').textContent = money(Store.totalAssets());
  renderStorageNote();

  $('#vaultGrid').innerHTML = Object.entries(ACCOUNTS).map(([key, info]) => {
    // 微信：拆成「零钱 / 零钱通」两个子板块
    if (Array.isArray(info.subAccounts) && info.subAccounts.length) {
      const total = round2(info.subAccounts.reduce((s, sub) => s + (v[sub.key] || 0), 0));
      const subCards = info.subAccounts.map((sub) => {
        const bal = v[sub.key] || 0;
        return `
          <div class="vault-sub">
            <div class="vault-sub-head">
              ${icon(sub.icon)}
              <span class="vault-sub-name">${sub.name}</span>
            </div>
            <div class="vault-sub-amount ${bal < 0 ? 'neg' : ''}">${money(bal)}</div>
            <button class="btn-mini" data-vault-act="set" data-acc="${sub.key}">${icon('pencil')}改余额</button>
          </div>`;
      }).join('');
      return `
        <div class="vault-card vault-card-split">
          <div class="vault-head">
            <span class="vault-icon">${icon(info.icon)}</span>
            <span class="vault-name">${info.name}</span>
            <span class="vault-total ${total < 0 ? 'neg' : ''}">${money(total)}</span>
          </div>
          <div class="vault-subs">${subCards}</div>
        </div>`;
    }

    // 普通账户
    const bal = v[key] || 0;
    return `
      <div class="vault-card">
        <div class="vault-head">
          <span class="vault-icon">${icon(info.icon)}</span>
          <span class="vault-name">${info.name}</span>
        </div>
        <div class="vault-amount ${bal < 0 ? 'neg' : ''}">${money(bal)}</div>
        <div class="vault-actions">
          <button class="btn-mini" data-vault-act="set" data-acc="${key}">${icon('pencil')}改余额</button>
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
    ul.innerHTML = `
      <li class="empty">
        <span class="empty-icon">${icon('arrow-left-right')}</span>
        <span class="empty-title">暂无流水记录</span>
        <span class="empty-desc">记账后，账户流水会在这里按时间倒序展示</span>
      </li>`;
    refreshIcons($('#vaultGrid'));
    refreshIcons(ul);
    return;
  }
  ul.innerHTML = all.map((t) => billRow(t, {})).join('');

  refreshIcons($('#vaultGrid'));
  refreshIcons(ul);
}

/* --- 本地存储状态提示 --- */
function renderStorageNote() {
  const el = $('#storageNote');
  if (!el) return;
  let bytes = 0;
  try { bytes = (localStorage.getItem(STORE_KEY) || '').length; } catch (_) {}
  const kb = (bytes / 1024).toFixed(1);
  const count = Store.data.transactions.length;
  el.innerHTML = `${icon('shield-check')}数据已保存在本机浏览器 · ${count} 笔记录 · 约 ${kb} KB`;
  refreshIcons(el);
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
        toast('导入失败：文件格式不正确', 'err');
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
  const key = btn.dataset.acc;                 // 金库键：wechat_change / wechat_lct / alipay / bank
  const info = VAULT_META[key] || { name: key };
  const cur = Store.getVault()[key] || 0;
  openModal(`
    <h3>${icon('coins')}调整「${info.name}」余额</h3>
    <p>直接设置该板块当前余额（允许为负数）</p>
    <div class="form-field">
      <label class="field-label">余额</label>
      <input type="number" class="input" id="vaultInput" step="0.01" value="${cur}" />
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
    if (isNaN(nv)) { toast('请输入有效数值', 'err'); return; }
    if (!Object.prototype.hasOwnProperty.call(Store.data.vault, key)) return;
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
    <h3>${icon('sparkles')}添加功能</h3>
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

  // 静态图标（侧边栏 / 标题等）
  refreshIcons(document.body);

  initEntryForms();
  initMonthlySummary();
  switchPage('ledger');
  renderLedger();
  refreshIcons(document.body);
}

document.addEventListener('DOMContentLoaded', init);
if (document.readyState !== 'loading') init();
