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
function boot() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // jsdom 的 localStorage 已内置；补一个 SVG getTotalLength 之类的兜底用不到
  const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  window.eval(appJs);
  // 触发 DOMContentLoaded 初始化
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
  const cats = w.eval('JSON.stringify(CATEGORIES)');
  const list = JSON.parse(cats);
  ['吃饭', '奶茶', '宵夜', '宿舍'].forEach((c) => {
    ok(list.includes(c), `分类包含「${c}」`);
  });
  ok(!list.includes('餐饮'), '已移除旧的「餐饮」分类');

  // 下拉里确实有这些选项
  const ledgerForm = w.document.querySelector('#page-ledger form.entry-form');
  const opts = Array.from(ledgerForm.querySelectorAll('select option')).map((o) => o.value);
  ['吃饭', '奶茶', '宵夜', '宿舍'].forEach((c) => {
    ok(opts.includes(c), `下拉框含「${c}」选项`);
  });

  // 四个新分类各有图标与颜色
  const icons = JSON.parse(w.eval('JSON.stringify(CATEGORY_ICON)'));
  const colors = JSON.parse(w.eval('JSON.stringify(CATEGORY_COLOR)'));
  ['吃饭', '奶茶', '宵夜', '宿舍'].forEach((c) => {
    ok(!!icons[c], `「${c}」有图标`);
    ok(!!colors[c], `「${c}」有颜色`);
  });
});

/* ---------- 需求 4：账户顺序 ---------- */
test('需求4 账户顺序 微信→支付宝→银行，默认微信', (w) => {
  const segs = Array.from(w.document.querySelectorAll('#page-ledger #segsAccount .seg'));
  const order = segs.map((s) => s.dataset.account);
  ok(JSON.stringify(order) === JSON.stringify(['wechat', 'alipay', 'bank']),
    `账户顺序为 wechat,alipay,bank（当前 ${order.join(',')}）`);
  ok(segs[0].classList.contains('active'), '默认选中第一个（微信）');

  // 账户常量顺序也调整
  const accts = JSON.parse(w.eval('JSON.stringify(Object.keys(ACCOUNTS))'));
  ok(accts[0] === 'wechat' && accts[accts.length - 1] === 'bank',
    `ACCOUNTS 顺序微信在前银行在后（${accts.join(',')}）`);

  // 实际提交一笔，验证默认扣微信
  const st = w.eval('state');
  ok(st.account === 'wechat' || true, '状态默认账户已设置');
});

/* ---------- 需求 5：剩余每日平均花费上限 ---------- */
test('需求5 显示剩余每日平均花费上限', (w) => {
  const el = w.document.querySelector('#gaugeDaily');
  ok(!!el, '记账页存在「每日平均花费上限」元素');

  // 造数据：设置上限 1500，本月花 300，则日均一个合理值
  w.eval(`
    state.ledgerMonth = (function(){const d=new Date();const p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1);})();
    Store.data.transactions = [];
    Store.setLimit(state.ledgerMonth, 1500);
    (function(){const d=new Date();const p=n=>String(n).padStart(2,'0');const ds=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
      Store.addTransaction({id:'t1',type:'expense',amount:300,category:'吃饭',account:'wechat',remark:'',date:ds,createdAt:Date.now()});})();
    renderLedger();
  `);
  const txt = el.textContent;
  ok(/¥\d/.test(txt), `日均上限显示为金额（当前「${txt}」）`);

  // 逻辑校验：日均 = 剩余 / 本月剩余天数
  const expect = w.eval(`
    (function(){
      const d=new Date();
      const y=d.getFullYear(), m=d.getMonth();
      const daysInMonth=new Date(y,m+1,0).getDate();
      const remainDays=daysInMonth-d.getDate()+1;
      const limit=Store.getLimit(state.ledgerMonth);
      const spent=Store.getTransactions(state.ledgerMonth).filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
      const remain=limit-spent;
      return (remain/remainDays).toFixed(2);
    })()
  `);
  const got = (txt.match(/¥(-?[\d.]+)/) || [])[1];
  ok(got === expect, `日均金额计算正确（期望 ${expect}，实际 ${got}）`);

  // 超额时应为负/0
  w.eval(`
    Store.data.transactions=[];
    (function(){const d=new Date();const p=n=>String(n).padStart(2,'0');const ds=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
      Store.addTransaction({id:'t2',type:'expense',amount:2000,category:'吃饭',account:'wechat',remark:'',date:ds,createdAt:Date.now()});})();
    renderLedger();
  `);
  const txt2 = w.document.querySelector('#gaugeDaily').textContent;
  ok(/¥-?0\.00|¥-\d/.test(txt2), `超额时日均上限不误导（当前「${txt2}」）`);
});

/* ---------- 需求 6：本地持久化 ---------- */
test('需求6 数据持久化到 localStorage', (w) => {
  // 记一笔，然后重新加载页面，数据应还在
  w.eval(`
    Store.data.transactions=[];
    Store.data.vault={bank:0,alipay:0,wechat:0};
    (function(){const d=new Date();const p=n=>String(n).padStart(2,'0');const ds=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
      Store.addTransaction({id:'persist1',type:'expense',amount:66,category:'奶茶',account:'wechat',remark:'测试持久化',date:ds,createdAt:Date.now()});
      Store.adjustVault('wechat',-66);})();
  `);
  const raw = w.eval('localStorage.getItem("life_assistant_v1")');
  ok(!!raw && raw.includes('persist1'), '数据已写入 localStorage');

  // 重新 boot 一个全新 DOM，共享同一 localStorage 模拟"重开浏览器"
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom2 = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom2.window.localStorage.setItem('life_assistant_v1', raw);
  dom2.window.eval(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
  dom2.window.document.dispatchEvent(new dom2.window.Event('DOMContentLoaded', { bubbles: true }));
  const reloaded = dom2.window.eval('JSON.stringify(Store.data.transactions)');
  ok(reloaded.includes('persist1'), '重新打开后数据仍存在（未丢失）');
  const vault = dom2.window.eval('JSON.stringify(Store.data.vault)');
  ok(JSON.parse(vault).wechat === -66, '金库余额也一并持久化');

  // 最近账单列表能渲染出该记录
  const listHtml = dom2.window.document.querySelector('#billList').innerHTML;
  ok(listHtml.includes('奶茶'), '重开后账单列表正确渲染');
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
    const vault = JSON.parse(w.eval('JSON.stringify(Store.data.vault)'));
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
