// 業務管理アプリ本体：今日（予定・開始/終了・反響対応・配布）／成績／チーム／設定
// 表はゲームのように楽しく、裏では時間あたりの生産性と入力漏れをきっちり見る。
(function(){
'use strict';

// ---------- 決まりごと ----------
const KIND = { door: '訪販', call: '反響対応', post: '配布', other: '事務・その他' };
const KIND_ORDER = ['door', 'call', 'post', 'other'];
const KC = { door: 'var(--k-door)', call: 'var(--k-call)', post: 'var(--k-post)', other: 'var(--k-other)' };
const HAN = [['call', '電話した', ''], ['msg', 'メッセージだけ', '電話せず文字で対応'], ['conn', 'つながった', '話せた'], ['apo', 'アポ・提案', '提案まで進んだ'], ['inv', '無効', 'いたずら・対象外など'], ['got', '獲得', '申込まで']];
const POST_TY = ['分譲', '賃貸', '混在'];
const GOAL_DEF = { brk: 1.5, brkMin: 4, std: 6, door: 60, face: 10, call: 15, post: 500, got: 1, monthGot: 20 };
const FACE = ['fng', 'again', 'got'];
const WEEK = '日月火水木金土';
// この日より前は、日報の出し忘れとして数えない（アプリを使い始めた日）
const START = '20261003';
const MAP_URL = 'https://aimost-iga.github.io/houmon-map/';
const KEIHI_FORM = 'https://forms.gle/WAtRmB79m35BkEXT9';
const FORM_KAKU = 'https://forms.gle/K5acTr1Ux2opE4WS8';   // NURO光（後確・申込連携）
const FORM_WEB = 'https://forms.gle/AJkjg6Lp4fe9Q7zm9';    // WEBエントリー連携（WEB申込・獲得顧客）
const KEIHI_SHEET = 'https://docs.google.com/spreadsheets/d/17kNPksAgkHaUjbqkWl9pVdyIbN9FKmGl2Ocnb7wM-VM/edit?gid=969630987#gid=969630987';
const KH_CAT = { train: '電車・バス', cycle: 'レンタサイクル', gas: 'ガソリン', park: '駐車場・高速', tel: '通信費', other: 'その他' };
const yen = n => '¥' + Math.round(+n || 0).toLocaleString();
// スマホのお知らせの鍵（公開してよい鍵。設定画面で差し替え可）
const VAPID = 'BL-8TMM-bqpyBIN-ASgKrLvFG2GN30s3M6I47dm1-L6kN0rDC8ZT31t9nYtV5EvxqkGzIxGpllxX3oE0LK9Uwuw';
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
// 訪問の登録時刻から、訪販で動いていた時間帯を出す。
// ・20秒未満の間隔、または違う建物なのに1分未満の間隔は「あとからのまとめ入力」とみなす
// ・始まり＝最初の本当の登録、終わり＝まとめ入力を除いた最後の登録
// ・稼働時間＝終わり−始まり（休憩は別に引く。doorWork を参照）
const FAST = 20000, MOVE = 60000;
function doorBlocks(list){
  const xs = list.filter(x => +x.t).map(x => ({ t: +x.t, b: x.bid })).sort((a, b) => a.t - b.t);
  const fast = xs.map((x, i) => i > 0 && (x.t - xs[i - 1].t < FAST || (x.b !== xs[i - 1].b && x.t - xs[i - 1].t < MOVE)));
  // まとめ入力のかたまりの頭（1件目）も、まとめ入力の仲間とみなす
  const inBatch = xs.map((x, i) => fast[i] || (fast[i + 1] && runLen(fast, i + 1) >= 3));
  let run = 0, runMax = 0, batch = 0; fast.forEach(f => { run = f ? run + 1 : 0; runMax = Math.max(runMax, run); if (f) batch++; });
  const real = xs.filter((x, i) => !inBatch[i]);
  const out = real.length ? [[real[0].t, real[real.length - 1].t]] : [];
  out.batch = batch; out.batchRun = runMax;
  return out;
}
function runLen(fast, i){ let n = 0; while (i < fast.length && fast[i]) { n++; i++; } return n; }
// 訪販の稼働時間：始まりから終わりまでが「休憩を引き始める長さ」以上なら、休憩の時間を引く
function doorWork(spanMs){
  const g = S.goal || {}; const brk = (g.brk != null ? +g.brk : 1.5) * 3600000, min = (g.brkMin != null ? +g.brkMin : 4) * 3600000;
  return spanMs >= min ? Math.max(0, spanMs - brk) : spanMs;
}
const CAL_K = { door: 'door', call: 'call', post: 'post', apo: 'other', other: 'other' };
// 予定の名前の言葉で種類を決める（代表が管理画面で言葉を変えられる。Apps Script の KW_DEF と同じ）
const KW_DEF = { door: '訪販,訪問,ドア,ローラー', call: '反響,架電,電話,コール,テレ', post: '配布,ポスティング,ポス,チラシ', apo: 'アポ,商談,面談', ng: '' };
const kwList = v => String(v || '').split(/[,、，\n]/).map(x => x.trim()).filter(Boolean);
function kindOf(t){
  const kw = Object.assign({}, KW_DEF, (S.appcfg && S.appcfg.kw) || {}); t = String(t || '');
  for (const k of ['door', 'call', 'post', 'apo']) { if (k === 'post' && kwList(kw.ng).some(w => t.includes(w))) continue; if (kwList(kw[k]).some(w => t.includes(w))) return k; }
  return 'other';
}
// 予定ごとの印（Apps Script の sig_ と同じ計算）
function sigOf(e){ const s = e.s + '|' + e.e + '|' + e.t; let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return 'x' + h.toString(36); }
// カレンダーの予定（種類は名前の言葉か、本人が直した種類）＋アプリから入れてカレンダー待ちの予定
function calEv(doc){
  if (!doc) return [];
  const fix = doc.fix || {};
  const out = ((doc.cal && doc.cal.ev) || []).map(e => { const sig = sigOf(e); return { s: e.s, e: e.e, t: e.t, sig, k: fix[sig] || kindOf(e.t), fixed: !!fix[sig] }; });
  for (const id in (doc.add || {})) { const a = doc.add[id]; if (a && !a.st) out.push({ s: a.s, e: a.e, t: a.t, sig: 'a' + id, k: a.k, wait: 1 }); }
  return out.sort((a, b) => a.s < b.s ? -1 : 1);
}
// 配布の予定が終わったのに、配布の報告も「配っていない」もない予定
function postDue(doc, d){
  if (!doc || doc.off || doc.pnone || Object.keys(doc.post || {}).length) return [];
  const nowM = d < S.today ? 1e9 : d > S.today ? -1 : new Date().getHours() * 60 + new Date().getMinutes();
  return calEv(doc).filter(e => e.k === 'post' && !e.wait && toMin(e.e === '24:00' ? '23:59' : e.e) <= nowM);
}
// その日の期間の配布エリア（ポスティング反響台帳から自動で入る）
// 並び：自分が配る担当のエリア → 配布済みのエリア → そのほかのリストのエリア
const isMe = who => { if (!who) return false; const w = String(who).replace(/\s/g, ''); const names = [ME.name].concat(((S.users || []).find(u => u.email === ME.id) || {}).al || []).map(x => String(x || '').replace(/\s/g, '')).filter(Boolean); return names.some(n => n === w || n.startsWith(w) || w.startsWith(n)); };
function areasFor(d){
  const ds = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  const per = ((S.areas && S.areas.rounds) || []).filter(r => r && r.start <= ds && (!r.end || ds <= r.end));
  const m = new Map();
  per.forEach(r => (r.areas || []).forEach(a => { const o = m.get(a.a); if (o) { o.on = o.on || a.on; o.mine = o.mine || isMe(a.who); } else m.set(a.a, Object.assign({}, a, { mine: isMe(a.who) })); }));
  const rank = a => a.mine ? 0 : a.on ? 1 : 2;
  return { per: per.map(r => ({ label: r.name })), list: [...m.values()].sort((x, y) => rank(x) - rank(y) || y.h - x.h) };
}
// 最後に動いた時刻（訪問の登録・開始/終了・反響・配布の記録）
function lastMove(doc, st){
  let t = 0;
  (st.blocks || []).forEach(b => { t = Math.max(t, b[1] - 5 * 60000); });
  for (const id in ((doc || {}).ses || {})) { const x = doc.ses[id]; t = Math.max(t, x.en || 0); }
  for (const f of ['han', 'post']) for (const id in ((doc || {})[f] || {})) t = Math.max(t, +doc[f][id].t || 0);
  return t;
}
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
  const al = live ? actOf(u || doc.u || ME.id) : null;
  const v = live ? visits(al) : Object.assign({ doors: 0, face: 0, got: 0 }, doc.v || {});
  // 訪販の時間：開始・終了ボタンの時間と、訪問マップの登録時刻から出した時間の、長い方
  const blocks = live ? doorBlocks(al) : [];
  const raw = live ? blocks.reduce((a, b) => a + b[1] - b[0], 0) : (+(doc.v && doc.v.span) || 0);
  const span = doorWork(raw);
  const batchRun = live ? blocks.batchRun : (+(doc.v && doc.v.batchRun) || 0);
  const doorAuto = span > h.door;
  if (doorAuto) h.door = span;
  if (live && blocks.length && (first == null || blocks[0][0] < first)) first = blocks[0][0];
  const han = { call: 0, msg: 0, conn: 0, apo: 0, inv: 0, got: 0 };
  for (const id in (doc.han || {})) { const r = doc.han[id] || {}; for (const [k] of HAN) han[k] += +r[k] || 0; }
  han.all = han.call + han.msg;
  let post = 0; const postBy = {};
  for (const id in (doc.post || {})) { const p = doc.post[id] || {}; post += +p.n || 0; postBy[p.ty || '混在'] = (postBy[p.ty || '混在'] || 0) + (+p.n || 0); }
  const got = v.got + han.got;
  const work = h.door + h.call + h.post + h.other;
  const own = Object.entries(doc.plan || {}).map(([id, p]) => Object.assign({ id }, p)).sort((a, b) => (toMin(a.s) || 0) - (toMin(b.s) || 0));
  // カレンダーの予定（共有されたGoogleカレンダーから自動で入る）
  const cal = calEv(doc).map((e, i) => ({ id: 'c' + i, k: CAL_K[e.k] || 'other', s: e.s, e: e.e, m: e.t, cal: 1, apo: e.k === 'apo', wait: e.wait, sig: e.sig, ck: e.k }));
  const plan = own.length ? own : cal;
  const ph = { door: 0, call: 0, post: 0, other: 0 };
  for (const p of plan) { const a = toMin(p.s), b = toMin(p.e === '24:00' ? '23:59' : p.e); if (a != null && b != null && b > a) ph[p.k] = (ph[p.k] || 0) + (b - a) * 60000; }
  const off = !!doc.off || !!(doc.cal && doc.cal.off && !own.length && !work);
  return { h, work, running, first, v, han, post, postBy, got, plan, cal, own, ph, blocks, doorAuto, batchRun, off, sub: 0 /* 日報はやめた（2026-10） */, has: !!(plan.length || work || v.doors) };
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
function myDays(){
  const m = {}; for (const d of (S.mine || [])) if (d && d.d) m[d.d] = d;
  if (S.doc) m[S.today] = S.doc; if (S.ydoc) m[S.yday] = S.ydoc; if (S.tdoc) m[S.tmr] = S.tdoc;
  return m;
}
function sumRange(days, from, to, u){
  const t = { h: { door: 0, call: 0, post: 0, other: 0 }, plan: 0, work: 0, doors: 0, face: 0, doorGot: 0, got: 0, post: 0, han: 0, call: 0, conn: 0, apo: 0, hgot: 0, days: 0, ok: 0, subs: 0, off: 0, batchDays: 0 };
  for (const d in days) {
    if (d < from || d > to) continue;
    const st = statOf(days[d], d === S.today, u);
    for (const k in t.h) t.h[k] += st.h[k];
    t.plan += Object.values(st.ph).reduce((a, b) => a + b, 0); t.work += st.work; t.doors += st.v.doors; t.face += st.v.face; t.doorGot += st.v.got; t.got += st.got; t.post += st.post;
    t.han += st.han.all; t.call += st.han.call; t.conn += st.han.conn; t.apo += st.han.apo; t.hgot += st.han.got;
    if (st.work || st.v.doors) t.days++; if (st.sub) t.subs++; if (st.off) t.off++; if (st.batchRun >= 5) t.batchDays++;
    if (achieved(targetsOf(st))) t.ok++;
  }
  return t;
}
const monthStart = s => s.slice(0, 6) + '01';
function weekStart(s){ const d = toDate(s); return addDays(s, -((d.getDay() + 6) % 7)); }
function lastMonthSame(s){ const d = toDate(s); const a = new Date(d.getFullYear(), d.getMonth() - 1, 1); const last = new Date(d.getFullYear(), d.getMonth(), 0).getDate(); return [ymd(a), ymd(new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), last)))]; }
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
// Googleカレンダーに予定を入れる：入力した内容でカレンダーの「予定を作成」画面を開く（本人のカレンダーに入る）
function calForm(){
  let k = 'door';
  const now = new Date(); const nx = Math.min(22, now.getHours() + 1);
  const s1 = el('input', { type: 'time', value: pad(nx) + ':00', 'aria-label': '始める時刻' });
  const e1 = el('input', { type: 'time', value: pad(Math.min(23, nx + 3)) + ':00', 'aria-label': '終わる時刻' });
  const memo = el('input', { type: 'text', placeholder: '例：青葉区 美しが丘、○○様 など（任意）' });
  const chips = el('div', { class: 'chips' });
  const KL = { door: '訪販', call: '反響', post: '配布', apo: 'アポ', other: 'その他' };
  const draw = () => { chips.textContent = ''; Object.keys(KL).forEach(x => add(chips, el('button', { type: 'button', 'aria-pressed': String(x === k), onclick: () => { k = x; draw(); } }, KL[x]))); };
  draw();
  const close = modal('Googleカレンダーに予定を入れる', [
    el('div', { class: 'field' }, 'やること', chips),
    el('div', { class: 'pline' }, el('span', { class: 'tilde', style: 'grid-column:1/5;grid-row:1;justify-self:start', text: '時間' }), s1, el('span', { class: 'tilde', text: '〜' }), e1),
    el('label', { class: 'field' }, 'メモ', memo),
    el('div', { class: 'muted', text: '「カレンダーで開く」を押すと、Googleカレンダーの予定の作成画面が開きます。そこで「保存」を押してください。名前の頭に「訪販」などが入るので、アプリで種類ごとに数えられます。' }),
    el('button', { class: 'btn primary wide', onclick: () => {
      const a = toMin(s1.value), b = toMin(e1.value);
      if (a == null || b == null || b <= a) { toast('終わる時刻は、始める時刻より後にしてください'); return; }
      const d = S.today, f = t => d + 'T' + t.replace(':', '') + '00';
      const title = KL[k] + (memo.value.trim() ? ' ' + memo.value.trim() : '');
      const url = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + f(s1.value) + '/' + f(e1.value) + '&ctz=Asia/Tokyo&details=' + encodeURIComponent('業務管理アプリから');
      window.open(url, '_blank', 'noopener'); close(); toast('カレンダーで「保存」を押してください');
    } }, 'カレンダーで開く'),
    el('button', { class: 'btn wide', onclick: () => close() }, 'やめる')]);
}
function areaNames(){
  const s = new Set();
  for (const d of Object.values(myDays())) for (const id in (d.post || {})) if (d.post[id].a) s.add(d.post[id].a);
  return [...s].slice(-40);
}
// 配布の報告：その日の期間の配布エリア（台帳）から選ぶ。リストにないエリアは手で入れる
function postForm(run, day, ev){
  day = day || S.today;
  let ty = store.get('postTy', '分譲'), pick = '';
  const ar = areasFor(day);
  // 予定の名前にエリアが入っていれば、最初から選んでおく（例：「ポス 戸田市」→ 戸田市、「配布 青葉区」→ 横浜市青葉区）
  if (ev && ev.t) { const hit = ar.list.find(a => ev.t.includes(a.a) || ev.t.includes(a.a.replace(/^.+?市(?=.+区$)/, ''))); if (hit) pick = hit.a; }
  const done = new Set(Object.values((myDays()[day] || {}).post || {}).map(p => p.a));
  const area = el('input', { type: 'text', placeholder: ar.list.length ? 'リストにないときは、ここに入れる' : '例：横浜市青葉区 美しが丘', list: 'gyAreas' });
  const dl = el('datalist', { id: 'gyAreas' }, [...new Set(areaNames().concat(ar.list.map(a => a.a)))].map(a => el('option', { value: a })));
  const flt = el('input', { type: 'search', placeholder: '絞り込み（例：青葉）', 'aria-label': 'エリアを絞り込む' });
  const grid = el('div', { class: 'achips' });
  const drawAreas = () => { grid.textContent = ''; const q = flt.value.trim(); ar.list.filter(a => !q || a.a.includes(q) || (a.grp || '').includes(q)).forEach(a => add(grid, el('button', { type: 'button', 'aria-pressed': String(pick === a.a), onclick: () => { pick = pick === a.a ? '' : a.a; area.value = ''; drawAreas(); } }, el('b', { text: a.a }), el('small', { text: `${a.mine ? 'あなたの担当・' : a.on ? '配布済み・' : ''}${a.b}棟・${nf(a.h)}戸${done.has(a.a) ? '・報告済み' : ''}` })))); };
  flt.addEventListener('input', drawAreas); area.addEventListener('input', () => { if (area.value.trim()) { pick = ''; drawAreas(); } });
  drawAreas();
  const num = el('input', { type: 'number', inputmode: 'numeric', min: 0, placeholder: '例：400' });
  const chips = el('div', { class: 'chips' });
  const drawChips = () => { chips.textContent = ''; POST_TY.forEach(t => add(chips, el('button', { type: 'button', 'aria-pressed': String(t === ty), onclick: () => { ty = t; store.set('postTy', t); drawChips(); } }, t))); };
  drawChips();
  const save = more => {
    const n = parseInt(num.value, 10); const a = (pick || area.value.trim());
    if (!a) { toast('配ったエリアを選ぶか入れてください'); return; }
    if (!(n > 0)) { toast('配った枚数を入れてください'); num.focus(); return; }
    const p = { a, n, t: Date.now() }; if (run) p.sid = run.id; if (pick) p.list = 1; if (ev) p.ev = ev.sig;
    close();
    const patch = { post: { [uid()]: p } };
    if (run) endSession(patch); else { put(day, patch); toast(`${a} ${nf(n)}枚を記録しました`); }
    if (more) setTimeout(() => postForm(null, day, ev), 300);
  };
  const close = modal(run ? '配布の結果を入れて終了' : `配布の報告${day !== S.today ? '（' + md(day) + '）' : ''}`, [
    ev ? el('div', { class: 'muted', text: `予定：${ev.s}〜${ev.e}「${ev.t}」` }) : null,
    el('div', { class: 'field' }, ar.per.length ? `配ったエリア（${ar.per.map(p => p.label).join('・')}の台帳の全${ar.list.length}エリア）` : '配ったエリア', ar.list.length ? [flt, grid] : el('div', { class: 'muted', text: 'この期間の配布エリアが、ポスティング反響台帳にまだありません。下に入れてください。' })),
    el('label', { class: 'field' }, ar.list.length ? 'リストにないエリア' : 'エリア（市区町村・町名）', area, dl),
    el('label', { class: 'field' }, '配った枚数', num),
    el('button', { class: 'btn primary wide', onclick: () => save(false) }, run ? '記録して終了する' : '記録する'),
    run ? null : el('button', { class: 'btn wide', onclick: () => save(true) }, '記録して、別のエリアも入れる'),
    el('button', { class: 'btn wide', onclick: () => close() }, run ? 'まだ続ける（閉じる）' : 'やめる')
  ]);
  setTimeout(() => (pick ? num : ar.list.length ? flt : area).focus(), 50);
}
// 「配布」と判定された予定を直す：配布ではない／配っていない
function notPostForm(day, evs){
  const KL = { door: '訪販', call: '反響対応', apo: 'アポ・商談', other: 'その他（配布ではない）' };
  const why = el('input', { type: 'text', placeholder: '例：雨で中止、チラシが届かなかった' });
  const close = modal('この予定は配布ではない・配っていない', [
    el('div', { class: 'muted', text: evs.map(e => `${e.s}〜${e.e}「${e.t}」`).join('　') }),
    el('div', { class: 'field' }, '配布ではない予定だった（種類を直す）', el('div', { class: 'chips' }, Object.keys(KL).map(k => el('button', { type: 'button', onclick: () => {
      const fix = {}; evs.forEach(e => { fix[e.sig] = k; }); close(); put(day, { fix }); toast(`「${KL[k]}」に直しました`);
    } }, KL[k])))),
    el('label', { class: 'field' }, '配布の予定だったが、配っていない（理由）', why),
    el('button', { class: 'btn wide', onclick: () => { if (!why.value.trim()) { toast('配っていない理由を入れてください'); why.focus(); return; } close(); put(day, { pnone: why.value.trim() }); toast('「配っていない」で記録しました'); } }, '配っていないで記録する'),
    el('button', { class: 'btn wide', onclick: () => close() }, 'やめる')]);
}
// カレンダーの予定の種類を直す（言葉で自動判定した種類がちがうとき）
function kindFix(day, p){
  const KL = { door: '訪販', call: '反響対応', post: '配布', apo: 'アポ・商談', other: 'その他' };
  const close = modal('この予定の種類を直す', [
    el('div', { class: 'muted', text: `${p.s}〜${p.e}「${p.m}」は、いま「${KL[p.ck] || 'その他'}」として数えています。` }),
    el('div', { class: 'chips' }, Object.keys(KL).map(k => el('button', { type: 'button', 'aria-pressed': String(k === p.ck), onclick: () => { close(); put(day, { fix: { [p.sig]: k } }); toast(`「${KL[k]}」に直しました`); } }, KL[k]))),
    el('div', { class: 'muted', text: '名前の言葉で自動で決めています。いつも間違う言葉があれば、代表に伝えてください（管理の画面で言葉を直せます）。' }),
    el('button', { class: 'btn wide', onclick: () => close() }, 'やめる')]);
}
// 配布の報告がまだの日（今日・使い始めてからの日）
function postDueBox(){
  const days = myDays(); const out = [];
  Object.keys(days).filter(d => d <= S.today && (d >= START || d === S.today) && d >= addDays(S.today, -31)).sort().forEach(d => { const l = postDue(days[d], d); if (l.length) out.push([d, l]); });
  if (!out.length) return null;
  return el('section', { class: 'card bad' }, el('h3', { text: '配布の報告がまだです' }),
    el('div', { class: 'muted', text: '配布・ポスティングの予定がありました。どのエリアに何枚配ったかを入れてください（入れるまでお知らせが届きます）。' }),
    out.map(([d, l]) => el('div', { class: 'due' },
      el('div', { class: 'due-h' }, el('b', { text: d === S.today ? '今日' : md(d) }), el('span', { text: l.map(e => `${e.s}〜${e.e} ${e.t}`).join('／') })),
      el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: () => postForm(null, d, l[0]) }, 'エリアと枚数を入れる'), el('button', { class: 'link', onclick: () => notPostForm(d, l) }, '配布ではない・配っていない')))));
}
// 予定をまとめてGoogleカレンダーに入れる：日付にチェック → 種類・時間・メモ → まとめて登録
function bulkForm(){
  let k = store.get('bulkK', 'door'), mOff = 0; const picked = new Set();
  const KL = { door: '訪販', post: '配布', call: '反響', apo: 'アポ', other: 'その他' };
  const days = myDays();
  const s1 = el('input', { type: 'time', value: store.get('bulkS', '10:00'), 'aria-label': '始める時刻' });
  const e1 = el('input', { type: 'time', value: store.get('bulkE', '18:00'), 'aria-label': '終わる時刻' });
  const memo = el('input', { type: 'text', placeholder: '例：横浜市青葉区（任意）', list: 'gyAreas2' });
  const dl = el('datalist', { id: 'gyAreas2' });
  const chips = el('div', { class: 'chips' }); const cal = el('div', { class: 'mcal' }); const btn = el('button', { class: 'btn primary wide' });
  const drawChips = () => { chips.textContent = ''; Object.keys(KL).forEach(x => add(chips, el('button', { type: 'button', 'aria-pressed': String(x === k), onclick: () => { k = x; store.set('bulkK', k); drawChips(); } }, KL[x]))); };
  const drawCal = () => {
    cal.textContent = '';
    const t = toDate(S.today); const first = new Date(t.getFullYear(), t.getMonth() + mOff, 1); const y = first.getFullYear(), m = first.getMonth();
    add(cal, el('div', { class: 'mc-h' }, el('button', { type: 'button', class: 'mc-nav', disabled: mOff <= 0, 'aria-label': '前の月', onclick: () => { mOff--; drawCal(); } }, '‹'), el('b', { text: `${y}年${m + 1}月` }), el('button', { type: 'button', class: 'mc-nav', disabled: mOff >= 2, 'aria-label': '次の月', onclick: () => { mOff++; drawCal(); } }, '›')));
    const g = el('div', { class: 'mc-g' }); '月火水木金土日'.split('').forEach(w => add(g, el('span', { class: 'mc-w', text: w })));
    for (let i = 0; i < (first.getDay() + 6) % 7; i++) add(g, el('span'));
    const last = new Date(y, m + 1, 0).getDate();
    for (let dd = 1; dd <= last; dd++) {
      const d = ymd(new Date(y, m, dd)); const doc = days[d]; const ev = calEv(doc);
      const off = doc && (doc.off || (doc.cal && doc.cal.off)); const wd = new Date(y, m, dd).getDay();
      add(g, el('button', { type: 'button', class: 'mc-d' + (wd === 0 ? ' sun' : wd === 6 ? ' sat' : '') + (d === S.today ? ' today' : ''), disabled: d < S.today, 'aria-pressed': String(picked.has(d)), 'aria-label': `${md(d)}${ev.length ? ' 予定あり' : ''}${off ? ' 休み' : ''}`,
        onclick: () => { picked.has(d) ? picked.delete(d) : picked.add(d); drawCal(); } }, el('span', { text: String(dd) }), off ? el('small', { text: '休' }) : ev.length ? el('i', { class: 'mc-dots' }, [...new Set(ev.map(e => e.k))].slice(0, 3).map(x => el('b', { style: `background:${CKC[x] || CKC.other}` }))) : null));
    }
    add(cal, g, el('div', { class: 'row mc-q' }, el('button', { type: 'button', class: 'link', onclick: () => { for (let dd = 1; dd <= last; dd++) { const dt = new Date(y, m, dd); const d = ymd(dt); if (d >= S.today && dt.getDay() > 0 && dt.getDay() < 6 && !(days[d] && (days[d].off || (days[d].cal && days[d].cal.off)))) picked.add(d); } drawCal(); } }, 'この月の平日を全部'), el('button', { type: 'button', class: 'link', onclick: () => { picked.clear(); drawCal(); } }, 'チェックを外す')));
    btn.textContent = picked.size ? `${picked.size}日分をGoogleカレンダーに入れる` : '日付をチェックしてください';
    const dd0 = [...picked].sort()[0] || S.today; dl.textContent = ''; areasFor(dd0).list.forEach(a => add(dl, el('option', { value: a.a })));
  };
  drawChips(); drawCal();
  btn.onclick = async () => {
    if (!picked.size) { toast('日付をチェックしてください'); return; }
    const a = toMin(s1.value), b = toMin(e1.value);
    if (a == null || b == null || b <= a) { toast('終わる時刻は、始める時刻より後にしてください'); return; }
    store.set('bulkS', s1.value); store.set('bulkE', e1.value);
    const t = KL[k] + (memo.value.trim() ? ' ' + memo.value.trim() : '');
    const list = [...picked].sort(); close();
    for (const d of list) await put(d, { add: { [uid()]: { k, s: s1.value, e: e1.value, t, at: Date.now() } }, q: true }, true);
    toast(`${list.length}日分を登録しました。10分ほどでGoogleカレンダーに入ります`);
  };
  const close = modal('予定をまとめてカレンダーに入れる', [
    el('div', { class: 'muted', text: '入れたい日をタップしてチェック。点は、もう入っている予定です。' }),
    cal,
    el('div', { class: 'field' }, 'やること', chips),
    el('div', { class: 'pline' }, el('span', { class: 'tilde', style: 'grid-column:1/5;grid-row:1;justify-self:start', text: '時間' }), s1, el('span', { class: 'tilde', text: '〜' }), e1),
    el('label', { class: 'field' }, 'メモ（予定の名前に入ります）', memo, dl),
    btn,
    el('div', { class: 'muted', text: 'Googleカレンダーには「訪販 横浜市青葉区」のような名前で入ります。消したいときはGoogleカレンダーで消してください。' }),
    el('button', { class: 'btn wide', onclick: () => close() }, 'やめる')]);
}
// これから入れる予定（カレンダー待ち・入った・入らなかった）
function addsBox(){
  const days = myDays(); const rows = [];
  Object.keys(days).filter(d => d >= S.today).sort().forEach(d => { for (const id in (days[d].add || {})) { const a = days[d].add[id]; if (a && (!a.st || (a.done && Date.now() - a.done < 86400000) || a.st === 'ng')) rows.push([d, a]); } });
  const sec = el('section', { class: 'card' }, el('h3', null, '予定をまとめて入れる', el('small', { text: '訪販・配布など' })),
    el('div', { class: 'muted', text: 'カレンダーで日付にチェックするだけで、Googleカレンダーにまとめて入ります。' }),
    el('button', { class: 'btn primary wide', onclick: () => bulkForm() }, '日付を選んで入れる'));
  if (rows.length) add(sec, el('div', { class: 'adds' }, rows.slice(0, 5).map(([d, a]) => el('div', { class: 'rec' }, el('div', { class: 'rt' }, `${md(d)} ${a.s}〜${a.e}`, el('small', { text: a.t })), el('span', { class: 'st ' + (!a.st ? 'warn' : a.st === 'ok' ? 'good' : 'bad'), text: !a.st ? '登録待ち' : a.st === 'ok' ? (a.how === 'inv' ? '招待で登録' : '登録済み') : '入らなかった' }))), rows.length > 5 ? el('div', { class: 'muted', text: `ほか ${rows.length - 5}件` }) : null));
  return sec;
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
  S.unsub.push(FB.act.watchDay(S.today, docs => { S.acts = docs || []; rerender(); }));
  S.unsub.push(FB.cfg.watch('goal', d => { S.goal = Object.assign({}, GOAL_DEF, d || {}); rerender(); }));
  S.unsub.push(FB.cfg.watch('app', d => { S.appcfg = d || {}; pushAuto(); rerender(); }));
  S.unsub.push(FB.cfg.watch('areas', d => { S.areas = d || {}; rerender(); }));
  S.unsub.push(FB.kh.mine(d => { S.kh = d; rerender(); }));
  S.unsub.push(FB.kh.sa(d => { S.sa = d; rerender(); }));
  S.unsub.push(FB.cfg.watch('arearesp', d => { S.resp = d; rerender(); }));
  if (FB.isAdmin()) S.unsub.push(FB.kh.saAll(d => { S.saAll = d; rerender(); }));
  if (FB.isAdmin()) S.unsub.push(FB.kh.all(d => { S.khAll = d; if (S.tab === 'admin') rerender(); }));
  if (FB.isAdmin()) S.unsub.push(FB.cfg.watch('calstat', d => { S.calstat = d || {}; if (S.tab === 'admin') rerender(); }));
  S.unsub.push(FB.ntc.watch(S.today, d => { S.ntc = d || {}; if (S.tab === 'team') rerender(); }));
  loadMine();
}
async function loadMine(){ const r = await FB.day.mine(); if (r) { S.mine = r; rerender(); } }
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
  $('#meBtn').setAttribute('aria-pressed', String(S.tab === 'set'));
  $('#admBtn').setAttribute('aria-pressed', String(S.tab === 'admin'));
  if (S.tab === 'set') renderSet(main); else if (S.tab === 'admin' && FB.isAdmin()) renderAdmin(main); else renderToday(main);
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
      el('div', { class: 'hsub', text: `${timeOf(r.st)} 開始・今日の合計 ${hm(st.work)}` }),
      el('button', { class: 'btn big', onclick: stopWork }, r.k === 'call' || r.k === 'post' ? '終了して結果を入れる' : '終了する'),
      r.k === 'door' ? el('a', { class: 'btn big', style: 'background:transparent;color:#fff;border-color:rgba(255,255,255,.6)', href: MAP_URL }, '訪問マップを開く') : null);
    return box;
  }
  if (st.off) { add(box, el('div', { class: 'hk', text: '今日は休み（申告済み）' }), el('div', { class: 'hsub', text: 'お知らせは止まっています。しっかり休んでください。' })); return box; }
  if (!st.plan.length && !st.work) { add(box, el('div', { class: 'hk', text: '今日の予定がまだ入っていません' }), el('div', { class: 'hsub', text: 'Googleカレンダーに今日の予定を入れると、ここに自動で出ます。休みの日はカレンダーに終日の「休み」を。' })); return box; }
  const next = nextPlan(st);
  add(box, el('div', { class: 'hk', text: st.work ? `今日の稼働 ${hm(st.work)}` : '今日もよろしくお願いします' }),
    el('div', { class: 'hsub', text: next ? `次の予定：${next.s}〜${next.e} ${next.cal ? next.m : KIND[next.k] + (next.m ? '（' + next.m + '）' : '')}` : '今日の予定はすべて終わりました。おつかれさまでした。' }),
    next && next.k !== 'other' ? el('button', { class: 'btn primary big', onclick: () => startWork(next.k, next.cal ? null : next.id) }, `${KIND[next.k]}を開始する`) : null,
    null);
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
    toast('今日の予定を申告しました。Googleカレンダーにも入ります');
  } }, 'この予定で申告する'));
  add(sec, el('div', { class: 'row' },
    el('button', { class: 'btn', onclick: () => { if (confirm('今日は休みとして申告しますか？（今日のお知らせは止まります）')) { S.draft = null; S.editing = false; put(S.today, { off: true }, true); } } }, '今日は休み'),
    el('button', { class: 'btn', onclick: () => { S.draft = null; S.editing = false; render(); } }, 'やめる')));
  return sec;
}
function planList(st){
  const ses = Object.values((S.doc && S.doc.ses) || {});
  const fromCal = !st.own.length && st.cal.length;
  const sec = el('section', { class: 'card' }, el('h3', null, el('span', { class: 'h3t' }, '今日の予定', fromCal ? el('span', { class: 'gcal', text: 'Googleカレンダー' }) : null),
    st.sub ? null : fromCal ? el('button', { class: 'link', onclick: () => calForm() }, '＋ カレンダーに足す') : el('button', { class: 'link', onclick: () => { S.editing = true; S.draft = null; render(); } }, '予定を直す')));
  for (const p of st.plan) {
    const mine = ses.filter(s => s.pid === p.id), run = mine.find(s => !s.en);
    const used = mine.reduce((a, s) => a + ((s.en || Date.now()) - s.st), 0);
    const nowM = new Date().getHours() * 60 + new Date().getMinutes();
    const past = p.cal && toMin(p.e) != null && toMin(p.e) <= nowM;
    add(sec, el('div', { class: 'pitem' + (run ? ' on' : mine.length || past ? ' done' : '') },
      el('span', { class: 'dot', style: `background:${KC[p.k]}` }),
      el('div', { class: 'pt' + (p.cal && !p.wait ? ' tap' : ''), onclick: p.cal && !p.wait && !st.sub ? () => kindFix(S.today, p) : null, title: p.cal ? '種類がちがうときはタップして直せます' : null }, el('b', { text: p.cal ? `${p.s}〜${p.e}　${p.m || KIND[p.k]}` : `${p.s}〜${p.e}　${KIND[p.k]}` }),
        p.cal ? el('small', { class: 'muted', text: (p.wait ? 'カレンダーに登録待ち・' : '') + (p.apo ? 'アポ・商談' : p.k === 'other' ? 'その他の予定' : KIND[p.k]) }) :
        (p.m || mine.length) ? el('small', { class: 'muted' }, run ? el('span', { class: 'pst', text: '実行中　' }) : mine.length ? el('span', { class: 'pst', text: `済 ${hm(used)}　` }) : null, p.m || '') : null),
      !run && !st.sub && !past && p.k !== 'other' ? el('button', { class: 'btn', onclick: () => startWork(p.k, p.cal ? null : p.id) }, mine.length ? '再開' : '開始') : null));
  }
  if (!st.sub && !st.running) add(sec, keepOpen('adhoc', el('details', null, el('summary', { text: '予定にない仕事を開始する' }),
    el('div', { class: 'row', style: 'margin-top:8px' }, KIND_ORDER.map(k => el('button', { class: 'btn', onclick: () => { S.open.adhoc = false; startWork(k); } }, KIND[k]))))));
  return sec;
}
function hanBox(st){
  const list = Object.entries((S.doc && S.doc.han) || {}).sort((a, b) => a[1].t - b[1].t);
  const h = st.han;
  if (!list.length && !st.sub) return el('section', { class: 'card slim' }, el('div', { class: 'slim-r' }, el('b', { text: '反響対応' }), el('small', { text: 'まだありません' }), el('button', { class: 'btn', onclick: () => hanForm(null) }, '＋ 反響対応を足す')));
  return el('section', { class: 'card' }, el('h3', null, '反響対応', el('small', { text: `対応${h.all}件` })),
    h.all || h.inv ? el('div', { class: 'kpis k3' }, [['電話', h.call], ['メッセージ', h.msg], ['つながった', h.conn], ['アポ・提案', h.apo], ['無効', h.inv], ['獲得', h.got]].map(([t, v]) => el('div', { class: 'kpi' }, el('b', { text: v }), el('span', { text: t })))) : null,
    list.map(([id, r]) => el('div', { class: 'rec' }, el('div', { class: 'rt' }, `${timeOf(r.t)}　電話${r.call || 0}・メッセ${r.msg || 0}・つながり${r.conn || 0}・アポ${r.apo || 0}・無効${r.inv || 0}・獲得${r.got || 0}`, r.m ? el('small', { text: r.m }) : null),
      st.sub ? null : el('button', { class: 'del', 'aria-label': 'この記録を消す', onclick: () => { if (confirm('この記録を消しますか？')) drop(S.today, 'han', id); } }, '×'))),
    st.sub ? null : el('button', { class: 'btn', onclick: () => hanForm(null) }, '＋ 反響対応を足す'));
}
function postBox(st){
  const list = Object.entries((S.doc && S.doc.post) || {}).sort((a, b) => a[1].t - b[1].t);
  if (S.doc && S.doc.pnone && !list.length) return el('section', { class: 'card' }, el('h3', null, '配布報告', el('small', { text: '配っていない' })), el('div', { class: 'muted', text: '理由：' + S.doc.pnone }), st.sub ? null : el('button', { class: 'btn', onclick: () => put(S.today, { pnone: null }) }, '取り消す'));
  if (!list.length && !st.sub) return el('section', { class: 'card slim' }, el('div', { class: 'slim-r' }, el('b', { text: '配布報告' }), el('small', { text: 'まだありません' }), el('button', { class: 'btn', onclick: () => postForm(null) }, '＋ 配布を足す')));
  return el('section', { class: 'card' }, el('h3', null, '配布報告', el('small', { text: `今日 ${nf(st.post)}枚` })),
    list.map(([id, p]) => el('div', { class: 'rec' }, el('div', { class: 'rt' }, p.a || 'エリア未記入'), el('b', { text: `${nf(p.n)}枚` }),
      st.sub ? null : el('button', { class: 'del', 'aria-label': 'この報告を消す', onclick: () => { if (confirm('この配布報告を消しますか？')) drop(S.today, 'post', id); } }, '×'))),
    st.sub ? null : el('button', { class: 'btn', onclick: () => postForm(null) }, '＋ 配布を足す'));
}
function reportBox(st){
  // 夕方まではたたんでおく（押すと開く）。夕方以降・直すときは開いておく
  const sec = el('details', { class: 'card fold' + (st.sub ? ' ok' : '') }, el('summary', null, el('span', { class: 'fs-t' }, '日報'), st.sub ? el('span', { class: 'stamp', text: '提出済み' }) : el('small', { text: '出すまでお知らせが届きます' })));
  if (S.editRep || (S.open.rep != null ? S.open.rep : !st.sub && new Date().getHours() >= 17)) sec.open = true;
  sec.addEventListener('toggle', () => { S.open.rep = sec.open; });
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
      const pd = postDue(S.doc, S.today);
      if (pd.length) { toast('先に配布の報告（エリアと枚数）を入れてください'); postForm(null, S.today, pd[0]); return; }
      if (!refl.value.trim()) { toast('振り返りをひとこと書いてください'); refl.focus(); return; }
      const first = !st.sub; const now = Date.now();
      const patch = { refl: refl.value.trim(), tmr: tmr.value.trim(), sub: st.sub || now };
      if (run) patch.ses = { [run.id]: Object.assign({}, S.doc.ses[run.id], { en: now }) };
      S.editRep = false; document.activeElement && document.activeElement.blur();
      if (off.checked !== !!(S.tdoc && S.tdoc.off)) put(S.tmr, { off: off.checked }, true);
      put(S.today, patch);
      toast(first ? '日報を提出しました。おつかれさまでした' : '日報を直しました');
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
  return out;
}
function pushNotice(){
  if (['granted', 'novapid', 'unsupported'].includes(S.pushState) || !S.pushState) return null;
  if (S.pushState === 'needhome') return el('section', { class: 'card warn' }, el('h3', { text: 'お知らせを受け取る準備をしてください' }), el('div', { class: 'muted', text: 'iPhoneは、この画面を「ホーム画面に追加」して、ホーム画面のアイコンから開くと、お知らせを受け取れるようになります。やり方は「設定」にあります。' }), el('button', { class: 'btn', onclick: () => go('set') }, '設定を開く'));
  return el('section', { class: 'card warn' }, el('h3', { text: 'お知らせを受け取る設定がまだです' }),
    el('div', { class: 'muted', text: S.pushState === 'denied' ? 'お知らせが「許可しない」になっています。スマホの設定から、このアプリ（またはブラウザ）の通知を許可してください。通知を切っているかどうかは代表の画面に出ます。' : '予定や日報の出し忘れを、スマホに直接お知らせします。下のボタンを押して「許可」を選んでください。' }),
    S.pushState === 'denied' ? null : el('button', { class: 'btn primary', onclick: () => pushOn(true) }, 'お知らせを受け取る'));
}
// ===== 今日の時間割（予定と実際を1本の線に重ねる） =====
function dayline(st){
  const plan = st.plan, ses = Object.entries((S.doc && S.doc.ses) || {}).map(([id, x]) => Object.assign({ id }, x));
  const now = new Date(); const nowM = now.getHours() * 60 + now.getMinutes();
  const base = toDate(S.today).getTime();
  const mins = [8 * 60, 20 * 60, nowM];
  plan.forEach(p => { const a = toMin(p.s), b = toMin(p.e); if (a != null) mins.push(a); if (b != null) mins.push(b); });
  ses.forEach(x => { mins.push((x.st - base) / 60000); mins.push(((x.en || Date.now()) - base) / 60000); });
  (st.blocks || []).forEach(b => { mins.push((b[0] - base) / 60000); mins.push((b[1] - base) / 60000); });
  const from = Math.max(0, Math.floor(Math.min(...mins) / 60) * 60), to = Math.min(24 * 60, Math.ceil(Math.max(...mins) / 60) * 60);
  const span = Math.max(60, to - from); const pos = m => ((m - from) / span * 100).toFixed(2) + '%'; const wid = (a, b) => (Math.max(0, b - a) / span * 100).toFixed(2) + '%';
  const track = el('div', { class: 'dl-track' });
  plan.forEach(p => { const a = toMin(p.s), b = toMin(p.e); if (a == null || b == null) return; add(track, el('i', { class: 'dl-plan', style: `left:${pos(a)};width:${wid(a, b)};--c:${KC[p.k]}`, title: `予定 ${p.s}〜${p.e} ${KIND[p.k]}` })); });
  ses.forEach(x => { const a = (x.st - base) / 60000, b = ((x.en || Date.now()) - base) / 60000; add(track, el('i', { class: 'dl-act' + (x.en ? '' : ' live'), style: `left:${pos(a)};width:${wid(a, b)};--c:${KC[x.k]}`, title: `実際 ${timeOf(x.st)}〜${x.en ? timeOf(x.en) : '今'} ${KIND[x.k]}` })); });
  (st.blocks || []).forEach(b => { const a = (b[0] - base) / 60000, e = (b[1] - base) / 60000; add(track, el('i', { class: 'dl-act auto', style: `left:${pos(a)};width:${wid(a, e)};--c:${KC.door}`, title: `訪問マップの登録 ${timeOf(b[0])}〜${timeOf(b[1])}` })); });
  if (nowM >= from && nowM <= to) add(track, el('b', { class: 'dl-now', style: `left:${pos(nowM)}` }));
  const ticks = el('div', { class: 'dl-ticks' });
  for (let m = from; m <= to; m += span > 600 ? 120 : 60) add(ticks, el('span', { style: `left:${pos(m)}`, text: String(m / 60) }));
  const planned = Object.values(st.ph).reduce((a, b) => a + b, 0);
  const legend = el('div', { class: 'dl-leg' }, KIND_ORDER.filter(k => st.ph[k] || st.h[k]).map(k => el('span', null, el('i', { style: `background:${KC[k]}` }), KIND[k])), el('span', { class: 'dl-key' }, el('i', { class: 'k-plan' }), '予定'), el('span', { class: 'dl-key' }, el('i', { class: 'k-act' }), '実際'));
  return el('section', { class: 'dayline', 'aria-label': '今日の予定と実際の時間' },
    el('div', { class: 'dl-head' }, el('div', null, el('small', { text: '稼働' }), el('b', { text: hm(st.work) })), el('div', null, el('small', { text: '予定' }), el('b', { text: planned ? hm(planned) : '—' })),
      el('div', null, el('small', { text: '予定に対して' }), el('b', { text: planned ? Math.round(st.work / planned * 100) + '%' : '—' }))),
    track, ticks, legend, mrow(st));
}
// 今日の数字を1行で（訪問・対面・獲得・反響・配布）
function mrow(st){
  const ts = st.off ? [] : targetsOf(st); const tg = l => ts.find(t => t.label === l);
  const cell = (label, val, t) => el('div', { class: 'mr' + (t && t.val >= t.tgt ? ' hit' : '') }, el('b', { text: val }), el('small', { text: label }),
    t ? el('div', { class: 'mt-bar' }, el('i', { style: `width:${Math.min(100, Math.round(t.val / t.tgt * 100))}%` })) : el('div', { class: 'mt-bar off' }), el('span', { text: t ? `/${nf(t.tgt)}` : '' }));
  return el('div', { class: 'mrow', 'aria-label': '今日の数字' }, cell('訪問', nf(st.v.doors), tg('訪問')), cell('対面', nf(st.v.face), tg('対面')), cell('獲得', nf(st.got), tg('獲得')), cell('反響', nf(st.han.all), tg('反響の対応')), cell('配布', nf(st.post), tg('配布枚数')));
}
// あいさつと日付
function greet(st){
  const d = toDate(S.today), h = new Date().getHours();
  const hi = h < 11 ? 'おはようございます' : h < 18 ? 'おつかれさまです' : 'おつかれさまでした';
  const recent = Date.now() - lastMove(S.doc, st) < 30 * 60000;
  const state = st.running ? `${KIND[st.running.k]}中` : st.off ? '休み' : recent ? '稼働中' : st.work ? '空き時間' : st.plan.length ? '開始前' : '予定なし';
  const live = st.running || recent;
  return el('section', { class: 'greet' },
    el('div', { class: 'gdate' }, el('b', { text: `${d.getMonth() + 1}月${d.getDate()}日` }), el('span', { text: `${WEEK[d.getDay()]}曜日` })),
    el('div', { class: 'ghi' }, `${hi}、${ME.name}さん`, el('span', { class: 'gst' + (live && !st.sub ? ' run' : st.sub ? ' ok' : ''), text: state })));
}
// 今日の数字（訪問マップと記録から自動）
function metrics(st){
  const ts = st.off ? [] : targetsOf(st); const tg = l => ts.find(t => t.label === l);
  const cell = (label, val, t, sub) => el('div', { class: 'mt' + (t && t.val >= t.tgt ? ' hit' : '') },
    el('small', { text: label }), el('b', { text: val }),
    t ? el('div', { class: 'mt-bar' }, el('i', { style: `width:${Math.min(100, Math.round(t.val / t.tgt * 100))}%` })) : null,
    el('span', { text: t ? `目標 ${nf(t.tgt)}` : sub || '' }));
  return el('section', { class: 'metrics', 'aria-label': '今日の数字' },
    cell('訪問', nf(st.v.doors), tg('訪問')), cell('対面', nf(st.v.face), tg('対面'), st.v.doors ? `対面率 ${Math.round(st.v.face / st.v.doors * 100)}%` : ''),
    cell('獲得', nf(st.got), tg('獲得'), st.got ? `訪販${st.v.got}・反響${st.han.got}` : ''),
    cell('反響対応', nf(st.han.all), tg('反響の対応'), st.han.all ? `アポ ${st.han.apo}` : ''), cell('配布', nf(st.post), tg('配布枚数'), ''));
}
// アクティビティ（社員・代表だけ）：今日の獲得と日報
function feedBox(){
  if (!FB.isStaff() || !S.week) return null;
  const ev = [];
  for (const d of S.acts) for (const k in d) { const v = d[k]; if (v && v.r === 'got' && !v.x && v.t) ev.push([v.t, v.u, '訪販で獲得', 'got']); }
  for (const d of S.week) { if (d.d !== S.today) continue; for (const id in (d.han || {})) { const r = d.han[id]; if (r && +r.got > 0) ev.push([r.t, d.u, `反響で獲得${r.got > 1 ? '×' + r.got : ''}`, 'got']); } if (d.sub) ev.push([d.sub, d.u, '日報を提出', 'sub']); }
  if (!ev.length) return null;
  ev.sort((a, b) => b[0] - a[0]);
  return el('section', { class: 'sec' }, el('h2', { class: 'sh', text: 'チームの動き' }),
    el('div', { class: 'list' }, ev.slice(0, 5).map(([t, u, txt, k]) => el('div', { class: 'li fd ' + k }, el('span', { class: 'av', text: (nameOf(u) || '?').slice(0, 1) }), el('span', { class: 'fx' }, el('b', { text: u === ME.id ? 'あなた' : nameOf(u) }), txt), el('small', { text: timeOf(t) })))));
}
function renderToday(main){
  const st = statOf(S.doc, true);
  add(main, greet(st), salesCard(), coachCard(), pointCard(), memoCard(), pushNotice(), postDueBox(), yesterdayBox(), heroBox(st), launcher());
  const editing = S.editing;
  if (!st.off && (st.plan.length || st.work || st.v.doors)) add(main, dayline(st));
  if (st.off && !editing) add(main, el('section', { class: 'card' }, el('h3', { text: '今日は休み' }), el('div', { class: 'muted', text: S.doc && S.doc.cal && S.doc.cal.off ? 'Googleカレンダーに「休み」が入っています。お知らせは止まっています。' : 'お知らせは止まっています。' }), S.doc && S.doc.off ? el('button', { class: 'btn', onclick: () => put(S.today, { off: false }, true) }, '休みを取り消す') : null));
  else if (editing && !st.sub) add(main, planEditor());
  else if (st.plan.length) add(main, planList(st));
  else if (!st.sub) add(main, el('section', { class: 'card forgot' }, el('h3', { text: '今日の予定、忘れていませんか？' }),
    el('div', { class: 'muted', text: 'Googleカレンダーに今日の予定が入っていません。ここから入れられます（アプリに出るまで10分ほどかかります）。' }),
    el('button', { class: 'btn primary wide', onclick: () => calForm() }, 'Googleカレンダーに予定を入れる'),
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: () => { if (confirm('今日は休みにしますか？（今日のお知らせは止まります）')) put(S.today, { off: true }, true); } }, '今日は休み')),
    keepOpen('adhoc2', el('details', null, el('summary', { text: '予定なしで仕事を開始する' }), el('div', { class: 'row', style: 'margin-top:8px' }, ['call', 'post', 'other'].map(k => el('button', { class: 'btn', onclick: () => startWork(k) }, KIND[k])))))));
  if (st.off && !editing) return;
  const used = k => st.ph[k] || st.h[k];
  const blocks = [[used('call') || st.han.all || st.han.inv, hanBox(st)], [used('post') || st.post, postBox(st)]];
  blocks.filter(b => b[0]).forEach(b => add(main, b[1]));
  const rest = blocks.filter(b => !b[0]).map(b => b[1]);
  if (rest.length && !st.sub) add(main, keepOpen('more', el('details', { class: 'card fold' }, el('summary', null, el('span', { class: 'fs-t', text: '予定にない記録' }), el('small', { text: '反響対応・配布' })), rest)));
}
// ===== 分析とアドバイス（カレンダーと実際の記録から。事実だけを冷静に） =====
// 比べるもの：①法律で決まった1日8時間・週40時間 ②会社の目標の基準（管理の画面で変更） ③自分の先月の同じ時期 ④台帳の全エリアの平均反響率
const LAW_DAY = 8;
function analyze(days, u, opt){
  opt = opt || {};
  const to = opt.to || S.today, from = opt.from || monthStart(to);
  const g = S.goal || GOAL_DEF; const out = [];
  const tip = (lv, title, fact, ask) => out.push({ lv, title, fact, ask });
  let planMs = 0, planDays = 0, workMs = 0, workDays = 0, emptyWd = 0, rough = 0, gapMs = 0, gapDays = 0, starts = [], kind = { door: 0, call: 0, post: 0, apo: 0, other: 0 };
  let doors = 0, face = 0, doorMs = 0, got = 0, han = 0, postN = 0, postMs = 0, batchDays = 0, wd = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const doc = days[d]; const dow = toDate(d).getDay(); const weekday = dow > 0 && dow < 6;
    const off = doc && (doc.off || (doc.cal && doc.cal.off));
    if (weekday && !off && d < S.today) wd++;
    const ev = calEv(doc).filter(e => !e.wait);
    if (ev.length) {
      planDays++; let mins = [];
      ev.forEach(e => { const a = toMin(e.s), b = toMin(e.e === '24:00' ? '23:59' : e.e); if (a == null || b == null || b <= a) return; planMs += (b - a) * 60000; kind[e.k] = (kind[e.k] || 0) + (b - a) * 60000; mins.push([a, b]); });
      if (ev.length === 1 && mins[0] && mins[0][1] - mins[0][0] >= 360) rough++;
      mins.sort((x, y) => x[0] - y[0]); if (mins.length) starts.push(mins[0][0]);
      let gm = 0; for (let i = 1; i < mins.length; i++) { const gap = mins[i][0] - Math.max(...mins.slice(0, i).map(m => m[1])); if (gap >= 90) gm += gap; }
      if (gm) { gapMs += gm * 60000; gapDays++; }
    } else if (weekday && !off && d < S.today && d >= START) emptyWd++;
    if (doc && d <= S.today) { const st = statOf(doc, d === S.today, u); if (st.work > 0) { workMs += st.work; workDays++; } doors += st.v.doors; face += st.v.face; doorMs += st.h.door; got += st.got; han += st.han.all; postN += st.post; postMs += st.ph.post || 0; if (st.batchRun >= 5) batchDays++; }
  }
  const avgPlan = planDays ? planMs / planDays / 3600000 : 0, avgWork = workDays ? workMs / workDays / 3600000 : 0;
  // 1. 予定の量
  if (planDays) {
    const lv = avgPlan < 5 ? 'warn' : avgPlan >= 7 ? 'good' : 'info';
    tip(lv, '1日の予定の量', `予定のある日は${planDays}日、1日平均${avgPlan.toFixed(1)}時間。法律で決まった1日の労働時間は${LAW_DAY}時間です。`,
      avgPlan < 5 ? '移動や準備の時間も予定に入れていますか？ 入れていないなら入れる、本当に少ないなら1日の組み方を見直してみましょう。' : avgPlan >= 7 ? '十分な量です。次は中身（成果の出る時間帯に、成果の出る仕事を置けているか）を見ましょう。' : 'あと1〜2時間、成果につながる仕事（訪販・反響対応）を足せないか考えてみましょう。');
  }
  // 2. 予定に対する実際
  if (planDays && workDays) {
    const rate = workMs / Math.max(1, planMs * Math.min(1, workDays / planDays));
    tip(rate < .7 ? 'warn' : 'info', '予定に対して実際に動いた時間', `実際に動いた日は1日平均${avgWork.toFixed(1)}時間（${workDays}日）。予定に対しておよそ${Math.round(Math.min(rate, 1.5) * 100)}%です。`,
      rate < .7 ? '予定と実際のずれが大きいです。予定が多すぎるのか、途中で止まっているのか、どちらか確かめてみましょう。' : '予定どおりに動けています。');
  }
  // 3. 予定も休みもない平日
  if (emptyWd) tip('warn', '予定も休みも入っていない平日', `${emptyWd}日あります。`, '休みならカレンダーに「休み」、仕事ならその日の予定を入れましょう。記録がない日は、何もしていない日と同じに見えてしまいます。');
  // 4. 中身の分からない大きな予定
  if (rough) tip('info', '中身が分からない大きな予定', `1日に6時間以上の予定が1つだけの日が${rough}日あります。`, '「訪販 青葉区」「反響」「配布 八潮市」のように分けて入れると、どこに時間を使ったかが見えて、自分でも改善しやすくなります。');
  // 5. 空き時間
  if (gapDays) tip(gapMs / gapDays / 3600000 >= 2 ? 'warn' : 'info', '予定と予定のあいだの空き時間', `1時間半以上の空きがある日が${gapDays}日、合計${h1(gapMs)}時間です。`, '移動・休憩・待ち時間のどれでしょう？ 移動ならエリアの順番、待ちなら反響対応や配布を入れられないか確認してみましょう。');
  // 6. 仕事の中身の割合
  const tot = Object.values(kind).reduce((a, b) => a + b, 0);
  if (tot) {
    const pct = k => Math.round((kind[k] || 0) / tot * 100);
    const earn = pct('door') + pct('call') + pct('apo');
    tip(pct('other') >= 30 ? 'warn' : 'info', '時間の使い方の内訳', `訪販${pct('door')}%・反響${pct('call')}%・アポ${pct('apo')}%・配布${pct('post')}%・その他${pct('other')}%。お客様と話す仕事（訪販・反響・アポ）は${earn}%です。`,
      pct('other') >= 30 ? '「その他」（事務・移動・中身の分からない予定）が多めです。まとめてできる事務や、なくせる作業がないか確認してみましょう。' : earn < 50 ? '獲得につながるのはお客様と話す時間です。半分以上をそこに使えると、数字が変わりやすくなります。' : 'お客様と話す時間がしっかり取れています。');
  }
  // 7. 始める時間
  if (starts.length >= 3) { const avg = starts.reduce((a, b) => a + b, 0) / starts.length; const hh = Math.floor(avg / 60), mm = Math.round(avg % 60);
    tip(avg >= 11 * 60 ? 'warn' : 'info', '1日の始まり', `最初の予定は平均${hh}時${pad(mm)}分。`, avg >= 11 * 60 ? '午前中が空きがちです。平日の日中は不在が多い時間帯なので、配布や事務を午前〜昼、訪販を夕方以降に寄せるなど、時間帯で仕事を分けてみましょう。' : '朝から動けています。'); }
  // 8. 訪販の効率
  if (doorMs > 3600000) { const ph = doors / (doorMs / 3600000), base = (g.door || 60) / (g.std || 6), fr = doors ? face / doors : 0;
    tip(ph < base * .8 ? 'warn' : 'good', '訪販の効率', `1時間あたり${ph.toFixed(1)}部屋（会社の基準 ${base.toFixed(1)}部屋）、対面率${Math.round(fr * 100)}%。`,
      ph < base * .8 ? '訪問の数が基準より少なめです。建物の回る順番や、1部屋にかける時間を見直してみましょう。' : fr < .15 ? '数は回れています。不在が多いなら、訪問する時間帯（夕方〜夜）を変えると対面が増えやすいです。' : '数も対面も取れています。対面からの獲得（話し方・提案）を磨く段階です。'); }
  if (batchDays) tip('warn', '訪問マップのまとめ入力', `あとからまとめて登録したとみられる日が${batchDays}日あります。`, 'その場で登録すると、どの時間帯に会えたかが分かり、次に回る時間の作戦が立てられます。');
  // 9. 配布の効率
  if (postN && postMs > 1800000) tip('info', '配布の効率', `配布は1時間あたりおよそ${Math.round(postN / (postMs / 3600000))}枚（予定の時間で計算）。`, '同じエリアで続けて配る、配る順番を地図で決めておくなどで枚数は伸ばせます。');
  // 10. 成果と先月比べ
  if (workMs > 10 * 3600000) tip(got ? 'good' : 'warn', '成果', `この期間の獲得は${got}件、動いた${h1(workMs)}時間あたり${(got / (workMs / 36000000)).toFixed(1)}件／10時間。反響対応${han}件。`, got ? '獲得までの流れ（どこで・いつ・どう話して取れたか）を言葉にして、毎回同じようにできる形にしましょう。' : '動いた時間に対して獲得がまだありません。対面できているのに取れないのか、そもそも会えていないのか、どちらかを確かめましょう。');
  // 11. 反響率（自分が配ったエリア）
  const rows = (S.resp && S.resp.rows) || []; const withRate = rows.filter(r => r.rate != null && r.dist > 300);
  if (opt.self !== false && withRate.length >= 3) { const avg = withRate.reduce((a, r) => a + r.rate, 0) / withRate.length;
    const mine = myPosts().list.map(([a]) => respOf(a)).filter(r => r && r.rate != null);
    if (mine.length) { const m = mine.reduce((a, r) => a + r.rate, 0) / mine.length;
      tip(m < avg * .8 ? 'warn' : 'good', '配ったエリアの反響率', `あなたが配ったエリアは平均${(m * 100).toFixed(2)}%、台帳の全エリア平均は${(avg * 100).toFixed(2)}%です。`, m < avg * .8 ? '反響が少ないエリアに時間を使っていないか、次の配布エリアを選ぶときに確認しましょう。' : '反響の取れるエリアを選べています。'); } }
  // 12. 経費
  if (opt.self !== false) { const ym = S.today.slice(0, 4) + '-' + S.today.slice(4, 6); const k = S.kh && S.kh.m && S.kh.m[ym]; const sa = S.sa && S.sa.m && S.sa.m[ym];
    if (k && k.t && sa && sa.acq) tip('info', '1件あたりの経費', `今月の経費${yen(k.t)}・獲得${sa.acq}件で、1件あたり${yen(k.t / sa.acq)}。`, '交通費の大きい日に成果が出ているかを見て、遠いエリアに行く価値があるか判断しましょう。'); }
  return out;
}
function coachBlock(items, title){
  if (!items.length) return null;
  const order = { warn: 0, info: 1, good: 2 };
  const list = items.slice().sort((a, b) => order[a.lv] - order[b.lv]);
  return el('details', { class: 'coach' }, el('summary', null, el('span', { text: title || '活動分析とポイント' }), el('small', { text: `気をつけたい点 ${items.filter(i => i.lv === 'warn').length}つ` })),
    list.map(i => el('div', { class: 'co ' + i.lv }, el('b', { text: i.title }), el('p', { text: i.fact }), el('p', { class: 'co-ask', text: i.ask }))),
    el('p', { class: 'co-note', text: '数字はGoogleカレンダーの予定と、アプリ・訪問マップの記録から自動で出しています。比べているのは、法律の労働時間（1日8時間）・会社の基準・台帳の平均です。' }));
}
function coachCard(){
  const items = analyze(myDays(), ME.id, { self: true });
  if (!items.length) return null;
  const top = items.filter(i => i.lv === 'warn')[0] || items[0];
  const box = el('section', { class: 'coachc' }, el('div', { class: 'cc-h' }, el('b', { text: '活動分析とポイント' }), el('small', { text: `${+S.today.slice(4, 6)}月・カレンダーと記録から` })),
    el('div', { class: 'co ' + top.lv }, el('b', { text: top.title }), el('p', { text: top.fact }), el('p', { class: 'co-ask', text: top.ask })),
    coachBlock(items.filter(i => i !== top), `ほかのポイント ${items.length - 1}件`));
  return box;
}
// ===== あなたのポイント：問いかけ・やりとりの確認・考え方（数字にからめて。記入はなし） =====
const ROLE_LINE = 'あなたの役割は、数字を作ることと、事業を大きくすること。現場の結果が、そのまま会社の結果です。';
const dayNo = () => Math.floor(toDate(S.today).getTime() / 86400000);
function pointFacts(){
  const cm = ymOf(0); const c = (S.sa && S.sa.m && S.sa.m[cm]) || {}; const d = toDate(S.today);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), passed = d.getDate();
  const pace = c.acq != null && passed ? Math.round(c.acq / passed * last) : null;
  const goal = (S.goal && S.goal.monthGot) || GOAL_DEF.monthGot;
  const k = S.kh && S.kh.m && S.kh.m[S.today.slice(0, 4) + '-' + S.today.slice(4, 6)];
  const posts = myPosts().list.map(([a, n]) => [a, n, respOf(a)]);
  const rows = (S.resp && S.resp.rows) || []; const rr = rows.filter(r => r.rate != null && r.dist > 300);
  const avg = rr.length ? rr.reduce((a, r) => a + r.rate, 0) / rr.length : null;
  const low = avg != null ? posts.find(([, , r]) => r && r.rate != null && r.rate < avg * .6) : null;
  // 今月いちばん時間を使った仕事（カレンダー）
  const kind = {}; for (const [dd, doc] of Object.entries(myDays())) { if (dd.slice(0, 6) !== S.today.slice(0, 6) || dd > S.today) continue; calEv(doc).forEach(e => { const a = toMin(e.s), b = toMin(e.e === '24:00' ? '23:59' : e.e); if (a != null && b > a) kind[e.k] = (kind[e.k] || 0) + (b - a); }); }
  const topK = Object.entries(kind).sort((a, b) => b[1] - a[1])[0];
  return { c, pace, goal, left: last - passed, k, low, avg, topK, kindName: { door: '訪販', call: '反響対応', post: '配布', apo: 'アポ・商談', other: '事務・その他' } };
}
function pointCard(){
  const f = pointFacts(); const n = dayNo(), wk = Math.floor((n + 3) / 7);
  // ① 今日の問い（数字があるものを優先）
  const qs = [];
  if (f.pace != null) qs.push(`今月の獲得は今${f.c.acq || 0}件。このままのペースだと月末に${f.pace}件です。目標の${f.goal}件に届かせるには、残り${f.left}日をどう使いますか？`);
  if (f.low) qs.push(`${f.low[0]}の反響率は${(f.low[2].rate * 100).toFixed(2)}%で、全エリア平均（${(f.avg * 100).toFixed(2)}%）の半分ほどです。次の配布もここにしますか？ 変えるならどこにしますか？`);
  if (f.topK) qs.push(`今月いちばん時間を使った仕事は「${f.kindName[f.topK[0]] || f.topK[0]}」で、約${Math.round(f.topK[1] / 60)}時間です。その時間は、売上にいくら返ってきましたか？`);
  if (f.c.acq && f.k && f.k.t) qs.push(`今月は1件取るのに経費が約${yen(f.k.t / f.c.acq)}かかっています。同じ1件を、もっと少ないお金と時間で取る方法はありますか？`);
  qs.push('今日の予定のうち、あなたにしかできない仕事はどれですか？ 人に任せられるものはありますか？');
  qs.push('いま会社の売上をいちばん増やせる一手は何だと思いますか？ それを今日の予定に入れていますか？');
  qs.push('今月の数字で、代表にまだ伝えていない「悪い知らせ」はありますか？');
  qs.push('もし来月、人が1人増えたら、あなたは何を任せて、自分は何に時間を使いますか？');
  const q = qs[n % qs.length];
  // ② 今週の確認（やりとり）
  const checks = ['今週、代表と数字と方針をすり合わせる時間を取りましたか？', '業務委託さん・代理店さんに、自分から連絡して状況を聞きましたか？', '工事日が決まらないお客様に、自分から連絡しましたか？', 'うまくいったやり方を、もう一人に伝えましたか？', '困っていること・止まっていることを、自分から代表に相談しましたか？', '自分の数字の見込み（今月あと何件取れるか）を、代表に伝えましたか？'];
  const ck = [0, 1, 2].map(i => checks[(wk * 3 + i) % checks.length]);
  // ⑤ 考え方（数字にからめて）
  const ad = [
    ['売上より粗利で考える', f.k && f.k.t ? `今月の経費は${yen(f.k.t)}。同じ1件でも、遠いエリアや配布の原価が大きいと、会社に残るお金（粗利）は減ります。` : '同じ1件でも、遠いエリアや配布の原価が大きいと、会社に残るお金（粗利）は減ります。'],
    ['自分が動くだけでは会社は大きくならない', '自分が取れる件数には上限があります。うまくいったやり方を、人に渡せる形（手順・話し方・回る順番）にするのが、会社を大きくする仕事です。'],
    ['悪い数字ほど早く出す', f.pace != null && f.pace < f.goal ? `今のペースは月末${f.pace}件で、目標まで${f.goal - f.pace}件足りません。早く出すほど、打てる手が増えます。` : '目標に届かないと分かった時点で、すぐ代表に出しましょう。早いほど打てる手が増えます。'],
    ['数字を「量×率」に分ける', '獲得＝会えた数×取れた割合。足りないとき、量（訪問・配布）が足りないのか、率（話し方・エリア選び）が低いのかを分けると、やることがはっきりします。'],
    ['時間をお金で考える', f.c.fc && f.topK ? `今月の発生予測は${yen(f.c.fc)}。1時間あたりいくら生んでいるかを意識すると、やめるべき仕事が見えてきます。` : '1時間あたりいくら生んでいるかを意識すると、やめるべき仕事が見えてきます。'],
    ['先に約束して、あとで確かめる', '月のはじめに「今月は○件・○円」と自分で決め、週ごとに差を見る。決めた数字があると、日々の判断が速くなります。'],
    ['お客様の「次」まで考える', '獲得はゴールではなく、開通して初めて売上になります。工事日が決まるまで追いかけるのも、数字を作る仕事のうちです。']
  ];
  const a = ad[wk % ad.length];
  return el('section', { class: 'pointc' },
    el('div', { class: 'cc-h' }, el('b', { text: `${ME.name}さんのポイント` })),
    el('div', { class: 'pt-q' }, el('small', { text: '今日の問い' }), el('p', { text: `${ME.name}さん、${q}` })),
    el('div', { class: 'pt-a' }, el('small', { text: '今週の考え方' }), el('b', { text: a[0] }), el('p', { text: a[1] })),
    el('details', { class: 'coach' }, el('summary', null, el('span', { text: '今週のやりとりの確認' }), el('small', { text: '3つ' })),
      el('ul', { class: 'pt-ck' }, ck.map(t => el('li', { text: t })))));
}
// ===== ひらめきメモ：思いついたこと・考えたことを一行で残す（本人があとで見返せる） =====
function allMemos(days){
  const out = []; for (const [d, doc] of Object.entries(days)) for (const id in ((doc && doc.memo) || {})) { const m = doc.memo[id]; if (m && m.x) out.push({ d, id, t: +m.t || 0, x: m.x, u: doc.u }); }
  return out.sort((a, b) => b.t - a.t);
}
const memoTime = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${pad(d.getMinutes())}`; };
function memoCard(){
  const list = allMemos(myDays());
  const ta = el('textarea', { rows: 2, placeholder: '例：夕方の青葉区は在宅が多い／チラシの裏に料金比較を載せたら？／〇〇さんの話し方を真似する', 'aria-label': 'ひらめきメモ' });
  const save = () => { const x = ta.value.trim(); if (!x) { ta.focus(); return; } ta.value = ''; put(S.today, { memo: { [uid()]: { x, t: Date.now() } } }, true); toast('メモを残しました'); };
  return el('section', { class: 'memoc' },
    el('div', { class: 'cc-h' }, el('b', { text: 'ひらめきメモ' }), list.length ? el('button', { class: 'link', onclick: () => memoModal() }, `これまでのメモ ${list.length}件`) : null),
    el('p', { class: 'mm-why', text: `いいアイデアは、机の前ではなく、移動中や現場でふと浮かびます。そして、そのほとんどは数時間で消えます。${ME.name}さんが思いついたその一瞬を、一行だけでいいので残してください。積み重なったメモは、あとで見返すと大きな結果につながるヒントの宝庫になります。` }),
    ta, el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: save }, '残す')),
    list.length ? el('div', { class: 'mm-list' }, list.slice(0, 2).map(m => el('div', { class: 'mm' }, el('small', { text: memoTime(m.t) }), el('p', { text: m.x })))) : null);
}
function memoModal(){
  const list = allMemos(myDays());
  const q = el('input', { type: 'search', placeholder: 'メモを探す（言葉で絞り込み）' });
  const box = el('div', { class: 'mm-list' });
  const draw = () => { box.textContent = ''; const w = q.value.trim(); list.filter(m => !w || m.x.includes(w)).forEach(m => add(box, el('div', { class: 'mm' }, el('div', { class: 'mm-h' }, el('small', { text: memoTime(m.t) }),
    el('button', { class: 'del', 'aria-label': 'このメモを消す', onclick: () => { if (!confirm('このメモを消しますか？')) return; drop(m.d, 'memo', m.id); const i = list.indexOf(m); if (i >= 0) list.splice(i, 1); draw(); } }, '×')), el('p', { text: m.x })))); };
  q.addEventListener('input', draw); draw();
  modal(`${ME.name}さんのメモ（${list.length}件）`, [q, box, el('button', { class: 'btn wide', onclick: e => e.target.closest('.modal').remove() }, '閉じる')]);
}
function memoAdmin(docs){
  const list = allMemos(Object.fromEntries((docs || []).map(d => [d.d + '_' + d.u, d])));
  if (!list.length) return null;
  return keepOpen('memoadm', el('details', { class: 'card fold' }, el('summary', null, el('span', { class: 'fs-t', text: 'みんなのひらめきメモ' }), el('small', { text: `${list.length}件` })),
    el('div', { class: 'mm-list' }, list.slice(0, 200).map(m => el('div', { class: 'mm' }, el('small', { text: `${nameOf(m.u)}・${memoTime(m.t)}` }), el('p', { text: m.x }))))));
}
// ===== 今月の数字（いちばん上）：獲得→発生予測、工事予定→売上予測、配布数とそのエリアの反響率 =====
const ymOf = (off) => { const d = toDate(S.today); const x = new Date(d.getFullYear(), d.getMonth() + (off || 0), 1); return x.getFullYear() + '-' + pad(x.getMonth() + 1); };
const man = n => { n = Math.round(+n || 0); return n >= 10000 ? (n / 10000).toFixed(n >= 1000000 ? 0 : 1).replace(/\.0$/, '') + '万円' : yen(n); };
function myPosts(){
  const ms = S.today.slice(0, 6); const by = {}; let total = 0;
  for (const [d, doc] of Object.entries(myDays())) { if (d.slice(0, 6) !== ms) continue; for (const id in (doc.post || {})) { const p = doc.post[id]; const n = +p.n || 0; total += n; const a = p.a || 'エリア未記入'; by[a] = (by[a] || 0) + n; } }
  return { total, list: Object.entries(by).sort((a, b) => b[1] - a[1]) };
}
function respOf(area){
  const rows = (S.resp && S.resp.rows) || []; const a = String(area || '').replace(/\s/g, '');
  return rows.find(r => r.g === a || (r.cities || []).includes(a) || (r.cities || []).some(c => a.includes(c) || c.includes(a))) || null;
}
function salesCard(){
  const cm = ymOf(0), nm = ymOf(1);
  const m = (S.sa && S.sa.m) || {}; const c = m[cm] || {}, n = m[nm] || {};
  const posts = myPosts();
  const rate = c.rate || n.rate || 0.7;
  const big = (label, val, sub) => el('div', { class: 'sc-c' }, el('small', { text: label }), el('b', { text: val }), el('span', { text: sub }));
  const sec = el('section', { class: 'sales' },
    el('div', { class: 'sc-h' }, el('b', { text: `${+cm.slice(5)}月の数字` }), el('small', { text: S.sa && S.sa.asof ? `台帳 ${S.sa.asof} 時点` : '' })),
    el('div', { class: 'sc-g' },
      big('獲得', `${c.acq || 0}件`, `発生予測 ${man(c.fc)}`),
      big('今月の工事', `${(c.schedN || 0) + (c.openN || 0)}件`, `売上予測 ${man((c.schedV || 0) + (c.openV || 0))}`),
      big('来月の工事', `${n.schedN || 0}件`, `売上予測 ${man(n.schedV)}`)));
  if (!S.sa) add(sec, el('div', { class: 'sc-note', text: 'ポスティング反響台帳を開くと、獲得・工事の数字がここに入ります（名前が合わないときは代表の名簿で別名を）。' }));
  else add(sec, el('div', { class: 'sc-note', text: `発生予測＝今月の申込×単価×${Math.round(rate * 100)}%・今月の工事は開通済み${c.openN || 0}件を含む` }));
  const pl = posts.list;
  add(sec, el('div', { class: 'sc-post' }, el('div', { class: 'sc-ph' }, el('small', { text: '今月の配布' }), el('b', { text: `${nf(posts.total)}枚` })),
    pl.length ? el('div', { class: 'sc-areas' }, pl.slice(0, 6).map(([a, nn]) => { const r = respOf(a);
      return el('div', { class: 'sc-a' }, el('span', { text: a }), el('b', { text: `${nf(nn)}枚` }), el('em', { text: r && r.rate != null ? `反響率 ${(r.rate * 100).toFixed(2)}%（${r.resp}件）` : '反響率 —' })); }))
      : el('div', { class: 'sc-note', text: 'まだ配布の報告はありません。' })));
  return sec;
}
// すぐ使う：よく使うフォームや機能へ1タップで
const IC = {
  form: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  yen: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>',
  map: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'
};
const svgI = k => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '22'); s.setAttribute('height', '22'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.innerHTML = IC[k]; return s; };
function launcher(){
  const tile = (k, label, href, onclick) => href ? el('a', { class: 'ln', href, target: '_blank', rel: 'noopener' }, el('span', { class: 'ln-i' }, svgI(k)), el('span', { class: 'ln-t', text: label }))
    : el('button', { class: 'ln', onclick }, el('span', { class: 'ln-i' }, svgI(k)), el('span', { class: 'ln-t', text: label }));
  const ym = S.today.slice(0, 4) + '-' + S.today.slice(4, 6); const m = (S.kh && S.kh.m && S.kh.m[ym]) || null;
  let wait = 0; const days = myDays(); Object.keys(days).filter(d => d >= S.today).forEach(d => { for (const id in (days[d].add || {})) if (days[d].add[id] && !days[d].add[id].st) wait++; });
  const ng = Object.keys(days).filter(d => d >= S.today).some(d => Object.values(days[d].add || {}).some(a => a && a.st === 'ng'));
  return el('section', { class: 'launch', 'aria-label': 'すぐ使う' },
    el('div', { class: 'ln-g' },
      tile('form', '後確申込', FORM_KAKU), tile('web', 'WEB申込', FORM_WEB), tile('yen', '経費', KEIHI_FORM),
      tile('cal', '予定登録', null, () => bulkForm()), tile('map', 'マップ', MAP_URL)),
    el('div', { class: 'ln-s' },
      el('button', { class: 'ln-chip', onclick: () => keihiModal() }, `${+S.today.slice(4, 6)}月の経費 `, el('b', { text: m ? yen(m.t) : '¥0' }), m && m.tate ? el('span', { text: `立替 ${yen(m.tate)}` }) : null, el('i', { text: '›' })),
      wait || ng ? el('button', { class: 'ln-chip' + (ng ? ' bad' : ''), onclick: () => addsModal() }, ng ? 'カレンダーに入らなかった予定' : 'カレンダー登録待ち ', wait ? el('b', { text: wait + '件' }) : null, el('i', { text: '›' })) : null));
}
function keihiModal(){
  const box = keihiBox(); box.classList.add('plain'); const h = box.querySelector('h3'); if (h) h.remove();
  modal('今月の経費', [box, el('button', { class: 'btn wide', onclick: e => e.target.closest('.modal').remove() }, '閉じる')]);
}
function addsModal(){
  const box = addsBox(); box.classList.add('plain'); const h = box.querySelector('h3'); if (h) h.remove();
  modal('予定をまとめて入れる', [box, el('button', { class: 'btn wide', onclick: e => e.target.closest('.modal').remove() }, '閉じる')]);
}
// 経費：申請フォームへすぐ飛べる＋今月の自分の経費
function keihiBox(){
  const ym = S.today.slice(0, 4) + '-' + S.today.slice(4, 6);
  const m = (S.kh && S.kh.m && S.kh.m[ym]) || null;
  const d = toDate(S.today);
  return el('section', { class: 'card' }, el('h3', null, '経費', el('small', { text: `${d.getMonth() + 1}月の自分の経費` })),
    m ? el('div', { class: 'kpis k3' }, [['合計', yen(m.t)], ['会社カード', yen(m.card)], ['個人立替', yen(m.tate)]].map(([t, v]) => el('div', { class: 'kpi' }, el('b', { text: v }), el('span', { text: t })))) : el('div', { class: 'muted', text: '今月の経費の申請はまだありません。' }),
    m && m.none ? el('div', { class: 'muted', text: `支払い方法が未記入の分 ${yen(m.none)}` }) : null,
    el('div', { class: 'row' }, el('a', { class: 'btn primary', href: KEIHI_FORM, target: '_blank', rel: 'noopener' }, '経費を申請する'),
      FB.isAdmin() ? el('a', { class: 'btn', href: KEIHI_SHEET, target: '_blank', rel: 'noopener' }, '管理シートを開く') : null),
    el('div', { class: 'muted', text: '申請した分は10分ほどでここに反映されます。' }));
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
  if (none) out.push(['dn', `今月、予定も休みも申告がない日が${none}日あります。休みの日は「今日は休み」を押しておきましょう。`]);
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
  const mon = toDate(t).getMonth() + 1;
  const k0 = (label, v, p, fmt, sub) => el('div', { class: 'mt' }, el('small', { text: label }), el('b', { text: fmt ? fmt(v) : nf(v) }), +t.slice(6) < 3 ? el('span', { text: sub || '' }) : arrow(v, p));
  add(main, el('section', { class: 'sec' }, el('h2', { class: 'sh' }, `${mon}月の数字`, el('small', { text: +t.slice(6) < 3 ? '3日目から先月と比べます' : '先月の同じ日までと比べて' })),
    el('div', { class: 'metrics m6' }, k0('獲得', cur.got, prev.got), k0('訪問', cur.doors, prev.doors), k0('対面', cur.face, prev.face), k0('反響対応', cur.han, prev.han), k0('配布', cur.post, prev.post), k0('稼働', cur.work, prev.work, v => h1(v) + 'h'))));
  add(main, el('section', { class: 'card' }, el('h3', { text: '気づき' }), insights(days, cur, prev).map(([c, x]) => el('div', { class: 'ins ' + c, text: x }))));
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
  for (let i = 1; i <= last; i++) { const d = ymd(new Date(d0.getFullYear(), d0.getMonth(), i)); const st = d <= t ? statOf(days[d], d === t) : null; arr.push([d, st]); if (st) max = Math.max(max, st.v.doors + st.han.all); }
  add(main, el('section', { class: 'sec' }, el('h2', { class: 'sh' }, '日ごとの活動', el('small', { text: '棒＝訪問＋反響対応、点＝獲得' })),
    el('div', { class: 'chart', role: 'img', 'aria-label': '今月の日ごとの活動量と獲得' }, arr.map(([d, st]) => { const v = st ? st.v.doors + st.han.all : 0; return el('div', { class: 'col' + (d === t ? ' today' : ''), title: st ? `${md(d)} 訪問${st.v.doors}・反響${st.han.all}・獲得${st.got}` : md(d) },
      st && st.got ? el('em', { text: st.got > 1 ? st.got : '' }) : null, el('i', { style: `height:${v ? Math.max(3, Math.round(v / max * 100)) : 0}%` }), el('span', { text: st && st.off ? '休' : String(+d.slice(6)) })); }))));
}

// ===== チーム =====
const stateOf = (st, isToday, doc) => !isToday ? '' : st.running ? `${KIND[st.running.k]}中` : st.off ? '休み' : (Date.now() - lastMove(doc, st) < 30 * 60000) ? '稼働中' : st.work ? '空き時間' : st.plan.length ? '開始前' : '予定なし';
const stCls = s => /中$/.test(s) ? 'run' : s === '予定なし' ? 'bad' : s === '開始前' || s === '空き時間' ? 'warn' : s === '日報済み' ? 'good' : '';
const PUSH_T = { granted: ['受信中', 'good'], novapid: ['受信中', 'good'], denied: ['切っている', 'bad'], default: ['未設定', 'warn'], needhome: ['ホーム未追加', 'warn'], unsupported: ['メールのみ', ''] };
function renderTeam(main){
  if (!FB.isStaff()) { go('today'); return; }
  // 一覧
  const sel = el('select', { onchange: e => { S.period = e.target.value; loadTeam(true); } }, [['today', '今日'], ['yday', '昨日'], ['week', '今週'], ['month', '今月'], ['last', '先月']].map(([v, t]) => el('option', { value: v, selected: v === S.period }, t)));
  const sec = el('section', { class: 'card' }, el('h3', null, 'みんなの状況', el('span', { class: 'row' }, sel, el('button', { class: 'btn', onclick: () => loadTeam(true) }, '更新'))));
  add(main, sec);
  if (!S.team) { loadTeam(); add(sec, el('div', { class: 'muted', text: '読み込み中…' })); }
  else {
    const [from, to] = periodRange(S.period); const one = from === to; const isToday = one && from === S.today;
    const rows = byPerson(S.team, from, to).sort((a, b) => b.t.got - a.t.got || b.t.doors - a.t.doors || b.t.han - a.t.han);
    const nts = u => { const n = S.ntc[FB.ukey(u)] || {}; return n.total || 0; };
    add(sec, el('div', { class: 'tw' }, el('table', { class: 'tbl team' },
      el('thead', null, el('tr', null, ['名前', one ? '状態' : '日報', '獲得', '訪問', '対面', '反響', 'アポ', '配布', '稼働', '訪問/時', isToday ? '催促' : null, 'お知らせ'].filter(Boolean).map(h => el('th', { text: h })))),
      el('tbody', null, rows.map(r => {
        const st = one ? statOf(r.days[from], from === S.today, r.u) : null;
        const s = one ? stateOf(st, isToday) || (st.off ? '休み' : st.sub ? '日報済み' : st.has ? '日報なし' : '申告なし') : `${r.t.subs}日`;
        const p = (S.pushAll || {})[FB.ukey(r.u)]; const pt = PUSH_T[(p && p.perm) || 'default'] || PUSH_T.default;
        const cls = one ? (stCls(s) || (s === '日報なし' || s === '申告なし' ? 'bad' : '')) : '';
        return el('tr', null, el('th', { text: r.name }), el('td', null, el('span', { class: 'st ' + cls, text: s })),
          el('td', null, el('b', { text: r.t.got })), el('td', { text: r.t.doors }), el('td', { text: r.t.face }), el('td', { text: r.t.han }), el('td', { text: r.t.apo }), el('td', { text: nf(r.t.post) }),
          el('td', { text: h1(r.t.work) + 'h' }), el('td', { text: r.t.h.door > 600000 ? (r.t.doors / (r.t.h.door / 3600000)).toFixed(1) : '—' }),
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
  const g = S.goal; const inp = {}; const num = (k, v, step) => (inp[k] = el('input', { type: 'number', min: 0, step: step || 1, value: v }));
  return keepOpen('admin', el('details', { class: 'card' }, el('summary', { text: '1日の目標の基準・訪販の休憩（代表）' }),
    el('div', { class: 'muted', text: '「1日＝基準の時間」働いたときの目標です。予定が短い日はその分少なくなります。' }),
    [['brk', '訪販の休憩として引く時間（時間）', .5], ['brkMin', '休憩を引き始める長さ（時間）', .5], ['std', '基準の時間（時間）', .5], ['door', '訪販：訪問数'], ['face', '訪販：対面数'], ['call', '反響対応：対応数'], ['post', '配布：枚数', 10], ['got', '獲得数'], ['monthGot', '1か月の獲得の目安']].map(([k, l, st]) => el('label', { class: 'gf' }, l, num(k, g[k], st))),
    el('button', { class: 'btn primary', onclick: async () => { const d = {}; for (const k in inp) { const v = parseFloat(inp[k].value); d[k] = isFinite(v) && v >= 0 ? v : GOAL_DEF[k]; } try { await FB.cfg.set('goal', d); toast('目標の基準を保存しました'); } catch (e) { toast('保存できませんでした'); } } }, '保存する')));
}

// ===== 管理（代表だけ）：月の仕事の量と成果 =====
S.adm = { mon: 'cur', docs: null, key: '' };
function monRange(which){
  const d = toDate(S.today);
  if (which === 'week' || which === 'lweek') {
    const ws = weekStart(S.today), off = which === 'lweek' ? -7 : 0;
    const from = addDays(ws, off), end = addDays(from, 6), to = which === 'lweek' ? end : S.today;
    const span = Math.round((toDate(to) - toDate(from)) / 86400000);
    return { from, to, end, pfrom: addDays(from, -7), pto: addDays(from, span - 7), label: which === 'lweek' ? '先週' : '今週', week: true };
  }
  if (which === 'last') { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 0); const pa = new Date(d.getFullYear(), d.getMonth() - 2, 1), pb = new Date(d.getFullYear(), d.getMonth() - 1, 0); return { from: ymd(a), to: ymd(b), end: ymd(b), pfrom: ymd(pa), pto: ymd(pb), label: `${a.getMonth() + 1}月` }; }
  const [pf, pt] = lastMonthSame(S.today);
  return { from: monthStart(S.today), to: S.today, end: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)), pfrom: pf, pto: pt, label: `${d.getMonth() + 1}月` };
}
async function loadAdmin(force){
  if (!FB.isAdmin()) return;
  const r = monRange(S.adm.mon); const key = r.pfrom + r.end;
  if (!force && S.adm.key === key && S.adm.docs) return;
  S.adm.key = key; S.adm.docs = null; rerender();
  await loadUsers(); S.pushAll = await FB.push.all();
  S.adm.docs = (await FB.day.range(r.pfrom, r.end)) || [];
  rerender();
}
const per = (n, ms) => ms > 600000 ? n / (ms / 3600000) : null;
const f1 = v => v == null ? '—' : v.toFixed(1);
function delta(now, before){
  if (!before) return null;
  const d = Math.round((now - before) / before * 100);
  return el('em', { class: 'dl ' + (d > 0 ? 'up' : d < 0 ? 'dn' : ''), text: d ? `${d > 0 ? '+' : ''}${d}%` : '±0' });
}
function renderAdmin(main){
  const r = monRange(S.adm.mon);
  add(main, el('div', { class: 'sethead' }, el('button', { class: 'back', onclick: () => go('today'), 'aria-label': '今日の画面に戻る' }, '‹'), el('h1', { text: '管理' }),
    el('div', { class: 'seg adm-seg', role: 'group', 'aria-label': '月を選ぶ' }, [['week', '今週'], ['lweek', '先週'], ['cur', '今月'], ['last', '先月']].map(([v, t]) => el('button', { 'aria-pressed': String(S.adm.mon === v), onclick: () => { S.adm.mon = v; loadAdmin(true); } }, t)))));
  if (!S.adm.docs) { add(main, el('div', { class: 'card' }, el('div', { class: 'muted', text: '読み込んでいます…' }))); return; }
  const rows = byPerson(S.adm.docs, r.from, r.to).filter(x => { const u = (S.users || []).find(y => y.email === x.u); return !u || u.nt !== false; });
  const prev = {}; byPerson(S.adm.docs, r.pfrom, r.pto).forEach(x => { prev[x.u] = x.t; });
  const sum = k => rows.reduce((a, x) => a + (k === 'work' ? x.t.work : x.t[k]), 0);
  const psum = k => Object.values(prev).reduce((a, t) => a + (k === 'work' ? t.work : t[k]), 0);
  // 会社全体
  add(main, el('section', { class: 'adm-total' },
    el('div', { class: 'at-main' }, el('small', { text: `${r.label}の獲得（全員）${r.week ? `　${md(r.from)}〜${md(r.end)}` : ''}` }), el('b', { text: nf(sum('got')) }), delta(sum('got'), psum('got'))),
    el('div', { class: 'at-sub' }, [['稼働', h1(sum('work')) + 'h', delta(sum('work'), psum('work'))], ['訪問', nf(sum('doors')), delta(sum('doors'), psum('doors'))], ['反響対応', nf(sum('han')), delta(sum('han'), psum('han'))], ['配布', nf(sum('post')), delta(sum('post'), psum('post'))]]
      .map(([l, v, d]) => el('div', null, el('small', { text: l }), el('b', { text: v }), d))),
    el('div', { class: 'at-note', text: { cur: '増減は先月の同じ日までとの比較です', last: '増減はその前の月との比較です', week: '増減は先週の同じ曜日までとの比較です', lweek: '増減はその前の週との比較です' }[S.adm.mon] })));
  add(main, salesAdmin(), respAdmin(), memoAdmin(S.adm.docs.filter(d => d.d >= r.from && d.d <= (r.end || r.to))));
  // 量と成果の図
  add(main, quadrant(rows));
  // 月の予定（カレンダー）
  const end = r.end || r.to;
  const allDays = {}; const teamCal = { kind: { door: 0, call: 0, post: 0, apo: 0, other: 0 }, total: 0, past: 0, future: 0, apo: 0, planDays: 0, offDays: 0, emptyDays: 0, roughDays: 0, heat: Array.from({ length: 7 }, () => Array(24).fill(0)), actual: 0 };
  const perCal = {};
  rows.forEach(x => { const o = perCal[x.u] = calStats(x.days, r.from, end, x.u); for (const k in o.kind) teamCal.kind[k] += o.kind[k]; ['total', 'past', 'future', 'apo', 'planDays', 'offDays', 'emptyDays', 'roughDays', 'actual'].forEach(k => { teamCal[k] += o[k]; }); o.heat.forEach((row, i) => row.forEach((v, j) => { teamCal.heat[i][j] += v; })); });
  add(main, el('section', { class: 'card' }, el('h3', null, `${r.label}の予定（Googleカレンダー）`, el('small', { text: '全員の合計' })), calCard(teamCal, r.label, true)));
  add(main, keihiAdmin(r));
  // 一人ずつ
  add(main, el('h2', { class: 'sh' }, '一人ずつ', el('small', { text: '仕事の量と成果' })));
  const mx = k => Math.max(1, ...rows.map(x => k === 'work' ? x.t.work : x.t[k]));
  const today = S.adm.mon === 'cur' || S.adm.mon === 'week';
  rows.sort((a, b) => b.t.got - a.t.got || b.t.work - a.t.work).forEach(x => {
    const t = x.t, p = prev[x.u] || null;
    const st = today ? statOf(x.days[S.today], true, x.u) : null;
    const state = st ? stateOf(st, true, x.days[S.today]) : '';
    const pu = (S.pushAll || {})[FB.ukey(x.u)]; const pt = PUSH_T[(pu && pu.perm) || 'default'] || PUSH_T.default;
    const nag = today ? ((S.ntc[FB.ukey(x.u)] || {}).total || 0) : 0;
    const work = Object.keys(x.days).filter(d => d >= r.from && d <= r.to && x.days[d] && (statOf(x.days[d], d === S.today, x.u).work || statOf(x.days[d], d === S.today, x.u).v.doors));
    const need = Object.keys(x.days).filter(d => d >= r.from && d <= r.to && d < S.today && d >= START && x.days[d] && !x.days[d].off && statOf(x.days[d], false, x.u).has).length;
    const bar = (label, val, show, k, pk) => el('div', { class: 'pb' }, el('span', { text: label }), el('div', { class: 'pb-t' }, el('i', { style: `width:${Math.round((k === 'work' ? t.work : t[k]) / mx(k) * 100)}%` })), el('b', { text: show }), p ? delta(k === 'work' ? t.work : t[k], k === 'work' ? p.work : p[k]) : el('em'));
    add(main, el('section', { class: 'card person' },
      el('div', { class: 'ph' }, el('span', { class: 'av' + (t.got ? ' got' : ''), text: (x.name || '?').slice(0, 1) }), el('div', { class: 'pn' }, el('b', { text: x.name }), el('small', { text: `稼働 ${work.length}日${t.plan ? `・予定 ${h1(t.plan)}h に対して実際 ${Math.round(t.work / t.plan * 100)}%` : ''}` }), t.batchDays ? el('span', { class: 'st warn', style: 'align-self:flex-start;margin-top:4px', text: `訪問マップのまとめ入力あり ${t.batchDays}日` }) : null),
        state ? el('span', { class: 'st ' + stCls(state), text: state }) : null),
      el('div', { class: 'pg vol' }, el('h4', { text: '仕事の量' }), bar('稼働', 0, h1(t.work) + 'h', 'work'), bar('訪問', 0, nf(t.doors), 'doors'), bar('反響対応', 0, nf(t.han), 'han'), bar('配布', 0, nf(t.post), 'post')),
      el('div', { class: 'pg res' }, el('h4', { text: '成果' }), bar('獲得', 0, nf(t.got), 'got'), bar('対面', 0, nf(t.face), 'face'), bar('アポ', 0, nf(t.apo), 'apo')),
      el('div', { class: 'pr' }, [['訪問/時', f1(per(t.doors, t.h.door))], ['対面率', t.doors ? Math.round(t.face / t.doors * 100) + '%' : '—'], ['獲得/10時間', f1(t.work > 600000 ? t.got / (t.work / 36000000) : null)], ['1件あたり', t.got ? h1(t.work / t.got) + 'h' : '—']].map(([l, v]) => el('div', null, el('small', { text: l }), el('b', { text: v })))),
      spark(x, r),
      coachBlock(analyze(x.days, x.u, { from: r.from, to: r.to, self: false })),
      el('details', { class: 'pcal' }, el('summary', { text: `${r.label}の予定の分析` }), calCard(perCal[x.u] || calStats(x.days, r.from, end, x.u), r.label)),
      today ? el('div', { class: 'pf' }, (() => { const c = (S.calstat || {})[FB.ukey(x.u)]; return el('span', { class: 'st ' + (c && c.ok ? 'good' : 'bad'), text: c && c.ok ? 'カレンダー：共有済み' : 'カレンダー：未共有' }); })(), el('span', { class: 'st ' + pt[1], text: `お知らせ：${pt[0]}` }), nag ? el('span', { class: 'st ' + (nag >= 3 ? 'bad' : 'warn'), text: `今日の催促 ${nag}回` }) : null) : null));
  });
  add(main, el('h2', { class: 'sh', text: '設定' }), notifySwitch(), areaBox(), kwBox(), adminGame(), rosterBox());
}
// ===== 売上の数字（担当者別）・エリアの反響（ポスティング反響台帳から） =====
function salesAdmin(){
  const cm = ymOf(0), nm = ymOf(1); const rows = (S.saAll && S.saAll.rows) || [];
  const sec = el('section', { class: 'card' }, el('h3', null, `${+cm.slice(5)}月の獲得と売上予測`, el('small', { text: S.saAll && S.saAll.asof ? `台帳 ${S.saAll.asof} 時点` : '' })));
  if (!rows.length) { add(sec, el('div', { class: 'muted', text: 'ポスティング反響台帳を開くと、ここに担当者ごとの数字が入ります（10分ほどかかります）。' })); return sec; }
  const by = {}; rows.forEach(r => { (by[r.st] = by[r.st] || {})[r.m] = r; });
  const names = Object.keys(by).filter(n => n !== '全員').sort((a, b) => ((by[b][cm] || {}).fc || 0) - ((by[a][cm] || {}).fc || 0)); if (by['全員']) names.push('全員');
  add(sec, el('div', { class: 'kh-tw' }, el('table', { class: 'kh-t' },
    el('thead', null, el('tr', null, ['', '獲得', '発生予測', '今月の工事', '売上予測', '来月の工事', '売上予測', '支払額'].map(t => el('th', { text: t })))),
    el('tbody', null, names.map(n => { const c = by[n][cm] || {}, x = by[n][nm] || {};
      return el('tr', { class: n === '全員' ? 'kh-sum' : '' }, el('th', null, n, c.type && c.type !== '自社社員' ? el('small', { class: 'muted', text: ' ' + c.type }) : null),
        el('td', { text: `${c.acq || 0}件` }), el('td', { text: yen(c.fc) }), el('td', { text: `${(c.schedN || 0) + (c.openN || 0)}件` }), el('td', { text: yen((c.schedV || 0) + (c.openV || 0)) }),
        el('td', { text: `${x.schedN || 0}件` }), el('td', { text: yen(x.schedV) }), el('td', { text: c.fee ? yen(c.fee) : '—' })); })))));
  add(sec, el('div', { class: 'muted', text: '発生予測＝今月の申込×単価×開通する割合（台帳の設定）。今月の工事＝今月の開通済み＋今月の工事予定。支払額は業務委託・代理店への今月の開通分。' }));
  return sec;
}
function respAdmin(){
  const rows = ((S.resp && S.resp.rows) || []).slice().sort((a, b) => (b.rate || 0) - (a.rate || 0));
  if (!rows.length) return null;
  const rounds = [...new Set(rows.map(r => r.name))];
  return keepOpen('resp', el('details', { class: 'card fold' }, el('summary', null, el('span', { class: 'fs-t', text: 'エリアごとの配布数と反響率' }), el('small', { text: rounds.join('・') })),
    el('div', { class: 'kh-tw' }, el('table', { class: 'kh-t' },
      el('thead', null, el('tr', null, ['エリア', '配った人', '配布数', '反響', '反響率', '獲得'].map(t => el('th', { text: t })))),
      el('tbody', null, rows.map(r => el('tr', null, el('th', { text: r.g }), el('td', { text: r.who || '—' }), el('td', { text: nf(r.dist) }), el('td', { text: nf(r.resp) }), el('td', { text: r.rate != null ? (r.rate * 100).toFixed(2) + '%' : '—' }), el('td', { text: r.gain != null ? nf(r.gain) : '—' })))))),
    el('div', { class: 'muted', text: '配布数は台帳の「総戸数×配布回数×配布率」。反響はホームズの反響です。' })));
}
// ===== 経費（月ごと・担当者別） =====
function keihiAdmin(r){
  const all = (S.khAll && S.khAll.m) || {};
  const ym0 = (r.end || r.to); const ym = ym0.slice(0, 4) + '-' + ym0.slice(4, 6);
  const pd = new Date(+ym.slice(0, 4), +ym.slice(5) - 2, 1); const pym = pd.getFullYear() + '-' + pad(pd.getMonth() + 1);
  const cur = all[ym] || {}, prev = all[pym] || {};
  const names = Object.keys(cur).sort((a, b) => cur[b].t - cur[a].t);
  const lab = `${+ym.slice(5)}月`;
  const sec = el('section', { class: 'card' }, el('h3', null, `${lab}の経費（担当者別）`, el('a', { class: 'link', href: KEIHI_SHEET, target: '_blank', rel: 'noopener' }, '管理シートを開く')));
  if (!S.khAll) { add(sec, el('div', { class: 'muted', text: '読み込み中…（はじめは10分ほどで入ります）' })); return sec; }
  if (!names.length) { add(sec, el('div', { class: 'muted', text: `${lab}の経費の申請はまだありません。` })); return sec; }
  const T = { t: 0, card: 0, tate: 0, none: 0, n: 0 }; names.forEach(n => ['t', 'card', 'tate', 'none', 'n'].forEach(k => { T[k] += +cur[n][k] || 0; }));
  const PT = Object.values(prev).reduce((a, o) => a + (+o.t || 0), 0);
  const mx = Math.max(1, ...names.map(n => cur[n].t));
  add(sec, el('div', { class: 'kh-top' }, el('div', null, el('small', { text: '合計' }), el('b', { text: yen(T.t) }), PT ? delta(T.t, PT) : null), el('div', null, el('small', { text: '会社カード' }), el('b', { text: yen(T.card) })), el('div', null, el('small', { text: '個人立替（精算が必要）' }), el('b', { text: yen(T.tate) }))));
  names.forEach(n => { const o = cur[n]; const by = o.by || {};
    add(sec, el('div', { class: 'kh-row' },
      el('div', { class: 'kh-h' }, el('b', { text: n }), el('span', { text: `${o.n || 0}件` }), el('strong', { text: yen(o.t) }), prev[n] ? delta(o.t, prev[n].t) : el('em')),
      el('div', { class: 'kb' }, Object.keys(KH_CAT).filter(k => by[k]).map((k, i) => el('i', { class: 'kh-c' + i, style: `width:${(by[k] / mx * 100).toFixed(1)}%`, title: `${KH_CAT[k]} ${yen(by[k])}` }))),
      el('div', { class: 'kh-d' }, `カード ${yen(o.card)}・立替 ${yen(o.tate)}${o.none ? '・未記入 ' + yen(o.none) : ''}　`, Object.keys(KH_CAT).filter(k => by[k]).map(k => `${KH_CAT[k]} ${yen(by[k])}`).join('・')))); });
  // 直近6か月
  const months = []; for (let i = 5; i >= 0; i--) { const d = new Date(+ym.slice(0, 4), +ym.slice(5) - 1 - i, 1); months.push(d.getFullYear() + '-' + pad(d.getMonth() + 1)); }
  const people = [...new Set(months.flatMap(m => Object.keys(all[m] || {})))];
  add(sec, el('details', { class: 'pcal' }, el('summary', { text: '月ごとの推移（直近6か月）' }),
    el('div', { class: 'kh-tw' }, el('table', { class: 'kh-t' },
      el('thead', null, el('tr', null, el('th', { text: '' }), months.map(m => el('th', { text: `${+m.slice(5)}月` })))),
      el('tbody', null, people.map(p => el('tr', null, el('th', { text: p }), months.map(m => el('td', { text: all[m] && all[m][p] ? yen(all[m][p].t) : '—' })))),
        el('tr', { class: 'kh-sum' }, el('th', { text: '合計' }), months.map(m => { const v = Object.values(all[m] || {}).reduce((a, o) => a + (+o.t || 0), 0); return el('td', { text: v ? yen(v) : '—' }); })))))));
  add(sec, el('div', { class: 'muted', text: '経費申請のフォームの回答から自動で集計しています（申請した日の月で数えます）。名前は申請フォームの「名前」です。' }));
  return sec;
}
// ===== 月の予定（Googleカレンダー）の分析 =====
const CK = { door: '訪販', call: '反響', post: '配布', apo: 'アポ', other: 'その他' };
const CKC = { door: 'var(--k-door)', call: 'var(--k-call)', post: 'var(--k-post)', apo: '#8E5CD9', other: 'var(--k-other)' };
function calStats(days, from, end, u){
  const o = { kind: { door: 0, call: 0, post: 0, apo: 0, other: 0 }, total: 0, past: 0, future: 0, apo: 0, planDays: 0, offDays: 0, emptyDays: 0, roughDays: 0, heat: Array.from({ length: 7 }, () => Array(24).fill(0)), actual: 0, pastPlanDays: 0 };
  for (let d = from; d <= end; d = addDays(d, 1)) {
    const doc = days[d]; const ev = calEv(doc).filter(e => !e.wait);
    const off = doc && (doc.off || (doc.cal && doc.cal.off));
    const wd = (toDate(d).getDay() + 6) % 7; // 月=0
    if (off) { o.offDays++; continue; }
    if (!ev.length) { if (d < S.today && wd < 5) o.emptyDays++; continue; }
    o.planDays++; if (d <= S.today) o.pastPlanDays++;
    let dayMin = 0;
    ev.forEach(e => {
      const a = toMin(e.s), b = toMin(e.e === '24:00' ? '23:59' : e.e); if (a == null || b == null || b <= a) return;
      const ms = (b - a) * 60000; const k = CK[e.k] ? e.k : 'other';
      o.kind[k] += ms; o.total += ms; dayMin += b - a; if (k === 'apo') o.apo++;
      if (d > S.today) o.future += ms; else o.past += ms;
      for (let m = a; m < b; m += 30) o.heat[wd][Math.floor(m / 60)] += .5;
    });
    if (ev.length === 1 && dayMin >= 360) o.roughDays++;
    if (d <= S.today && doc) o.actual += statOf(doc, d === S.today, u).work;
  }
  return o;
}
function kindBar(kind, total){
  return el('div', { class: 'kb' }, Object.keys(CK).filter(k => kind[k]).map(k => el('i', { style: `width:${(kind[k] / total * 100).toFixed(1)}%;background:${CKC[k]}`, title: `${CK[k]} ${h1(kind[k])}h` })));
}
function heatMap(heat){
  const mx = Math.max(1, ...heat.flat()); const H0 = 7, H1 = 22;
  return el('div', { class: 'hm', role: 'img', 'aria-label': '曜日と時間帯ごとの予定の入り方' },
    el('div', { class: 'hm-row hm-hd' }, el('span'), Array.from({ length: H1 - H0 }, (_, i) => el('span', { text: (H0 + i) % 3 === 0 ? String(H0 + i) : '' }))),
    '月火水木金土日'.split('').map((w, r) => el('div', { class: 'hm-row' }, el('span', { class: 'hm-w', text: w }),
      Array.from({ length: H1 - H0 }, (_, i) => { const v = heat[r][H0 + i]; return el('i', { style: `opacity:${v ? (.15 + .85 * v / mx).toFixed(2) : 0}`, title: `${w} ${H0 + i}時台 ${v}時間` }); }))));
}
function calCard(o, label, isTeam){
  if (!o.total && !o.offDays) return el('div', { class: 'muted', text: 'この期間のカレンダーの予定はまだありません（共有されると10分ほどで入ります）。' });
  const rate = o.past ? Math.round(o.actual / o.past * 100) : null;
  return el('div', { class: 'calan' },
    el('div', { class: 'ca-top' },
      el('div', null, el('small', { text: '予定の合計' }), el('b', { text: h1(o.total) + 'h' }), el('span', { text: o.future ? `うち今日より先 ${h1(o.future)}h` : '' })),
      el('div', null, el('small', { text: '今日までの予定に対する実際' }), el('b', { class: rate == null ? '' : rate >= 80 ? 'ok' : rate < 50 ? 'ng' : 'mid', text: rate == null ? '—' : rate + '%' }), el('span', { text: o.past ? `予定 ${h1(o.past)}h／実際 ${h1(o.actual)}h` : '' }))),
    kindBar(o.kind, o.total),
    el('div', { class: 'kl' }, Object.keys(CK).filter(k => o.kind[k]).map(k => el('span', null, el('i', { style: `background:${CKC[k]}` }), `${CK[k]} ${h1(o.kind[k])}h`))),
    el('div', { class: 'pr ca-cnt' }, [['予定のある日', o.planDays + '日'], ['休み', o.offDays + '日'], ['予定なしの平日', o.emptyDays + '日'], ['アポ', o.apo + '件']].map(([l, v]) => el('div', null, el('small', { text: l }), el('b', { text: v })))),
    o.roughDays ? el('div', { class: 'ins dn', text: `1日に大きな予定が1つだけの日が${o.roughDays}日あります。中身がわからないので、「訪販 ○○区」「反響」のように分けて入れてもらうと、分析が正確になります。` }) : null,
    o.emptyDays ? el('div', { class: 'ins dn', text: `予定も休みも入っていない平日が${o.emptyDays}日あります。` }) : null,
    el('details', { class: 'hm-wrap' }, el('summary', { text: '曜日と時間帯ごとの予定の入り方' }), heatMap(o.heat)));
}

// 日ごとの稼働（棒）と獲得（点）
function spark(x, r){
  const end = r.end || r.to; const cols = []; let mx = 1;
  for (let d = r.from; d <= end; d = addDays(d, 1)) { const st = d <= r.to && x.days[d] ? statOf(x.days[d], d === S.today, x.u) : null; cols.push([d, st]); if (st) mx = Math.max(mx, st.work); }
  return el('div', { class: 'spark', role: 'img', 'aria-label': `${x.name}さんの日ごとの稼働と獲得` }, cols.map(([d, st]) => el('div', { class: 'sk' + (d === S.today ? ' today' : '') + (st && st.off ? ' off' : ''), title: st ? `${md(d)} 稼働${hm(st.work)}・獲得${st.got}` : md(d) },
    st && st.got ? el('em') : null, el('i', { style: `height:${st && st.work ? Math.max(6, Math.round(st.work / mx * 100)) : 0}%` }), r.week ? el('span', { class: 'skd', text: WEEK[toDate(d).getDay()] }) : null)));
}
// 仕事の量（稼働時間）× 成果（獲得）の図
function quadrant(rows){
  const W = 340, H = 220, P = 30;
  const xs = rows.map(x => x.t.work / 3600000), ys = rows.map(x => x.t.got);
  const mxX = Math.max(1, ...xs) * 1.15, mxY = Math.max(1, ...ys) * 1.2;
  const ax = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length), ay = ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length);
  const X = v => P + v / mxX * (W - P - 10), Y = v => H - P - v / mxY * (H - P - 12);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'qd');
  const mk = (tag, a, txt) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; svg.append(e); return e; };
  mk('rect', { x: X(ax), y: 12, width: W - 10 - X(ax), height: Y(ay) - 12, class: 'q-good' });
  mk('line', { x1: P, y1: H - P, x2: W - 10, y2: H - P, class: 'q-axis' }); mk('line', { x1: P, y1: 12, x2: P, y2: H - P, class: 'q-axis' });
  mk('line', { x1: X(ax), y1: 12, x2: X(ax), y2: H - P, class: 'q-avg' }); mk('line', { x1: P, y1: Y(ay), x2: W - 10, y2: Y(ay), class: 'q-avg' });
  mk('text', { x: W - 14, y: 26, class: 'q-lb', 'text-anchor': 'end' }, 'よく動いて成果も出ている');
  mk('text', { x: W - 14, y: H - P - 8, class: 'q-lb', 'text-anchor': 'end' }, '動いているが成果が少ない');
  mk('text', { x: P + 6, y: 26, class: 'q-lb' }, '少ない時間で成果');
  mk('text', { x: P + 6, y: H - P - 8, class: 'q-lb' }, '量が足りない');
  mk('text', { x: W - 10, y: H - 8, class: 'q-ax', 'text-anchor': 'end' }, '稼働時間 →'); mk('text', { x: 4, y: 14, class: 'q-ax' }, '獲得');
  const placed = [];
  rows.forEach((x, i) => { let cx = X(xs[i]), cy = Y(ys[i]); let n = 0; while (placed.some(([px, py]) => Math.hypot(px - cx, py - cy) < 24) && n < 8) { cx += 22; if (cx > W - 20) { cx = X(xs[i]) - 22 * (n + 1); } n++; } placed.push([cx, cy]); mk('circle', { cx, cy, r: 13, class: 'q-dot' }); mk('text', { x: cx, y: cy + 4.5, class: 'q-ini', 'text-anchor': 'middle' }, (x.name || '?').slice(0, 1)); });
  return el('section', { class: 'card' }, el('h3', null, '仕事の量 × 成果', el('small', { text: '点線は全員の平均' })), svg,
    el('div', { class: 'muted', text: '右上ほど「よく動いて成果も出ている」。右下は量は出ているので、やり方（時間帯・エリア・話し方）を見直す余地があります。左下は量そのものが足りていません。' }));
}

// ===== 設定 =====
function renderSet(main){
  add(main, el('div', { class: 'sethead' }, el('button', { class: 'back', onclick: () => go('today'), 'aria-label': '今日の画面に戻る' }, '‹'), el('h1', { text: '設定' })));
  const ps = S.pushState;
  const pm = { granted: 'スマホにお知らせが届く状態です。', novapid: 'お知らせの許可は済んでいます（会社側の設定が終わると届き始めます）。', denied: 'お知らせが「許可しない」になっています。スマホの設定から、このアプリ（またはブラウザ）の通知を許可してください。', default: 'まだお知らせの許可をしていません。', needhome: 'iPhoneは、ホーム画面に追加したアイコンから開くと、お知らせを受け取れます。', unsupported: 'この端末ではスマホのお知らせが使えないため、メールでお知らせします。' }[ps] || '確認中…';
  add(main, el('section', { class: 'card' }, el('h3', { text: 'お知らせ' }), el('div', { text: pm }),
    ps === 'default' ? el('button', { class: 'btn primary', onclick: () => pushOn(true) }, 'お知らせを受け取る') : null,
    el('details', null, el('summary', { text: 'ホーム画面に追加するやり方' }),
      el('div', { class: 'muted', style: 'margin-top:6px' },
        el('div', null, '【iPhone】Safariでこの画面を開く → 下の「共有」ボタン（四角から上矢印） → 「ホーム画面に追加」 → ホーム画面の「業務管理」から開く → 「お知らせを受け取る」を押して「許可」。'),
        el('div', { style: 'margin-top:6px' }, '【Android】Chromeでこの画面を開く → 右上の「︙」 → 「ホーム画面に追加」（または「アプリをインストール」）。'))),
    el('div', { class: 'muted', text: 'お知らせは、予定の申告・終了・配布の報告を入れるまで30分ごとに届きます。休みを申告した日は届きません。' })));
  // 休みの予定
  const days = myDays();
  const offs = Object.keys(days).filter(d => d >= S.today && days[d].off).sort();
  const di = el('input', { type: 'date', min: `${S.today.slice(0, 4)}-${S.today.slice(4, 6)}-${S.today.slice(6)}` });
  add(main, el('section', { class: 'card' }, el('h3', { text: '休みの予定' }),
    el('div', { class: 'muted', text: '先に入れておくと、その日はお知らせが届きません。' }),
    el('div', { class: 'row' }, di, el('button', { class: 'btn primary', onclick: () => { const d = di.value.replace(/-/g, ''); if (d.length !== 8 || d < S.today) { toast('今日以降の日を選んでください'); return; } put(d, { off: true }, true); toast(`${md(d)}を休みにしました`); } }, 'この日を休みにする')),
    offs.length ? offs.map(d => el('div', { class: 'rec' }, el('div', { class: 'rt', text: md(d) }), el('button', { class: 'btn', onclick: () => put(d, { off: false }, true) }, '取り消す'))) : el('div', { class: 'muted', text: '入っている休みはありません。' })));
  add(main, el('section', { class: 'card' }, el('h3', { text: 'アカウント' }),
    el('div', { class: 'row' }, el('a', { class: 'btn', href: 'guide.html' }, '使い方'), el('button', { class: 'btn', onclick: () => FB.signOut() }, 'ログアウト')),
    el('div', { class: 'muted', text: `ログイン中：${ME.email}` })));
  if (FB.isAdmin()) add(main, el('button', { class: 'btn wide', onclick: () => go('admin') }, '管理の画面を開く（代表）'));
}
// 自動のお知らせ・カレンダー反映を、代表が止めたり動かしたりする
function notifySwitch(){
  const on = !!(S.appcfg && S.appcfg.notify === true);
  return el('section', { class: 'card' + (on ? ' ok' : ' warn') }, el('h3', null, '自動のお知らせ（代表）', el('span', { class: 'st ' + (on ? 'good' : 'warn'), text: on ? '動いています' : '止めています' })),
    el('div', { class: 'muted', text: on ? '予定・終了・配布の報告の催促、Googleカレンダーへの反映、毎朝のまとめが動いています。' : '催促・カレンダー反映・毎朝のまとめは、すべて止まっています。始める準備ができたら「動かす」を押してください（10分以内に動き始めます）。' }),
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
    const cal = el('input', { type: 'text', value: u.cal || '', placeholder: '空なら本人のGoogleカレンダー', 'aria-label': '読み取るカレンダー' });
    add(sec, el('div', { class: 'pedit' },
      el('div', { class: 'row' }, el('b', { text: u.email, style: 'font-size:12.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis' }), el('span', { class: 'tag', text: { admin: '管理者', staff: '社員', contractor: '業務委託' }[u.role] || u.role || '社員' })),
      el('div', { class: 'row' }, el('label', { class: 'field', style: 'flex:1' }, '表示名', nm)),
      el('label', { class: 'field' }, '別名', al),
      el('label', { class: 'field' }, '読み取るカレンダー（仕事用を分けている人だけ、そのカレンダーのIDを入れる）', cal),
      el('div', { class: 'row' }, el('label', { class: 'row', style: 'font-size:13px;flex:1' }, nt, 'お知らせ・成績の対象にする'),
        el('button', { class: 'btn', onclick: async () => {
          const aliases = [...new Set(al.value.split(/[、,，\n]/).map(x => x.trim()).filter(Boolean))];
          try { await FB.people.save(u.email, { name: nm.value.trim(), al: aliases, nt: nt.checked, cal: cal.value.trim() }); Object.assign(u, { name: nm.value.trim(), al: aliases, nt: nt.checked, cal: cal.value.trim() }); toast(`${nm.value.trim() || u.email}を保存しました`); } catch (e) { toast('保存できませんでした'); }
        } }, '保存'))));
  }
  return sec;
}
// 配布エリア：ポスティング反響台帳から自動で入る（表示だけ）
const DAICHO_URL = 'https://claude.ai/artifact/834DaqXe4mAVrNgKtd4x1e';
function areaBox(){
  const rs = (S.areas && S.areas.rounds) || [];
  return keepOpen('area', el('details', { class: 'card' }, el('summary', { text: '配布エリア（ポスティング反響台帳とつながっています）' }),
    el('div', { class: 'muted', text: 'ポスティング反響台帳の「配布エリア」（配布回ごとのエリア・配布済み・配った人）が自動で入り、配布の報告でエリアを選べます。エリアを変えるときは台帳の方で変えてください（台帳を開くと書き出され、10分ほどでここに入ります）。' }),
    rs.length ? rs.map(r => el('div', { class: 'rec' }, el('div', { class: 'rt' }, r.name, el('small', { text: `${(r.start || '').replace(/-/g, '/')}〜${(r.end || '').replace(/-/g, '/')}・${(r.areas || []).length}エリア（配布済み ${(r.areas || []).filter(a => a.on).length}）` })))) : el('div', { class: 'muted', text: 'まだ入っていません（10分ほどお待ちください）。' }),
    el('div', { class: 'row' }, el('a', { class: 'btn', href: DAICHO_URL, target: '_blank', rel: 'noopener' }, 'ポスティング反響台帳を開く'))));
}
// 予定の名前の言葉 → 種類（訪販・反響・配布・アポ）。誤判定を直す
function kwBox(){
  const kw = Object.assign({}, KW_DEF, (S.appcfg && S.appcfg.kw) || {});
  const f = {}; const L = [['door', '訪販'], ['call', '反響対応'], ['post', '配布（この言葉があれば配布の報告が必須）'], ['apo', 'アポ・商談'], ['ng', '配布と見なさない言葉（例：ポスト投函確認、ポストカード）']];
  return keepOpen('kw', el('details', { class: 'card' }, el('summary', { text: '予定の名前の言葉と種類（代表）' }),
    el('div', { class: 'muted', text: 'Googleカレンダーの予定の名前にこの言葉が入っていたら、その種類として数えます。上から順に見ます。「、」区切り。本人も予定をタップして種類を直せます。' }),
    L.map(([k, l]) => el('label', { class: 'field' }, l, f[k] = el('input', { type: 'text', value: kwList(kw[k]).join('、') }))),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', onclick: async () => { const o = {}; for (const k in f) o[k] = kwList(f[k].value).join(','); try { await FB.cfg.set('app', Object.assign({}, S.appcfg || {}, { kw: o })); toast('言葉を保存しました'); } catch (e) { toast('保存できませんでした'); } } }, '保存する'),
      el('button', { class: 'btn', onclick: async () => { if (!confirm('最初の言葉に戻しますか？')) return; const c = Object.assign({}, S.appcfg || {}); delete c.kw; try { await FB.cfg.set('app', c); toast('戻しました'); } catch (e) { toast('戻せませんでした'); } } }, '最初に戻す'))));
}
function appBox(){
  const v = el('input', { type: 'text', value: (S.appcfg && S.appcfg.vapid) || '', placeholder: 'B で始まる長い文字列' });
  return el('section', { class: 'card' }, el('h3', { text: 'スマホのお知らせの鍵（代表・最初に1回）' }),
    el('div', { class: 'muted', text: 'Firebaseの画面 →（歯車）プロジェクトの設定 →「Cloud Messaging」→ いちばん下の「ウェブプッシュ証明書」で「鍵ペアを生成」→ 出てきた鍵をここに貼って保存。' }),
    v, el('button', { class: 'btn primary', onclick: async () => { try { await FB.cfg.set('app', Object.assign({}, S.appcfg || {}, { vapid: v.value.trim() })); toast('保存しました。みんなの端末で順にお知らせが使えるようになります'); } catch (e) { toast('保存できませんでした'); } } }, '保存'));
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
window.addEventListener('push-in', e => { const d = e.detail || {}; toast(`${d.title || 'お知らせ'}：${d.body || ''}`); });

// ---------- 起動 ----------
function go(tab){ S.tab = ['set', 'admin'].includes(tab) ? tab : 'today'; if (S.tab === 'admin') loadAdmin(); render(); window.scrollTo(0, 0); }
$('#admBtn').addEventListener('click', () => go(S.tab === 'admin' ? 'today' : 'admin'));
$('#meBtn').addEventListener('click', () => go(S.tab === 'set' ? 'today' : 'set'));
$('#homeBtn').addEventListener('click', () => go('today'));
setInterval(() => {
  document.querySelectorAll('.clock[data-st]').forEach(e => { e.textContent = clock(Date.now() - +e.dataset.st); });
  if (FB && ME && S.today && ymd(Date.now()) !== S.today) { S.draft = null; S.editing = false; S.week = null; watch(); }
}, 1000);
setInterval(() => { if (S.doc && Object.values(S.doc.ses || {}).some(s => !s.en)) rerender(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && ME) rerender(); });

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
  $('#meBtn').hidden = false; $('#meIni').textContent = (ME.name || '?').slice(0, 1);
  if (FB.isAdmin()) $('#admBtn').hidden = false;
  S.tab = 'today';
  watch();
  render();
}
boot().catch(e => { console.error(e); $('#main').textContent = '読み込めませんでした。開き直してください。'; });
window.GY = { S, statOf, targetsOf, render };
})();
