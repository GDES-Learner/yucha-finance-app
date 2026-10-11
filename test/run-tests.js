/* =========================================================================
   轻量端到端测试：用 jsdom 加载 index.html + app.js，模拟真实操作
   运行：node test/run-tests.js
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; failures.push(msg); console.log('  \u2717 ' + msg); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* ---------- 构建 DOM 环境 ---------- */
// app.js 使用顶层 const，用 window.eval 声明不会挂到 window 上。
// 解决办法：把 app.js 包装成 IIFE，并把需要观测的内部对象显式挂到 window.__app。
function boot() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const instrumented =
    '(function(){\n' + appJs + '\n' +
    'window.__app = { Store, state, CATEGORIES, CATEGORY_ICON, CATEGORY_COLOR, ACCOUNTS, ' +
    'normalizeCategory, renderLedger, renderStats, renderVault, switchPage, todayStr, monthStr };\n' +
    '})();';
  window.eval(instrumented);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  return window;
}

/* ---------- 工具 ---------- */
function click(w, el) {
  el.dispatchEvent(new w.Event('click', { bubbles: true }));
}
function submit(w, form) {
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}
function setVal(w, el, v) {
  el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}
const money = (n) => '¥' + (Number(n) || 0).toFixed(2);
const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* =========================================================================
   测试用例
   ========================================================================= */
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

/* ---------- 需求 1：环形图更大 ---------- */
test('需求1 环形仪表盘尺寸加大', (w) => {
  const wrap = w.document.querySelector('.gauge-wrap');
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const m = css.match(/\.gauge-wrap\s*\{[^}]*width:\s*(\d+)px/);
  ok(!!m, '存在 .gauge-wrap 尺寸定义');
  const size = m ? parseInt(m[1], 10) : 0;
  ok(size >= 280, `环形图尺寸 >= 280px（当前 ${size}px）`);
  ok(!!wrap, '页面中存在环形仪表盘容器');
});

/* ---------- 需求 2：统计页可记账 ---------- */
test('需求2 统计页具备记账功能', (w) => {
  // 切到统计页
  click(w, w.document.querySelector('.nav-item[data-page="stats"]'));
  const statsPage = w.document.querySelector('#page-stats');
  const form = statsPage.querySelector('form.entry-form');
  ok(!!form, '统计页内存在记账表单');

  // 在统计页记一笔支出，验证写入
  const before = w.eval('JSON.parse(localStorage.getItem("life_assistant_v1")).transactions.length');
  const amt = statsPage.querySelector('form.entry-form input[type="number"]');
  amt.value = '9.5';
  submit(w, form);
  const after = w.eval('JSON.parse(localStorage.getItem("life_assistant_v1")).transactions.length');
  ok(after === before + 1, '在统计页提交后新增了一笔记录');

  // 统计页点击支出/收入页签仍有效
  const tabs = statsPage.querySelectorAll('.tab');
  ok(tabs.length >= 2, '统计页有支出/收入切换页签');
});

/* ---------- 需求 3：分类调整 ---------- */
test('需求3 分类拆分为 吃饭/奶茶/宵夜 + 宿舍', (w) => {
  const list = w.__app.CATEGORIES;
  ['吃饭', '奶茶', '宵夜', '宿舍'].forEach((c) => {
    ok(list.includes(c), `分类包含「${c}」`);
  });
  ok(!list.includes('餐饮'), '已移除旧的「餐饮」分类');

  // 下拉里确实有这些选项（两个页面各一个表单）
  const ledgerForm = w.document.querySelector('#page-ledger form.entry-form');
  const opts = Array.from(ledgerForm.querySelectorAll('select option')).map((o) => o.value);
  ['吃饭', '奶茶', '宵夜', '宿舍'].forEach((c) => {
    ok(opts.includes(c), `下拉框含「${c}」选项`);
  });

  // 四个新分类各有图标与颜色
  const icons = w.__app.CATEGORY_ICON;
  const colors = w.__app.CATEGORY_COLOR;
  ['吃饭', '奶茶', '宵夜', '宿舍'].forEach((c) => {
    ok(!!icons[c], `「${c}」有图标`);
    ok(!!colors[c], `「${c}」有颜色`);
  });

  // 历史「餐饮」数据归一化到「吃饭」
  ok(w.__app.normalizeCategory('餐饮') === '吃饭', '旧「餐饮」自动映射为「吃饭」');
});

/* ---------- 需求 4：账户顺序 ---------- */
test('需求4 账户顺序 微信→支付宝→银行，默认微信', (w) => {
  const segs = Array.from(w.document.querySelectorAll('#page-ledger .segs-account .seg'));
  const order = segs.map((s) => s.dataset.account);
  ok(JSON.stringify(order) === JSON.stringify(['wechat', 'alipay', 'bank']),
    `账户顺序为 wechat,alipay,bank（当前 ${order.join(',')}）`);
  ok(segs[0].classList.contains('active'), '默认选中第一个（微信）');

  // 账户常量顺序也调整
  const accts = Object.keys(w.__app.ACCOUNTS);
  ok(accts[0] === 'wechat' && accts[accts.length - 1] === 'bank',
    `ACCOUNTS 顺序微信在前银行在后（${accts.join(',')}）`);

  // 实际提交一笔，验证默认扣微信
  w.__app.Store.data.transactions = [];
  w.__app.Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  const form = w.document.querySelector('#page-ledger form.entry-form');
  form.querySelector('.f-amount').value = '11';
  submit(w, form);
  const txs = w.__app.Store.data.transactions;
  ok(txs.length === 1 && txs[0].account === 'wechat', '默认记账扣款账户为微信');
  ok(w.__app.Store.data.vault.wechat_change === -11, '微信默认从「零钱」扣减（零钱 -11）');
  ok(w.__app.Store.data.vault.wechat_lct === 0, '「零钱通」余额不受影响');
});

/* ---------- 需求 5：剩余每日平均花费上限 ---------- */
test('需求5 显示剩余每日平均花费上限', (w) => {
  const el = w.document.querySelector('#gaugeDaily');
  ok(!!el, '记账页存在「每日平均花费上限」元素');

  const { Store, state } = w.__app;
  const m = w.__app.monthStr();
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.setLimit(m, 1500);
  Store.addTransaction({ id: 't1', type: 'expense', amount: 300, category: '吃饭', account: 'wechat', remark: '', date: ds, createdAt: Date.now() });
  w.__app.switchPage('ledger');
  w.__app.renderLedger();

  const txt = el.textContent;
  ok(/¥\d/.test(txt), `日均上限显示为金额（当前「${txt}」）`);

  // 逻辑校验：日均 = 剩余 / 本月剩余天数（含当天）
  const d = new Date();
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const remainDays = daysInMonth - d.getDate() + 1;
  const expect = ((1500 - 300) / remainDays).toFixed(2);
  const got = (txt.match(/¥(-?[\d.]+)/) || [])[1];
  ok(got === expect, `日均金额计算正确（期望 ${expect}，实际 ${got}）`);

  // 超额时应为负
  Store.data.transactions = [];
  Store.addTransaction({ id: 't2', type: 'expense', amount: 2000, category: '吃饭', account: 'wechat', remark: '', date: ds, createdAt: Date.now() });
  w.__app.renderLedger();
  const txt2 = w.document.querySelector('#gaugeDaily').textContent;
  ok(/-¥/.test(txt2), `超额时日均上限显示为负（当前「${txt2}」）`);
});

/* ---------- 需求 6：本地持久化 ---------- */
test('需求6 数据持久化到 localStorage', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  Store.addTransaction({ id: 'persist1', type: 'expense', amount: 66, category: '奶茶', account: 'wechat', remark: '测试持久化', date: ds, createdAt: Date.now() });
  Store.adjustVault('wechat', -66);

  const raw = w.eval('localStorage.getItem("life_assistant_v1")');
  ok(!!raw && raw.includes('persist1'), '数据已写入 localStorage');

  // 重新 boot 一个全新 DOM，共享同一 localStorage 模拟"重开浏览器"
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom2 = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom2.window.localStorage.setItem('life_assistant_v1', raw);
  const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  dom2.window.eval('(function(){' + appJs + 'window.__app={Store,state,monthStr,todayStr};})();');
  dom2.window.document.dispatchEvent(new dom2.window.Event('DOMContentLoaded', { bubbles: true }));
  const reloaded = JSON.stringify(dom2.window.__app.Store.data.transactions);
  ok(reloaded.includes('persist1'), '重新打开后数据仍存在（未丢失）');
  ok(dom2.window.__app.Store.data.vault.wechat_change === -66, '金库余额也一并持久化（零钱）');

  // 最近账单列表能渲染出该记录
  const listHtml = dom2.window.document.querySelector('#billList').innerHTML;
  ok(listHtml.includes('奶茶'), '重开后账单列表正确渲染');

  // 数据版本字段
  ok(dom2.window.__app.Store.data.version >= 2, '数据包含版本号（便于后续迁移）');

  // 旧版本数据（餐饮 + 旧 vault）自动迁移
  const legacy = JSON.stringify({
    transactions: [{ id: 'old1', type: 'expense', amount: 30, category: '餐饮', account: 'wechat', remark: '', date: ds, createdAt: 1 }],
    budgets: {}, vault: { bank: 0, alipay: 0, wechat: 128.5 },
  });
  const dom3 = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom3.window.localStorage.setItem('life_assistant_v1', legacy);
  dom3.window.eval('(function(){' + fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + 'window.__app={Store};})();');
  dom3.window.document.dispatchEvent(new dom3.window.Event('DOMContentLoaded', { bubbles: true }));
  const migratedTx = dom3.window.__app.Store.data.transactions[0];
  const migratedVault = dom3.window.__app.Store.data.vault;
  ok(migratedTx.category === '吃饭', '旧「餐饮」数据迁移为「吃饭」');
  ok(migratedVault.wechat_change === 128.5, '旧 wechat 余额整体迁入「零钱」');
  ok(migratedVault.wechat_lct === 0, '「零钱通」初始为 0');
  ok(!('wechat' in migratedVault), '旧 wechat 键已被移除');
  ok(dom3.window.__app.Store.data.version === 3, '数据版本升级为 3');

  // 损坏数据（非法 JSON）不应导致崩溃，且会备份原始串
  const dom4 = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom4.window.localStorage.setItem('life_assistant_v1', '{坏掉的JSON');
  let crashed = false;
  try {
    dom4.window.eval('(function(){' + fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + 'window.__app={Store};})();');
    dom4.window.document.dispatchEvent(new dom4.window.Event('DOMContentLoaded', { bubbles: true }));
  } catch (e) { crashed = true; }
  ok(!crashed, '损坏数据不会导致程序崩溃');
  ok(Array.isArray(dom4.window.__app.Store.data.transactions), '损坏数据后自动重置为可用结构');

  // 非法交易记录被过滤
  const dirty = JSON.stringify({
    version: 2,
    transactions: [
      { id: 'good', type: 'expense', amount: 10, category: '奶茶', account: 'wechat', date: ds, createdAt: 1 },
      { id: 'bad1', type: 'expense', amount: -5, category: '吃饭', account: 'wechat', date: ds },
      { id: 'bad2', type: 'xxx', amount: 10, category: '吃饭', account: 'wechat', date: ds },
      { id: 'bad3', type: 'expense', amount: 'NaN', category: '吃饭', account: 'wechat', date: ds },
    ],
    budgets: {}, vault: { wechat: 0 },
  });
  const dom5 = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom5.window.localStorage.setItem('life_assistant_v1', dirty);
  dom5.window.eval('(function(){' + fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + 'window.__app={Store};})();');
  dom5.window.document.dispatchEvent(new dom5.window.Event('DOMContentLoaded', { bubbles: true }));
  ok(dom5.window.__app.Store.data.transactions.length === 1, '非法记录被过滤，仅保留有效记录');
  ok(!!dom5.window.__app.Store.data.vault.alipay === true ||
     dom5.window.__app.Store.data.vault.alipay === 0, '缺失账户被补全为 0');
});

/* ---------- 需求 7：微信拆分零钱 / 零钱通 ---------- */
test('需求7 金库微信拆分为零钱与零钱通', (w) => {
  const { Store } = w.__app;

  // 金库页渲染：微信卡片内含两个子板块
  w.__app.switchPage('vault');
  w.__app.renderVault();

  const splitCard = w.document.querySelector('.vault-card-split');
  ok(!!splitCard, '金库页存在「微信」拆分卡片');

  const subNames = Array.from(splitCard.querySelectorAll('.vault-sub-name')).map((e) => e.textContent);
  ok(subNames.length === 2, `微信卡片下有 2 个子板块（当前 ${subNames.length}）`);
  ok(subNames[0] === '零钱' && subNames[1] === '零钱通', `子板块为 零钱/零钱通（${subNames.join('/')}）`);

  // 两个子板块各有独立「改余额」按钮，指向不同金库键
  const subBtns = Array.from(splitCard.querySelectorAll('button[data-vault-act="set"]'));
  const keys = subBtns.map((b) => b.dataset.acc);
  ok(keys.includes('wechat_change') && keys.includes('wechat_lct'),
    `零钱/零钱通各自独立（${keys.join(',')}）`);

  // 余额独立：零钱 100 / 零钱通 500
  Store.data.vault = { wechat_change: 100, wechat_lct: 500, alipay: 0, bank: 0 };
  Store.save();
  w.__app.renderVault();
  const splitCard2 = w.document.querySelector('.vault-card-split');   // 重新查询（DOM 已重建）
  const amounts = Array.from(splitCard2.querySelectorAll('.vault-sub-amount')).map((e) => e.textContent);
  ok(amounts[0] === '¥100.00' && amounts[1] === '¥500.00',
    `两个子板块余额相互独立（${amounts.join(' / ')}）`);

  // 微信卡片头部显示合计 = 零钱 + 零钱通
  const headTotal = splitCard2.querySelector('.vault-total').textContent;
  ok(headTotal === '¥600.00', `微信卡片显示合计（${headTotal}）`);

  // 总资产 = 零钱 + 零钱通 + 支付宝 + 银行
  Store.data.vault = { wechat_change: 100, wechat_lct: 500, alipay: 200, bank: 300 };
  Store.save();
  ok(Store.totalAssets() === 1100, `总资产汇总正确（当前 ${Store.totalAssets()}）`);
  w.__app.renderVault();
  ok(w.document.querySelector('#totalAssets').textContent === '¥1100.00', '页面总资产显示正确');
});

test('需求7 记账扣款默认走零钱且不影响零钱通', (w) => {
  const { Store } = w.__app;
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 200, wechat_lct: 800, alipay: 0, bank: 0 };
  Store.save();

  w.__app.switchPage('ledger');
  const form = w.document.querySelector('#page-ledger form.entry-form');
  // 默认账户应为微信
  const activeAcc = form.querySelector('.segs-account .seg.active').dataset.account;
  ok(activeAcc === 'wechat', '记账表单默认付款账户为微信');

  form.querySelector('.f-amount').value = '50';
  submit(w, form);

  const v = Store.data.vault;
  ok(v.wechat_change === 150, `扣款从「零钱」扣减（200 → ${v.wechat_change}）`);
  ok(v.wechat_lct === 800, '「零钱通」完全不受影响');

  // 收入默认入账：微信收入也进零钱
  const card = form.closest('.card');
  const incomeTab = Array.from(card.querySelectorAll('.tab')).find((t) => t.dataset.type === 'income');
  click(w, incomeTab);
  const accSegs = Array.from(form.querySelectorAll('.segs-account .seg'));
  click(w, accSegs.find((s) => s.dataset.account === 'wechat'));
  form.querySelector('.f-amount').value = '30';
  submit(w, form);
  ok(Store.data.vault.wechat_change === 180, `微信收入入「零钱」（150 → ${Store.data.vault.wechat_change}）`);
  ok(Store.data.vault.wechat_lct === 800, '零钱通依旧不受影响');
});

/* ---------- 回归：整体可用性 ---------- */
test('回归 核心链路正常', (w) => {
  click(w, w.document.querySelector('.nav-item[data-page="ledger"]'));
  const form = w.document.querySelector('#page-ledger form.entry-form');
  setVal(w, form.querySelector('input[type="number"]'), '25');
  setVal(w, form.querySelector('input[type="text"]'), '午饭');
  submit(w, form);
  const html = w.document.querySelector('#billList').innerHTML;
  ok(html.includes('25.00'), '记账后账单列表出现该笔金额');

  // 改账户
  const btn = w.document.querySelector('#billList button[data-act="account"]');
  ok(!!btn, '支出记录带「改账户」按钮');
  if (btn) {
    click(w, btn);
    const segs = w.document.querySelectorAll('#modalSegs .seg');
    ok(segs.length >= 3, '改账户弹窗列出账户');
    click(w, Array.from(segs).find((s) => s.dataset.acc === 'bank'));
    click(w, w.document.querySelector('#modalOk'));
    const vault = w.__app.Store.data.vault;
    ok(typeof vault.bank === 'number', '改账户后金库已更新');
  }

  // 统计页渲染
  click(w, w.document.querySelector('.nav-item[data-page="stats"]'));
  ok(w.document.querySelector('#donutSvg').innerHTML.length > 0, '统计页环形图已渲染');

  // 金库页
  click(w, w.document.querySelector('.nav-item[data-page="vault"]'));
  ok(w.document.querySelectorAll('.vault-card').length === 3, '金库页展示 3 个账户（微信/支付宝/银行）');
  const names = Array.from(w.document.querySelectorAll('.vault-name')).map((e) => e.textContent);
  ok(names[0] === '微信' && names[2] === '银行', `金库账户顺序为 微信…银行（${names.join('>')}）`);
});

test('回归 改账户金额联动正确', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 100, bank: 50 };
  Store.addTransaction({ id: 'c1', type: 'expense', amount: 40, category: '奶茶', account: 'wechat', remark: '', date: ds, createdAt: Date.now() });
  Store.adjustVault('wechat', -40);   // 微信 -40
  w.__app.switchPage('ledger');
  w.__app.renderLedger();

  // 模拟改账户：微信 → 支付宝（原账户加回，新账户扣除）
  const tx = Store.data.transactions[0];
  Store.adjustVault(tx.account, tx.amount);
  Store.adjustVault('alipay', -tx.amount);
  tx.account = 'alipay';
  Store.save();
  ok(Store.data.vault.wechat_change === 0, '原账户（微信零钱）金额已加回至 0');
  ok(Store.data.vault.alipay === 60, '新账户（支付宝）扣除 40 后为 60');
  ok(Store.data.vault.bank === 50, '无关账户（银行）不受影响');
  ok(Store.data.vault.wechat_lct === 0, '「零钱通」在改账户过程中不受影响');
});

test('回归 收入不影响记账环只入金库', (w) => {
  const { Store, state } = w.__app;
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  w.__app.switchPage('ledger');
  const form = w.document.querySelector('#page-ledger form.entry-form');
  // 切到收入（.tab 是表单的兄弟节点，位于同一张卡片内）
  const card = form.closest('.card');
  const incomeTab = Array.from(card.querySelectorAll('.tab')).find((t) => t.dataset.type === 'income');
  ok(!!incomeTab, '存在收入页签');
  click(w, incomeTab);
  form.querySelector('.f-amount').value = '500';
  submit(w, form);

  const spent = Store.getTransactions(w.__app.monthStr())
    .filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  ok(spent === 0, '收入不计入本月支出（记账环不受影响）');
  const total = Store.totalAssets();
  ok(total === 500, `收入 500 使总资产增加（当前 ${total}）`);
});

test('回归 分类统计与图例', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  [
    ['吃饭', 20], ['奶茶', 15], ['宵夜', 10], ['宿舍', 5], ['交通', 8],
  ].forEach(([c, a], i) => {
    Store.addTransaction({ id: 's' + i, type: 'expense', amount: a, category: c, account: 'wechat', remark: '', date: ds, createdAt: i });
  });
  w.__app.switchPage('stats');
  w.document.querySelector('#statsDate').value = ds;
  w.__app.renderStats();

  const legend = w.document.querySelector('#statsLegend').innerHTML;
  ['吃饭', '奶茶', '宵夜', '宿舍', '交通'].forEach((c) => {
    ok(legend.includes(c), `统计图例含「${c}」`);
  });
  ok(w.document.querySelector('#statsTotal').textContent === '¥58.00', '当日总支出 = 58.00');
  const segs = w.document.querySelectorAll('#donutSvg .donut-seg').length;
  ok(segs === 5, `环形图渲染 5 个分类扇区（当前 ${segs}）`);
});

test('回归 月度上限与日均联动', (w) => {
  const { Store } = w.__app;
  const m = w.__app.monthStr();
  const ds = w.__app.todayStr();
  Store.data.transactions = [];
  Store.setLimit(m, 3000);
  ok(Store.getLimit(m) === 3000, '月度上限可修改为 3000');

  // 记一笔后日均下降
  w.__app.switchPage('ledger');
  const before = w.document.querySelector('#gaugeDaily').textContent;
  Store.addTransaction({ id: 'd1', type: 'expense', amount: 500, category: '吃饭', account: 'wechat', remark: '', date: ds, createdAt: Date.now() });
  Store.adjustVault('wechat', -500);
  w.__app.renderLedger();
  const after = w.document.querySelector('#gaugeDaily').textContent;
  ok(before !== after, `支出后日均上限发生变化（${before} → ${after}）`);

  // 上限为 0 时不崩溃
  Store.setLimit(m, 0);
  w.__app.renderLedger();
  ok(true, '上限为 0 时渲染不崩溃');
});

/* =========================================================================
   运行
   ========================================================================= */
console.log('个人生活助手 —— 端到端测试');
console.log('时间：' + new Date().toLocaleString('zh-CN'));

const only = process.argv[2]; // 可指定只跑某个用例关键词

tests.forEach((t, i) => {
  if (only && !t.name.includes(only)) return;
  section(`[${i + 1}] ${t.name}`);
  let w;
  try {
    w = boot();
    t.fn(w);
  } catch (e) {
    fail++;
    failures.push(t.name + ' 抛出异常: ' + e.message);
    console.log('  \u2717 用例异常: ' + e.message);
    if (process.env.DEBUG) console.log(e.stack);
  } finally {
    if (w) w.close();
  }
});

console.log('\n========================================');
console.log(`结果：通过 ${pass} / 失败 ${fail}`);
if (failures.length) {
  console.log('\n失败项：');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('========================================');
process.exit(fail ? 1 : 0);
