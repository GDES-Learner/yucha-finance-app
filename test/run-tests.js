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
    'normalizeCategory, renderLedger, renderStats, renderVault, switchPage, todayStr, monthStr, ' +
    'renderMonthlySummary, monthTotals, monthCategoryTotals, addMonths, ' +
    'applyAppName, openRenameModal, DEFAULT_APP_NAME };\n' +
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

/* ---------- 需求 2：统计页专注分析（不再内嵌记账表单） ---------- */
test('需求2 统计页只做分析，入口统一到记账页', (w) => {
  // 切到统计页
  click(w, w.document.querySelector('.nav-item[data-page="stats"]'));
  const statsPage = w.document.querySelector('#page-stats');
  ok(!!statsPage.classList.contains('active'), '成功切换到统计页');

  // 统计页不应再内嵌记账表单，也不应有支出/收入页签
  ok(!statsPage.querySelector('form.entry-form'), '统计页已移除快捷记账表单');
  ok(statsPage.querySelectorAll('.tab').length === 0, '统计页已移除支出/收入切换页签');

  // 分析模块仍然完整
  ok(!!w.document.querySelector('#donutSvg'), '统计页保留分类占比环形图');
  ok(!!w.document.querySelector('#statsRank'), '统计页保留分类支出排行');
  ok(!!w.document.querySelector('#statsTrend'), '统计页保留近 7 日收支趋势');

  // 记账入口统一在记账页，且功能正常（跨页写库不漏）
  const ledgerForm = w.document.querySelector('#page-ledger form.entry-form');
  ok(!!ledgerForm, '记账页记账表单仍在');
  const before = w.eval('JSON.parse(localStorage.getItem("life_assistant_v1")).transactions.length');
  ledgerForm.querySelector('.f-amount').value = '9.5';
  submit(w, ledgerForm);
  const after = w.eval('JSON.parse(localStorage.getItem("life_assistant_v1")).transactions.length');
  ok(after === before + 1, '记账页提交后新增了一笔记录');
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

/* ---------- 需求 8：账单明细可切换是否计入环形图 ---------- */
test('需求8 账单明细可切换是否计入环形图', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  const m = w.__app.monthStr();
  Store.data.transactions = [];
  Store.data.vault = { wechat_change: 0, wechat_lct: 0, alipay: 0, bank: 0 };
  Store.setLimit(m, 1000);

  // 两笔支出：100 + 200
  Store.addTransaction({ id: 'e1', type: 'expense', amount: 100, category: '吃饭', account: 'wechat', remark: '', date: ds, counted: true, createdAt: 1 });
  Store.addTransaction({ id: 'e2', type: 'expense', amount: 200, category: '奶茶', account: 'wechat', remark: '', date: ds, counted: true, createdAt: 2 });
  w.__app.switchPage('ledger');
  w.__app.renderLedger();

  // 初始：环形图已花 300，进度 30%
  ok(w.document.querySelector('#gaugeSpent').textContent === '¥300.00', '初始环形图已花 = 300');
  ok(w.document.querySelector('#gaugePct').textContent === '30%', '初始进度 = 30%');

  // 每笔支出都有切换按钮，且默认显示「已计入」
  const btns = Array.from(w.document.querySelectorAll('#billList button[data-act="toggle-count"]'));
  ok(btns.length === 2, `每笔支出都有计入开关（${btns.length} 个）`);
  ok(btns[0].textContent.includes('已计入'), '默认状态为「已计入」');

  // 点击第一笔（200 或 100，按渲染顺序）切换为不计入
  click(w, btns[0]);
  const excludedId = btns[0].closest('.bill-item').dataset.id;
  const excludedAmt = excludedId === 'e1' ? 100 : 200;
  const leftAmt = 300 - excludedAmt;

  ok(Store.data.transactions.find((t) => t.id === excludedId).counted === false, '该笔被标记为不计入');
  ok(w.document.querySelector('#gaugeSpent').textContent === money(leftAmt),
    `环形图已花减少为 ${leftAmt}`);
  ok(w.document.querySelector('#listSummary').innerHTML.includes('不计入'), '汇总区出现「不计入」金额');

  // 该行有视觉标记
  const row = w.document.querySelector(`#billList .bill-item[data-id="${excludedId}"]`);
  ok(row.classList.contains('excluded'), '不计入的行有淡化样式');
  ok(!!row.querySelector('.bill-flag'), '不计入的行有「不计入」标签');

  // 再点一次恢复计入
  const btnNow = row.querySelector('button[data-act="toggle-count"]');
  click(w, btnNow);
  ok(Store.data.transactions.find((t) => t.id === excludedId).counted === true, '再次点击恢复计入');
  ok(w.document.querySelector('#gaugeSpent').textContent === '¥300.00', '环形图恢复为 300');

  // 持久化：重新加载后不计入状态保留
  click(w, w.document.querySelector(`#billList .bill-item[data-id="e2"] button[data-act="toggle-count"]`));
  const raw = w.eval('localStorage.getItem("life_assistant_v1")');
  ok(JSON.parse(raw).transactions.find((t) => t.id === 'e2').counted === false, '不计入状态已持久化');
});

test('需求8 全部不计入时环形图为 0', (w) => {
  const { Store } = w.__app;
  const ds = w.__app.todayStr();
  const m = w.__app.monthStr();
  Store.data.transactions = [];
  Store.setLimit(m, 1000);
  Store.addTransaction({ id: 'x1', type: 'expense', amount: 500, category: '吃饭', account: 'wechat', remark: '', date: ds, counted: false, createdAt: 1 });
  Store.addTransaction({ id: 'x2', type: 'expense', amount: 300, category: '购物', account: 'wechat', remark: '', date: ds, counted: false, createdAt: 2 });
  w.__app.switchPage('ledger');
  w.__app.renderLedger();

  ok(w.document.querySelector('#gaugeSpent').textContent === '¥0.00', '全部不计入时已花为 0');
  ok(w.document.querySelector('#gaugePct').textContent === '0%', '进度为 0%');
  // 日均上限此时应等于 上限/剩余天数
  const daily = w.document.querySelector('#gaugeDaily').textContent;
  ok(/¥\d/.test(daily), `日均上限仍可正常显示（${daily}）`);

  // 但账单列表汇总里总支出仍是 800（只是不计入环形图）
  ok(w.document.querySelector('#listSummary').innerHTML.includes('¥800.00'), '总支出仍如实显示 800');
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

/* ---------- 需求 9：月度总结 ---------- */
test('需求9 月度总结：12月网格 + 明细 + 环比 + 全年对比', (w) => {
  const { Store, state } = w.__app;

  // boot 每次都是空 store，自行注入数据
  Store.data.transactions = [];
  const add = (id, amount, category, date, counted) => Store.addTransaction({
    id, type: 'expense', amount, category, account: 'wechat', remark: '',
    date, counted: counted !== false, createdAt: Date.now(),
  });
  // 3 月：吃饭 100 + 奶茶 50 = 150
  add('m3a', 100, '吃饭', '2026-03-05');
  add('m3b', 50, '奶茶', '2026-03-08');
  // 4 月：吃饭 200 + 奶茶 50 + 交通 30 = 280
  add('m4a', 200, '吃饭', '2026-04-02');
  add('m4b', 50, '奶茶', '2026-04-03');
  add('m4c', 30, '交通', '2026-04-04');

  w.__app.switchPage('stats');
  state.summaryYear = 2026;
  state.summaryMonth = '2026-04';
  w.__app.renderMonthlySummary();

  // --- 12 个按钮，2 行 × 6 列 ---
  const grid = w.document.querySelector('#msumGrid');
  const btns = grid.querySelectorAll('.month-btn');
  ok(btns.length === 12, `月份网格渲染 12 个按钮（当前 ${btns.length}）`);
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  ok(/\.month-grid\s*\{[^}]*grid-template-columns:\s*repeat\(6,/.test(css), 'CSS 定义 6 列网格（2 行 × 6）');

  // --- 选中月高亮 ---
  const activeBtn = grid.querySelector('.month-btn.active');
  ok(!!activeBtn && activeBtn.dataset.month === '2026-04', '选中月按钮高亮为 2026-04');

  // --- 详情面板：分类合计正确（全部支出） ---
  const panel = w.document.querySelector('#msumPanel');
  ok(!panel.hidden, '详情面板已展开');
  ok(panel.textContent.includes('¥280.00'), '4 月合计显示 ¥280.00');
  const rows = Array.from(panel.querySelectorAll('.msum-row'));
  const eatRow = rows.find((li) => li.querySelector('.rank-name').textContent.includes('吃饭'));
  ok(!!eatRow && eatRow.querySelector('.rank-amt').textContent === '¥200.00', '吃饭行 = ¥200.00');
  ok(rows.length === 3, `明细列出 3 个分类（当前 ${rows.length}）`);

  // --- 环比：吃饭 200 vs 上月 100 → +100 (+100.0%) ---
  const eatDelta = eatRow.querySelector('.msum-delta').textContent.replace(/\s+/g, '');
  ok(eatDelta.includes('+') && eatDelta.includes('100.0%'), `吃饭环比 +100.0%（当前「${eatDelta}」）`);
  // 交通上月无数据 → 新增
  const transRow = rows.find((li) => li.querySelector('.rank-name').textContent.includes('交通'));
  ok(transRow.querySelector('.msum-delta').textContent.includes('新增'), '交通（上月无）显示「新增」');

  // --- 12 个月对比图 ---
  const colsBar = w.document.querySelectorAll('#msumChart .msum-col');
  ok(colsBar.length === 12, `对比图渲染 12 列（当前 ${colsBar.length}）`);
  const aprCol = Array.from(colsBar).find((c) => c.dataset.month === '2026-04');
  ok(!!aprCol && aprCol.classList.contains('active'), '对比图高亮选中月');

  // --- 统计口径：全部支出（含 counted:false）---
  add('m4d', 70, '购物', '2026-04-05', false); // 不计入环形图
  w.__app.renderMonthlySummary();
  const panelText2 = w.document.querySelector('#msumPanel').textContent;
  ok(panelText2.includes('¥350.00'), '含不计入的支出后 4 月合计 = ¥350.00（口径为全部支出）');
});

test('需求9 月份算术跨年正确', (w) => {
  const { addMonths } = w.__app;
  ok(addMonths('2026-01', -1) === '2025-12', '2026-01 上月 = 2025-12');
  ok(addMonths('2026-12', 1) === '2027-01', '2026-12 下月 = 2027-01');
  ok(addMonths('2026-06', 0) === '2026-06', '加减 0 个月不变');
  ok(addMonths('2026-03', -14) === '2025-01', '跨多个月/年正确（2026-03 −14 → 2025-01）');
});

test('需求9 年度切换与空数据兜底', (w) => {
  const { Store, state } = w.__app;
  Store.data.transactions = [];
  Store.addTransaction({
    id: 'y25', type: 'expense', amount: 88, category: '吃饭', account: 'wechat',
    remark: '', date: '2025-07-10', counted: true, createdAt: Date.now(),
  });
  w.__app.switchPage('stats');

  state.summaryYear = 2025;
  state.summaryMonth = '2025-07';
  w.__app.renderMonthlySummary();
  ok(w.document.querySelector('#msumYear').textContent === '2025', '年份标题显示 2025');
  ok(w.document.querySelector('#msumPanel').textContent.includes('¥88.00'), '2025-07 明细 = ¥88.00');

  // 点击「上一年」箭头 → 2024（无数据）
  click(w, w.document.querySelector('#msumPrevYear'));
  ok(state.summaryYear === 2024, '点击上一年箭头 → 2024');
  ok(w.document.querySelector('#msumYear').textContent === '2024', '标题更新为 2024');
  ok(w.document.querySelectorAll('#msumGrid .month-btn.empty').length === 12, '空年份 12 个按钮均为空态');
  ok(w.document.querySelector('#msumPanel').textContent.includes('暂无支出'), '空年份详情面板显示空态');

  // 点两次「下一年」回到 2026
  click(w, w.document.querySelector('#msumNextYear'));
  click(w, w.document.querySelector('#msumNextYear'));
  ok(state.summaryYear === 2026, '点击下一年箭头回到 2026');
});

test('需求9 点击月份按钮切换明细', (w) => {
  const { Store, state } = w.__app;
  Store.data.transactions = [];
  Store.addTransaction({
    id: 'may', type: 'expense', amount: 123, category: '娱乐', account: 'wechat',
    remark: '', date: '2026-05-20', counted: true, createdAt: Date.now(),
  });
  w.__app.switchPage('stats');
  state.summaryYear = 2026;
  state.summaryMonth = '2026-01';
  w.__app.renderMonthlySummary();

  const mayBtn = w.document.querySelector('#msumGrid .month-btn[data-month="2026-05"]');
  ok(!!mayBtn, '存在 2026-05 月按钮');
  click(w, mayBtn);
  ok(state.summaryMonth === '2026-05', '点击后选中月变为 2026-05');
  ok(w.document.querySelector('#msumPanel').textContent.includes('¥123.00'), '明细切到 5 月 = ¥123.00');
  // 重新查询（innerHTML 重建后原引用已失效）
  const mayBtn2 = w.document.querySelector('#msumGrid .month-btn[data-month="2026-05"]');
  ok(mayBtn2.classList.contains('active'), '5 月按钮变为高亮');

  // 点击对比图列同样可切换
  const janCol = w.document.querySelector('#msumChart .msum-col[data-month="2026-01"]');
  click(w, janCol);
  ok(state.summaryMonth === '2026-01', '点击对比图列也能切换月份');
});

/* ---------- 需求 10：应用名称可随时修改 ---------- */
test('需求10 左上角应用名称可修改并持久化', (w) => {
  const { Store } = w.__app;

  // 默认名称
  const brand = w.document.querySelector('#brandName');
  ok(!!brand, '左上角品牌名元素存在');
  ok(brand.textContent === w.__app.DEFAULT_APP_NAME, `默认名称为「${w.__app.DEFAULT_APP_NAME}」`);
  ok(w.document.title === w.__app.DEFAULT_APP_NAME, '页面标题与名称一致');

  // 点击品牌名 → 弹出改名弹窗
  click(w, brand);
  const input = w.document.querySelector('#appNameInput');
  ok(!!input, '点击品牌名后弹出改名输入框');

  // 输入新名并保存
  setVal(w, input, '我的小账本');
  click(w, w.document.querySelector('#modalOk'));
  ok(Store.data.appName === '我的小账本', 'Store.data.appName 已更新');
  ok(brand.textContent === '我的小账本', '左上角文案已更新');
  ok(w.document.title === '我的小账本', '页面标题已同步');

  // 持久化：写入 localStorage
  const saved = JSON.parse(w.eval('localStorage.getItem("life_assistant_v1")'));
  ok(saved.appName === '我的小账本', '已持久化到 localStorage');

  // 首尾空白会被裁剪
  w.__app.applyAppName('  测试名  ');
  ok(w.document.querySelector('#brandName').textContent === '测试名', '首尾空白被裁剪');

  // 空名称兜底：不允许保存为空（沿用 store 中当前名称）
  const nameBefore = Store.data.appName;
  click(w, w.document.querySelector('#brandName'));
  const input2 = w.document.querySelector('#appNameInput');
  setVal(w, input2, '   ');
  click(w, w.document.querySelector('#modalOk'));
  ok(Store.data.appName === nameBefore, `空名称被拒绝，保留原值「${nameBefore}」`);

  // sanitize 对残缺数据的兜底
  Store.data.appName = '';
  Store.sanitize();
  ok(Store.data.appName === w.__app.DEFAULT_APP_NAME, 'sanitize 将空名称回落到默认名');
  Store.data.appName = 12345;
  Store.sanitize();
  ok(Store.data.appName === w.__app.DEFAULT_APP_NAME, 'sanitize 将非字符串名称回落到默认名');

  // 超长名称被截断
  Store.data.appName = '一二三四五六七八九十一二三四五六七八九十甲乙丙丁';
  Store.sanitize();
  ok(Store.data.appName.length === 20, `超长名称被截断为 20 字符（当前 ${Store.data.appName.length}）`);
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
