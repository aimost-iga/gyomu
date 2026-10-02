// 業務管理アプリ本体：今日（予定・開始/終了・反響対応・配布・日報）／成績／チーム／設定
// 表はゲームのように楽しく、裏では時間あたりの生産性と入力漏れをきっちり見る。
(function(){
'use strict';

// ---------- 決まりごと ----------
const KIND = { door: '訪販', call: '反響対応', post: '配布', other: '事務・その他' };
const KIND_ORDER = ['door', 'call', 'post', 'other'];
const KC = { door: 'var(--k-door)', call: 'var(--k-call)', post: 'var(--k-post)', other: 'var(--k-other)' };
const HAN = [['call', '電話した', ''], ['msg', 'メッセージだけ', '電話せず文字で対応'], ['conn', 'つながった', '話せた'], ['apo', 'アポ・提案', '提案まで進んだ'], ['inv', '無効', 'いたずら・対象外など'], ['got', '獲得', '申込まで']];
const POST_TY = ['分譲', '賃貸', '混在'];
const GOAL_DEF = { std: 6, door: 60, face: 10, call: 15, post: 500, got: 1, monthGot: 20 };
const PT = { door: 1, face: 3, got: 30, call: 2, msg: 1, conn: 1, apo: 3, post100: 2 };
const PT_TEXT = '訪問1・対面3・獲得30・反響の電話2・メッセージ1・つながった1・アポ3・配布100枚で2';
const RANKS = [[0, '見習い'], [300, '駆け出し'], [800, '一人前'], [1500, '腕利き'], [2500, '達人'], [4000, '名人'], [6000, '伝説']];
const FACE = ['fng', 'again', 'got'];
const WEEK = '日月火水木金土';
const MAP_URL = 'https://aimost-iga.github.io/houmon-map/';
// スマホのお知らせの鍵（公開してよい鍵。設定画面で差し替え可）
const VAPID = 'BL-8TMM-bqpyBIN-ASgKrLvFG2GN30s3M6I47dm1-L6kN0rDC8ZT31t9nYtV5EvxqkGzIxGpllxX3oE0LK9Uwuw';
// 称号（取ると自分の画面に並ぶ）
const TITLES = [
  ['first', '一', 'はじめの一歩', '初めて日報を出す', a => a.subs >= 1],
  ['s7', '7', '1週間皆勤', '7日連続で日報', a => a.bestStreak >= 7],
  ['s30', '30', '鉄の意志', '30日連続で日報', a => a.bestStreak >= 30],
  ['early', '朝', '朝イチ', '9時台までに開始 10日', a => a.early >= 10],
  ['d100', '百', '100部屋', '累計訪問100', a => a.doors >= 100],
  ['d1000', '千', '千部屋', '累計訪問1,000', a => a.doors >= 1000],
  ['dd80', '走', '一日80部屋', '1日で訪問80', a => a.maxDoors >= 80],
  ['f15', '顔', '対面の達人', '1日で対面15', a => a.maxFace >= 15],
  ['g1', '初', '初獲得', '獲得1件', a => a.got >= 1],
  ['gd3', '三', '1日3件', '1日で獲得3', a => a.maxGot >= 3],
  ['gm10', '十', '月10件', '1か月で獲得10', a => a.maxMonthGot >= 10],
  ['c100', '電', '電話番長', '反響の対応 累計100', a => a.han >= 100],
  ['apo30', '提', '提案の鬼', 'アポ・提案 累計30', a => a.apo >= 30],
  ['p10k', '紙', '一万枚', '配布 累計10,000枚', a => a.post >= 10000],
  ['ok10', '的', 'お題ハンター', 'お題達成 10日', a => a.ok >= 10],
  ['ok5', '連', '5連続達成', 'お題を5日連続で達成', a => a.bestOkRow >= 5],
  ['best', '星', '自己ベスト', '自己最高の点を更新', a => a.bestUp >= 1]
];

// ---------- 小さな道具 ----------
const $ = s => document.querySelector(s);
const el = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const pad = n => String(n).padStart(2, '0');
const ymd = t => { const d = new Date(t); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); };
const toDate = s => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return ymd(d); };
const clock = ms => { ms = Math.max(0, ms); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${h}:${pad(m)}:${pad(s)}`; };
const hm = ms => { ms = Math.max(0, ms); const h = Math.floor(ms / 3600000), m = Math.round(ms / 60000) % 60; return h ? `${h}時間${m ? m + '分' : ''}` : `${m}分`; };
const h1 = ms => (ms / 3600000).toFixed(1);
const toMin = t => { if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null; const [a, b] = t.split(':').map(Number); return a * 60 + b; };
const timeOf = ms => { const d = new Date(ms); return `${d.getHours()}:${pad(d.getMinutes())}`; };
const md = s => { const d = toDate(s); return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const nf = n => (+n || 0).toLocaleString();
const store = { get(k, d){ try { const v = localStorage.getItem('gy_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v){ try { localStorage.setItem('gy_' + k, JSON.stringify(v)); } catch (e) {} } };
let toastT = 0;
function toast(m){ const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2800); }

// ---------- 状態 ----------
let FB = null, ME = null;
const S = {
  tab: 'today', today: '', yday: '', tmr: '',
  doc: null, ydoc: null, tdoc: null, acts: [], goal: Object.assign({}, GOAL_DEF), quest: null, reward: null, appcfg: {},
  mine: null, team: null, teamKey: '', week: null, qteam: null, qkey: '', users: null, pushAll: null, ntc: {},
  period: 'today', draft: null, editing: false, editRep: false, open: {}, pending: false, unsub: [], pushState: ''
};

// ---------- 数字の計算 ----------
function actOf(u){ const out = []; for (const d of S.acts) for (const k in d) { const v = d[k]; if (v && v.t && !v.x && v.r && v.u === u) out.push(v); } return out; }
function visits(list){ const v = { doors: 0, face: 0, got: 0 }; for (const x of list) { v.doors++; if (FACE.includes(x.r)) v.face++; if (x.r === 'got') v.got++; } return v; }
function statOf(doc, live, u){
  doc = doc || {};
  const now = Date.now();
  const h = { door: 0, call: 0, post: 0, other: 0 };
  let running = null, first = null;
  for (const id in (doc.ses || {})) {
    const s = doc.ses[id]; if (!s || !s.st) continue;
    const en = s.en || (live ? now : s.st);
    h[s.k] = (h[s.k] || 0) + Math.max(0, en - s.st);
    if (!s.en) running = Object.assign({ id }, s);
    if (first == null || s.st < first) first = s.st;
  }
  const v = live ? visits(actOf(u || doc.u || ME.id)) : Object.assign({ doors: 0, face: 0, got: 0 }, doc.v || {});
  const han = { call: 0, msg: 0, conn: 0, apo: 0, inv: 0, got: 0 };
  for (const id in (doc.han || {})) { const r = doc.han[id] || {}; for (const [k] of HAN) han[k] += +r[k] || 0; }
  han.all = han.call + han.msg;
  let post = 0; const postBy = {};
  for (const id in (doc.post || {})) { const p = doc.post[id] || {}; post += +p.n || 0; postBy[p.ty || '混在'] = (postBy[p.ty || '混在'] || 0) + (+p.n || 0); }
  const got = v.got + han.got;
  const work = h.door + h.call + h.post + h.other;
  const pts = (+doc.bonus || 0) + v.doors * PT.door + v.face * PT.face + got * PT.got + han.call * PT.call + han.msg * PT.msg + han.conn * PT.conn + han.apo * PT.apo + Math.floor(post / 100) * PT.post100;
  const plan = Object.entries(doc.plan || {}).map(([id, p]) => Object.assign({ id }, p)).sort((a, b) => (toMin(a.s) || 0) - (toMin(b.s) || 0));
  const ph = { door: 0, call: 0, post: 0, other: 0 };
  for (const p of plan) { const a = toMin(p.s), b = toMin(p.e); if (a != null && b != null && b > a) ph[p.k] = (ph[p.k] || 0) + (b - a) * 60000; }
  return { h, work, running, first, v, han, post, postBy, got, pts, plan, ph, off: !!doc.off, sub: doc.sub || 0, has: !!(plan.length || work) };
}
function targetsOf(st){
  const g = S.goal, out = [];
  const hrs = k => (st.ph[k] || st.h[k] || 0) / 3600000;
  const sc = k => hrs(k) / (g.std || 6);
  const n = (b, s) => Math.max(1, Math.round(b * s));
  if (hrs('door') > 0) { out.push({ label: '訪問', val: st.v.doors, tgt: n(g.door, sc('door')) }); out.push({ label: '対面', val: st.v.face, tgt: n(g.face, sc('door')) }); }
  if (hrs('call') > 0) out.push({ label: '反響の対応', val: st.han.all, tgt: n(g.call, sc('call')) });
  if (hrs('post') > 0) out.push({ label: '配布枚数', val: st.post, tgt: n(g.post, sc('post')) });
  if (hrs('door') > 0 || hrs('call') > 0) out.push({ label: '獲得', val: st.got, tgt: n(g.got, sc('door') + sc('call')) });
  return out;
}
const achieved = ts => ts.length > 0 && ts.every(t => t.val >= t.tgt);
function rankOf(p){ let i = 0; for (let j = 0; j < RANKS.length; j++) if (p >= RANKS[j][0]) i = j; return { name: RANKS[i][1], base: RANKS[i][0], next: RANKS[i + 1] || null }; }
function myDays(){
  const m = {}; for (const d of (S.mine || [])) if (d && d.d) m[d.d] = d;
  if (S.doc) m[S.today] = S.doc; if (S.ydoc) m[S.yday] = S.ydoc; if (S.tdoc) m[S.tmr] = S.tdoc;
  return m;
}
function sumRange(days, from, to, u){
  const t = { h: { door: 0, call: 0, post: 0, other: 0 }, work: 0, doors: 0, face: 0, doorGot: 0, got: 0, post: 0, han: 0, call: 0, conn: 0, apo: 0, hgot: 0, pts: 0, days: 0, ok: 0, subs: 0, off: 0 };
  for (const d in days) {
    if (d < from || d > to) continue;
    const st = statOf(days[d], d === S.today, u);
    for (const k in t.h) t.h[k] += st.h[k];
    t.work += st.work; t.doors += st.v.doors; t.face += st.v.face; t.doorGot += st.v.got; t.got += st.got; t.post += st.post;
    t.han += st.han.all; t.call += st.han.call; t.conn += st.han.conn; t.apo += st.han.apo; t.hgot += st.han.got; t.pts += st.pts;
    if (st.work || st.v.doors) t.days++; if (st.sub) t.subs++; if (st.off) t.off++;
    if (achieved(targetsOf(st))) t.ok++;
  }
  return t;
}
const okDay = d => d && (d.sub || d.off);
function streak(days){
  let n = okDay(days[S.today]) ? 1 : 0;
  for (let i = 1; i < 500; i++) { if (okDay(days[addDays(S.today, -i)])) n++; else break; }
  return n;
}
const monthStart = s => s.slice(0, 6) + '01';
function weekStart(s){ const d = toDate(s); return addDays(s, -((d.getDay() + 6) % 7)); }
function lastMonthSame(s){ const d = toDate(s); const a = new Date(d.getFullYear(), d.getMonth() - 1, 1); const last = new Date(d.getFullYear(), d.getMonth(), 0).getDate(); return [ymd(a), ymd(new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), last)))]; }
// 称号の判定に使う、全期間のまとめ
function lifetime(days){
  const a = { subs: 0, bestStreak: 0, early: 0, doors: 0, maxDoors: 0, maxFace: 0, got: 0, maxGot: 0, maxMonthGot: 0, han: 0, apo: 0, post: 0, ok: 0, bestOkRow: 0, bestUp: 0 };
  const ds = Object.keys(days).filter(d => d <= S.today).sort();
  let run = 0, okRow = 0, prev = null, best = 0; const mg = {};
  for (const d of ds) {
    const doc = days[d], st = statOf(doc, d === S.today);
    if (st.sub) a.subs++;
    if (prev && addDays(prev, 1) !== d) run = 0;
    run = okDay(doc) ? run + 1 : 0; a.bestStreak = Math.max(a.bestStreak, run);
    if (st.first && new Date(st.first).getHours() < 10) a.early++;
    a.doors += st.v.doors; a.maxDoors = Math.max(a.maxDoors, st.v.doors); a.maxFace = Math.max(a.maxFace, st.v.face);
    a.got += st.got; a.maxGot = Math.max(a.maxGot, st.got); mg[d.slice(0, 6)] = (mg[d.slice(0, 6)] || 0) + st.got;
    a.han += st.han.all; a.apo += st.han.apo; a.post += st.post;
    const ok = achieved(targetsOf(st)); if (ok) a.ok++;
    okRow = ok ? okRow + 1 : (st.off || !st.has ? okRow : 0); a.bestOkRow = Math.max(a.bestOkRow, okRow);
    if (best > 0 && st.pts > best) a.bestUp++; best = Math.max(best, st.pts);
    prev = d;
  }
  a.maxMonthGot = Math.max(0, ...Object.values(mg));
  return a;
}

// ---------- 書き込み ----------
function mergeLocal(cur, patch){
  const o = Object.assign({}, cur || {});
  for (const k in patch) { const v = patch[k]; o[k] = (v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object') ? Object.assign({}, o[k], v) : v; }
  return o;
}
async function put(d, patch, quiet){
  const key = d === S.today ? 'doc' : d === S.yday ? 'ydoc' : d === S.tmr ? 'tdoc' : null;
  if (key) S[key] = mergeLocal(S[key] || { u: ME.id, d }, Object.assign({ u: ME.id, d }, patch));
  else if (S.mine) { const i = S.mine.findIndex(x => x.d === d); const n = mergeLocal(i >= 0 ? S.mine[i] : { u: ME.id, d }, patch); if (i >= 0) S.mine[i] = n; else S.mine.push(n); }
  rerender();
  try { await FB.day.patch(d, patch); }
  catch (e) { toast(e && e.code === 'permission-denied' ? '保存できませんでした。管理者に設定を確認してもらってください。' : '保存できませんでした。電波を確認してもう一度お試しください。'); }
  if (!quiet) afterChange();
}
async function drop(d, field, id){
  const key = d === S.today ? 'doc' : d === S.yday ? 'ydoc' : null;
  if (key && S[key] && S[key][field]) { const m = Object.assign({}, S[key][field]); delete m[id]; S[key] = Object.assign({}, S[key], { [field]: m }); }
  rerender();
  try { await FB.day.drop(d, field, id); } catch (e) { toast('消せませんでした。もう一度お試しください。'); }
}
function startWork(k, pid){
  const now = Date.now(); const ses = {};
  const run = statOf(S.doc, true).running;
  if (run) { if (run.k === 'call' || run.k === 'post') { toast(`先に「${KIND[run.k]}」を終了して、結果を入れてください`); stopWork(); return; } ses[run.id] = Object.assign({}, S.doc.ses[run.id], { en: now }); }
  const id = uid(); ses[id] = { k, st: now, en: null }; if (pid) ses[id].pid = pid;
  put(S.today, { ses, off: false }, true);
  ding(1);
  toast(k === 'door' ? '訪販を開始しました。結果は訪問マップで登録してください' : `${KIND[k]}を開始しました。いってらっしゃい！`);
}
function endSession(extra){
  const run = statOf(S.doc, true).running; if (!run) return;
  const now = Date.now();
  put(S.today, Object.assign({ ses: { [run.id]: Object.assign({}, S.doc.ses[run.id], { en: now }) } }, extra || {}));
  toast(`${KIND[run.k]}を終了しました（${hm(now - run.st)}）。おつかれさまです`);
}
function stopWork(){
  const run = statOf(S.doc, true).running; if (!run) return;
  if (run.k === 'call') hanForm(run);
  else if (run.k === 'post') postForm(run);
  else endSession();
}

// ---------- 入力の小窓 ----------
function modal(title, body, onClose){
  const box = el('div', { class: 'mbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, el('h2', { text: title }), body);
  const m = el('div', { class: 'modal', onclick: e => { if (e.target === m) close(); } }, box);
  const close = () => { m.remove(); onClose && onClose(); };
  document.body.append(m);
  return close;
}
function counterField(label, sub, val){
  const inp = el('input', { type: 'number', inputmode: 'numeric', min: 0, value: val || 0, 'aria-label': label });
  const set = d => { inp.value = Math.max(0, (parseInt(inp.value, 10) || 0) + d); };
  const box = el('div', { class: 'cnt' }, el('span', null, label, sub ? el('small', { text: '　' + sub }) : null),
    el('div', { class: 'cc' }, el('button', { type: 'button', class: 'cb', 'aria-label': label + 'を1減らす', onclick: () => set(-1) }, '−'), inp, el('button', { type: 'button', class: 'cb plus', 'aria-label': label + 'を1増やす', onclick: () => set(1) }, '＋')));
  box.val = () => Math.max(0, parseInt(inp.value, 10) || 0);
  return box;
}
// 反響対応の結果（反響対応を終了するとき・あとから追加するとき）
function hanForm(run){
  const f = {}; const grid = el('div', { class: 'cnts' });
  for (const [k, label, sub] of HAN) { f[k] = counterField(label, sub, 0); add(grid, f[k]); }
  const memo = el('textarea', { rows: 2, placeholder: 'ひとことメモ（任意）：どの反響か、次の予定など' });
  const close = modal(run ? '反響対応の結果を入れて終了' : '反響対応の結果を追加', [
    el('div', { class: 'muted', text: run ? `${timeOf(run.st)}から${hm(Date.now() - run.st)}の対応です。LINEでの報告の代わりに、ここに数を入れてください。` : '予定外に対応した分を足します。' }),
    grid, memo,
    el('button', { class: 'btn primary wide', onclick: () => {
      const r = {}; let total = 0; for (const [k] of HAN) { r[k] = f[k].val(); total += r[k]; }
      if (!total && !confirm('対応が0件のまま記録しますか？')) return;
      if (r.conn > r.call + r.msg) { toast('「つながった」は「電話した＋メッセージ」以下にしてください'); return; }
      r.t = Date.now(); if (run) r.sid = run.id; const m = memo.value.trim(); if (m) r.m = m;
      close();
      const patch = { han: { [uid()]: r } };
      if (run) endSession(patch); else { put(S.today, patch); toast('反響対応を記録しました'); }
    } }, run ? '記録して終了する' : '記録する'),
    el('button', { class: 'btn wide', onclick: () => close() }, run ? 'まだ続ける（閉じる）' : 'やめる')
  ]);
}
function areaNames(){
  const s = new Set();
  for (const d of Object.values(myDays())) for (const id in (d.post || {})) if (d.post[id].a) s.add(d.post[id].a);
  return [...s].slice(-40);
}
function postForm(run){
  let ty = store.get('postTy', '分譲');
  const area = el('input', { type: 'text', placeholder: '例：横浜市青葉区 美しが丘', list: 'gyAreas' });
  const dl = el('datalist', { id: 'gyAreas' }, areaNames().map(a => el('option', { value: a })));
  const num = el('input', { type: 'number', inputmode: 'numeric', min: 0, placeholder: '例：400' });
  const chips = el('div', { class: 'chips' });
  const drawChips = () => { chips.textContent = ''; POST_TY.forEach(t => add(chips, el('button', { type: 'button', 'aria-pressed': String(t === ty), onclick: () => { ty = t; store.set('postTy', t); drawChips(); } }, t))); };
  drawChips();
  const close = modal(run ? '配布の結果を入れて終了' : '配布を記録', [
    el('label', { class: 'field' }, '配ったエリア（市区町村・町名）', area, dl),
    el('div', { class: 'field' }, '建物の種類', chips),
    el('label', { class: 'field' }, '配った枚数', num),
    el('button', { class: 'btn primary wide', onclick: () => {
      const n = parseInt(num.value, 10);
      if (!(n >= 0) || num.value === '') { toast('配った枚数を入れてください'); num.focus(); return; }
      if (!area.value.trim() && n > 0) { toast('配ったエリアを入れてください'); area.focus(); return; }
      const p = { a: area.value.trim(), ty, n, t: Date.now() }; if (run) p.sid = run.id;
      close();
      const patch = { post: { [uid()]: p } };
      if (run) endSession(patch); else { put(S.today, patch); toast(`${nf(n)}枚の配布を記録しました`); }
    } }, run ? '記録して終了する' : '記録する'),
    run ? el('div', { class: 'muted', text: '複数のエリアを配ったときは、終了したあと「配布を足す」で残りを入れてください。' }) : null,
    el('button', { class: 'btn wide', onclick: () => close() }, run ? 'まだ続ける（閉じる）' : 'やめる')
  ]);
  setTimeout(() => area.focus(), 50);
}

// ---------- お祝い ----------
let actx = null;
function ding(kind){
  if (!store.get('sound', true)) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 2 ? [523, 659, 784, 1047] : kind === 3 ? [784, 988, 1175, 1568] : [660, 880];
    notes.forEach((f, i) => { const o = actx.createOscillator(), g = actx.createGain(); o.type = 'triangle'; o.frequency.value = f; o.connect(g); g.connect(actx.destination); const t = actx.currentTime + i * .11; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.18, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .35); o.start(t); o.stop(t + .4); });
  } catch (e) {}
}
function confetti(){
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = el('div', { class: 'confetti', 'aria-hidden': 'true' });
  const cols = ['#1B1FA8', '#5CC2F2', '#1f9a55', '#c9920e', '#e0861c', '#d24a3a'];
  for (let i = 0; i < 60; i++) { const s = el('i'); s.style.left = Math.random() * 100 + '%'; s.style.background = cols[i % cols.length]; s.style.animationDelay = Math.random() * .5 + 's'; s.style.animationDuration = 1.6 + Math.random() * 1.3 + 's'; add(box, s); }
  document.body.append(box); setTimeout(() => box.remove(), 3500);
}
const cheerQ = [];
function cheer(icon, title, sub, sound){ cheerQ.push([icon, title, sub, sound]); if (cheerQ.length === 1) nextCheer(); }
function nextCheer(){
  const c = cheerQ[0]; if (!c) return;
  const o = el('div', { class: 'cheer', role: 'status' }, el('em', { text: c[0] }), el('b', { text: c[1] }), c[2] ? el('span', { text: c[2] }) : null);
  document.body.append(o); confetti(); ding(c[3] || 2); try { navigator.vibrate && navigator.vibrate([30, 50, 30]); } catch (e) {}
  setTimeout(() => o.classList.add('out'), 2300); setTimeout(() => { o.remove(); cheerQ.shift(); nextCheer(); }, 2750);
}
// 変化のあと：お題達成・新しい称号・階級アップ
function afterChange(){
  if (!S.doc || !S.mine) return;
  const days = myDays();
  const st = statOf(S.doc, true);
  if (achieved(targetsOf(st)) && store.get('okDay', '') !== S.today) { store.set('okDay', S.today); cheer('🎯', '今日のお題 達成！', `${st.pts}点・この調子です`, 3); }
  const life = lifetime(days);
  const have = TITLES.filter(t => t[4](life)).map(t => t[0]);
  const seen = store.get('titles', null);
  if (seen === null) store.set('titles', have);
  else { const nw = have.filter(x => !seen.includes(x)); if (nw.length) { store.set('titles', have); nw.forEach(id => { const t = TITLES.find(x => x[0] === id); cheer('🏅', `称号「${t[2]}」を獲得！`, t[3], 3); }); } }
  const rk = rankOf(sumRange(days, monthStart(S.today), S.today).pts).name;
  const lr = store.get('rank', null);
  if (lr && lr.m === S.today.slice(0, 6) && lr.r !== rk && RANKS.findIndex(r => r[1] === rk) > RANKS.findIndex(r => r[1] === lr.r)) cheer('⬆', `階級アップ！「${rk}」`, '今月の点で上がりました', 3);
  store.set('rank', { m: S.today.slice(0, 6), r: rk });
}

// ---------- 読み込み ----------
function stopWatch(){ S.unsub.forEach(u => { try { u(); } catch (e) {} }); S.unsub = []; }
function watch(){
  stopWatch();
  S.today = ymd(Date.now()); S.yday = addDays(S.today, -1); S.tmr = addDays(S.today, 1);
  S.doc = S.ydoc = S.tdoc = null; S.acts = [];
  S.unsub.push(FB.day.watch(S.today, d => { S.doc = d; rerender(); }));
  S.unsub.push(FB.day.watch(S.yday, d => { S.ydoc = d; rerender(); }));
  S.unsub.push(FB.day.watch(S.tmr, d => { S.tdoc = d; rerender(); }));
  S.unsub.push(FB.act.watchDay(S.today, docs => { S.acts = docs || []; rerender(); afterChange(); }));
  S.unsub.push(FB.cfg.watch('goal', d => { S.goal = Object.assign({}, GOAL_DEF, d || {}); rerender(); }));
  S.unsub.push(FB.cfg.watch('quest', d => { S.quest = d && d.target ? d : null; S.qkey = ''; rerender(); }));
  S.unsub.push(FB.cfg.watch('reward', d => { S.reward = d; rerender(); }));
  S.unsub.push(FB.cfg.watch('app', d => { S.appcfg = d || {}; pushAuto(); }));
  S.unsub.push(FB.ntc.watch(S.today, d => { S.ntc = d || {}; if (S.tab === 'team') rerender(); }));
  loadMine();
}
async function loadMine(){ const r = await FB.day.mine(); if (r) { S.mine = r; rerender(); afterChange(); } }
function periodRange(p){
  const t = S.today;
  if (p === 'today') return [t, t];
  if (p === 'yday') return [S.yday, S.yday];
  if (p === 'week') return [weekStart(t), t];
  if (p === 'month') return [monthStart(t), t];
  if (p === 'last') { const d = toDate(t); return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))]; }
  return [t, t];
}
async function loadUsers(){ if (!S.users) { const r = await FB.people.list(); S.users = (r || []).filter(u => u.active !== false); } return S.users; }
async function loadTeam(force){
  if (!FB.isStaff()) return;
  const [from, to] = periodRange(S.period);
  if (!force && S.teamKey === from + to && S.team) return;
  S.teamKey = from + to; S.team = null; rerender();
  await loadUsers();
  S.pushAll = await FB.push.all();
  S.team = (await FB.day.range(from, to)) || [];
  rerender();
}
async function loadWeek(){
  if (!FB.isStaff() || S.week) return;
  S.week = []; await loadUsers();
  S.week = (await FB.day.range(weekStart(S.today), S.today)) || [];
  rerender();
}
async function loadQuest(){
  if (!S.quest || !FB.isStaff()) return;
  const from = S.quest.period === 'month' ? monthStart(S.today) : weekStart(S.today);
  if (S.qkey === from) return;
  S.qkey = from; S.qteam = (await FB.day.range(from, S.today)) || [];
  rerender();
}
const nameOf = id => { const u = (S.users || []).find(x => x.email === id); return (u && u.name) || (id === ME.id ? ME.name : (id || '').split('@')[0]); };
// 期間の、人ごとのまとめ（今日の訪問数は訪問マップの記録から）
function byPerson(docs, from, to){
  const byU = {};
  for (const d of docs) (byU[d.u] = byU[d.u] || {})[d.d] = d;
  const people = new Set(Object.keys(byU));
  (S.users || []).forEach(u => { if (u.nt !== false) people.add(u.email); });
  for (const d of S.acts) for (const k in d) { const v = d[k]; if (v && v.u) people.add(v.u); }
  return [...people].map(u => {
    const days = byU[u] || {};
    if (to >= S.today && from <= S.today && !days[S.today]) days[S.today] = { u, d: S.today };
    if (u === ME.id && S.doc && to >= S.today && from <= S.today) days[S.today] = S.doc;
    return { u, name: nameOf(u), days, t: sumRange(days, from, to, u) };
  });
}

// ---------- 画面の組み立て ----------
let rT = 0;
function rerender(){
  clearTimeout(rT);
  rT = setTimeout(() => {
    const a = document.activeElement;
    if (a && $('#main').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { S.pending = true; return; }
    if (document.querySelector('.modal')) { S.pending = true; return; }
    render();
  }, 60);
}
document.addEventListener('focusout', () => { if (S.pending) { S.pending = false; setTimeout(rerender, 250); } });
new MutationObserver(() => { if (S.pending && !document.querySelector('.modal')) { S.pending = false; rerender(); } }).observe(document.body, { childList: true });

function render(){
  const main = $('#main'); const keep = window.scrollY;
  main.textContent = '';
  const days = myDays();
  const mp = sumRange(days, monthStart(S.today), S.today).pts;
  $('#who').textContent = `${ME.name}・${rankOf(mp).name}・連続${streak(days)}日`;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === S.tab)));
  if (S.tab === 'today') renderToday(main);
  else if (S.tab === 'stats') renderStats(main, days);
  else if (S.tab === 'team') renderTeam(main);
  else renderSet(main);
  window.scrollTo(0, keep);
}
const add = (box, ...xs) => { for (const x of xs.flat(3)) if (x != null && x !== false) box.append(x); };
const keepOpen = (key, d) => { if (S.open[key]) d.open = true; d.addEventListener('toggle', () => { S.open[key] = d.open; }); return d; };

// ===== 今日 =====
function heroBox(st){
  const box = el('section', { class: 'hero' + (st.running ? ' on' : st.sub ? ' done' : '') });
  if (st.running) {
    const r = st.running;
    add(box, el('div', { class: 'hk' }, el('span', { class: 'dot', style: `background:${KC[r.k]}` }), `${KIND[r.k]} 実行中`),
      el('div', { class: 'clock', 'data-st': r.st, text: clock(Date.now() - r.st) }),
      el('div', { class: 'hsub', text: `${timeOf(r.st)} 開始・今日の合計 ${hm(st.work)}・${st.pts}点` }),
      el('button', { class: 'btn big', onclick: stopWork }, r.k === 'call' || r.k === 'post' ? '終了して結果を入れる' : '終了する'),
      r.k === 'door' ? el('a', { class: 'btn big', style: 'background:transparent;color:#fff;border-color:rgba(255,255,255,.6)', href: MAP_URL }, '訪問マップを開く') : null);
    return box;
  }
  if (st.off) { add(box, el('div', { class: 'hk', text: '今日は休み（申告済み）' }), el('div', { class: 'hsub', text: 'しっかり休んでください。連続記録は途切れません。' })); return box; }
  if (st.sub) { add(box, el('div', { class: 'hk', text: '日報を提出しました。おつかれさまでした！' }), el('div', { class: 'hsub', text: `今日の合計 ${hm(st.work)}・${st.pts}点` })); return box; }
  if (!st.plan.length && !st.work) { add(box, el('div', { class: 'hk', text: 'まず、今日やることを申告しましょう' }), el('div', { class: 'hsub', text: '申告するまで、お知らせが30分ごとに届きます。休みの日は「今日は休み」を。' })); return box; }
  const next = nextPlan(st);
  add(box, el('div', { class: 'hk', text: st.work ? `今日の合計 ${hm(st.work)}・${st.pts}点` : '準備ができたら開始を押しましょう' }),
    el('div', { class: 'hsub', text: next ? `次の予定：${next.s}〜${next.e} ${KIND[next.k]}${next.m ? '（' + next.m + '）' : ''}` : '予定はすべて終わりました。日報を出しましょう。' }),
    next ? el('button', { class: 'btn primary big', onclick: () => startWork(next.k, next.id) }, `${KIND[next.k]}を開始する`) : null);
  return box;
}
function nextPlan(st){
  const used = new Set(Object.values((S.doc && S.doc.ses) || {}).map(s => s.pid).filter(Boolean));
  const left = st.plan.filter(p => !used.has(p.id));
  const d = new Date(); const now = d.getHours() * 60 + d.getMinutes();
  return left.find(p => toMin(p.e) > now) || left[left.length - 1] || null;
}
function planEditor(){
  if (!S.draft) S.draft = statOf(S.doc, true).plan.map(p => Object.assign({}, p));
  if (!S.draft.length) {
    const prev = Object.keys(myDays()).filter(d => d < S.today).sort().reverse().map(d => myDays()[d]).find(d => d.plan && Object.keys(d.plan).length);
    S.draft = prev ? Object.values(prev.plan).map(p => Object.assign({}, p, { id: uid() })).sort((a, b) => (toMin(a.s) || 0) - (toMin(b.s) || 0)) : [{ id: uid(), k: 'door', s: '10:00', e: '13:00', m: '' }, { id: uid(), k: 'door', s: '14:00', e: '18:00', m: '' }];
  }
  const sec = el('section', { class: 'card' }, el('h3', null, '今日の予定', el('small', { text: '前回の予定を下書きにしています' })));
  S.draft.forEach((p, i) => add(sec, el('div', { class: 'pedit' },
    el('div', { class: 'pline' },
      el('select', { 'aria-label': 'やること', onchange: e => { p.k = e.target.value; } }, KIND_ORDER.map(k => el('option', { value: k, selected: p.k === k }, KIND[k]))),
      el('button', { class: 'del', 'aria-label': 'この予定を消す', onclick: () => { S.draft.splice(i, 1); render(); } }, '×'),
      el('input', { type: 'time', value: p.s, 'aria-label': '始める時刻', onchange: e => { p.s = e.target.value; } }),
      el('span', { class: 'tilde', text: '〜' }),
      el('input', { type: 'time', value: p.e, 'aria-label': '終わる時刻', onchange: e => { p.e = e.target.value; } })),
    el('input', { type: 'text', placeholder: 'メモ（エリア・物件・アポ先など）', value: p.m || '', onchange: e => { p.m = e.target.value; } }))));
  add(sec, el('div', { class: 'row' },
    el('button', { class: 'btn', onclick: () => { const lp = S.draft[S.draft.length - 1]; const s = lp ? lp.e : '10:00'; const e = toMin(s) != null ? pad(Math.min(23, Math.floor(toMin(s) / 60) + 2)) + ':' + pad(toMin(s) % 60) : '12:00'; S.draft.push({ id: uid(), k: lp ? lp.k : 'door', s, e, m: '' }); render(); } }, '＋ 予定を足す')));
  const had = statOf(S.doc, true).plan;
  add(sec, el('button', { class: 'btn primary wide', onclick: async () => {
    if (!S.draft.length) { toast('予定を1つ以上入れてください'); return; }
    if (S.draft.some(p => toMin(p.s) == null || toMin(p.e) == null || toMin(p.e) <= toMin(p.s))) { toast('終わる時刻は、始める時刻より後にしてください'); return; }
    const plan = {}; S.draft.forEach(p => { plan[p.id] = { k: p.k, s: p.s, e: p.e, m: (p.m || '').trim() }; });
    const gone = had.filter(p => !plan[p.id]).map(p => p.id);
    S.draft = null; S.editing = false;
    await put(S.today, { plan, off: false }, true);
    for (const id of gone) await drop(S.today, 'plan', id);
    ding(1); toast('今日の予定を申告しました。Googleカレンダーにも入ります');
  } }, 'この予定で申告する'));
  add(sec, el('div', { class: 'row' },
    el('button', { class: 'btn', onclick: () => { if (confirm('今日は休みとして申告しますか？（今日のお知らせは止まります）')) { S.draft = null; S.editing = false; put(S.today, { off: true }, true); } } }, '今日は休み'),
    had.length ? el('button', { class: 'btn', onclick: () => { S.draft = null; S.editing = false; render(); } }, 'やめる') : null));
  return sec;
}
function planList(st){
  const ses = Object.values((S.doc && S.doc.ses) || {});
  const sec = el('section', { class: 'card' }, el('h3', null, '今日の予定', st.sub ? null : el('button', { class: 'link', onclick: () => { S.editing = true; S.draft = null; render(); } }, '予定を直す')));
  for (const p of st.plan) {
    const mine = ses.filter(s => s.pid === p.id), run = mine.find(s => !s.en);
    const used = mine.reduce((a, s) => a + ((s.en || Date.now()) - s.st), 0);
    add(sec, el('div', { class: 'pitem' + (run ? ' on' : mine.length ? ' done' : '') },
      el('span', { class: 'dot', style: `background:${KC[p.k]}` }),
      el('div', { class: 'pt' }, el('b', { text: `${p.s}〜${p.e} ${KIND[p.k]}` }), p.m ? el('small', { class: 'muted', text: p.m }) : null),
      run ? el('span', { class: 'pst', text: '実行中' }) : mine.length ? el('span', { class: 'pst', text: `済（${hm(used)}）` }) : null,
      !run && !st.sub ? el('button', { class: 'btn', onclick: () => startWork(p.k, p.id) }, mine.length ? '再開' : '開始') : null));
  }
  if (!st.sub && !st.running) add(sec, keepOpen('adhoc', el('details', null, el('summary', { text: '予定にない仕事を開始する' }),
    el('div', { class: 'row', style: 'margin-top:8px' }, KIND_ORDER.map(k => el('button', { class: 'btn', onclick: () => { S.open.adhoc = false; startWork(k); } }, KIND[k]))))));
  return sec;
}
function goalBox(st){
  const ts = targetsOf(st); if (!ts.length) return null;
  const ok = achieved(ts);
  return el('section', { class: 'card' + (ok ? ' ok' : '') }, el('h3', null, '今日のお題', ok ? el('span', { class: 'stamp', text: '達成' }) : el('small', { text: '全部そろうと達成' })),
    ts.map(t => el('div', { class: 'bar' + (t.val >= t.tgt ? ' done' : '') },
      el('div', { class: 'bl' }, el('span', { text: t.label }), el('b', { text: `${nf(t.val)} / ${nf(t.tgt)}` })),
      el('div', { class: 'track' }, el('i', { style: `width:${Math.min(100, Math.round(t.val / t.tgt * 100))}%` })),
      t.val < t.tgt ? el('small', { class: 'muted', text: `あと${nf(t.tgt - t.val)}` }) : null)),
    el('div', { class: 'muted', text: '数は予定した時間に合わせて決まります。訪問・対面・訪販の獲得は、訪問マップの登録から自動で数えます。' }));
}
function questBox(){
  if (!S.quest || !FB.isStaff()) return null;
  loadQuest();
  const q = S.quest; const from = q.period === 'month' ? monthStart(S.today) : weekStart(S.today);
  let val = 0;
  if (S.qteam) for (const r of byPerson(S.qteam, from, S.today)) val += ({ got: r.t.got, face: r.t.face, doors: r.t.doors, post: r.t.post, han: r.t.han, pts: r.t.pts })[q.kind] || 0;
  const ok = val >= q.target;
  return el('section', { class: 'card' + (ok ? ' ok' : '') }, el('h3', null, `チームお題：${q.title || ''}`, ok ? el('span', { class: 'stamp', text: '達成' }) : el('small', { text: q.period === 'month' ? '今月' : '今週' })),
    el('div', { class: 'bar' + (ok ? ' done' : '') }, el('div', { class: 'bl' }, el('span', { text: 'みんなの合計' }), el('b', { text: `${nf(val)} / ${nf(q.target)}` })), el('div', { class: 'track' }, el('i', { style: `width:${Math.min(100, Math.round(val / q.target * 100))}%` }))),
    q.reward ? el('div', { class: 'reward' }, '🎁', el('span', null, '達成のご褒美：', el('b', { text: q.reward }))) : null);
}
function hanBox(st){
  const list = Object.entries((S.doc && S.doc.han) || {}).sort((a, b) => a[1].t - b[1].t);
  const h = st.han;
  return el('section', { class: 'card' }, el('h3', null, '反響対応', el('small', { text: `対応${h.all}件` })),
    h.all || h.inv ? el('div', { class: 'kpis k3' }, [['電話', h.call], ['メッセージ', h.msg], ['つながった', h.conn], ['アポ・提案', h.apo], ['無効', h.inv], ['獲得', h.got]].map(([t, v]) => el('div', { class: 'kpi' }, el('b', { text: v }), el('span', { text: t })))) : null,
    list.map(([id, r]) => el('div', { class: 'rec' }, el('div', { class: 'rt' }, `${timeOf(r.t)}　電話${r.call || 0}・メッセ${r.msg || 0}・つながり${r.conn || 0}・アポ${r.apo || 0}・無効${r.inv || 0}・獲得${r.got || 0}`, r.m ? el('small', { text: r.m }) : null),
      st.sub ? null : el('button', { class: 'del', 'aria-label': 'この記録を消す', onclick: () => { if (confirm('この記録を消しますか？')) drop(S.today, 'han', id); } }, '×'))),
    st.sub ? null : el('button', { class: 'btn', onclick: () => hanForm(null) }, '＋ 反響対応を足す'));
}
function postBox(st){
  const list = Object.entries((S.doc && S.doc.post) || {}).sort((a, b) => a[1].t - b[1].t);
  return el('section', { class: 'card' }, el('h3', null, '配布報告', el('small', { text: `今日 ${nf(st.post)}枚` })),
    list.map(([id, p]) => el('div', { class: 'rec' }, el('div', { class: 'rt' }, p.a || 'エリア未記入'), el('span', { class: 'tag', text: p.ty || '' }), el('b', { text: `${nf(p.n)}枚` }),
      st.sub ? null : el('button', { class: 'del', 'aria-label': 'この報告を消す', onclick: () => { if (confirm('この配布報告を消しますか？')) drop(S.today, 'post', id); } }, '×'))),
    st.sub ? null : el('button', { class: 'btn', onclick: () => postForm(null) }, '＋ 配布を足す'));
}
function reportBox(st){
  const sec = el('section', { class: 'card' + (st.sub ? ' ok' : '') }, el('h3', null, '日報', st.sub ? el('span', { class: 'stamp', text: '提出済み' }) : el('small', { text: '出すまでお知らせが届きます' })));
  add(sec, el('div', { class: 'kpis' }, [['稼働', h1(st.work) + 'h'], ['訪問', st.v.doors], ['対面', st.v.face], ['獲得', st.got], ['配布', nf(st.post)], ['反響対応', st.han.all], ['アポ', st.han.apo], ['今日の点', st.pts]].map(([t, v]) => el('div', { class: 'kpi' }, el('b', { text: v }), el('span', { text: t })))));
  if (st.work) add(sec, el('div', { class: 'muted', text: KIND_ORDER.filter(k => st.h[k]).map(k => `${KIND[k]} ${hm(st.h[k])}`).join('・') + (st.h.door > 600000 ? `・訪販1時間あたり ${(st.v.doors / (st.h.door / 3600000)).toFixed(1)}部屋` : '') }));
  if (st.sub && !S.editRep) {
    if (S.doc.refl) add(sec, el('div', { class: 'ins' }, el('small', { class: 'muted', text: '振り返り　' }), S.doc.refl));
    if (S.doc.tmr) add(sec, el('div', { class: 'ins' }, el('small', { class: 'muted', text: '明日やること　' }), S.doc.tmr));
    if (S.tdoc && S.tdoc.off) add(sec, el('div', { class: 'muted', text: '明日は休みで申告済みです。' }));
    add(sec, el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => { S.editRep = true; render(); } }, '日報を直す')));
    return sec;
  }
  const refl = el('textarea', { rows: 2, placeholder: '今日の振り返りをひとこと（うまくいったこと・次に変えること）' }); refl.value = (S.doc && S.doc.refl) || '';
  const tmr = el('textarea', { rows: 2, placeholder: '明日やること（任意）' }); tmr.value = (S.doc && S.doc.tmr) || '';
  const off = el('input', { type: 'checkbox', id: 'tmrOff', checked: !!(S.tdoc && S.tdoc.off) });
  add(sec, refl, tmr, el('label', { class: 'row', for: 'tmrOff', style: 'font-size:14px' }, off, '明日は休み（明日のお知らせを止める）'),
    el('button', { class: 'btn primary wide', onclick: () => {
      const run = statOf(S.doc, true).running;
      if (run && (run.k === 'call' || run.k === 'post')) { toast(`先に「${KIND[run.k]}」の結果を入れてください`); stopWork(); return; }
      if (!refl.value.trim()) { toast('振り返りをひとこと書いてください'); refl.focus(); return; }
      const first = !st.sub; const now = Date.now();
      const patch = { refl: refl.value.trim(), tmr: tmr.value.trim(), sub: st.sub || now };
      if (run) patch.ses = { [run.id]: Object.assign({}, S.doc.ses[run.id], { en: now }) };
      S.editRep = false; document.activeElement && document.activeElement.blur();
      if (off.checked !== !!(S.tdoc && S.tdoc.off)) put(S.tmr, { off: off.checked }, true);
      put(S.today, patch);
      if (first) {
        const days = myDays(); let best = 0; for (const d in days) if (d < S.today) best = Math.max(best, statOf(days[d], false).pts);
        const pts = statOf(S.doc, true).pts;
        cheer('📝', '日報 提出！', pts > best && best > 0 ? `今日は${pts}点・自己最高を更新！` : `今日は${pts}点・連続${streak(myDays())}日`, 2);
        setTimeout(treasure, 2900);
      } else toast('日報を直しました');
    } }, st.sub ? '直して保存' : '日報を提出する'));
  return sec;
}
function yesterdayBox(){
  if (!S.ydoc) return null;
  const y = S.ydoc; const out = [];
  const open = Object.entries(y.ses || {}).find(([, s]) => !s.en);
  if (open) {
    const inp = el('input', { type: 'time', value: '19:00' });
    out.push(el('section', { class: 'card warn' }, el('h3', { text: '昨日の「終了」が押されていません' }),
      el('div', { class: 'muted', text: `${KIND[open[1].k]}を${timeOf(open[1].st)}に開始したままです。終わった時刻を入れてください。` }),
      el('div', { class: 'row' }, inp, el('button', { class: 'btn primary', onclick: () => {
        const m = toMin(inp.value); if (m == null) return; const en = toDate(S.yday).getTime() + m * 60000;
        if (en <= open[1].st) { toast('開始より後の時刻にしてください'); return; }
        put(S.yday, { ses: { [open[0]]: Object.assign({}, open[1], { en }) } }, true); toast('昨日の終了時刻を直しました');
      } }, '終了時刻を入れる'))));
  }
  const yst = statOf(y, false);
  if (yst.has && !yst.sub && !yst.off) {
    const ta = el('textarea', { rows: 2, placeholder: '昨日の振り返りをひとこと' });
    out.push(el('section', { class: 'card bad' }, el('h3', { text: '昨日の日報がまだです' }),
      el('div', { class: 'muted', text: '出すまでお知らせが届きます。ひとことで大丈夫です。' }), ta,
      el('button', { class: 'btn primary', onclick: () => { if (!ta.value.trim()) { ta.focus(); return; } put(S.yday, { refl: ta.value.trim(), sub: Date.now(), late: 1 }); toast('昨日の日報を出しました'); } }, '昨日の日報を出す')));
  }
  return out;
}
function pushNotice(){
  if (['granted', 'novapid', 'unsupported'].includes(S.pushState) || !S.pushState) return null;
  if (S.pushState === 'needhome') return el('section', { class: 'card warn' }, el('h3', { text: 'お知らせを受け取る準備をしてください' }), el('div', { class: 'muted', text: 'iPhoneは、この画面を「ホーム画面に追加」して、ホーム画面のアイコンから開くと、お知らせを受け取れるようになります。やり方は「設定」にあります。' }), el('button', { class: 'btn', onclick: () => go('set') }, '設定を開く'));
  return el('section', { class: 'card warn' }, el('h3', { text: 'お知らせを受け取る設定がまだです' }),
    el('div', { class: 'muted', text: S.pushState === 'denied' ? 'お知らせが「許可しない」になっています。スマホの設定から、このアプリ（またはブラウザ）の通知を許可してください。通知を切っているかどうかは代表の画面に出ます。' : '予定や日報の出し忘れを、スマホに直接お知らせします。下のボタンを押して「許可」を選んでください。' }),
    S.pushState === 'denied' ? null : el('button', { class: 'btn primary', onclick: () => pushOn(true) }, 'お知らせを受け取る'));
}
// ===== スコアボード（今日の画面の一番上） =====
const SVGNS = 'http://www.w3.org/2000/svg';
function ring(val, tgt, size, stroke, label, sub, opts){
  opts = opts || {};
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = opts.prog != null ? Math.min(1, opts.prog) : tgt ? Math.min(1, val / tgt) : 0;
  const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('aria-hidden', 'true');
  const mk = (cls, off) => { const ci = document.createElementNS(SVGNS, 'circle'); ci.setAttribute('cx', size / 2); ci.setAttribute('cy', size / 2); ci.setAttribute('r', r); ci.setAttribute('class', cls); ci.setAttribute('stroke-width', stroke); ci.setAttribute('stroke-dasharray', c.toFixed(1)); ci.setAttribute('stroke-dashoffset', off.toFixed(1)); return ci; };
  svg.append(mk('rg-bg', 0));
  const fg = mk('rg-fg' + (p >= 1 ? ' full' : ''), c); svg.append(fg);
  requestAnimationFrame(() => requestAnimationFrame(() => fg.setAttribute('stroke-dashoffset', (c * (1 - p)).toFixed(1))));
  const num = el('b', { class: 'rg-num', 'data-to': val, text: opts.anim ? '0' : nf(val) });
  return el('div', { class: 'rg' + (p >= 1 ? ' done' : '') + (opts.near ? ' near' : ''), style: `--sz:${size}px`, role: 'img', 'aria-label': `${label} ${val}／${tgt}` },
    svg, el('div', { class: 'rg-in' }, num, sub ? el('small', { text: sub }) : null), label ? el('span', { class: 'rg-lb', text: label }) : null);
}
function countUp(root){
  root.querySelectorAll('.rg-num[data-to]').forEach(e => {
    const to = +e.dataset.to; const from = +(store.get('lastPts', 0)); if (!to) { e.textContent = '0'; return; }
    const st = performance.now(), dur = 900;
    const f = t => { const k = Math.min(1, (t - st) / dur); const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); e.textContent = nf(v); if (k < 1) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
}
function weekRank(){
  if (!S.week || !FB.isStaff()) return null;
  const rows = byPerson(S.week, weekStart(S.today), S.today).sort((a, b) => b.t.pts - a.t.pts);
  const i = rows.findIndex(r => r.u === ME.id); if (i < 0) return null;
  return { pos: i + 1, n: rows.length, gap: i > 0 ? rows[i - 1].t.pts - rows[i].t.pts + 1 : (rows[1] ? rows[0].t.pts - rows[1].t.pts : 0), above: i > 0 ? rows[i - 1].name : '' };
}
function hud(st){
  if (FB.isStaff()) loadWeek();
  const days = myDays(); const mp = sumRange(days, monthStart(S.today), S.today).pts; const rk = rankOf(mp); const sk = streak(days);
  const ts = st.off ? [] : targetsOf(st);
  const total = ts.length ? ts.reduce((a, t) => a + Math.min(1, t.val / t.tgt), 0) / ts.length : 0;
  const near = ts.filter(t => t.val < t.tgt).sort((a, b) => (b.val / b.tgt) - (a.val / a.tgt))[0];
  const hour = new Date().getHours();
  const risk = !st.off && !st.sub && st.has && hour >= 19;
  const wr = weekRank();
  const lvP = rk.next ? Math.round((mp - rk.base) / (rk.next[0] - rk.base) * 100) : 100;
  const box = el('section', { class: 'hud' },
    el('div', { class: 'hud-top' },
      el('div', { class: 'emb', title: '今月の階級' }, el('span', { text: rk.name })),
      el('div', { class: 'who' }, el('b', { text: ME.name }), el('div', { class: 'lv' }, el('i', { style: `width:${Math.max(4, lvP)}%` })), el('small', { text: rk.next ? `「${rk.next[1]}」まで ${nf(rk.next[0] - mp)}点` : '最高の階級' })),
      el('div', { class: 'flame' + (risk ? ' risk' : '') + (sk ? '' : ' out'), title: '連続記録' }, el('span', { class: 'fl', 'aria-hidden': 'true', text: '🔥' }), el('b', { text: sk }), el('small', { text: '日連続' }))),
    el('div', { class: 'hud-main' },
      ring(st.pts, 1, 168, 14, '', '今日の点', { anim: true, prog: ts.length ? total : (st.pts ? 1 : 0) }),
      el('div', { class: 'quests' }, ts.length ? ts.slice(0, 4).map(t => ring(t.val, t.tgt, 66, 7, t.label, `/${nf(t.tgt)}`, { near: near && t === near && t.val / t.tgt >= .6 })) : el('div', { class: 'hud-empty', text: st.off ? '今日は休み' : '予定を申告すると、今日のお題が出ます' }))),
    el('div', { class: 'hud-msg' + (risk ? ' risk' : '') }, risk ? `今日の日報がまだ。出さないと${sk}日の連続が途切れます` : near ? `あと${nf(near.tgt - near.val)}で「${near.label}」達成` : ts.length && achieved(ts) ? '今日のお題、全部達成！' : st.sub ? '今日もおつかれさまでした' : '今日も1点ずつ積み上げよう'),
    wr ? el('div', { class: 'hud-rank' }, el('b', { text: `今週 ${wr.pos}位` }), el('span', { text: wr.pos === 1 ? (wr.gap > 0 ? `2位と${nf(wr.gap)}点差。逃げ切ろう` : '同点で並んでいます') : `${wr.above}さんまで あと${nf(wr.gap)}点` })) : null);
  setTimeout(() => { countUp(box); store.set('lastPts', st.pts); }, 30);
  return box;
}
// 仲間の動き（社員・代表だけ）：今日の獲得・日報・お題達成が流れてくる
function feedBox(){
  if (!FB.isStaff() || !S.week) return null;
  const ev = [];
  for (const d of S.acts) for (const k in d) { const v = d[k]; if (v && v.r === 'got' && !v.x && v.t) ev.push([v.t, v.u, '訪販で獲得！', 'got']); }
  for (const d of S.week) { if (d.d !== S.today) continue; for (const id in (d.han || {})) { const r = d.han[id]; if (r && +r.got > 0) ev.push([r.t, d.u, `反響で獲得${r.got > 1 ? r.got + '件' : ''}！`, 'got']); } if (d.sub) ev.push([d.sub, d.u, '日報を提出', 'sub']); }
  if (!ev.length) return null;
  ev.sort((a, b) => b[0] - a[0]);
  return el('section', { class: 'feed', 'aria-label': '今日のみんなの動き' }, ev.slice(0, 6).map(([t, u, txt, k]) =>
    el('div', { class: 'fd ' + k }, el('span', { class: 'av', text: (nameOf(u) || '?').slice(0, 1) }), el('span', { class: 'fx' }, el('b', { text: u === ME.id ? 'あなた' : nameOf(u) + 'さん' }), txt), el('small', { text: timeOf(t) }))));
}
// 日報を出したら開く宝箱：おまけの点（5〜50点、たまに大当たり）
function treasure(){
  if (!S.doc || S.doc.bonus != null) return;
  const r = Math.random(); const b = r < .05 ? 50 : r < .2 ? 25 : r < .55 ? 15 : r < .85 ? 10 : 5;
  const lid = el('div', { class: 'chest', role: 'button', tabindex: 0, 'aria-label': '宝箱を開ける' }, el('span', { class: 'cb-ic', text: '🎁' }), el('b', { text: '今日の宝箱' }), el('small', { text: '押して開ける' }));
  const close = modal('おつかれさまでした', [lid, el('div', { class: 'muted', style: 'text-align:center', text: '日報を出した日だけ開けられます。中身は開けるまでわかりません。' })]);
  const open = () => {
    lid.classList.add('open'); lid.querySelector('.cb-ic').textContent = b >= 50 ? '💎' : b >= 25 ? '🏆' : '✨';
    lid.querySelector('b').textContent = `+${b}点`; lid.querySelector('small').textContent = b >= 50 ? '大当たり！' : b >= 25 ? '当たり！' : 'おまけの点';
    put(S.today, { bonus: b }); if (b >= 25) { confetti(); ding(3); } else ding(1);
    try { navigator.vibrate && navigator.vibrate(b >= 25 ? [40, 60, 40, 60, 120] : 40); } catch (e) {}
    setTimeout(close, 1800);
  };
  lid.addEventListener('click', open, { once: true }); lid.addEventListener('keydown', e => { if (e.key === 'Enter') open(); }, { once: true });
}
function renderToday(main){
  const st = statOf(S.doc, true);
  add(main, hud(st), pushNotice(), yesterdayBox(), heroBox(st), feedBox());
  const editing = S.editing || (!st.off && !st.plan.length && !st.work);
  if (st.off && !editing) add(main, el('section', { class: 'card' }, el('h3', { text: '今日は休み' }), el('button', { class: 'btn', onclick: () => { S.editing = true; put(S.today, { off: false }, true); } }, '休みを取り消して予定を申告する')));
  else add(main, editing && !st.sub ? planEditor() : planList(st));
  if (st.off && !editing) { add(main, questBox()); return; }
  add(main, questBox());
  const used = k => st.ph[k] || st.h[k];
  const blocks = [[used('call') || st.han.all || st.han.inv, hanBox(st)], [used('post') || st.post, postBox(st)]];
  blocks.filter(b => b[0]).forEach(b => add(main, b[1]));
  const rest = blocks.filter(b => !b[0]).map(b => b[1]);
  if (rest.length && !st.sub) add(main, keepOpen('more', el('details', { class: 'card' }, el('summary', { text: '予定にない記録（反響対応・配布）' }), rest)));
  if (st.plan.length || st.work) add(main, reportBox(st));
}

// ===== 成績 =====
function arrow(now, before){
  if (!before && !now) return null;
  const d = before ? Math.round((now - before) / before * 100) : 100;
  if (!d) return el('small', { text: '先月と同じ' });
  return el('small', { class: d > 0 ? 'up' : 'dn', text: `${d > 0 ? '▲' : '▼'}${Math.abs(d)}%` });
}
function insights(days, cur, prev){
  const out = [], t = S.today;
  const tw = sumRange(days, weekStart(t), t);
  const lwS = addDays(weekStart(t), -7), lwE = addDays(t, -7);
  const lw = sumRange(days, lwS, lwE);
  if (lw.work > 3600000) {
    const d = Math.round((tw.work - lw.work) / lw.work * 100);
    if (d <= -20) out.push(['dn', `今週の稼働時間は、先週の同じ曜日までより${-d}%少ないペースです（${h1(tw.work)}時間／先週${h1(lw.work)}時間）。`]);
    else if (d >= 20) out.push(['up', `今週の稼働時間は先週より${d}%多いペース。いい流れです。`]);
  }
  if (cur.doors >= 30 && prev.doors >= 30) {
    const a = cur.face / cur.doors, b = prev.face / prev.doors;
    if (a - b >= .03) out.push(['up', `対面率が先月より上がっています（${Math.round(b * 100)}%→${Math.round(a * 100)}%）。`]);
    else if (b - a >= .03) out.push(['dn', `対面率が先月より下がっています（${Math.round(b * 100)}%→${Math.round(a * 100)}%）。回る時間帯を見直すと上がるかもしれません。`]);
  }
  if (cur.h.door > 3600000 && prev.h.door > 3600000) {
    const a = cur.doors / (cur.h.door / 3600000), b = prev.doors / (prev.h.door / 3600000);
    if (b && (a - b) / b <= -.15) out.push(['dn', `訪販1時間あたりの訪問数が先月より減っています（${b.toFixed(1)}→${a.toFixed(1)}部屋）。移動や待ち時間が増えていないか見てみましょう。`]);
  }
  if (cur.han >= 10 && prev.han >= 10) {
    const a = cur.conn / cur.han, b = prev.conn / prev.han;
    if (b - a >= .05) out.push(['dn', `反響の「つながった率」が先月より下がっています（${Math.round(b * 100)}%→${Math.round(a * 100)}%）。反響が来てから連絡するまでの早さを見直してみましょう。`]);
  }
  let none = 0;
  for (let d = monthStart(t); d < t; d = addDays(d, 1)) { const x = days[d]; if (!x || (!x.off && !(x.plan && Object.keys(x.plan).length) && !(x.ses && Object.keys(x.ses).length))) none++; }
  if (none) out.push(['dn', `今月、予定も休みも申告がない日が${none}日あります。休みの日も「今日は休み」を押せば連続が途切れません。`]);
  const g = S.goal.monthGot;
  if (g) {
    const d0 = toDate(t); const left = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate() - d0.getDate() + 1;
    const rem = g - cur.got;
    if (rem > 0) out.push(['', `今月の獲得の目安${g}件まであと${rem}件。残り${left}日なので1日あたり約${(rem / left).toFixed(1)}件。${cur.face && cur.doorGot ? `今の自分の割合なら、あと約${Math.ceil(rem / (cur.doorGot / cur.face))}件の対面が目安です。` : ''}`]);
    else out.push(['up', `今月の獲得の目安${g}件を達成しています！`]);
  }
  if (!out.length) out.push(['', 'まだ比べられるだけの記録がたまっていません。毎日つけると、ここに自分の気づきが出てきます。']);
  return out;
}
function renderStats(main, days){
  if (!S.mine) { add(main, el('div', { class: 'loading', text: '読み込んでいます…' })); return; }
  const t = S.today; const [pf, pt] = lastMonthSame(t);
  const cur = sumRange(days, monthStart(t), t), prev = sumRange(days, pf, pt);
  const rk = rankOf(cur.pts);
  let best = { pts: 0, d: '' }; for (const d in days) { if (d > t) continue; const p = statOf(days[d], d === t).pts; if (p > best.pts) best = { pts: p, d }; }
  add(main, el('section', { class: 'card rank' },
    el('div', { class: 'rk' }, el('span', { class: 'badge', text: rk.name }), el('b', { text: `${nf(cur.pts)}点` }), el('small', { class: 'muted', text: `${toDate(t).getMonth() + 1}月` })),
    rk.next ? el('div', { class: 'bar' }, el('div', { class: 'track' }, el('i', { style: `width:${Math.min(100, Math.round((cur.pts - rk.base) / (rk.next[0] - rk.base) * 100))}%` })), el('small', { class: 'muted', text: `「${rk.next[1]}」まであと${nf(rk.next[0] - cur.pts)}点` })) : el('small', { class: 'muted', text: '最高の階級です！' }),
    el('div', { class: 'mini' }, el('span', null, '連続 ', el('b', { text: streak(days) + '日' })), el('span', null, 'お題達成 ', el('b', { text: cur.ok + '日' })), best.d ? el('span', null, '自己最高 ', el('b', { text: best.pts + '点' }), `（${md(best.d)}）`) : null),
    S.reward && S.reward.text ? el('div', { class: 'reward' }, '🎁', el('span', null, '今月のご褒美：', el('b', { text: S.reward.text }))) : null,
    el('div', { class: 'muted', text: `点の付け方：${PT_TEXT}。階級は毎月1日に見習いから。休んでも点は減りません。` })));
  add(main, el('section', { class: 'card' }, el('h3', { text: '気づき' }), insights(days, cur, prev).map(([c, x]) => el('div', { class: 'ins ' + c, text: x }))));
  const early = +t.slice(6) < 3;
  const k = (label, v, p, fmt) => el('div', { class: 'kpi' }, el('b', { text: fmt ? fmt(v) : nf(v) }), el('span', { text: label }), early ? null : arrow(v, p));
  add(main, el('section', { class: 'card' }, el('h3', null, '今月の数字', el('small', { text: early ? '3日目から先月と比べます' : '先月の同じ日までと比べて' })),
    el('div', { class: 'kpis k3' }, k('稼働時間', cur.work, prev.work, v => h1(v) + 'h'), k('訪問', cur.doors, prev.doors), k('対面', cur.face, prev.face), k('獲得', cur.got, prev.got), k('配布枚数', cur.post, prev.post), k('反響対応', cur.han, prev.han))));
  const rate = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
  const per = (a, ms) => ms > 600000 ? (a / (ms / 3600000)).toFixed(1) : '—';
  add(main, el('section', { class: 'card' }, el('h3', { text: '自分の流れと生産性' }),
    el('div', { class: 'tw' }, el('table', { class: 'tbl' },
      el('thead', null, el('tr', null, el('th'), el('th', { text: '今月' }), el('th', { text: '先月' }))),
      el('tbody', null, [
        ['対面率（対面÷訪問）', rate(cur.face, cur.doors), rate(prev.face, prev.doors)],
        ['訪販の獲得率（獲得÷対面）', rate(cur.doorGot, cur.face), rate(prev.doorGot, prev.face)],
        ['反響 つながった率', rate(cur.conn, cur.han), rate(prev.conn, prev.han)],
        ['反響 アポ率（÷つながった）', rate(cur.apo, cur.conn), rate(prev.apo, prev.conn)],
        ['反響 獲得率（÷アポ）', rate(cur.hgot, cur.apo), rate(prev.hgot, prev.apo)],
        ['訪販1時間あたり訪問', per(cur.doors, cur.h.door), per(prev.doors, prev.h.door)],
        ['反響1時間あたり対応', per(cur.han, cur.h.call), per(prev.han, prev.h.call)],
        ['配布1時間あたり枚数', per(cur.post, cur.h.post), per(prev.post, prev.h.post)]
      ].map(r => el('tr', null, el('th', { text: r[0] }), el('td', null, el('b', { text: r[1] })), el('td', { text: r[2] })))))),
    el('div', { class: 'muted', text: '自分の流れのどこで止まっているかが一目でわかります。' })));
  const d0 = toDate(t), last = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
  const arr = []; let max = 1;
  for (let i = 1; i <= last; i++) { const d = ymd(new Date(d0.getFullYear(), d0.getMonth(), i)); const st = d <= t ? statOf(days[d], d === t) : null; arr.push([d, st]); if (st) max = Math.max(max, st.pts); }
  add(main, el('section', { class: 'card' }, el('h3', null, '日ごとの点', el('small', { text: '濃い色＝お題達成' })),
    el('div', { class: 'chart', role: 'img', 'aria-label': '今月の日ごとの点' }, arr.map(([d, st]) => el('div', { class: 'col' + (d === t ? ' today' : ''), title: st ? `${md(d)} ${st.pts}点` : md(d) },
      el('i', { class: st && achieved(targetsOf(st)) ? 'ok' : '', style: `height:${st && st.pts ? Math.max(3, Math.round(st.pts / max * 100)) : 0}%` }), el('span', { text: st && st.off ? '休' : String(+d.slice(6)) }))))));
  const life = lifetime(days);
  const got = TITLES.filter(x => x[4](life)).length;
  add(main, el('section', { class: 'card' }, el('h3', null, '称号', el('small', { text: `${got} / ${TITLES.length}` })),
    el('div', { class: 'titles' }, TITLES.map(x => { const ok = x[4](life); return el('div', { class: 'tt' + (ok ? '' : ' lock') }, el('i', { text: ok ? x[1] : '？' }), el('b', { text: x[2] }), el('small', { text: x[3] })); }))));
}

// ===== チーム =====
const stateOf = (st, isToday) => !isToday ? '' : st.running ? `${KIND[st.running.k]}中` : st.off ? '休み' : st.sub ? '日報済み' : st.work ? '中断中' : st.plan.length ? '未開始' : '未申告';
const stCls = s => /中$/.test(s) && s !== '中断中' ? 'run' : s === '未申告' ? 'bad' : s === '未開始' || s === '中断中' ? 'warn' : s === '日報済み' ? 'good' : '';
const PUSH_T = { granted: ['受信中', 'good'], novapid: ['受信中', 'good'], denied: ['切っている', 'bad'], default: ['未設定', 'warn'], needhome: ['ホーム未追加', 'warn'], unsupported: ['メールのみ', ''] };
function renderTeam(main){
  if (!FB.isStaff()) { go('today'); return; }
  loadWeek();
  // 週の順位
  if (S.week) {
    const rows = byPerson(S.week, weekStart(S.today), S.today).sort((a, b) => b.t.pts - a.t.pts);
    add(main, el('section', { class: 'card' }, el('h3', null, '今週の順位', el('small', { text: `${md(weekStart(S.today))}〜` })),
      el('div', { class: 'ladder' }, rows.map((r, i) => el('div', { class: 'lrow' + (r.u === ME.id ? ' me' : '') }, el('span', { class: 'pos', text: i + 1 }),
        el('div', { class: 'lb' }, el('b', { text: r.name }), el('small', { text: `訪問${r.t.doors}・対面${r.t.face}・獲得${r.t.got}・反響${r.t.han}・配布${nf(r.t.post)}` })), el('b', { text: nf(r.t.pts) })))),
      el('div', { class: 'muted', text: '毎週月曜にまた0から。' })));
  }
  add(main, questBox());
  // 一覧
  const sel = el('select', { onchange: e => { S.period = e.target.value; loadTeam(true); } }, [['today', '今日'], ['yday', '昨日'], ['week', '今週'], ['month', '今月'], ['last', '先月']].map(([v, t]) => el('option', { value: v, selected: v === S.period }, t)));
  const sec = el('section', { class: 'card' }, el('h3', null, 'みんなの状況', el('span', { class: 'row' }, sel, el('button', { class: 'btn', onclick: () => loadTeam(true) }, '更新'))));
  add(main, sec);
  if (!S.team) { loadTeam(); add(sec, el('div', { class: 'muted', text: '読み込み中…' })); }
  else {
    const [from, to] = periodRange(S.period); const one = from === to; const isToday = one && from === S.today;
    const rows = byPerson(S.team, from, to).sort((a, b) => b.t.pts - a.t.pts);
    const nts = u => { const n = S.ntc[FB.ukey(u)] || {}; return n.total || 0; };
    add(sec, el('div', { class: 'tw' }, el('table', { class: 'tbl team' },
      el('thead', null, el('tr', null, ['名前', one ? '状態' : '日報', '稼働', '訪問', '対面', '獲得', '反響', 'アポ', '配布', '訪問/時', '点', isToday ? '催促' : null, 'お知らせ'].filter(Boolean).map(h => el('th', { text: h })))),
      el('tbody', null, rows.map(r => {
        const st = one ? statOf(r.days[from], from === S.today, r.u) : null;
        const s = one ? stateOf(st, isToday) || (st.off ? '休み' : st.sub ? '日報済み' : st.has ? '日報なし' : '申告なし') : `${r.t.subs}日`;
        const p = (S.pushAll || {})[FB.ukey(r.u)]; const pt = PUSH_T[(p && p.perm) || 'default'] || PUSH_T.default;
        const cls = one ? (stCls(s) || (s === '日報なし' || s === '申告なし' ? 'bad' : '')) : '';
        return el('tr', null, el('th', { text: r.name }), el('td', null, el('span', { class: 'st ' + cls, text: s })),
          el('td', { text: h1(r.t.work) + 'h' }), el('td', { text: r.t.doors }), el('td', { text: r.t.face }), el('td', { text: r.t.got }), el('td', { text: r.t.han }), el('td', { text: r.t.apo }), el('td', { text: nf(r.t.post) }),
          el('td', { text: r.t.h.door > 600000 ? (r.t.doors / (r.t.h.door / 3600000)).toFixed(1) : '—' }), el('td', null, el('b', { text: nf(r.t.pts) })),
          isToday ? el('td', null, nts(r.u) ? el('span', { class: 'st ' + (nts(r.u) >= 3 ? 'bad' : 'warn'), text: `${nts(r.u)}回` }) : '—') : null,
          el('td', null, el('span', { class: 'st ' + pt[1], text: pt[0] })));
      })))));
    add(sec, el('div', { class: 'muted', text: '「催促」は今日自動で送ったお知らせの回数、「お知らせ」はスマホの通知を受け取れる状態か（切っている人は赤）です。前日までの訪問数は毎晩0時15分に入ります。' }));
    const refl = rows.map(r => [r.name, one && r.days[from] && r.days[from].refl]).filter(x => x[1]);
    if (refl.length) add(sec, el('details', null, el('summary', { text: `振り返り（${refl.length}人）` }), refl.map(([n, x]) => el('div', { class: 'ins', style: 'margin-top:6px' }, el('b', { text: n + '：' }), x))));
  }
  if (FB.isAdmin()) add(main, adminGame());
}
function adminGame(){
  const g = S.goal, q = S.quest || { title: '', kind: 'got', target: 10, period: 'week', reward: '' }, rw = S.reward || {};
  const inp = {}; const num = (k, v, step) => (inp[k] = el('input', { type: 'number', min: 0, step: step || 1, value: v }));
  const qt = el('input', { type: 'text', value: q.title || '', placeholder: '例：今週チームで獲得10件' });
  const qk = el('select', null, [['got', '獲得'], ['face', '対面'], ['doors', '訪問'], ['han', '反響対応'], ['post', '配布枚数'], ['pts', '点']].map(([v, t]) => el('option', { value: v, selected: v === q.kind }, t)));
  const qn = el('input', { type: 'number', min: 1, value: q.target || 10 });
  const qp = el('select', null, [['week', '今週'], ['month', '今月']].map(([v, t]) => el('option', { value: v, selected: v === q.period }, t)));
  const qr = el('input', { type: 'text', value: q.reward || '', placeholder: '例：みんなで焼肉' });
  const rt = el('input', { type: 'text', value: rw.text || '', placeholder: '例：今月の1位にAmazonギフト5,000円' });
  return keepOpen('admin', el('details', { class: 'card' }, el('summary', { text: 'お題・チームお題・ご褒美を決める（代表）' }),
    el('h3', { text: '1日のお題の基準', style: 'margin:8px 0 0;font-size:14px' }),
    el('div', { class: 'muted', text: '「1日＝基準の時間」働いたときの数です。予定が短い日はその分少なくなります。' }),
    [['std', '基準の時間（時間）', .5], ['door', '訪販：訪問数'], ['face', '訪販：対面数'], ['call', '反響対応：対応数'], ['post', '配布：枚数', 10], ['got', '獲得数'], ['monthGot', '1か月の獲得の目安']].map(([k, l, s]) => el('label', { class: 'gf' }, l, num(k, g[k], s))),
    el('button', { class: 'btn primary', onclick: async () => { const d = {}; for (const k in inp) { const v = parseFloat(inp[k].value); d[k] = isFinite(v) && v >= 0 ? v : GOAL_DEF[k]; } try { await FB.cfg.set('goal', d); toast('お題の基準を保存しました'); } catch (e) { toast('保存できませんでした'); } } }, 'お題の基準を保存'),
    el('h3', { text: 'チームお題', style: 'margin:14px 0 0;font-size:14px' }),
    el('label', { class: 'field' }, 'お題の名前', qt), el('div', { class: 'row' }, el('label', { class: 'field', style: 'flex:1' }, '数えるもの', qk), el('label', { class: 'field', style: 'flex:1' }, '目標', qn), el('label', { class: 'field', style: 'flex:1' }, '期間', qp)),
    el('label', { class: 'field' }, '達成のご褒美', qr),
    el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: async () => { const n = parseInt(qn.value, 10); if (!(n > 0)) { toast('目標の数を入れてください'); return; } try { await FB.cfg.set('quest', { title: qt.value.trim(), kind: qk.value, target: n, period: qp.value, reward: qr.value.trim() }); toast('チームお題を出しました'); } catch (e) { toast('保存できませんでした'); } } }, 'チームお題を出す'),
      S.quest ? el('button', { class: 'btn', onclick: async () => { try { await FB.cfg.set('quest', { target: 0 }); toast('チームお題を終わりにしました'); } catch (e) {} } }, '終わりにする') : null),
    el('h3', { text: '今月のご褒美', style: 'margin:14px 0 0;font-size:14px' }),
    el('label', { class: 'field' }, '成績画面に出す文', rt),
    el('button', { class: 'btn primary', onclick: async () => { try { await FB.cfg.set('reward', { text: rt.value.trim() }); toast('ご褒美を保存しました'); } catch (e) { toast('保存できませんでした'); } } }, 'ご褒美を保存')));
}

// ===== 設定 =====
function renderSet(main){
  const ps = S.pushState;
  const pm = { granted: 'スマホにお知らせが届く状態です。', novapid: 'お知らせの許可は済んでいます（会社側の設定が終わると届き始めます）。', denied: 'お知らせが「許可しない」になっています。スマホの設定から、このアプリ（またはブラウザ）の通知を許可してください。', default: 'まだお知らせの許可をしていません。', needhome: 'iPhoneは、ホーム画面に追加したアイコンから開くと、お知らせを受け取れます。', unsupported: 'この端末ではスマホのお知らせが使えないため、メールでお知らせします。' }[ps] || '確認中…';
  add(main, el('section', { class: 'card' }, el('h3', { text: 'お知らせ' }), el('div', { text: pm }),
    ps === 'default' ? el('button', { class: 'btn primary', onclick: () => pushOn(true) }, 'お知らせを受け取る') : null,
    el('details', null, el('summary', { text: 'ホーム画面に追加するやり方' }),
      el('div', { class: 'muted', style: 'margin-top:6px' },
        el('div', null, '【iPhone】Safariでこの画面を開く → 下の「共有」ボタン（四角から上矢印） → 「ホーム画面に追加」 → ホーム画面の「業務管理」から開く → 「お知らせを受け取る」を押して「許可」。'),
        el('div', { style: 'margin-top:6px' }, '【Android】Chromeでこの画面を開く → 右上の「︙」 → 「ホーム画面に追加」（または「アプリをインストール」）。'))),
    el('div', { class: 'muted', text: 'お知らせは、予定の申告・開始・終了・日報を入れるまで30分ごとに届きます。休みを申告した日は届きません。' })));
  // 休みの予定
  const days = myDays();
  const offs = Object.keys(days).filter(d => d >= S.today && days[d].off).sort();
  const di = el('input', { type: 'date', min: `${S.today.slice(0, 4)}-${S.today.slice(4, 6)}-${S.today.slice(6)}` });
  add(main, el('section', { class: 'card' }, el('h3', { text: '休みの予定' }),
    el('div', { class: 'muted', text: '先に入れておくと、その日はお知らせが届かず、連続記録も途切れません。' }),
    el('div', { class: 'row' }, di, el('button', { class: 'btn primary', onclick: () => { const d = di.value.replace(/-/g, ''); if (d.length !== 8 || d < S.today) { toast('今日以降の日を選んでください'); return; } put(d, { off: true }, true); toast(`${md(d)}を休みにしました`); } }, 'この日を休みにする')),
    offs.length ? offs.map(d => el('div', { class: 'rec' }, el('div', { class: 'rt', text: md(d) }), el('button', { class: 'btn', onclick: () => put(d, { off: false }, true) }, '取り消す'))) : el('div', { class: 'muted', text: '入っている休みはありません。' })));
  const snd = el('input', { type: 'checkbox', id: 'snd', checked: store.get('sound', true), onchange: e => store.set('sound', e.target.checked) });
  add(main, el('section', { class: 'card' }, el('h3', { text: 'この端末' }), el('label', { class: 'row', for: 'snd' }, snd, '達成したときに音を鳴らす'),
    el('div', { class: 'row' }, el('a', { class: 'btn', href: 'guide.html' }, '使い方'), el('button', { class: 'btn', onclick: () => FB.signOut() }, 'ログアウト')),
    el('div', { class: 'muted', text: `ログイン中：${ME.email}` })));
  if (FB.isAdmin()) add(main, notifySwitch(), rosterBox());
}
// 自動のお知らせ・カレンダー反映を、代表が止めたり動かしたりする
function notifySwitch(){
  const on = !!(S.appcfg && S.appcfg.notify === true);
  return el('section', { class: 'card' + (on ? ' ok' : ' warn') }, el('h3', null, '自動のお知らせ（代表）', el('span', { class: 'st ' + (on ? 'good' : 'warn'), text: on ? '動いています' : '止めています' })),
    el('div', { class: 'muted', text: on ? '予定・開始・終了・日報の催促、Googleカレンダーへの反映、毎朝のまとめが動いています。' : '催促・カレンダー反映・毎朝のまとめは、すべて止まっています。始める準備ができたら「動かす」を押してください（10分以内に動き始めます）。' }),
    el('button', { class: 'btn ' + (on ? '' : 'primary'), onclick: async () => {
      if (!confirm(on ? '自動のお知らせを止めますか？' : '自動のお知らせを動かしますか？（全員に催促が届き始めます）')) return;
      try { await FB.cfg.set('app', Object.assign({}, S.appcfg || {}, { notify: !on })); toast(on ? '止めました' : '動かしました'); } catch (e) { toast('切り替えられませんでした'); }
    } }, on ? '止める' : '動かす'));
}
// 名簿：人の名前をそろえる。別名（ほかの表・リストでの書き方）も登録して、自動で本人に寄せる
function rosterBox(){
  const sec = el('section', { class: 'card' }, el('h3', null, '名簿（代表）', el('small', { text: '人の名前をここでそろえます' })));
  if (!S.users) { loadUsers().then(rerender); add(sec, el('div', { class: 'muted', text: '読み込み中…' })); return sec; }
  add(sec, el('div', { class: 'muted', text: '別名には、申込のスプレッドシートやソニーのリストなどで使われている書き方を「、」区切りで入れてください（例：佐藤、さとう、佐藤太郎）。取り込むときに、別名で自動で本人に寄せます。人の追加は訪問マップの「設定」から。' }));
  for (const u of S.users.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'))) {
    const nm = el('input', { type: 'text', value: u.name || '', 'aria-label': '表示名' });
    const al = el('input', { type: 'text', value: (u.al || []).join('、'), placeholder: '別名（、区切り）', 'aria-label': '別名' });
    const nt = el('input', { type: 'checkbox', checked: u.nt !== false, 'aria-label': 'お知らせ・成績の対象' });
    add(sec, el('div', { class: 'pedit' },
      el('div', { class: 'row' }, el('b', { text: u.email, style: 'font-size:12.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis' }), el('span', { class: 'tag', text: { admin: '管理者', staff: '社員', contractor: '業務委託' }[u.role] || u.role || '社員' })),
      el('div', { class: 'row' }, el('label', { class: 'field', style: 'flex:1' }, '表示名', nm)),
      el('label', { class: 'field' }, '別名', al),
      el('div', { class: 'row' }, el('label', { class: 'row', style: 'font-size:13px;flex:1' }, nt, 'お知らせ・成績の対象にする'),
        el('button', { class: 'btn', onclick: async () => {
          const aliases = [...new Set(al.value.split(/[、,，\n]/).map(x => x.trim()).filter(Boolean))];
          try { await FB.people.save(u.email, { name: nm.value.trim(), al: aliases, nt: nt.checked }); Object.assign(u, { name: nm.value.trim(), al: aliases, nt: nt.checked }); toast(`${nm.value.trim() || u.email}を保存しました`); } catch (e) { toast('保存できませんでした'); }
        } }, '保存'))));
  }
  return sec;
}
function appBox(){
  const v = el('input', { type: 'text', value: (S.appcfg && S.appcfg.vapid) || '', placeholder: 'B で始まる長い文字列' });
  return el('section', { class: 'card' }, el('h3', { text: 'スマホのお知らせの鍵（代表・最初に1回）' }),
    el('div', { class: 'muted', text: 'Firebaseの画面 →（歯車）プロジェクトの設定 →「Cloud Messaging」→ いちばん下の「ウェブプッシュ証明書」で「鍵ペアを生成」→ 出てきた鍵をここに貼って保存。' }),
    v, el('button', { class: 'btn primary', onclick: async () => { try { await FB.cfg.set('app', { vapid: v.value.trim() }); toast('保存しました。みんなの端末で順にお知らせが使えるようになります'); } catch (e) { toast('保存できませんでした'); } } }, '保存'));
}

// ---------- スマホのお知らせ ----------
let pushMod = null;
async function pushOn(ask){
  try {
    pushMod = pushMod || await import('./push.js?v=1');
    S.pushState = await pushMod.enable((S.appcfg && S.appcfg.vapid) || VAPID, ask);
    if (ask && S.pushState === 'granted') toast('お知らせを受け取れるようになりました');
    if (ask && S.pushState === 'denied') toast('「許可しない」になりました。スマホの設定から許可できます');
  } catch (e) { S.pushState = S.pushState || 'unsupported'; if (ask) toast('お知らせの設定ができませんでした。もう一度お試しください'); }
  rerender();
}
let pushTried = '';
function pushAuto(){ const k = (S.appcfg && S.appcfg.vapid) || VAPID; if (pushTried === k) return; pushTried = k; pushOn(false); }
window.addEventListener('push-in', e => { const d = e.detail || {}; toast(`${d.title || 'お知らせ'}：${d.body || ''}`); ding(1); });

// ---------- 起動 ----------
function go(tab){ S.tab = tab; store.set('tab', tab); if (tab === 'team') { S.week = null; loadTeam(); } if (tab === 'stats' && !S.mine) loadMine(); render(); window.scrollTo(0, 0); }
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
setInterval(() => {
  document.querySelectorAll('.clock[data-st]').forEach(e => { e.textContent = clock(Date.now() - +e.dataset.st); });
  if (FB && ME && S.today && ymd(Date.now()) !== S.today) { S.draft = null; S.editing = false; S.qkey = ''; S.week = null; watch(); }
}, 1000);
setInterval(() => { if (S.doc && Object.values(S.doc.ses || {}).some(s => !s.en)) rerender(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && ME) { if (S.tab === 'team') loadTeam(true); rerender(); } });

function gate(kind, email){
  const m = $('#main'); m.textContent = '';
  const box = el('div', { class: 'gbox' }, el('img', { src: 'img/logo.png', alt: 'AImost' }), el('h1', { text: '業務管理' }));
  if (kind === 'out') add(box, el('p', { text: '会社で許可されたGoogleアカウントでログインしてください。' }), el('button', { class: 'btn primary wide', onclick: async () => { try { await FB.signIn(); location.reload(); } catch (e) { toast('ログインできませんでした'); } } }, 'Googleでログイン'));
  else add(box, el('p', { text: `${email} は、まだ使える人に登録されていません。` }), el('p', { class: 'muted', text: '代表に、訪問マップの「設定」からこのアドレスを登録してもらってください。' }), el('button', { class: 'btn wide', onclick: () => FB.signOut() }, '別のアカウントでログインし直す'));
  m.append(el('div', { class: 'gate' }, box));
}
async function boot(){
  FB = window.FB || await new Promise(r => window.addEventListener('fb-ready', () => r(window.FB), { once: true }));
  const st = await FB.whenSignedIn();
  if (st.state !== 'in') { gate(st.state, st.email); return; }
  ME = st.me;
  $('#tabs').hidden = false;
  if (FB.isStaff()) $('#tabTeam').hidden = false;
  const t = store.get('tab', 'today'); S.tab = (t === 'team' && !FB.isStaff()) ? 'today' : t;
  watch();
  render();
  if (S.tab === 'team') loadTeam();
}
boot().catch(e => { console.error(e); $('#main').textContent = '読み込めませんでした。開き直してください。'; });
window.GY = { S, statOf, targetsOf, lifetime, render };
})();
