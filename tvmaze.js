/* =========================================================================
   TVmaze 剧集信息查询（只读公开 API，免密钥）
   ---------------------------------------------------------------------
   设计要点：
   1. **永不 reject** —— 所有函数在失败时返回 [] 或 { ok:false }，
      调用方无需 try/catch，界面永远可继续手动填写。
   2. **超时保护** —— 用 AbortController 给请求设上限；
      运行环境缺少 AbortController 时自动跳过超时（不影响主流程）。
   3. **纯函数分离** —— 映射/去标签为纯函数，便于单元测试。
   API 文档：https://www.tvmaze.com/api
   ========================================================================= */

'use strict';

var TVMAZE_BASE = 'https://api.tvmaze.com';
/** 单次请求超时（毫秒）。校园网访问外网不稳定，给足时间但不宜过久 */
var TVMAZE_TIMEOUT_MS = 8000;
/** 搜索结果最多展示条数（避免弹窗过长） */
var TVMAZE_SEARCH_LIMIT = 12;

/* -------------------------------------------------------------------------
   内部小工具：与 app.js 的同名函数语义一致。
   这里自带一份，是为了让本模块能独立加载与单元测试（不依赖 app.js 先执行）；
   浏览器里 app.js 的同名函数在同一作用域，语义相同，不冲突。
   ------------------------------------------------------------------------- */

/** 字符串兜底：非字符串一律返回 '' */
function tvSafeStr(v) {
  return typeof v === 'string' ? v : '';
}

/** 可空正整数：空/非法 → null（绝不虚构） */
function tvOptPositiveInt(v) {
  if (v == null || v === '') return null;
  var n = Math.floor(Number(v));
  return isFinite(n) && n >= 1 ? n : null;
}

/**
 * 去 HTML 标签并解码常见实体（TVmaze 的 summary 是 HTML 串）。
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  if (html == null) return '';
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 统一 GET 请求。永不 reject。
 * @param {string} path 以 / 开头的路径，如 '/search/shows?q=xxx'
 * @returns {Promise<{ok:boolean, data:*, error:string, aborted:boolean}>}
 */
function tvmazeGet(path) {
  var url = TVMAZE_BASE + path;
  var controller = null;
  var timer = null;
  try {
    if (typeof AbortController !== 'undefined') controller = new AbortController();
  } catch (e) {
    controller = null;
  }

  var options = {};
  if (controller) options.signal = controller.signal;

  var req;
  try {
    req = fetch(url, options);
  } catch (e) {
    return Promise.resolve({ ok: false, data: null, error: '网络请求发起失败', aborted: false });
  }

  if (controller) {
    timer = setTimeout(function () {
      try { controller.abort(); } catch (e) { /* 忽略 */ }
    }, TVMAZE_TIMEOUT_MS);
  }

  return req.then(function (res) {
    if (timer) clearTimeout(timer);
    if (!res || !res.ok) {
      return { ok: false, data: null, error: '服务返回 ' + ((res && res.status) || '错误'), aborted: false };
    }
    return res.json().then(function (data) {
      return { ok: true, data: data, error: '', aborted: false };
    }, function () {
      return { ok: false, data: null, error: '返回内容解析失败', aborted: false };
    });
  }, function (err) {
    if (timer) clearTimeout(timer);
    var aborted = !!(err && (err.name === 'AbortError' || err.aborted));
    return {
      ok: false,
      data: null,
      error: aborted ? '请求超时，请稍后重试' : '无法连接 TVmaze',
      aborted: aborted,
    };
  });
}

/** 把 TVmaze 的 show 对象裁剪成界面需要的精简结构 */
function mapTvmazeShow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var name = tvSafeStr(raw.name).trim();
  if (!name) return null;
  var premiered = tvSafeStr(raw.premiered);
  var rating = raw.rating && raw.rating.average;
  var image = raw.image || {};
  var genres = Array.isArray(raw.genres) ? raw.genres.filter(function (g) { return typeof g === 'string' && g; }) : [];
  return {
    id: String(raw.id == null ? '' : raw.id),
    name: name,
    premiered: premiered,
    year: /^\d{4}/.test(premiered) ? Number(premiered.slice(0, 4)) : null,
    rating: typeof rating === 'number' && isFinite(rating) ? Math.round(rating * 10) / 10 : null,
    genres: genres,
    genreText: genres.join(' / '),
    image: tvSafeStr(image.medium) || tvSafeStr(image.original),
    summary: stripHtml(raw.summary),
    url: tvSafeStr(raw.url),
  };
}

/**
 * 搜索剧集。失败返回 []（永不 reject）。
 * @param {string} query
 * @returns {Promise<Array>}
 */
function tvmazeSearchShows(query) {
  var q = tvSafeStr(query).trim();
  if (!q) return Promise.resolve([]);
  return tvmazeGet('/search/shows?q=' + encodeURIComponent(q)).then(function (r) {
    if (!r.ok || !Array.isArray(r.data)) return [];
    var out = [];
    for (var i = 0; i < r.data.length && out.length < TVMAZE_SEARCH_LIMIT; i++) {
      var item = r.data[i];
      var mapped = mapTvmazeShow(item && item.show);
      if (mapped) out.push(mapped);
    }
    return out;
  }, function () { return []; });
}

/** 取某剧的全部季。失败返回 []。 */
function tvmazeGetSeasons(showId) {
  var id = tvSafeStr(showId).trim();
  if (!id) return Promise.resolve([]);
  return tvmazeGet('/shows/' + encodeURIComponent(id) + '/seasons').then(function (r) {
    if (!r.ok || !Array.isArray(r.data)) return [];
    var out = [];
    r.data.forEach(function (s) {
      if (!s || typeof s !== 'object') return;
      var num = tvOptPositiveInt(s.number);
      if (num == null) return;
      var img = s.image || {};
      var order = tvOptPositiveInt(s.episodeOrder);
      out.push({
        number: num,
        premiereDate: tvSafeStr(s.premiereDate),
        endDate: tvSafeStr(s.endDate),
        episodeOrder: order,                        // 可能为 null（集数未知）
        image: tvSafeStr(img.medium) || tvSafeStr(img.original),
        label: '第 ' + num + ' 季',
        epText: order != null ? order + ' 集' : '集数未知',
      });
    });
    return out;
  }, function () { return []; });
}

/**
 * 组合标题：名称为主，季号 ≥2 时直接追加数字。
 *   第 1 季 → 「进击的巨人」
 *   第 3 季 → 「进击的巨人3」
 */
function tvmazeSeasonTitle(name, seasonNumber) {
  var base = tvSafeStr(name).trim();
  var n = tvOptPositiveInt(seasonNumber);
  if (n == null || n <= 1) return base;
  return base + n;
}

/* -------------------------------------------------------------------------
   中文标题（别名）处理
   -------------------------------------------------------------------------
   TVmaze 的 show.name 基本是英文原名，但 /shows/:id/akas 里带各国别名，
   其中 country.code === 'CN' 的即中文名（如「进击的巨人」「绝命毒师」）。
   注意：简体与繁体都会标 CN（同一部剧可能同时有「绝命毒师」和「絕命毒師」），
   所以优先挑含简体特有字符的那条，挑不到就取第一条 CN 别名。
   ------------------------------------------------------------------------- */

/** 简体特有字符（繁体写法里不会出现的字形）。命中即认为该别名是简体 */
var TV_SIMPLIFIED_HINTS = /[击绝师学国岁无开关门东车马鸟风飞龙云台应发识让议单双书长电见说体听觉]|剧|节|总|历|际|罗|发|后/;

/**
 * 纯函数：从 TVmaze 的 akas 数组里挑出中文名。
 * 处理三种常见形态：
 *   1. 同一部剧有「简体」「繁体」两条 CN 别名 → 取简体那条；
 *   2. 只有一条 CN 别名但内容是「简体 / 繁体」 → 取斜杠左边；
 *   3. 只有繁体 → 原样返回（聊胜于无，用户可自行改）。
 * @param {Array} akas /shows/:id/akas 的返回体
 * @returns {string} 中文名；没有则返回 ''
 */
function pickChineseAka(akas) {
  if (!Array.isArray(akas)) return '';
  var cnList = [];
  for (var i = 0; i < akas.length; i++) {
    var a = akas[i];
    if (!a || typeof a !== 'object') continue;
    var country = a.country || {};
    if (!country || country.code !== 'CN') continue;
    var name = tvSafeStr(a.name).trim();
    // TVmaze 的 CN 别名里混有纯拼音（如琅琊榜 → 'Lang ya bang'），那不是中文名，丢掉
    if (name && /[\u4e00-\u9fa5]/.test(name)) cnList.push(name);
  }
  if (!cnList.length) return '';

  // 形态 1：多条 CN 别名 → 优先含简体特有字形的
  for (var j = 0; j < cnList.length; j++) {
    if (TV_SIMPLIFIED_HINTS.test(cnList[j])) return stripTradHalf(cnList[j]);
  }
  // 形态 2 / 3：取第一条（内部再做一次「简 / 繁」拆分）
  return stripTradHalf(cnList[0]);
}

/**
 * 内部：把「简体 / 繁体」这类合并别名裁成简体那半。
 * 只在能明确判断左右两侧、且右侧看起来像繁体时才裁，避免误伤
 * 「A / B」这种真正的并列剧名。
 */
function stripTradHalf(name) {
  var s = tvSafeStr(name).trim();
  if (s.indexOf('/') < 0) return s;
  var parts = s.split('/').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
  if (parts.length < 2) return s;
  // 若后一段含繁体字形，前一段又含简体字形 → 认定是「简 / 繁」合并，取简体
  var tradHint = /[絕師學國歲無開關門東車馬鳥風飛龍雲臺應發識讓議單雙書長電見說體聽覺劇節總歷際羅後擊]/;
  if (tradHint.test(parts[1]) && TV_SIMPLIFIED_HINTS.test(parts[0])) return parts[0];
  return s;
}

/**
 * 取某剧的中文名。失败/无中文名一律返回 ''（永不 reject）。
 * @param {string} showId
 * @returns {Promise<string>}
 */
function tvmazeGetChineseTitle(showId) {
  var id = tvSafeStr(showId).trim();
  if (!id) return Promise.resolve('');
  return tvmazeGet('/shows/' + encodeURIComponent(id) + '/akas').then(function (r) {
    if (!r.ok) return '';
    return pickChineseAka(r.data);
  }, function () { return ''; });
}

/**
 * 纯函数：把「剧 + 某一季」转成可直接写入表单的字段对象。
 * @param {object} show   mapTvmazeShow 的产物
 * @param {object} season tvmazeGetSeasons 的产物
 * @param {string} [chineseName] 该剧的中文名；有则优先作为标题
 * @returns {object}
 */
function tvmazeSeasonToFields(show, season, chineseName) {
  if (!show) return {};
  var s = season || {};
  var cn = tvSafeStr(chineseName).trim();
  var baseName = cn || tvSafeStr(show.name).trim();
  var title = tvmazeSeasonTitle(baseName, s.number);
  // 海报优先用该季自己的；没有则退回剧集主海报
  var cover = tvSafeStr(s.image) || tvSafeStr(show.image);
  return {
    title: title,
    // 标题已是中文名，不再把英文原名写进「原文标题」——用户要的是中文，保持整洁
    originalTitle: '',
    year: s.premiereDate && /^\d{4}/.test(s.premiereDate)
      ? Number(s.premiereDate.slice(0, 4))
      : (show.year != null ? show.year : ''),
    genre: show.genreText || '',
    rating: show.rating != null ? show.rating : '',
    summary: show.summary || '',
    currentSeasonEpisodes: s.episodeOrder != null ? s.episodeOrder : '',
    coverUrl: cover || '',
    externalId: show.id || '',
  };
}

/**
 * 把字段写入表单 —— **只填空，绝不覆盖用户已写内容**。
 * 注意：白名单里没有 showNote，所以「观后感 / 备注」在任何情况下都不会被触碰。
 * @param {object} fields tvmazeSeasonToFields 的产物
 * @param {object} [state] 封面选择器状态（传入则同步更新封面）
 * @returns {string[]} 实际被填写的字段标签，便于给用户反馈
 */
function applyTvmazeFields(fields, state) {
  if (!fields || typeof fields !== 'object') return [];
  var filled = [];
  var setIfEmpty = function (id, val, label) {
    var el = document.getElementById(id);
    if (!el) return;
    if (String(el.value || '').trim() !== '') return;   // 已有内容 → 跳过，不覆盖
    if (val == null || val === '') return;
    el.value = val;
    filled.push(label);
  };

  setIfEmpty('showTitle', fields.title, '标题');
  setIfEmpty('showOriginalTitle', fields.originalTitle, '原文标题');
  setIfEmpty('showYear', fields.year, '年份');
  setIfEmpty('showGenre', fields.genre, '类型');
  setIfEmpty('showRating', fields.rating, '评分');
  setIfEmpty('showSummary', fields.summary, '简介');
  setIfEmpty('showSeasonEpisodes', fields.currentSeasonEpisodes, '本季总集数');

  // 封面：仅当当前是「无封面」时才采用 TVmaze 海报，不动用户已选的封面
  if (state && fields.coverUrl && state.type === 'none') {
    state.type = 'url';
    state.url = fields.coverUrl;
    state.key = '';
    filled.push('封面');
  }
  return filled;
}

/* 暴露到全局，供浏览器与测试环境访问 */
if (typeof window !== 'undefined') {
  window.TVmaze = {
    TVMAZE_BASE: TVMAZE_BASE,
    stripHtml: stripHtml,
    tvmazeGet: tvmazeGet,
    mapTvmazeShow: mapTvmazeShow,
    tvmazeSearchShows: tvmazeSearchShows,
    tvmazeGetSeasons: tvmazeGetSeasons,
    tvmazeSeasonTitle: tvmazeSeasonTitle,
    pickChineseAka: pickChineseAka,
    stripTradHalf: stripTradHalf,
    tvmazeGetChineseTitle: tvmazeGetChineseTitle,
    tvmazeSeasonToFields: tvmazeSeasonToFields,
    applyTvmazeFields: applyTvmazeFields,
  };
}
