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
  const cloudJs = fs.readFileSync(path.join(ROOT, 'cloud.js'), 'utf8');
  // app.js 与 cloud.js 合并进同一 IIFE，cloud.js 的函数在 app.js 的 Store.save() 中按名调用
  const instrumented =
    '(function(){\n' + appJs + '\n' + cloudJs + '\n' +
    'window.__app = { Store, state, CATEGORIES, CATEGORY_ICON, CATEGORY_COLOR, ACCOUNTS, ' +
    'normalizeCategory, renderLedger, renderStats, renderVault, switchPage, todayStr, monthStr, ' +
    'renderMonthlySummary, monthTotals, monthCategoryTotals, addMonths, ' +
    'applyAppName, openRenameModal, DEFAULT_APP_NAME, DATA_VERSION, ' +
    'SHOW_STATUSES, SHOW_STATUS_META, SHOW_SORTS, SHOW_COVER_TYPES, ' +
    'normalizeShow, normalizeWatchLog, validateSeasonEpisode, filterShows, sortShows, groupShows, ' +
    'incEpisode, decEpisode, showProgressText, showProgressPercent, ' +
    'renderShows, renderShowsStats, renderShowsFilters, showCardHtml, showSectionHtml, ' +
    'coverImgHtml, coverPlaceholder, showProgressBarHtml, ' +
    'openAddShowModal, openEditShowModal, openShowDetail, openFinishModal, openDeleteShowModal, ' +
    'openProgressModal, initShowsPage, ' +
    'COVER_DB_NAME, COVER_STORE, coverDbAvailable, coverSave, coverGet, coverDelete, ' +
    'coverGetURL, hydrateCovers, saveCoverFile, revokeCoverURL, ' +
    'CLOUD_PUBLIC_CONFIG, CLOUD_TABLE, ensureCloudClient, isCloudSignedIn, renderSyncEntry, ' +
    'renderCloudCard, openLoginModal, cloudPush, cloudPull, scheduleAutoPush, escapeHtml };\n' +
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
/** 取某个 jsdom 窗口里的应用内部 state（供测试直接改筛选条件） */
const state = (w) => w.__app.state;
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
  ok(dom3.window.__app.Store.data.version === 4, '数据版本升级为 4');
  ok(Array.isArray(dom3.window.__app.Store.data.shows), '迁移后补齐 shows 数组');
  ok(Array.isArray(dom3.window.__app.Store.data.watchLogs), '迁移后补齐 watchLogs 数组');

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
   需求 11：云同步（登录入口 / 离线兜底 / 失败路径 / 安全边界）
   ========================================================================= */

test('需求11 云同步入口与配置齐备', (w) => {
  const doc = w.document;
  const app = w.__app;

  // 界面元素
  ok(!!doc.getElementById('syncBtn'), '侧边栏存在「云同步」入口按钮');
  ok(!!doc.getElementById('cloudSyncCard'), '金库页存在云同步卡片');
  ok(!!doc.getElementById('cloudSyncBadge'), '云同步卡片有状态徽章');

  // publicConfig 四个字段都在（都是可安全下发前端的值）
  const cfg = app.CLOUD_PUBLIC_CONFIG;
  ok(!!cfg.resourceId, 'publicConfig.resourceId 已配置');
  ok(cfg.endpoint === 'https://yucha-finance-app.app.workbuddy.host', 'endpoint 为发布域名');
  ok(!!cfg.oauthRelayBaseUrl, 'oauthRelayBaseUrl 已配置（Web 微信登录所需）');
  ok(!!cfg.publishableKey, 'publishableKey 已配置');

  // 数据表名
  ok(app.CLOUD_TABLE === 'finance_state', '云数据表名为 finance_state');
});

test('需求11 SDK 未加载时降级为纯本地模式', (w) => {
  const app = w.__app;
  // 测试环境无 WorkBuddyCloud 全局 → ensureCloudClient 应返回 null，而不是抛错
  ok(typeof w.WorkBuddyCloud === 'undefined', '测试环境确实没有 SDK（模拟离线/未加载）');
  let threw = false;
  let client = null;
  try { client = app.ensureCloudClient(); } catch (e) { threw = true; }
  ok(!threw, 'SDK 缺失时初始化不抛异常');
  ok(client === null, 'SDK 缺失时返回 null（降级为纯本地模式）');
  ok(app.isCloudSignedIn() === false, '未登录状态下 isCloudSignedIn() 为 false');
});

test('需求11 未登录时数据仍正常保存到本地（离线兜底）', (w) => {
  const app = w.__app;
  const Store = app.Store;
  const before = Store.data.transactions.length;

  Store.addTransaction({
    id: 'cloud_local_1', type: 'expense', amount: 9.9, category: '奶茶',
    account: 'wechat', date: app.todayStr(), remark: '离线记账', createdAt: Date.now(),
  });
  ok(Store.data.transactions.length === before + 1, '未登录也能正常记账');

  const stored = JSON.parse(w.localStorage.getItem('life_assistant_v1'));
  ok(stored.transactions.some((t) => t.id === 'cloud_local_1'), '数据已写入 localStorage');

  // 未登录时自动上传钩子应直接返回，不产生任何请求
  let threw = false;
  try { app.scheduleAutoPush(); } catch (e) { threw = true; }
  ok(!threw, '未登录时 scheduleAutoPush 安全空转');
});

test('需求11 未登录时上传/下载有明确提示而非静默失败', async (w) => {
  const app = w.__app;
  const pushRes = await app.cloudPush(true);
  ok(pushRes === false, '未登录时 cloudPush 返回 false');
  ok(w.document.getElementById('toast').textContent.includes('请先登录'), '上传给出「请先登录」提示');

  const pullRes = await app.cloudPull(true);
  ok(pullRes === false, '未登录时 cloudPull 返回 false');
  ok(w.document.getElementById('toast').textContent.includes('请先登录'), '下载给出「请先登录」提示');
});

test('需求11 登录弹窗结构完整且校验先行', (w) => {
  const app = w.__app;
  app.openLoginModal();
  const doc = w.document;

  ok(!!doc.getElementById('cloudEmailInput'), '弹窗含邮箱输入框');
  ok(!!doc.getElementById('cloudCodeInput'), '弹窗含验证码输入框');
  ok(!!doc.getElementById('cloudSendBtn'), '弹窗含「获取验证码」按钮');
  ok(!!doc.getElementById('modalOk'), '弹窗含「登录」提交按钮');
  ok(doc.getElementById('cloudSendBtn').type === 'button',
    '「获取验证码」为 type=button（避免触发表单提交）');

  // 非法邮箱：不发请求，直接提示
  const emailEl = doc.getElementById('cloudEmailInput');
  emailEl.value = 'not-an-email';
  click(w, doc.getElementById('cloudSendBtn'));
  const hint = () => doc.getElementById('cloudHint').textContent;
  ok(hint().includes('邮箱'), '非法邮箱给出格式提示');

  // 邮箱合法但未获取验证码就提交：应提示先获取
  emailEl.value = 'a@b.com';
  doc.getElementById('cloudCodeInput').value = '123456';
  click(w, doc.getElementById('modalOk'));
  ok(hint().includes('获取验证码'), '未获取验证码就提交时提示先去获取');
});

/* =========================================================================
   观影模块 —— A 数据 / 迁移
   ========================================================================= */
test('观影A 数据版本为 4 且新字段齐备', (w) => {
  const d = w.__app.Store.data;
  ok(d.version === 4, 'DATA_VERSION 为 4');
  ok(Array.isArray(d.shows), 'shows 为数组');
  ok(Array.isArray(d.watchLogs), 'watchLogs 为数组');
  ok(w.__app.DATA_VERSION === 4, '导出常量 DATA_VERSION 为 4');
});

test('观影A 旧版（v3）数据迁移后补空数组且不破坏原数据', (w) => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const legacy = JSON.stringify({
    version: 3, appName: '测试', customNav: [],
    transactions: [{ id: 't1', type: 'expense', amount: 20, category: '奶茶', account: 'wechat', date: '2026-01-05', createdAt: 1 }],
    budgets: { '2026-01': 800 }, vault: { wechat_change: 50, wechat_lct: 0, alipay: 0, bank: 0 },
  });
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.localStorage.setItem('life_assistant_v1', legacy);
  dom.window.eval('(function(){' + fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') +
    'var _c=typeof coverDelete!=="undefined"?{coverDelete:coverDelete}:{};' +
    'window.__app={Store, DATA_VERSION, normalizeShow, normalizeWatchLog};})();');
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  const d = dom.window.__app.Store.data;
  ok(d.version === 4, 'v3 → v4 升级成功');
  ok(Array.isArray(d.shows) && d.shows.length === 0, 'shows 补为空数组');
  ok(Array.isArray(d.watchLogs) && d.watchLogs.length === 0, 'watchLogs 补为空数组');
  ok(d.transactions.length === 1, '原有交易未被破坏');
  ok(d.budgets['2026-01'] === 800, '原有预算未被破坏');
  ok(d.vault.wechat_change === 50, '原有金库未被破坏');
});

test('观影A sanitize 丢弃非法剧集并兜底字段', (w) => {
  const dom = boot();
  const app = dom.__app;
  app.Store.data.shows = [
    { id: 's1', title: '合法剧', status: 'bogus', season: 0, episode: -3, year: 1800, rating: 99, coverType: 'bad' },
    { id: 's2', title: '' },              // 空标题 → 丢弃
    null, 'str', 42,                       // 非对象 → 丢弃
    { id: 's3', title: '无封面类型', coverType: 'url', coverUrl: 'javascript:alert(1)' },
  ];
  dom.__app.Store.sanitize();
  const shows = app.Store.data.shows;
  ok(shows.length === 2, '仅保留 2 条合法剧集');
  const s1 = shows.find((s) => s.id === 's1');
  ok(s1.status === 'want', '非法 status 回落为 want');
  ok(s1.season === 1 && s1.episode === 1, '非法季集回落为 1');
  ok(s1.year === 1900, '年份下界 clamp 到 1900');
  ok(s1.rating === 10, '评分上界 clamp 到 10');
  ok(s1.coverType === 'none', '非法封面类型回落 none');
  const s3 = shows.find((s) => s.id === 's3');
  ok(s3.coverType === 'none' && s3.coverUrl === '', 'javascript: 协议封面被拒绝 → none');
});

test('观影A sanitize 清理孤儿观看记录', (w) => {
  const app = w.__app;
  app.Store.data.shows = [{ id: 'keep', title: '留存' }];
  app.Store.data.watchLogs = [
    { id: 'l1', showId: 'keep', kind: 'progress', at: 1 },
    { id: 'l2', showId: 'ghost', kind: 'progress', at: 2 },  // 无对应剧集 → 丢弃
    { id: 'l3', kind: 'progress' },                          // 缺 showId → 丢弃
  ];
  app.Store.sanitize();
  ok(app.Store.data.watchLogs.length === 1, '孤儿观看记录被清理');
  ok(app.Store.data.watchLogs[0].showId === 'keep', '保留有效观看记录');
});

test('观影A normalizeShow 允许合法的 data:image 封面', (w) => {
  const dom = boot();
  const s = { title: 'X', coverType: 'url', coverUrl: 'data:image/png;base64,AAAA' };
  dom.__app.normalizeShow(s);
  ok(s.coverType === 'url', 'data:image 封面被接受');
  const s2 = { title: 'Y', coverType: 'url', coverUrl: 'http://x/y.jpg' };
  dom.__app.normalizeShow(s2);
  ok(s2.coverUrl === 'http://x/y.jpg', 'http 封面被接受');
});

/* =========================================================================
   观影模块 —— B 数据操作
   ========================================================================= */
test('观影B 新增剧集并持久化到 localStorage', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '进击的巨人', year: 2013, status: 'want' });
  ok(!!s && !!s.id, '返回带 id 的剧集对象');
  ok(app.Store.getShows().length === 1, '剧集已入内存');
  const raw = JSON.parse(w.localStorage.getItem('life_assistant_v1'));
  ok(raw.shows.length === 1, '剧集已写入 localStorage');
  ok(raw.shows[0].title === '进击的巨人', '标题正确持久化');
});

test('观影B 空标题被拒绝新增', (w) => {
  const app = w.__app;
  const before = app.Store.getShows().length;
  const s = app.Store.addShow({ title: '   ' });
  ok(s === null, '空标题返回 null');
  ok(app.Store.getShows().length === before, '未新增任何剧集');
});

test('观影B 编辑剧集刷新 updatedAt', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '原题', year: 2020 });
  const oldUp = s.updatedAt;
  const r = app.Store.updateShow(s.id, { title: '新题', genre: '科幻' });
  ok(r.title === '新题' && r.genre === '科幻', '字段已被更新');
  ok(r.updatedAt >= oldUp, 'updatedAt 已刷新');
});

test('观影B 删除剧集级联清理观看记录', (w) => {
  const app = w.__app;
  const a = app.Store.addShow({ title: 'A剧' });
  const b = app.Store.addShow({ title: 'B剧' });
  app.Store.updateProgress(a.id, 1, 2);
  app.Store.updateProgress(b.id, 1, 3);
  ok(app.Store.data.watchLogs.length === 2, '两条观看记录已写入');
  app.Store.removeShow(a.id);
  ok(app.Store.getShow(a.id) === undefined, 'A 剧已删除');
  ok(app.Store.data.watchLogs.length === 1, 'A 剧的观看记录被级联删除');
  ok(app.Store.data.watchLogs[0].showId === b.id, 'B 剧记录保留');
});

test('观影B 观看记录可按剧集倒序查询', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '记录剧' });
  app.Store.updateProgress(s.id, 1, 1);
  app.Store.updateProgress(s.id, 1, 2);
  app.Store.changeShowStatus(s.id, 'paused');
  const logs = app.Store.getWatchLogs(s.id, 10);
  ok(logs.length === 3, '三条记录');
  ok(logs.filter((l) => l.kind === 'status').length === 1, '含一条状态变更记录');
  ok(logs[0].at >= logs[2].at, '按时间倒序（不早于最旧一条）');
  ok(logs.some((l) => l.kind === 'progress' && l.episode === 2), '含第 2 集进度记录');
});

/* =========================================================================
   观影模块 —— C 进度（核心）
   ========================================================================= */
test('观影C validateSeasonEpisode 正整数校验', (w) => {
  const v = w.__app.validateSeasonEpisode;
  ok(v(1, 5).ok, '合法季集通过');
  ok(!v(0, 5).ok, '季数 0 非法');
  ok(!v(1, 0).ok, '集数 0 非法');
  ok(v(1.9, 2.7).season === 1 && v(1.9, 2.7).episode === 2, '小数季集被向下取整');
  ok(v(1, 5, 10).ok, '本季 10 集、第 5 集合法');
  const r = v(1, 11, 10);
  ok(!r.ok, '超出本季总集数判非法');
  ok(r.error.includes('10'), '错误信息含本季总集数');
  ok(v(1, 100, null).ok, '总集数未知时不设上限');
});

test('观影C incEpisode 未知本季总集数只 +1（不进季）', (w) => {
  const app = w.__app;
  const s = { season: 1, episode: 5, currentSeasonEpisodes: null, totalSeasons: null };
  const r = app.incEpisode(s);
  ok(r.season === 1 && r.episode === 6, '集数 +1 且季数不变');
});

test('观影C incEpisode 本季最后一集进入下一季', (w) => {
  const app = w.__app;
  const s = { season: 1, episode: 10, currentSeasonEpisodes: 10, totalSeasons: 3 };
  const r = app.incEpisode(s);
  ok(r.season === 2 && r.episode === 1, '末集后进入 S2 第 1 集');
});

test('观影C incEpisode 不越过总季数上界', (w) => {
  const app = w.__app;
  const s = { season: 3, episode: 10, currentSeasonEpisodes: 10, totalSeasons: 3 };
  const r = app.incEpisode(s);
  ok(r.season === 3 && r.episode === 10, '已到最后一季最后一集则不再前进');
});

test('观影C decEpisode 从季首回退到上一季', (w) => {
  const app = w.__app;
  const s = { season: 2, episode: 1, currentSeasonEpisodes: 12, totalSeasons: 3 };
  const r = app.decEpisode(s);
  ok(r.season === 1 && r.episode === 12, 'S2E1 回退到 S1E12（上季集数已知）');
  const s2 = { season: 2, episode: 1, currentSeasonEpisodes: null };
  const r2 = app.decEpisode(s2);
  ok(r2.season === 1 && r2.episode === 1, '上季集数未知时回退到 S1E1');
});

test('观影C decEpisode 下限保护（S1E1 不再后退）', (w) => {
  const app = w.__app;
  const r = app.decEpisode({ season: 1, episode: 1 });
  ok(r.season === 1 && r.episode === 1, 'S1E1 保持不变');
});

test('观影C 改状态不删除进度与资料', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '改状态剧', summary: '简介保留', rating: 8 });
  app.Store.updateProgress(s.id, 2, 7);
  app.Store.changeShowStatus(s.id, 'paused');
  const after = app.Store.getShow(s.id);
  ok(after.status === 'paused', '状态已改为暂停');
  ok(after.season === 2 && after.episode === 7, '进度未被清空');
  ok(after.summary === '简介保留', '简介未被清空');
  ok(after.rating === 8, '评分未被清空');
});

test('观影C 标记已看完保留资料并可改回在看继续推进', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '完结剧', genre: '悬疑' });
  app.Store.updateProgress(s.id, 1, 3);
  app.Store.finishShow(s.id, { date: '2026-02-01', rating: 9.5, note: '神作' });
  const fin = app.Store.getShow(s.id);
  ok(fin.status === 'watched', '状态为已看完');
  ok(fin.finishedAt === '2026-02-01', '完成日期已记录');
  ok(fin.rating === 9.5, '评分已记录');
  ok(fin.note === '神作', '观后感已记录');
  ok(fin.season === 1 && fin.episode === 3, '进度资料保留');
  // 改回在看后仍可推进
  app.Store.changeShowStatus(s.id, 'watching');
  const r = app.incEpisode(app.Store.getShow(s.id));
  ok(r.episode === 4, '改回在在后可继续推进');
});

test('观影C 首次推进进度自动从「想看」转为「在看」', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '自动转态剧', status: 'want' });
  app.Store.updateProgress(s.id, 1, 1);
  ok(app.Store.getShow(s.id).status === 'watching', '进度推进后状态变为在看');
  ok(!!app.Store.getShow(s.id).lastWatchedAt, 'lastWatchedAt 已写入');
});

test('观影C 不同季集数互不干扰（本季总集数独立）', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '多季剧', currentSeasonEpisodes: 12 });
  // 第 1 季 12 集 → 进第 2 季时集数重置为 1
  app.Store.updateProgress(s.id, 1, 12);
  let r = app.incEpisode(app.Store.getShow(s.id));
  ok(r.season === 2 && r.episode === 1, '跨季后集数重置为 1，不复用上一季集数');
  // 若用户把本季总集数改为 8，则第 8 集即为末集
  app.Store.updateShow(s.id, { currentSeasonEpisodes: 8 });
  app.Store.updateProgress(s.id, 2, 8);
  r = app.incEpisode(app.Store.getShow(s.id));
  ok(r.season === 3 && r.episode === 1, '按新的本季总集数判定季终');
});

/* =========================================================================
   观影模块 —— E 封面 / 降级
   ========================================================================= */
test('观影E jsdom 无 IndexedDB 时能力探测返回 false 且优雅降级', (w) => {
  const app = w.__app;
  ok(typeof w.indexedDB === 'undefined', 'jsdom 环境确实没有 indexedDB');
  ok(app.coverDbAvailable() === false, 'coverDbAvailable 返回 false');
});

test('观影E 无 IDB 时封面 API 全部返回安全值且不抛错', async (w) => {
  const app = w.__app;
  let threw = false;
  let saveR, getR, delR, urlR;
  try {
    saveR = await app.coverSave('k1', { fake: 'blob' });
    getR = await app.coverGet('k1');
    urlR = await app.coverGetURL('k1');
    delR = await app.coverDelete('k1');
  } catch (e) { threw = true; }
  ok(!threw, '封面 API 调用不抛错');
  ok(saveR === false, 'coverSave 降级返回 false');
  ok(getR !== undefined, 'coverGet 返回值不抛错');
  ok(urlR === null || urlR === undefined, 'coverGetURL 降级返回 null');
  ok(delR === false, 'coverDelete 降级返回 false');
});

test('观影E 空 key 的封面 API 立即安全返回', async (w) => {
  const app = w.__app;
  ok((await app.coverGet('')) === null, '空 key coverGet → null');
  ok((await app.coverSave('', { x: 1 })) === false, '空 key coverSave → false');
  ok((await app.coverDelete('')) === false, '空 key coverDelete → false');
});

test('观影E 本地封面仅存 key 引用，HTML 中不含 Base64 内联图', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '本地封面剧' });
  app.Store.updateShow(s.id, { coverType: 'local', coverKey: 'img_test123' });
  const saved = app.Store.getShow(s.id);
  ok(saved.coverType === 'local' && saved.coverKey === 'img_test123', '仅保存 key 引用');
  const json = w.localStorage.getItem('life_assistant_v1');
  ok(json.indexOf('data:image') === -1, 'localStorage 中不含 data:image 内联数据');
  ok(json.indexOf('img_test123') > -1, 'localStorage 中含封面 key');
});

test('观影E saveCoverFile 拒绝非图片与超大文件', async (w) => {
  const app = w.__app;
  const notImg = await app.saveCoverFile({ type: 'text/plain', size: 100, name: 'a.txt' });
  ok(notImg.ok === false && /图片/.test(notImg.error), '非图片被拒绝并给出提示');
  const tooBig = await app.saveCoverFile({ type: 'image/png', size: 9 * 1024 * 1024, name: 'a.png' });
  ok(tooBig.ok === false && /5MB|过大/.test(tooBig.error), '超大图片被拒绝');
  const good = await app.saveCoverFile({ type: 'image/png', size: 1024, name: 'a.png' });
  ok(good.ok === true && /^img_/.test(good.key), '合法图片返回 img_ 前缀 key');
});

test('观影E hydrateCovers 在无 IDB 时不抛错并标记失败', (w) => {
  const app = w.__app;
  const wrap = w.document.createElement('div');
  wrap.innerHTML = '<img data-cover-type="local" data-cover-key="nope" />';
  let threw = false;
  try { app.hydrateCovers(wrap); } catch (e) { threw = true; }
  ok(!threw, 'hydrateCovers 不抛错');
  ok(app.hydrateCovers(null) === undefined, '传入 null 安全返回');
});

/* =========================================================================
   观影模块 —— F 交互 / 结构
   ========================================================================= */
test('观影F 导航存在第 4 个「观影」入口', (w) => {
  const items = w.document.querySelectorAll('.nav-item[data-page]');
  ok(items.length === 4, '共有 4 个导航项');
  const showsNav = w.document.querySelector('.nav-item[data-page="shows"]');
  ok(!!showsNav, '存在 data-page="shows" 的导航项');
  ok(showsNav.textContent.includes('观影'), '文案为「观影」');
  ok(!!showsNav.querySelector('i[data-lucide="clapperboard"]'), '图标为 clapperboard');
});

test('观影F 点击导航第 4 项切换到观影页', (w) => {
  const nav = w.document.querySelector('.nav-item[data-page="shows"]');
  click(w, nav);
  const page = w.document.querySelector('#page-shows');
  ok(page.classList.contains('active'), '观影页已激活');
  ok(!w.document.querySelector('#page-ledger').classList.contains('active'), '记账页已隐藏');
  ok(nav.classList.contains('active'), '导航项高亮');
});

test('观影F 观影页含搜索 / 排序 / 添加 / 统计 / 筛选 / 区块容器', (w) => {
  const page = w.document.querySelector('#page-shows');
  ['showAddBtn', 'showSearch', 'showSortSel', 'showsStats', 'showsFilters', 'showsSections', 'showsLink']
    .forEach((id) => ok(!!page.querySelector('#' + id), `存在 #${id}`));
});

test('观影F 底部外链指向 iioo.me 且新窗口打开', (w) => {
  const a = w.document.querySelector('#showsLink');
  ok(!!a, '存在 #showsLink');
  ok(a.getAttribute('href') === 'https://iioo.me/', 'href 指向 https://iioo.me/');
  ok(a.target === '_blank', '新窗口打开（target=_blank）');
  ok(/noopener/.test(a.getAttribute('rel') || ''), 'rel 含 noopener（防逆向引用）');
  ok(a.textContent.includes('点此去看剧'), '文案为「点此去看剧」');
});

/* =========================================================================
   观影模块 —— D 渲染 / 筛选 / 排序
   ========================================================================= */
test('观影D 四区块 + 统计概览正确渲染', (w) => {
  const app = w.__app;
  app.Store.reset();
  const a = app.Store.addShow({ title: '在看剧', status: 'watching' });
  app.Store.updateProgress(a.id, 1, 3);            // 有观看记录 → 进「继续观看」
  const b = app.Store.addShow({ title: '刚标记在看', status: 'watching' }); // 无记录 → 进「在看」
  app.Store.addShow({ title: '想看剧', status: 'want' });
  app.Store.addShow({ title: '已看完剧', status: 'watched' });
  app.Store.addShow({ title: '暂停剧', status: 'paused' });

  app.renderShows();
  const secs = w.document.querySelectorAll('#showsSections .shows-section');
  ok(secs.length === 5, '渲染出 5 个区块（继续观看 + 在看 + 想看 + 暂停 + 已看完）');
  const names = Array.prototype.map.call(
    w.document.querySelectorAll('#showsSections .shows-section-head h2'), (h) => h.textContent);
  ok(names.some((n) => n.includes('继续观看')), '含「继续观看」区块');
  ok(names.some((n) => n.includes('已看完')), '含「已看完」区块');
  ok(!!b, '第二部在看剧已创建');

  const stats = w.document.querySelectorAll('#showsStats .show-stat');
  ok(stats.length === 4, '统计概览 4 项');
  const statText = w.document.querySelector('#showsStats').textContent;
  ok(statText.includes('在看') && statText.includes('已看完'), '统计含在看/已看完标签');
  // 两部在看 → 统计「在看」计数为 2
  const watchingNum = w.document.querySelector('#showsStats .show-stat .show-stat-num').textContent;
  ok(watchingNum === '2', '「在看」统计数为 2');
});

test('观影D 筛选 + 搜索叠加生效', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addShow({ title: '海绵宝宝', status: 'want', genre: '动画' });
  app.Store.addShow({ title: '火影忍者', status: 'watching', genre: '动画' });
  app.Store.addShow({ title: '绝命毒师', status: 'watching', genre: '犯罪' });

  // 仅状态筛选
  state(w).showStatus = 'watching';
  state(w).showQuery = '';
  app.renderShows();
  ok(w.document.querySelectorAll('#showsSections .poster-card').length === 2, '「在看」筛出 2 部');

  // 状态 + 关键词叠加
  state(w).showQuery = '绝命';
  app.renderShows();
  const cards = w.document.querySelectorAll('#showsSections .poster-card');
  ok(cards.length === 1, '叠加关键词后仅 1 部');
  ok(cards[0].textContent.includes('绝命毒师'), '命中「绝命毒师」');

  // 恢复
  state(w).showStatus = 'all';
  state(w).showQuery = '';
});

test('观影D filterShows 匹配原名 / 类型 / 简介', (w) => {
  const app = w.__app;
  const list = [
    { title: 'A', originalTitle: 'Breaking Bad', genre: '犯罪', summary: '' },
    { title: 'B', originalTitle: '', genre: '喜剧', summary: '一段校园故事' },
  ];
  ok(app.filterShows(list, 'all', 'breaking').length === 1, '匹配原文标题（忽略大小写）');
  ok(app.filterShows(list, 'all', '喜剧').length === 1, '匹配类型');
  ok(app.filterShows(list, 'all', '校园').length === 1, '匹配简介');
});

test('观影D sortShows 三种排序', (w) => {
  const app = w.__app;
  const list = [
    { id: '1', title: 'B剧', createdAt: 100, updatedAt: 300 },
    { id: '2', title: 'A剧', createdAt: 300, updatedAt: 100 },
    { id: '3', title: 'C剧', createdAt: 200, updatedAt: 200 },
  ];
  ok(app.sortShows(list, 'updated')[0].id === '1', 'updated 降序 → 最近更新在前');
  ok(app.sortShows(list, 'created')[0].id === '2', 'created 降序 → 最近添加在前');
  ok(app.sortShows(list, 'title')[0].id === '2', 'title 升序 → A 剧在前');
  ok(list[0].id === '1', '原数组未被修改');
});

test('观影D groupShows 正确分区（有观看记录才进「继续观看」）', (w) => {
  const app = w.__app;
  const g = app.groupShows([
    { id: '1', status: 'watching', lastWatchedAt: 5, updatedAt: 5 },
    { id: '2', status: 'watching', lastWatchedAt: null, updatedAt: 6 },
    { id: '3', status: 'want', updatedAt: 1 },
    { id: '4', status: 'watched', updatedAt: 1 },
    { id: '5', status: 'paused', updatedAt: 1 },
  ]);
  ok(g.continue.length === 1 && g.continue[0].id === '1', '有观看记录的在看剧进「继续观看」');
  ok(g.watching.length === 1 && g.watching[0].id === '2', '无记录的在看剧单列');
  ok(g.want.length === 1 && g.watched.length === 1 && g.paused.length === 1, 'want/watched/paused 各 1');
});

test('观影D 未知本季总集数不画进度条、不显百分比', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '集数未知', status: 'watching' });
  app.Store.updateProgress(s.id, 1, 5);
  app.renderShows();
  const card = w.document.querySelector(`.poster-card[data-id="${s.id}"]`);
  ok(!!card, '卡片已渲染');
  ok(card.querySelectorAll('.progress-track').length === 0, '未知总集数不渲染进度条');
  ok(card.textContent.includes('第 5 集') && !card.textContent.includes('/'), '仅显示「第 5 集」，无百分比');
});

test('观影D 已知本季总集数渲染进度条与「第 x / y 集」', (w) => {
  const app = w.__app;
  const s = app.Store.addShow({ title: '集数已知', status: 'watching', currentSeasonEpisodes: 10 });
  app.Store.updateProgress(s.id, 1, 4);
  app.renderShows();
  const card = w.document.querySelector(`.poster-card[data-id="${s.id}"]`);
  ok(card.querySelectorAll('.progress-track').length === 1, '渲染进度条');
  const fill = card.querySelector('.progress-fill');
  ok(fill.getAttribute('style').includes('40%'), '进度 40%');
  ok(card.textContent.includes('第 4 / 10 集'), '显示「第 4 / 10 集」');
});

test('观影D 卡片含 2:3 封面容器与状态标签', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '封面剧', status: 'watched' });
  app.renderShows();
  const card = w.document.querySelector(`.poster-card[data-id="${s.id}"]`);
  ok(!!card.querySelector('.poster-media'), '含海报容器（aspect-ratio 2:3 由 CSS 保证）');
  const badge = card.querySelector('.poster-badge');
  ok(!!badge, '含状态标签');
  ok(badge.classList.contains('st-watched'), '已看完徽标类名正确');
  ok(card.querySelector('.cover-ph') || card.querySelector('.cover-img'), '含封面或占位');
});

test('观影D 空态与无结果态', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.renderShows();
  ok(w.document.querySelector('#showsSections .empty'), '无数据时显示空态');
  ok(w.document.querySelector('#showsSections .empty').textContent.includes('还没有'), '空态文案正确');

  app.Store.addShow({ title: '唯一剧' });
  state(w).showQuery = 'zzz不存在zzz';
  app.renderShows();
  ok(w.document.querySelector('#showsSections .empty').textContent.includes('没有匹配'), '无结果态文案正确');
  state(w).showQuery = '';
});

test('观影F 事件委托：导航到观影页后点卡片可开详情（innerHTML 重建后仍生效）', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '委托测试剧', year: 2021, summary: '简介内容' });
  app.switchPage('shows');
  const card = w.document.querySelector(`.poster-card[data-id="${s.id}"]`);
  ok(!!card, '卡片已渲染');
  click(w, card);
  ok(w.document.getElementById('modalMask').classList.contains('show'), '详情弹窗已打开');
  ok(w.document.querySelector('#modal').textContent.includes('委托测试剧'), '详情显示剧名');
});

test('观影F 卡片「下一集」按钮推进进度', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '推进剧', status: 'watching', currentSeasonEpisodes: 5 });
  app.Store.updateProgress(s.id, 1, 1);
  app.switchPage('shows');
  const btn = w.document.querySelector(`button[data-act="continue"][data-id="${s.id}"]`);
  ok(!!btn, '卡片上有「下一集」按钮');
  click(w, btn);
  ok(app.Store.getShow(s.id).episode === 2, '进度推进到第 2 集');
});

test('观影F 点击筛选标签切换状态筛选', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addShow({ title: '想看甲', status: 'want' });
  app.Store.addShow({ title: '在看乙', status: 'watching' });
  app.switchPage('shows');
  const chip = w.document.querySelector('.chip[data-status="want"]');
  ok(!!chip, '存在「想看」筛选标签');
  click(w, chip);
  ok(app.state.showStatus === 'want', '筛选状态已切换为 want');
  ok(w.document.querySelectorAll('#showsSections .poster-card').length === 1, '仅显示 1 部');
});

test('观影F 新增剧集弹窗填写后成功入库', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.switchPage('shows');
  click(w, w.document.querySelector('#showAddBtn'));
  ok(w.document.getElementById('modalMask').classList.contains('show'), '新增弹窗已打开');
  ok(!!w.document.getElementById('showTitle'), '弹窗含标题输入');
  ok(!!w.document.querySelector('#showStatusSegs .seg'), '弹窗含状态分段控件');
  w.document.getElementById('showTitle').value = '新剧一';
  w.document.getElementById('showYear').value = '2024';
  w.document.getElementById('showGenre').value = '科幻';
  click(w, w.document.getElementById('modalOk'));
  ok(app.Store.getShows().length === 1, '剧集已入库');
  ok(app.Store.getShows()[0].title === '新剧一', '标题正确');
  ok(app.Store.getShows()[0].year === 2024, '年份正确');
});

test('观影F 新增弹窗空标题被拒绝', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.switchPage('shows');
  click(w, w.document.querySelector('#showAddBtn'));
  click(w, w.document.getElementById('modalOk'));
  ok(app.Store.getShows().length === 0, '未入库任何剧集');
  ok(w.document.getElementById('modalMask').classList.contains('show'), '弹窗保持打开');
});

test('观影F 编辑弹窗自动回填全部字段', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({
    title: '回填剧', originalTitle: 'Original', year: 2019, genre: '悬疑',
    status: 'paused', season: 2, episode: 7, currentSeasonEpisodes: 12, totalSeasons: 3,
    summary: '简介文本', note: '备注文本', rating: 8.5,
  });
  app.openEditShowModal(s.id);
  ok(w.document.getElementById('showTitle').value === '回填剧', '标题回填');
  ok(w.document.getElementById('showOriginalTitle').value === 'Original', '原文标题回填');
  ok(w.document.getElementById('showYear').value === '2019', '年份回填');
  ok(w.document.getElementById('showSeason').value === '2', '季回填');
  ok(w.document.getElementById('showEpisode').value === '7', '集回填');
  ok(w.document.getElementById('showSeasonEpisodes').value === '12', '本季集数回填');
  ok(w.document.getElementById('showRating').value === '8.5', '评分回填');
  ok(w.document.querySelector('#showStatusSegs .seg.active').dataset.status === 'paused', '状态选中暂停');
  ok(w.document.getElementById('showSummary').value === '简介文本', '简介回填');
});

test('观影F 改状态不影响进度（通过详情/状态操作链路）', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '状态剧', status: 'watching', currentSeasonEpisodes: 10 });
  app.Store.updateProgress(s.id, 1, 6);
  app.Store.changeShowStatus(s.id, 'paused');
  ok(app.Store.getShow(s.id).episode === 6, '进度保留');
  ok(app.Store.getShow(s.id).status === 'paused', '状态已改');
});

test('观影F 标记已看完弹窗默认日期为今天', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '看完剧', status: 'watching' });
  app.openFinishModal(s.id);
  ok(!!w.document.getElementById('showFinishDate'), '含完成日期输入');
  ok(w.document.getElementById('showFinishDate').value === todayStr(), '默认日期为今天');
  w.document.getElementById('showFinishRating').value = '9';
  click(w, w.document.getElementById('modalOk'));
  ok(app.Store.getShow(s.id).status === 'watched', '状态改为已看完');
  ok(app.Store.getShow(s.id).rating === 9, '评分已记录');
});

test('观影F 删除确认弹窗二次确认后删除', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '待删剧' });
  app.openDeleteShowModal(s.id);
  ok(w.document.querySelector('#modal').textContent.includes('待删剧'), '确认弹窗显示剧名');
  click(w, w.document.getElementById('modalOk'));
  ok(app.Store.getShow(s.id) === undefined, '剧集已删除');
});

test('观影F 详情弹窗含观看记录与操作组', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '详情剧', status: 'watching', currentSeasonEpisodes: 8, summary: '故事简介' });
  app.Store.updateProgress(s.id, 1, 3);
  app.openShowDetail(s.id);
  const modal = w.document.querySelector('#modal');
  ok(modal.textContent.includes('详情剧'), '显示剧名');
  ok(modal.textContent.includes('故事简介'), '显示简介');
  ok(!!modal.querySelector('.watchlog-list'), '含观看记录列表');
  ok(modal.querySelectorAll('.detail-acts [data-act]').length >= 5, '含多个操作按钮');
  ok(!!modal.querySelector('[data-act="continue"]'), '含「看下一集」');
  ok(!!modal.querySelector('[data-act="finish"]'), '含「已看完」');
});

test('观影F 详情内「看下一集」推进并刷新详情', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '详情推进剧', status: 'watching', currentSeasonEpisodes: 6 });
  app.Store.updateProgress(s.id, 1, 2);
  app.openShowDetail(s.id);
  click(w, w.document.querySelector('#modal [data-act="continue"]'));
  ok(app.Store.getShow(s.id).episode === 3, '进度推进到第 3 集');
  ok(w.document.querySelector('#modal').textContent.includes('第 3 / 6 集'), '详情已刷新为新进度');
});

test('观影F 封面选择器含三个可用 tab + AI 预留说明', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  const tabs = w.document.querySelectorAll('#coverPicker .cover-tab');
  ok(tabs.length === 4, '4 个封面 tab（无封面 / 链接 / 本地 / AI）');
  const aiPane = w.document.querySelector('[data-cover-pane="ai"]');
  ok(!!aiPane && aiPane.textContent.includes('预留'), 'AI 面板明确标注为预留');
  const aiBtn = aiPane.querySelector('button');
  ok(!!aiBtn && aiBtn.disabled, 'AI 生成按钮处于禁用态（未接入时不假装可用）');
});

test('观影F 选择「图片链接」并填 URL 后保存为 url 类型', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.openAddShowModal();
  w.document.getElementById('showTitle').value = '链接封面剧';
  click(w, w.document.querySelector('#coverPicker .cover-tab[data-cover-tab="url"]'));
  const urlInput = w.document.getElementById('coverUrlInput');
  urlInput.value = 'https://example.com/p.jpg';
  urlInput.dispatchEvent(new w.Event('input', { bubbles: true }));
  click(w, w.document.getElementById('modalOk'));
  const s = app.Store.getShows()[0];
  ok(s.coverType === 'url', '封面类型为 url');
  ok(s.coverUrl === 'https://example.com/p.jpg', '封面 URL 已保存');
});

/* =========================================================================
   观影模块 —— G 兼容（不干扰记账）
   ========================================================================= */
test('观影G 新增观影数据不影响记账 / 金库 / 预算', (w) => {
  const app = w.__app;
  app.Store.reset();
  const monthKey = app.monthStr();
  // 记一笔账 + 设预算 + 调金库
  app.Store.addTransaction({ id: 'gx1', type: 'expense', amount: 25, category: '奶茶', account: 'wechat', date: app.todayStr(), createdAt: Date.now() });
  app.Store.setLimit(monthKey, 1200);
  app.Store.adjustVault('wechat_change', 100);
  const txBefore = app.Store.data.transactions.length;
  const limitBefore = app.Store.getLimit(monthKey);
  const vaultBefore = app.Store.data.vault.wechat_change;

  // 大量的观影操作
  const s = app.Store.addShow({ title: '兼容剧', status: 'watching', currentSeasonEpisodes: 10 });
  app.Store.updateProgress(s.id, 1, 1);
  app.Store.updateProgress(s.id, 1, 2);
  app.Store.changeShowStatus(s.id, 'paused');
  app.Store.finishShow(s.id);
  app.Store.addShow({ title: '另一部' });

  ok(app.Store.data.transactions.length === txBefore, '交易记录数量不变');
  ok(app.Store.getLimit(monthKey) === limitBefore, '预算不变');
  ok(app.Store.data.vault.wechat_change === vaultBefore, '金库余额不变');
  ok(app.Store.data.shows.length === 2, '观影数据独立存在');
});

test('观影G 导出 / 导入保留观影数据', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '导出剧', genre: '科幻', status: 'watching', currentSeasonEpisodes: 8 });
  app.Store.updateProgress(s.id, 2, 3);
  const snapshot = JSON.parse(JSON.stringify(app.Store.data));
  ok(Array.isArray(snapshot.shows) && snapshot.shows.length === 1, '快照包含剧集');
  ok(snapshot.shows[0].title === '导出剧', '标题正确');
  ok(snapshot.watchLogs.length >= 1, '快照包含观看记录');
  // 模拟导入：清空后回填
  app.Store.reset();
  ok(app.Store.getShows().length === 0, '重置后无剧集');
  app.Store.data = snapshot;
  app.Store.migrate();
  app.Store.sanitize();
  app.Store.save();
  ok(app.Store.getShows().length === 1, '导入后剧集恢复');
  ok(app.Store.getShows()[0].season === 2 && app.Store.getShows()[0].episode === 3, '进度恢复');
});

/* =========================================================================
   观影模块 —— H 云同步
   ========================================================================= */
test('观影H 观影数据随快照进入云同步 payload', (w) => {
  const app = w.__app;
  app.Store.reset();
  app.Store.addShow({ title: '云同步剧', status: 'watching' });
  // cloudPush/cloudPull 传的是整个 Store.data，验证序列化后包含 shows
  const payload = JSON.parse(JSON.stringify(app.Store.data));
  ok(Array.isArray(payload.shows) && payload.shows.length === 1, 'payload 含 shows');
  ok(Array.isArray(payload.watchLogs), 'payload 含 watchLogs');
  ok(payload.version === 4, 'payload 版本为 4');
});

test('观影H 本地封面仅同步 key（二进制不上云）', (w) => {
  const app = w.__app;
  app.Store.reset();
  const s = app.Store.addShow({ title: '云端封面剧' });
  app.Store.updateShow(s.id, { coverType: 'local', coverKey: 'img_cloud_1' });
  const payload = JSON.stringify(app.Store.data);
  ok(payload.indexOf('img_cloud_1') > -1, 'payload 含封面 key');
  ok(payload.indexOf('data:image') === -1, 'payload 不含图片二进制（Base64）');
});

test('观影H 云端拉取后 renderShows 可正常降级渲染（无本机图）', (w) => {
  const app = w.__app;
  app.Store.reset();
  // 模拟从云端拉回的、本机没有对应图片的剧集
  app.Store.data.shows = [{ id: 'cloud1', title: '云端剧', status: 'watched', coverType: 'local', coverKey: 'missing_key' }];
  app.Store.sanitize();
  let threw = false;
  try { app.renderShows(); } catch (e) { threw = true; }
  ok(!threw, 'renderShows 不抛错');
  ok(!!w.document.querySelector('.poster-card[data-id="cloud1"]'), '卡片正常渲染');
  ok(!!w.document.querySelector('.cover-ph') || !!w.document.querySelector('[data-cover-key]'), '缺图走占位或延迟回填');
});

/* =========================================================================
   运行
   ========================================================================= */
console.log('个人生活助手 —— 端到端测试');
console.log('时间：' + new Date().toLocaleString('zh-CN'));

const only = process.argv[2]; // 可指定只跑某个用例关键词

/* 顺序执行，支持 async 用例（await 后再关闭 jsdom，避免断言丢失） */
(async () => {
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    if (only && !t.name.includes(only)) continue;
    section(`[${i + 1}] ${t.name}`);
    let w;
    try {
      w = boot();
      await t.fn(w);
    } catch (e) {
      fail++;
      failures.push(t.name + ' 抛出异常: ' + e.message);
      console.log('  \u2717 用例异常: ' + e.message);
      if (process.env.DEBUG) console.log(e.stack);
    } finally {
      if (w) w.close();
    }
  }

  console.log('\n========================================');
  console.log(`结果：通过 ${pass} / 失败 ${fail}`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})();
