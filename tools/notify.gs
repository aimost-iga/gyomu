/**
 * 業務管理：しつこいお知らせ ＋ Googleカレンダーへの反映（Google Apps Script）
 * 「訪問マップ 毎晩の書き写し」と同じ Apps Script のプロジェクトに、このファイルを足して使う。
 * （nightly.gs の道具：fsFetch_ / getDoc_ / listDocs_ / ukey_ / ymdJst_ / log_ / FS / PROJECT を使う）
 *
 * 10分ごとに動いて：
 *  1. 今日の予定を Googleカレンダー「AImost 業務予定」に入れる（本人を招待するので本人のカレンダーにも出る）。
 *     開始・終了を押すと、実際にやった時間に書き換える。休みは終日の「休み」。
 *  2. 休みを申告していないのに入力がない人へ、入れるまで30分ごとにお知らせ（スマホの通知。届かない人はメール）。
 *     同じお知らせが3回目になったら、代表にも知らせる。
 *  3. 毎朝、代表へ昨日の全員分のまとめ。月曜の朝、本人へ先週の振り返り。
 * 最初に一度だけ setupNotify を実行する。
 */
const APP_URL = 'https://aimost-iga.github.io/gyomu/';
const CAL_NAME = 'AImost 業務予定';
const OWNER_MAIL = 'igarashi@aimost.co.jp';
const NT = {
  every: 30,        // 同じお知らせをくり返す間隔（分）
  escalate: 3,      // この回数目で代表にも知らせる
  quietFrom: '23:00', quietTo: '08:00', // この間は送らない
  plan: '09:30',    // 予定も休みも申告していない
  lateStart: 15,    // 予定の開始からこの分数たっても「開始」がない
  lateEnd: 30,      // 予定の終わりからこの分数たっても「終了」がない
  longRun: 4,       // 予定なしで始めて、この時間たっても「終了」がない
  yreport: ['08:30', '12:00'], // 昨日の配布の報告がまだ（朝のうち）
  summary: '08:30', // 代表へ昨日のまとめ
  weekly: '08:00'   // 月曜：本人へ先週の振り返り
};
const KIND_J = { door: '訪販', call: '反響対応', post: '配布', other: '事務・その他' };

function setupNotify() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'tick').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(10).create();
  cal_();
  log_('業務管理：お知らせとカレンダー反映の自動実行をセットしました（10分ごと）');
}
function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try { tick_(new Date()); } catch (e) { log_('お知らせの失敗：' + e.message); throw e; } finally { lock.releaseLock(); }
}
/** 試し：自分にだけお知らせを1通送る */
function testPush() { const u = { email: OWNER_MAIL, name: '代表' }; log_('試しのお知らせ：' + send_(u, '試しのお知らせ', 'これが見えていればスマホのお知らせは届いています。', 'test')); }

function tick_(now) {
  // アプリで「まとめて入れる」を押した予定をGoogleカレンダーに入れる → カレンダーを読む → 配布エリアの台帳を読む
  // （お知らせのオン・オフに関係なくいつも行う）
  try { loadKw_(); } catch (e) {}
  try { processAdds_(now); } catch (e) { log_('カレンダーへの登録の失敗：' + e.message); }
  try { readCals_(now); } catch (e) { log_('カレンダー読み取りの失敗：' + e.message); }
  // 代表がアプリの「設定」で「動かす」にするまでは、お知らせはしない
  const appCfg = getDoc_('cfg/app') || {};
  try { readAreas_(now); } catch (e) { log_('配布エリアの台帳の読み取りの失敗：' + e.message); }
  try { readKeihi_(now); } catch (e) { log_('経費の読み取りの失敗：' + e.message); }
  try { readSales_(now); } catch (e) { log_('売上の数字の読み取りの失敗：' + e.message); }
  try { staffDigest_(now); } catch (e) { log_('担当者への数字メールの失敗：' + e.message); }
  try { kadoMail_(now); } catch (e) { log_('本日の稼働データのメールの失敗：' + e.message); }
  if (appCfg.notify !== true) return;
  const today = ymdJst_(now), yday = ymdJst_(new Date(now.getTime() - 86400000));
  const hhmm = Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm');
  const P = PropertiesService.getScriptProperties();
  const props = P.getProperties();
  cleanup_(P, props, today);
  const users = people_();
  const days = {}, ydays = {};
  users.forEach(u => { const k = ukey_(u.email); days[u.email] = getDoc_('day/' + today + '_' + k); ydays[u.email] = getDoc_('day/' + yday + '_' + k); });


  const quiet = hhmm >= NT.quietFrom || hhmm < NT.quietTo;
  const counts = {};
  if (!quiet) users.forEach(u => {
    if (u.nt === false) return;
    const uk = ukey_(u.email);
    const d = days[u.email] || {};
    const plans = Object.keys(d.plan || {}).map(id => Object.assign({ id }, d.plan[id]));
    const ses = Object.keys(d.ses || {}).map(id => Object.assign({ id }, d.ses[id]));
    const running = ses.find(s => !s.en);
    const calEv = (d.cal && d.cal.ev) || [];
    const active = plans.length || ses.length || calEv.length;
    const due = [];
    if (!d.off && !(d.cal && d.cal.off)) {
      if (hhmm >= NT.plan && !active) due.push(['plan', '今日の予定が入っていません', 'Googleカレンダーに今日の予定を入れてください。休みならカレンダーに終日の「休み」を入れるか、アプリで「今日は休み」を押せばお知らせは止まります。']);
      if (running) {
        const p = running.pid && d.plan && d.plan[running.pid];
        const en = p ? at_(today, p.e) : null;
        const late = en ? now.getTime() >= en.getTime() + NT.lateEnd * 60000 : now.getTime() - running.st >= NT.longRun * 3600000;
        if (late) due.push(['end_' + running.id, `「${KIND_J[running.k] || ''}」の終了がまだです`, `${Utilities.formatDate(new Date(running.st), 'Asia/Tokyo', 'H:mm')}から続いています。終わっていたら「終了」を押して${running.k === 'call' || running.k === 'post' ? '結果を入れて' : ''}ください。`]);
      }
      postDue_(d, today, hhmm).forEach(x => due.push(['post', '配布の報告がまだです', `${x.s}〜${x.e}「${x.t}」の配布エリアと枚数を入れてください。配っていない・配布ではない予定なら、アプリでそう選べばお知らせは止まります。`]));
      // 日報はやめた（2026-10）
    }
    const y = ydays[u.email];

    if (yday >= '20261003' && y && !y.off && postDue_(y, yday, '24:30').length && hhmm >= NT.yreport[0])
      due.push(['ypost', '昨日の配布の報告がまだです', 'どのエリアに何枚配ったかを入れてください。アプリを開くと一番上に出ています。']);

    due.forEach(([kind, title, body]) => {
      const key = 'r_' + today + '_' + uk + '_' + kind;
      const [n0, last] = (props[key] || '0|0').split('|').map(Number);
      if (now.getTime() - last < NT.every * 60000 - 60000) return;
      const n = n0 + 1;
      const how = send_(u, title + (n > 1 ? `（${n}回目）` : ''), body, kind.split('_')[0]);
      const v = n + '|' + now.getTime(); P.setProperty(key, v); props[key] = v;
      const c = counts[uk] = counts[uk] || {}; const kk = kind.split('_')[0]; c[kk] = (c[kk] || 0) + 1;
      if (n === NT.escalate && u.email !== OWNER_MAIL) {
        const what = { plan: '今日の予定の申告', start: '開始', end: '終了', rep: '今日の日報', yrep: '昨日の日報', post: '配布の報告', ypost: '昨日の配布の報告' }[kk];
        send_({ email: OWNER_MAIL, name: '代表' }, `${u.name}さん：${what}がまだです`, `${NT.escalate}回お知らせしても入っていません（${how}で送信）。`, 'esc');
      }
    });
  });
  if (Object.keys(counts).length) { try { saveCounts_(today, counts, props); } catch (e) { log_('回数の保存の失敗：' + e.message); } }

  if (now.getDay() === 1 && hhmm >= NT.weekly && !props['n_' + today + '_wk']) {
    P.setProperty('n_' + today + '_wk', today);
    users.forEach(u => { if (u.nt !== false) { try { weekly_(u, today); } catch (e) { log_('週の振り返りの失敗：' + u.email + ' ' + e.message); } } });
  }
  if (hhmm >= NT.summary && !props['n_' + today + '_sum']) {
    P.setProperty('n_' + today + '_sum', today);
    try { summary_(users, today); } catch (e) { log_('まとめの失敗：' + e.message); }
  }
}

// ---------- 送る（スマホ → だめならメール） ----------
function send_(u, title, body, tag) {
  const p = getDoc_('push/' + ukey_(u.email));
  let ok = false;
  if (p && p.perm === 'granted' && p.tokens) {
    Object.keys(p.tokens).forEach(k => {
      const res = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + PROJECT + '/messages:send', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({ message: { token: p.tokens[k],
          notification: { title: title, body: body },
          webpush: { notification: { icon: APP_URL + 'img/icon-192.png', tag: tag || 'gyomu', renotify: true, requireInteraction: tag === 'rep' || tag === 'plan' }, fcm_options: { link: APP_URL } } } })
      });
      if (res.getResponseCode() < 300) ok = true;
      else if (res.getResponseCode() !== 404) log_('スマホへのお知らせ失敗：' + u.email + ' ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 160));
    });
  }
  if (ok) return 'スマホ';
  mail_(u, title, `<p>${esc_(body)}</p>`);
  return 'メール';
}
function mail_(u, subject, html) {
  if (MailApp.getRemainingDailyQuota() < 3) { log_('メールの1日の上限に近いので送りませんでした：' + u.email + ' ' + subject); return; }
  MailApp.sendEmail({ to: u.email, subject: '【業務管理】' + subject, htmlBody: wrap_(html), name: '業務管理（AImost）' });
}
// 今日のお知らせ回数を ntc/<日付> に足す（チーム画面の「催促」）
function saveCounts_(today, counts, props) {
  const cur = getDoc_('ntc/' + today) || {};
  const fields = {}, mask = [];
  Object.keys(counts).forEach(uk => {
    const o = Object.assign({}, cur[uk] || {}); let total = Number(o.total) || 0;
    Object.keys(counts[uk]).forEach(k => { o[k] = (Number(o[k]) || 0) + counts[uk][k]; total += counts[uk][k]; });
    o.total = total;
    const f = {}; Object.keys(o).forEach(k => { f[k] = { integerValue: String(o[k]) }; });
    fields[uk] = { mapValue: { fields: f } }; mask.push('updateMask.fieldPaths=' + uk);
  });
  fsFetch_(FS + '/ntc/' + today + '?' + mask.join('&'), { method: 'patch', payload: JSON.stringify({ fields: fields }) });
}

// ---------- 人 ----------
function people_() {
  const out = listDocs_('users').map(x => Object.assign({ email: x.id }, x.data)).filter(u => u.active !== false);
  if (!out.some(u => u.email === OWNER_MAIL)) out.push({ email: OWNER_MAIL, name: '代表', role: 'admin' });
  out.forEach(u => { u.name = (u.name || '').trim() || u.email.split('@')[0]; });
  return out;
}

// ---------- 1日の数字 ----------
function stat_(d) {
  d = d || {};
  const h = { door: 0, call: 0, post: 0, other: 0 }; let work = 0;
  Object.keys(d.ses || {}).forEach(id => { const s = d.ses[id]; if (!s || !s.st || !s.en) return; const ms = Math.max(0, s.en - s.st); h[s.k] = (h[s.k] || 0) + ms; work += ms; });
  const v = Object.assign({ doors: 0, face: 0, got: 0 }, d.v || {});
  const han = { call: 0, msg: 0, conn: 0, apo: 0, inv: 0, got: 0 };
  Object.keys(d.han || {}).forEach(id => { Object.keys(han).forEach(k => { han[k] += Number(d.han[id][k]) || 0; }); });
  let post = 0; Object.keys(d.post || {}).forEach(k => { post += Number(d.post[k].n) || 0; });
  return { h, work, v, han, hall: han.call + han.msg, post, got: (v.got || 0) + han.got, off: !!d.off, sub: !!d.sub, plan: Object.keys(d.plan || {}).length };
}
const hr_ = ms => (ms / 3600000).toFixed(1);

function summary_(users, today) {
  const y = ymdJst_(new Date(dateOf_(today).getTime() - 86400000));
  const yd = dateOf_(y);
  const nt = getDoc_('ntc/' + y) || {};
  const rows = users.filter(u => u.nt !== false).map(u => {
    const d = getDoc_('day/' + y + '_' + ukey_(u.email)); const s = stat_(d);
    const state = s.off ? '休み' : (s.plan || s.work || s.v.doors) ? '稼働' : '<b style="color:#c0392b">申告なし</b>';
    return { u, s, state, refl: d && d.refl ? d.refl : '', nag: (nt[ukey_(u.email)] || {}).total || 0 };
  });
  const td = 'style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right"', th = 'style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:left"';
  let html = `<p>${yd.getMonth() + 1}月${yd.getDate()}日（${'日月火水木金土'[yd.getDay()]}）の全員分のまとめです。</p>`;
  html += `<table style="border-collapse:collapse;font-size:13px"><tr><th ${th}>名前</th><th ${th}>状態</th><th ${td}>稼働</th><th ${td}>訪問</th><th ${td}>対面</th><th ${td}>獲得</th><th ${td}>反響</th><th ${td}>アポ</th><th ${td}>配布</th><th ${td}>訪問/時</th><th ${td}>催促</th></tr>`;
  rows.forEach(r => { const s = r.s; const per = s.h.door > 600000 ? (s.v.doors / (s.h.door / 3600000)).toFixed(1) : '—';
    html += `<tr><td ${th}>${esc_(r.u.name)}</td><td ${th}>${r.state}</td><td ${td}>${hr_(s.work)}h</td><td ${td}>${s.v.doors}</td><td ${td}>${s.v.face}</td><td ${td}>${s.got}</td><td ${td}>${s.hall}</td><td ${td}>${s.han.apo}</td><td ${td}>${s.post}</td><td ${td}>${per}</td><td ${td}>${r.nag ? r.nag + '回' : '—'}</td></tr>`; });
  html += '</table>';
  const refl = rows.filter(r => r.refl);
  if (refl.length) html += '<p style="margin-top:14px"><b>振り返り</b></p>' + refl.map(r => `<p>・${esc_(r.u.name)}：${esc_(r.refl)}</p>`).join('');
  MailApp.sendEmail({ to: OWNER_MAIL, subject: `【業務まとめ】${yd.getMonth() + 1}/${yd.getDate()} の全員分`, htmlBody: wrap_(html), name: '業務管理（AImost）' });
}
function weekly_(u, today) {
  const t0 = dateOf_(today).getTime();
  const sum = (from, n) => {
    const a = { work: 0, doors: 0, face: 0, got: 0, post: 0, han: 0, apo: 0, doorH: 0, subs: 0, offs: 0, none: 0 };
    for (let i = 0; i < n; i++) {
      const d = getDoc_('day/' + ymdJst_(new Date(t0 - (from + i) * 86400000)) + '_' + ukey_(u.email)); const s = stat_(d);
      a.work += s.work; a.doors += s.v.doors; a.face += s.v.face; a.got += s.got; a.post += s.post; a.han += s.hall; a.apo += s.han.apo; a.doorH += s.h.door;
      if (s.sub) a.subs++; if (s.off) a.offs++; if (!d || (!s.off && !s.plan && !s.work)) a.none++;
    }
    return a;
  };
  const w1 = sum(1, 7), w0 = sum(8, 7);
  if (!w1.work && !w0.work && !w1.doors) return;
  const cmp = (a, b) => b ? `（先々週 ${b}・${a >= b ? '▲' : '▼'}${Math.abs(Math.round((a - b) / b * 100))}%）` : '';
  let html = `<p>${esc_(u.name)}さん、先週（月〜日）の振り返りです。</p><ul>`;
  html += `<li>稼働時間：<b>${hr_(w1.work)}時間</b>${cmp(+hr_(w1.work), +hr_(w0.work))}</li>`;
  html += `<li>訪問：<b>${w1.doors}</b>${cmp(w1.doors, w0.doors)}・対面 <b>${w1.face}</b>（対面率 ${w1.doors ? Math.round(w1.face / w1.doors * 100) : 0}%）</li>`;
  if (w1.doorH > 600000) html += `<li>訪販1時間あたり：<b>${(w1.doors / (w1.doorH / 3600000)).toFixed(1)}部屋</b></li>`;
  if (w1.han || w0.han) html += `<li>反響対応：<b>${w1.han}件</b>${cmp(w1.han, w0.han)}・アポ ${w1.apo}</li>`;
  if (w1.post || w0.post) html += `<li>配布：<b>${w1.post}枚</b>${cmp(w1.post, w0.post)}</li>`;
  html += `<li>獲得：<b>${w1.got}件</b>${cmp(w1.got, w0.got)}</li>`;
  html += `<li>休み ${w1.offs}日${w1.none ? `・<b style="color:#c0392b">申告なし ${w1.none}日</b>` : ''}</li></ul>`;
  html += '<p>くわしくはアプリの「成績」で。今週もいきましょう！</p>';
  mail_(u, '先週の振り返り', html);
}

// ---------- Googleカレンダーの読み取り ----------
// 各自が代表に共有したカレンダーを読み、その日の予定を day/<日付>_<人> の cal に書く。
// 名簿で「仕事用カレンダー」を指定した人はそれを、なければ本人のメールのカレンダーを読む。
// 予定の名前の言葉で種類を決める。代表がアプリの管理画面で言葉を変えられる（cfg/app.kw）
const KW_DEF = { door: '訪販,訪問,ドア,ローラー', call: '反響,架電,電話,コール,テレ', post: '配布,ポスティング,ポス,チラシ', apo: 'アポ,商談,面談', ng: '' };
let KW = null;
function loadKw_() { const c = getDoc_('cfg/app') || {}; KW = Object.assign({}, KW_DEF, c.kw || {}); }
const kwList_ = s => String(s || '').split(/[,、，\n]/).map(x => x.trim()).filter(Boolean);
const OFF_RE = /休み|休暇|有給|公休|休日|OFF|オフ/i;
function calKind_(t) {
  const kw = KW || KW_DEF; const has = k => kwList_(kw[k]).some(w => t.indexOf(w) >= 0);
  for (const k of ['door', 'call', 'post', 'apo']) { if (k === 'post' && kwList_(kw.ng).some(w => t.indexOf(w) >= 0)) continue; if (has(k)) return k; }
  return 'other';
}
// 予定ごとの印（アプリ側の sigOf と同じ計算）
function sig_(e) { const s = e.s + '|' + e.e + '|' + e.t; let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return 'x' + h.toString(36); }
// 配布の予定が終わっているのに、配布の報告も「配っていない」もない
function postDue_(d, day, hhmm) {
  d = d || {}; if (Object.keys(d.post || {}).length || d.pnone) return [];
  const fix = d.fix || {};
  return ((d.cal && d.cal.ev) || []).filter(e => (fix[sig_(e)] || calKind_(e.t)) === 'post' && (e.e === '24:00' ? '23:59' : e.e) <= addMin_(hhmm, -30));
}
function addMin_(hm, n) { const m = Math.max(0, Math.min(1439, +hm.slice(0, 2) * 60 + +hm.slice(3, 5) + n)); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); }
function readCals_(now) {
  const users = people_();
  const P = PropertiesService.getScriptProperties();
  const stat = {};
  const today = ymdJst_(now); const t0 = dateOf_(today);
  const monthEnd = new Date(t0.getFullYear(), t0.getMonth() + 1, 1);            // 月末の次の日
  const ahead = new Date(Math.max(monthEnd.getTime(), t0.getTime() + 15 * 86400000)); // 月末か2週間先の遅い方まで
  users.forEach(u => {
    if (u.nt === false) return;
    const uk = ukey_(u.email); const id = (u.cal || u.email).trim();
    let cal = null;
    try { cal = CalendarApp.getCalendarById(id); if (!cal) { try { cal = CalendarApp.subscribeToCalendar(id, { hidden: true, selected: false }); } catch (e) {} } } catch (e) { cal = null; }
    if (!cal) { stat[uk] = { ok: false, at: now.getTime() }; return; }
    stat[uk] = { ok: true, at: now.getTime() };
    // 初回だけ過去31日分、あとは昨日から。先は月末（または2週間先）まで。1回の読み取りでまとめて取る
    const doneKey = 'calback_' + uk;
    const back = P.getProperty(doneKey) ? 1 : 31;
    const from = new Date(t0.getTime() - back * 86400000);
    let evs = [];
    try { evs = cal.getEvents(from, ahead); } catch (e) { log_('カレンダーを読めなかった：' + u.email + ' ' + e.message); return; }
    const byDay = {};
    for (let d = new Date(from); d < ahead; d = new Date(d.getTime() + 86400000)) byDay[ymdJst_(d)] = { list: [], off: false };
    evs.forEach(e => {
      const t = String(e.getTitle() || '').slice(0, 40);
      if (e.isAllDayEvent()) {
        if (!OFF_RE.test(t)) return;
        for (let d = new Date(e.getAllDayStartDate()); d < e.getAllDayEndDate(); d = new Date(d.getTime() + 86400000)) { const k = ymdJst_(d); if (byDay[k]) byDay[k].off = true; }
        return;
      }
      const a = e.getStartTime(), b = e.getEndTime();
      for (let d = dateOf_(ymdJst_(a)); d < b; d = new Date(d.getTime() + 86400000)) {
        const k = ymdJst_(d); if (!byDay[k]) continue;
        const ds = dateOf_(k), de = new Date(ds.getTime() + 86400000);
        const s = a <= ds ? '00:00' : Utilities.formatDate(a, 'Asia/Tokyo', 'HH:mm');
        const z = b >= de ? '24:00' : Utilities.formatDate(b, 'Asia/Tokyo', 'HH:mm');
        if (s !== z) byDay[k].list.push({ s, e: z, t, k: calKind_(t) });
      }
    });
    Object.keys(byDay).forEach(k => { try { writeCalDay_(u, uk, k, byDay[k].list, byDay[k].off); } catch (e) { log_('カレンダーを書けなかった：' + u.email + ' ' + e.message); } });
    if (back > 1) P.setProperty(doneKey, '1');
  });
  const f = {}; Object.keys(stat).forEach(k => { f[k] = { mapValue: { fields: { ok: { booleanValue: stat[k].ok }, at: { integerValue: String(stat[k].at) } } } }; });
  if (Object.keys(f).length) fsFetch_(FS + '/cfg/calstat', { method: 'patch', payload: JSON.stringify({ fields: f }) });
}
function writeCalDay_(u, uk, day, list, off) {
  list.sort((x, y) => x.s < y.s ? -1 : 1);
  const sig = JSON.stringify([list, off]);
  const P = PropertiesService.getScriptProperties(); const key = 'calsig_' + day + '_' + uk;
  if (P.getProperty(key) === sig) return;
  if (P.getProperty(key) == null && !list.length && !off) { P.setProperty(key, sig); return; } // 予定のない日は書かない
  const evF = list.slice(0, 40).map(x => ({ mapValue: { fields: { s: { stringValue: x.s }, e: { stringValue: x.e }, t: { stringValue: x.t }, k: { stringValue: x.k } } } }));
  const body = { fields: { u: { stringValue: u.email }, d: { stringValue: day }, cal: { mapValue: { fields: { ev: { arrayValue: { values: evF } }, off: { booleanValue: off }, at: { integerValue: String(Date.now()) } } } } } };
  fsFetch_(FS + '/day/' + day + '_' + uk + '?updateMask.fieldPaths=u&updateMask.fieldPaths=d&updateMask.fieldPaths=cal', { method: 'patch', payload: JSON.stringify(body) });
  P.setProperty(key, sig);
}

// ---------- アプリから「まとめて入れる」予定をGoogleカレンダーへ ----------
// アプリは day/<日付>_<人> に add.<id> = {k,s,e,t} と q=true を書く。ここで本人のカレンダーに入れて st を書き戻す。
// 本人のカレンダーを「変更」できる共有なら本人のカレンダーに直接。できなければ「AImost 業務予定」に本人を招待して入れる。
function processAdds_(now) {
  const res = fsFetch_(FS + ':runQuery', { method: 'post', payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'day' }], where: { fieldFilter: { field: { fieldPath: 'q' }, op: 'EQUAL', value: { booleanValue: true } } }, limit: 200 } }) }) || [];
  const users = {}; people_().forEach(u => { users[u.email] = u; });
  res.forEach(r => {
    if (!r.document) return;
    const id = r.document.name.split('/').pop(); const d = doc_(r.document);
    const u = users[d.u] || { email: d.u, name: d.u };
    const fields = {}, mask = [];
    Object.keys(d.add || {}).forEach(aid => {
      const a = d.add[aid]; if (!a || a.st) return;
      const st = at_(d.d, a.s), en = at_(d.d, a.e === '24:00' ? '23:59' : a.e);
      let out = { st: 'ng', why: '時間が読めません' };
      if (st && en && en > st) out = addEvent_(u, a.t || KIND_J[a.k] || '予定', st, en);
      const o = Object.assign({}, a, out, { done: now.getTime() });
      fields[aid] = toFs_(o); mask.push('add.' + aid);
    });
    const body = { fields: { q: { booleanValue: false } } }; mask.push('q');
    if (Object.keys(fields).length) body.fields.add = { mapValue: { fields: fields } };
    fsFetch_(FS + '/day/' + id + '?' + mask.map(m => 'updateMask.fieldPaths=' + m).join('&'), { method: 'patch', payload: JSON.stringify(body) });
  });
}
function addEvent_(u, title, st, en) {
  const desc = '業務管理アプリから入れた予定です。\n' + APP_URL;
  try {
    const cal = CalendarApp.getCalendarById((u.cal || u.email).trim());
    if (cal) { const ev = cal.createEvent(title, st, en, { description: desc }); return { st: 'ok', how: 'own', eid: ev.getId() }; }
  } catch (e) {}
  try {
    const guests = u.email === OWNER_MAIL ? '' : u.email;
    const ev = cal_().createEvent(title, st, en, { guests, sendInvites: false, description: desc + '\n（' + u.name + 'さんの予定）' });
    return { st: 'ok', how: 'inv', eid: ev.getId() };
  } catch (e) { return { st: 'ng', why: String(e.message).slice(0, 80) }; }
}
function toFs_(v) {
  if (v == null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs_) } };
  if (typeof v === 'object') { const f = {}; Object.keys(v).forEach(k => { f[k] = toFs_(v[k]); }); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}

// ---------- 配布エリアの台帳（ポスティング反響台帳 → スプレッドシート「配布エリア（自動）」 → cfg/areas） ----------
// ポスティング反響台帳（Claudeのアプリ）が、配布回ごとのエリア・配布済み・配った人を申込フォームのスプレッドシートに書き出している。
// ここではそれを読んで、業務管理アプリの配布報告でエリアを選べるように cfg/areas に写す。
const AREA_SHEET = '1TXDWfuCO5eP311TxvoYuF84A3_UAFm7ZY3AW4U1uxfQ';
const AREA_TAB = '配布エリア（自動）';
function readAreas_(now) {
  const sh = SpreadsheetApp.openById(AREA_SHEET).getSheetByName(AREA_TAB); if (!sh) return;
  const n = sh.getLastRow(); if (n < 3) return;
  const v = sh.getRange(1, 1, n, 14).getValues();
  const hr = v.findIndex(r => String(r[0]).trim() === '配布回ID'); if (hr < 0) return;
  const d_ = x => x instanceof Date ? Utilities.formatDate(x, 'Asia/Tokyo', 'yyyy-MM-dd') : String(x || '').trim().replace(/\//g, '-');
  const lim = Utilities.formatDate(new Date(now.getTime() - 120 * 86400000), 'Asia/Tokyo', 'yyyy-MM-dd');
  const by = {};
  for (let i = hr + 1; i < v.length; i++) {
    const r = v[i]; const id = String(r[0]).trim(); if (!id || !r[5]) continue;
    const end = d_(r[3]); if (end && end < lim) continue;
    const o = by[id] = by[id] || { id, name: String(r[1]), start: d_(r[2]), end, areas: [] };
    o.areas.push({ a: String(r[5]).trim(), pref: String(r[6] || ''), on: String(r[4]).trim() === '○', grp: String(r[7] || ''), who: String(r[8] || ''), times: Number(r[9]) || 1, b: Number(r[10]) || 0, h: Number(r[11]) || 0 });
  }
  const rounds = Object.keys(by).map(k => by[k]).sort((x, y) => x.start < y.start ? 1 : -1);
  const sig = JSON.stringify(rounds);
  const P = PropertiesService.getScriptProperties();
  const key = 'areasig', h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig, Utilities.Charset.UTF_8));
  if (P.getProperty(key) === h) return;
  fsFetch_(FS + '/cfg/areas', { method: 'patch', payload: JSON.stringify({ fields: { src: { stringValue: 'daicho' }, at: { integerValue: String(now.getTime()) }, rounds: toFs_(rounds) } }) });
  P.setProperty(key, h);
}

// ---------- 経費（経費申請管理のスプレッドシート「フォームの回答 1」 → kh/<人>・kh/_all） ----------
const KEIHI_SHEET = '17kNPksAgkHaUjbqkWl9pVdyIbN9FKmGl2Ocnb7wM-VM';
const KEIHI_TAB = 'フォームの回答 1';
function keihiCat_(t) {
  t = String(t || '');
  if (/レンタ.?サイクル|ダイチャリ|自転車/.test(t)) return 'cycle';
  if (/ガソリン/.test(t)) return 'gas';
  if (/駐車|高速/.test(t)) return 'park';
  if (/電車|交通|バス|新幹線/.test(t)) return 'train';
  if (/通信/.test(t)) return 'tel';
  return 'other';
}
function keihiYen_(h, f) {
  if (typeof h === 'number' && h > 0) return Math.round(h);
  if (typeof f === 'number') return Math.round(f);
  const s = String(f || '').normalize('NFKC').replace(/,/g, '');
  const m = s.match(/(\d+)\s*円/) || s.match(/¥\s*(\d+)/); if (m) return Number(m[1]);
  const all = s.match(/\d+/g); return all ? Number(all[all.length - 1]) : 0;
}
function readKeihi_(now) {
  const sh = SpreadsheetApp.openById(KEIHI_SHEET).getSheetByName(KEIHI_TAB); if (!sh) return;
  const n = sh.getLastRow(); if (n < 2) return;
  const v = sh.getRange(1, 1, n, 8).getValues();
  const users = people_(); const nz = x => String(x || '').normalize('NFKC').replace(/[\s　]/g, '');
  const who = name => { const k = nz(name); if (!k) return null; return users.find(u => [u.name].concat(u.al || []).map(nz).filter(Boolean).some(a => a === k || k.indexOf(a) === 0 || a.indexOf(k) === 0)) || null; };
  const all = {}, per = {};
  for (let i = 1; i < v.length; i++) {
    const r = v[i]; const ts = r[0]; if (!ts || !r[1]) continue;
    const d = ts instanceof Date ? ts : new Date(String(ts).replace(/-/g, '/'));
    if (isNaN(d.getTime())) continue;
    const ym = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM');
    const yen = keihiYen_(r[7], r[5]); if (!yen) continue;
    const name = String(r[1]).trim(); const pay = /個人/.test(r[3]) ? 'tate' : /会社|カード/.test(r[3]) ? 'card' : 'none';
    const cat = keihiCat_(r[2]);
    const add = o => { o.t = (o.t || 0) + yen; o[pay] = (o[pay] || 0) + yen; o.n = (o.n || 0) + 1; o.by = o.by || {}; o.by[cat] = (o.by[cat] || 0) + yen; };
    const am = all[ym] = all[ym] || {}; add(am[name] = am[name] || {});
    const u = who(name);
    if (u) { const uk = ukey_(u.email); const pm = (per[uk] = per[uk] || { u: u.email, m: {} }).m; add(pm[ym] = pm[ym] || {}); if (!am[name].u) am[name].u = u.email; }
  }
  const P = PropertiesService.getScriptProperties();
  const save = (id, obj) => {
    const sig = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(obj), Utilities.Charset.UTF_8));
    if (P.getProperty('khsig_' + id) === sig) return;
    const f = {}; Object.keys(obj).forEach(k => { f[k] = toFs_(obj[k]); }); f.at = { integerValue: String(now.getTime()) };
    fsFetch_(FS + '/kh/' + id, { method: 'patch', payload: JSON.stringify({ fields: f }) });
    P.setProperty('khsig_' + id, sig);
  };
  save('_all', { m: all });
  Object.keys(per).forEach(uk => save(uk, per[uk]));
}

// ---------- 売上の数字・エリアの反響（ポスティング反響台帳が書き出したシート → kh/sa_<人>・kh/sa_all・cfg/arearesp） ----------
const SALES_TAB = '担当者別の数字（自動）', RESP_TAB = 'エリアの反響（自動）';
function sheetRows_(ss, tab, head0) {
  const sh = ss.getSheetByName(tab); if (!sh || sh.getLastRow() < 3) return null;
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const hr = v.findIndex(r => String(r[0]).trim() === head0); if (hr < 0) return null;
  return { at: String(v[0][0] || ''), rows: v.slice(hr + 1).filter(r => String(r[0]).trim()) };
}
function readSales_(now) {
  const ss = SpreadsheetApp.openById(AREA_SHEET);
  const P = PropertiesService.getScriptProperties();
  const md5 = o => Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(o), Utilities.Charset.UTF_8));
  const putDoc = (path, key, obj) => { const sig = md5(obj); if (P.getProperty(key) === sig) return; const f = {}; Object.keys(obj).forEach(k => { f[k] = toFs_(obj[k]); }); f.at = { integerValue: String(now.getTime()) }; fsFetch_(FS + '/' + path, { method: 'patch', payload: JSON.stringify({ fields: f }) }); P.setProperty(key, sig); };
  const asOf = t => { const m = String(t).match(/最終更新：([^　\s]+\s*[\d:]*)/); return m ? m[1] : ''; };
  const sr = sheetRows_(ss, SALES_TAB, '担当者');
  if (sr) {
    const users = people_(); const nz = x => String(x || '').normalize('NFKC').replace(/[\s　]/g, '');
    const who = name => { const k = nz(name); if (!k) return null; return users.find(u => [u.name].concat(u.al || []).map(nz).filter(Boolean).some(a => a === k || k.indexOf(a) === 0 || a.indexOf(k) === 0)) || null; };
    const all = [], per = {};
    sr.rows.forEach(r => {
      const o = { st: String(r[0]), type: String(r[1] || ''), m: String(r[2]), app: +r[3] || 0, acq: +r[4] || 0, cancel: +r[5] || 0, fc: +r[6] || 0, schedN: +r[7] || 0, schedV: +r[8] || 0, openN: +r[9] || 0, openV: +r[10] || 0, fee: +r[11] || 0, rate: +r[12] || 0 };
      all.push(o);
      const u = o.st === '全員' ? null : who(o.st);
      if (u) { const uk = ukey_(u.email); (per[uk] = per[uk] || { u: u.email, st: o.st, m: {} }).m[o.m] = o; }
    });
    putDoc('kh/sa_all', 'sasig_all', { rows: all, asof: asOf(sr.at) });
    Object.keys(per).forEach(uk => putDoc('kh/sa_' + uk, 'sasig_' + uk, Object.assign({ asof: asOf(sr.at) }, per[uk])));
  }
  const rr = sheetRows_(ss, RESP_TAB, '配布回ID');
  if (rr) {
    const d_ = x => x instanceof Date ? Utilities.formatDate(x, 'Asia/Tokyo', 'yyyy-MM-dd') : String(x || '');
    const rows = rr.rows.map(r => ({ rid: String(r[0]), name: String(r[1]), start: d_(r[2]), end: d_(r[3]), g: String(r[4]), cities: String(r[5] || '').split('・').filter(Boolean), who: String(r[6] || ''), dist: +r[7] || 0, resp: +r[8] || 0, rate: r[9] === '' ? null : +r[9], valid: +r[10] || 0, gain: r[11] === '' ? null : +r[11] }));
    putDoc('cfg/arearesp', 'respsig', { rows, asof: asOf(rr.at) });
  }
}

// ---------- 3日に1回、藤原・宇野へ「実績データ」をメール（ポスティング反響台帳が書き出す「担当者の今月の数字（自動）」から） ----------
const DIGEST = { to: { '藤原': 'fujiwara@aimost.co.jp', '宇野': 'uno@aimost.co.jp' }, every: 3, at: '21:00', from: '20261008', tab: '担当者の今月の数字（自動）', goal: 2500000, workDays: [0, 2, 3, 4, 6] }; // 稼働日＝日・火・水・木・土
function staffDigest_(now, force) {
  const hhmm = Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm'), today = ymdJst_(now);
  const P = PropertiesService.getScriptProperties(); const last = P.getProperty('digestLast') || '';
  if (!force && P.getProperty('digestOn') !== '1') return; // 文言の確認が済むまで本番の送信は止めておく
  if (!force) { if (hhmm < DIGEST.at || today < DIGEST.from) return; /* 毎回21時すぎに送る（10/8から） */ if (last && (dateOf_(today) - dateOf_(last)) / 86400000 < DIGEST.every - 0.5) return; }
  const sr = sheetRows_(SpreadsheetApp.openById(AREA_SHEET), DIGEST.tab, '担当者'); if (!sr) { log_('担当者の今月の数字のシートが読めませんでした'); return; }
  const tx = v => String(v == null ? '' : v).replace(/^'/, '');
  const rows = sr.rows.map(r => ({ n: tx(r[0]), type: tx(r[1]), m: tx(r[2]), face: +r[3] || 0, han: +r[4] || 0, other: +r[5] || 0, app: +r[6] || 0, fc: +r[7] || 0, avg: +r[8] || 0, sched: +r[9] || 0, vSched: +r[10] || 0, openN: +r[11] || 0, vOpen: +r[12] || 0, chase: +r[13] || 0, gSched: +r[15] || 0, gOpen: +r[16] || 0, list: (() => { try { return JSON.parse(tx(r[17]) || '[]'); } catch (e) { return []; } })() }));
  const ym = (rows[0] && rows[0].m) || Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM'); const Y = +ym.slice(0, 4), M = +ym.slice(5, 7);
  // 台帳の数字が何日時点か（シート1行目の「最終更新：10/6 23:38」）。古すぎるときは送らずに代表へ知らせる
  const am = String(sr.at).match(/最終更新：(\d+)\/(\d+)\s*([\d:]*)/); const asD = am ? new Date(Y, +am[1] - 1, +am[2]) : null;
  const ageDays = asD ? Math.round((dateOf_(today) - asD) / 86400000) : 99;
  if (!force && ageDays > 1) { if (P.getProperty('digestStale') !== today) { P.setProperty('digestStale', today); MailApp.sendEmail({ to: OWNER_MAIL, subject: '【未送信】実績データのメールを止めました', htmlBody: digestWrap_(`<p>台帳の数字が${am ? am[1] + '/' + am[2] + ' ' + am[3] : '不明な日'}のままで古いため、藤原さん・宇野さんへの実績データのメールを送っていません。</p><p>今日の24時までにポスティング反響台帳を開いて「最新のデータに更新」を押せば、10分ほどで送ります（24時を過ぎたら次の日の21時すぎに送ります）。</p>`), name: '業務管理（AImost）' }); } return; }
  const asofTxt = am ? `${am[1]}/${am[2]} ${am[3]}` : '';
  // 稼働日（火・水・木・土・日）：月初から数字の日付まで／月全体
  const cnt = (d1, d2) => { let n = 0; for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) if (DIGEST.workDays.includes(d.getDay())) n++; return n; };
  const wdEnd = asD && am[3] && +am[3].split(':')[0] < 9 ? new Date(asD.getTime() - 86400000) : asD; // 朝9時前の数字は前日までの稼働日で割る
  const wdDone = wdEnd ? cnt(new Date(Y, M - 1, 1), wdEnd) : 0, wdAll = cnt(new Date(Y, M - 1, 1), new Date(Y, M, 0));
  const yen = n => '¥' + Math.round(+n || 0).toLocaleString('ja-JP');
  const T = rows.reduce((t, r) => { ['face', 'han', 'other', 'app', 'fc', 'sched', 'vSched', 'openN', 'vOpen', 'chase', 'gSched', 'gOpen'].forEach(k => t[k] += r[k]); t.vApp += r.avg * r.app; if (r.type === '業務委託' || r.type === '代理店') t.schedItaku += r.sched; else if (r.n === '不明') t.schedUnk += r.sched; else t.schedOwn += r.sched; return t; },
    { face: 0, han: 0, other: 0, app: 0, fc: 0, sched: 0, vSched: 0, openN: 0, vOpen: 0, chase: 0, gSched: 0, gOpen: 0, vApp: 0, schedOwn: 0, schedItaku: 0, schedUnk: 0 });
  const rate = T.vApp ? Math.round(T.fc / T.vApp * 100) : 75;
  // 工事日を追う案件は、受け取る本人が獲得した案件だけを載せる
  const S = { th: 'padding:7px 10px;border:1px solid #d5dce6;background:#eef3fa;text-align:left;font-weight:bold;white-space:nowrap;vertical-align:top', td: 'padding:7px 10px;border:1px solid #d5dce6;vertical-align:top', sub: 'color:#5b6675;font-size:12px', h: 'margin:22px 0 6px;padding:6px 12px;color:#fff;border-radius:6px;font-size:15px', sec: 'padding:5px 10px;border:1px solid #d5dce6;background:#f6f7f9;color:#5b6675;font-size:12px;font-weight:bold' };
  const tr = (k, v, sub) => `<tr><th style="${S.th}">${k}</th><td style="${S.td}">${v}${sub ? `<div style="${S.sub}">${sub}</div>` : ''}</td></tr>`;
  const sec = t => `<tr><td colspan="2" style="${S.sec}">${t}</td></tr>`;
  const tbl = inner => `<table style="border-collapse:collapse;width:100%;max-width:640px;margin:4px 0">${inner}</table>`;
  // 全体：粗利の目標まで
  const left = Math.max(0, DIGEST.goal - T.gSched), gAvg = T.sched ? T.gSched / T.sched : 0, need = left && gAvg ? Math.ceil(left / gAvg) : 0;
  const goalTxt = left ? `目標 ${yen(DIGEST.goal)} まで <b style="color:#b42828">あと ${yen(left)}</b> ／ <b style="color:#b42828">あと約${need}件</b>の工事予約が必要` : `目標 ${yen(DIGEST.goal)} を<b style="color:#0b7f3a">超える見込み</b>（${yen(T.gSched - DIGEST.goal)} 上回り）`;
  const zen = tbl(
    sec('獲得') +
    tr('全体の獲得件数', `<b>${T.app}件</b>（対面 ${T.face}・反響 ${T.han}${T.other ? '・その他 ' + T.other : ''}）`) +
    tr('獲得からの発生売上予測', `<b>${yen(T.fc)}</b>`, `獲得の単価×開通する割合（${rate}％）`) +
    tr('全体の平均獲得単価', T.app ? `<b>${yen(T.vApp / T.app)}</b>` : '—') +
    sec('工事') +
    tr('今月の開通工事予定数', `<b>${T.sched}件</b>（自社の社員 ${T.schedOwn}件・業務委託 ${T.schedItaku}件${T.schedUnk ? '・担当不明 ' + T.schedUnk + '件' : ''}）`) +
    tr('今月の粗利予測', `<b>${yen(T.gSched)}</b>`, '工事予定の売上から業務委託への支払いを引いた額') +
    tr('実際に開通した粗利', `<b>${yen(T.gOpen)}</b>（${T.openN}件）`) +
    tr('粗利の目標まで', goalTxt, left ? `残り ÷ 工事予定1件あたりの平均粗利 ${yen(gAvg)} で計算` : ''));
  // 工事日を追う案件：1件ずつ枠で表示。本人が動く案件を先に、ソニー待ちは後ろ・灰色
  const v_ = t => esc_(String(t || '').replace(/\t/g, ' ').trim()) || '<span style="color:#9aa3ae">—</span>';
  const card = c => { const hd = c.wait ? 'background:#e5e7eb;color:#4b5563' : 'background:#fff4cc;color:#1b2233';
    const row = (k, v) => `<tr><th style="${S.th};width:9em;font-weight:normal;color:#5b6675">${k}</th><td style="${S.td}">${v}</td></tr>`;
    return `<table style="border-collapse:collapse;width:100%;max-width:640px;margin:0 0 12px;font-size:13px">
      <tr><td colspan="2" style="padding:7px 10px;border:1px solid #d5dce6;${hd}"><b>${esc_(c.name)}様</b>　${esc_(c.bld)}${c.room ? ' ' + esc_(c.room) + '号室' : ''}${c.wait ? '　<span style="font-size:12px">（ソニーの準備待ち：今は追わなくてよい）</span>' : ''}</td></tr>
      ${row('ソニーの状態', v_(c.sony))}${row('申込時の工事希望', v_(c.wish))}${row('こちらでやったこと', v_(c.state === 'まだなし' ? '' : c.state))}${row('メモ', v_(c.memo))}${row('エリア', v_(c.area))}${row('住戸指示日', v_(c.d))}</table>`; };
  let sent = 0;
  Object.keys(DIGEST.to).forEach(name => {
    const r = rows.find(x => x.n === name) || { n: name, face: 0, han: 0, other: 0, app: 0, fc: 0, avg: 0, sched: 0, vSched: 0, openN: 0, vOpen: 0, chase: 0, list: [] };
    const mineAct = r.list.filter(c => !c.wait).length, mineWait = r.list.length - mineAct;
    const kojin = tbl(
      tr('① 今月の獲得', `対面 ${r.face}件 ／ 反響 ${r.han}件${r.other ? ' ／ その他 ' + r.other + '件' : ''} ／ <b>合計 ${r.app}件</b>`) +
      tr('② 今月の発生売上', `<b>${yen(r.fc)}</b>`, `獲得の単価×開通する割合（${rate}％）`) +
      tr('平均獲得単価', r.app ? yen(r.avg) : '—') +
      tr('1日売上', wdDone ? `<b>${yen(r.fc / wdDone)}</b>` : '—', `発生売上 ÷ 稼働日 ${wdDone}日（火・水・木・土・日で数えて、今月は全${wdAll}日）`) +
      tr('③ 今月の工事予定数', `<b>${r.sched}件</b>`) +
      tr('④ 今月の開通売上見込み', `<b>${yen(r.vSched)}</b>`) +
      tr('⑤ 今月の開通売上', `<b>${yen(r.vOpen)}</b>（${r.openN}件）`) +
      tr('工事日を追う案件', `<b style="color:${mineAct ? '#b42828' : '#0b7f3a'}">${mineAct}件</b>${mineWait ? `（ほかにソニー待ち ${mineWait}件）` : ''}`, r.list.length ? '下に1件ずつ載せています' : ''));
    const html = `<p>${name}さん、お疲れさまです。${M}月の実績データです${asofTxt ? `（${asofTxt} 時点）` : ''}。</p>
      <div style="${S.h};background:#1d5fae">【個人データ】${name}さん</div>${kojin}
      <div style="${S.h};background:#2f3b4c">【全体データ】</div>${zen}
      <div style="${S.h};background:#b42828">工事日を追う案件（${name}さんの獲得分：${r.list.length}件）</div>
      ${r.list.length ? [...r.list].sort((a, b) => a.wait - b.wait).map(card).join('') : '<p>工事日を追う案件はありません。</p>'}`;
    if (MailApp.getRemainingDailyQuota() < 3) return;
    const dn = Utilities.formatDate(now, 'Asia/Tokyo', 'M月d日');
    MailApp.sendEmail({ to: DIGEST.to[name], subject: `【確認】${dn}現在の実績データ【${name}】`, htmlBody: digestWrap_(html), name: '業務管理（AImost）' }); sent++;
  });
  if (!force) P.setProperty('digestLast', today);
  log_('担当者への実績データのメールを送りました：' + sent + '通');
}
function digestWrap_(html) { return `<div style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#1b2233">${html}<p style="color:#888;font-size:12px;margin-top:18px">このメールは自動で送っています。</p></div>`; }
/** 試し：代表にだけ、藤原さん分と宇野さん分のメールを送る */
/** 今すぐ藤原さん・宇野さんに送る（送った日を記録して、次は3日後の21時すぎ） */
function sendDigestNow() { const now = new Date(); staffDigest_(now, true); PropertiesService.getScriptProperties().setProperty('digestLast', ymdJst_(now)); }
function digestStart() { PropertiesService.getScriptProperties().setProperty('digestOn', '1'); }
function testDigest() { const save = DIGEST.to; DIGEST.to = { '藤原': OWNER_MAIL, '宇野': OWNER_MAIL }; try { staffDigest_(new Date(), true); } finally { DIGEST.to = save; } }

// ---------- 訪問マップに登録があった日の夜20:30すぎに「本日の稼働データ」をメール（本人：藤原・宇野・大塚／代表：全員分） ----------
const KADO = { at: '20:30', to: ['藤原', '宇野', '大塚'] };
function kadoMail_(now, test) {
  const P = PropertiesService.getScriptProperties();
  const today = ymdJst_(now), hhmm = Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm');
  if (!test && P.getProperty('kadoOn') !== '1') return; /* 文言の確認が済むまで本番の送信は止めておく */
  if (!test) { if (hhmm < KADO.at || P.getProperty('kadoSent') === today) return; P.setProperty('kadoSent', today); }
  const acts = listDocs_('act').filter(x => x.data.d === today);
  if (!acts.length) { if (test) log_('本日の稼働データ：今日の登録がありません'); return; }
  const names = {}; listDocs_('users').forEach(u => { names[u.id] = (u.data.name || '').trim(); });
  const fmt = t => t ? Utilities.formatDate(new Date(t), 'Asia/Tokyo', 'HH:mm') : '—';
  const dur = ms => { const m = Math.round(ms / 60000); return m ? (Math.floor(m / 60) ? Math.floor(m / 60) + '時間' : '') + (m % 60 ? (m % 60) + '分' : '') : '—'; };
  const P_ = {};
  acts.forEach(a => {
    const u = a.data.u || ''; const p = P_[u] || (P_[u] = { u, name: names[u] || u, doors: 0, face: 0, got: 0, ts: [] });
    for (const k in a.data) { const e = a.data[k];
      if (!e || typeof e !== 'object' || e.x || !e.bid || !RES[e.r] || e.r === 'png') continue; // ポスト投函NGは訪問に数えない
      p.doors++; if (e.r === 'fng' || e.r === 'again' || e.r === 'got') p.face++; if (e.r === 'got') p.got++;
      if (e.t) p.ts.push({ t: Number(e.t), b: e.bid }); }
  });
  const people = Object.values(P_).filter(p => p.doors).map(p => { const sp = spanOf_(p.ts); const hrs = sp.ms / 3600000;
    return Object.assign(p, { t0: sp.t0, t1: sp.t1, ms: sp.ms, batch: sp.batch, perH: hrs >= 0.25 ? Math.round(p.doors / hrs * 10) / 10 : null }); })
    .sort((a, b) => b.doors - a.doors);
  if (!people.length) return;
  if (test) people.forEach(p => log_('試し：' + p.name + ' ' + (p.t0 ? Utilities.formatDate(new Date(p.t0), 'Asia/Tokyo', 'HH:mm') : '—') + '〜' + (p.t1 ? Utilities.formatDate(new Date(p.t1), 'Asia/Tokyo', 'HH:mm') : '—') + ' ' + Math.round(p.ms / 60000) + '分 訪問' + p.doors + ' 対面' + p.face + ' 獲得' + p.got + ' 1h' + p.perH + ' まとめ' + p.batch));
  const dn = Utilities.formatDate(now, 'Asia/Tokyo', 'M月d日') + '（' + '月火水木金土日'.charAt(+Utilities.formatDate(now, 'Asia/Tokyo', 'u') - 1) + '）';
  const th = 'padding:7px 10px;border:1px solid #d5dce6;background:#eef3fa;text-align:left;white-space:nowrap', td = 'padding:7px 10px;border:1px solid #d5dce6';
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
  const note = '<p style="color:#5b6675;font-size:12px">稼働時間は、訪問マップの最初の登録から最後の登録までの時間です（休憩も含みます）。あとからまとめて入力した登録は、時間の計算から外しています。訪問にポスト投函NGは数えていません。</p>';
  let sent = 0; const send = (to, subject, html) => { if (MailApp.getRemainingDailyQuota() < 3) return; MailApp.sendEmail({ to, subject, htmlBody: digestWrap_(html), name: '業務管理（AImost）' }); sent++; };
  // 本人あて
  people.forEach(p => {
    if (!KADO.to.includes(p.name) || !/@/.test(p.u)) return;
    const row = (k, v) => `<tr><th style="${th}">${k}</th><td style="${td}">${v}</td></tr>`;
    const html = `<p>${p.name}さん、お疲れさまです。本日の稼働データです。</p>
      <table style="border-collapse:collapse;width:100%;max-width:520px">${row('稼働開始', `<b>${fmt(p.t0)}</b>`)}${row('稼働終了', `<b>${fmt(p.t1)}</b>`)}${row('稼働時間', `<b>${dur(p.ms)}</b>`)}${row('訪問', `<b>${p.doors}件</b>`)}${row('対面', `<b>${p.face}件</b>（対面率 ${pct(p.face, p.doors)}）`)}${row('獲得', `<b>${p.got}件</b>`)}${row('1時間あたりの訪問', `<b>${p.perH != null ? p.perH + '件' : '—'}</b>`)}</table>
      ${p.batch ? `<p style="font-size:13px">あとからまとめて入力した登録：${p.batch}件</p>` : ''}${note}`;
    send(test ? OWNER_MAIL : p.u, `【本日の稼働データ】${dn}${p.name}さん`, html);
  });
  // 代表あて：全員分
  const T = people.reduce((t, p) => { t.doors += p.doors; t.face += p.face; t.got += p.got; t.ms += p.ms; return t; }, { doors: 0, face: 0, got: 0, ms: 0 });
  const tHrs = T.ms / 3600000;
  const head = ['担当', '稼働開始', '稼働終了', '稼働時間', '訪問', '対面', '獲得', '1時間あたりの訪問'].map(h => `<th style="${th}">${h}</th>`).join('');
  const line = p => `<tr><td style="${td}"><b>${esc_(p.name)}</b></td><td style="${td}">${fmt(p.t0)}</td><td style="${td}">${fmt(p.t1)}</td><td style="${td}">${dur(p.ms)}</td><td style="${td};text-align:right">${p.doors}</td><td style="${td};text-align:right">${p.face}<span style="color:#5b6675;font-size:12px">（${pct(p.face, p.doors)}）</span></td><td style="${td};text-align:right"><b>${p.got}</b></td><td style="${td};text-align:right">${p.perH != null ? p.perH : '—'}</td></tr>`;
  const total = `<tr style="background:#f6f7f9"><td style="${td}"><b>合計</b></td><td style="${td}"></td><td style="${td}"></td><td style="${td}">${dur(T.ms)}</td><td style="${td};text-align:right"><b>${T.doors}</b></td><td style="${td};text-align:right"><b>${T.face}</b><span style="color:#5b6675;font-size:12px">（${pct(T.face, T.doors)}）</span></td><td style="${td};text-align:right"><b>${T.got}</b></td><td style="${td};text-align:right">${tHrs >= 0.25 ? Math.round(T.doors / tHrs * 10) / 10 : '—'}</td></tr>`;
  send(OWNER_MAIL, `【本日の稼働データ】${dn}全員分`, `<p>本日の稼働データ（全員分）です。</p><table style="border-collapse:collapse;width:100%;max-width:820px;font-size:13px"><tr>${head}</tr>${people.map(line).join('')}${total}</table>${note}`);
  log_('本日の稼働データのメールを送りました：' + sent + '通' + (test ? '（試し）' : ''));
}
/** 試し：今日の登録で、本人分も全員分も代表にだけ送る */
function testKado() { kadoMail_(new Date(), true); }
/** 本番の送信を始める */
function kadoStart() { PropertiesService.getScriptProperties().setProperty('kadoOn', '1'); }

// ---------- Googleカレンダー（以前の書き込み。今は使わない） ----------
function cal_() {
  const c = CalendarApp.getCalendarsByName(CAL_NAME)[0];
  return c || CalendarApp.createCalendar(CAL_NAME, { color: CalendarApp.Color.BLUE, summary: '業務管理アプリで申告した予定（自動で入ります。ここで直してもアプリには戻りません）' });
}
function syncCal_(today, now, users, days, P, props) {
  let cal = null; const getCal = () => cal || (cal = cal_());
  users.forEach(u => {
    const d = days[u.email]; const uk = ukey_(u.email); const pre = 'ev_' + today + '_' + uk + '_'; const want = {};
    if (d && d.off) want.off = { title: `【${u.name}】休み`, allDay: true };
    if (d && !d.off) {
      const ses = Object.keys(d.ses || {}).map(id => Object.assign({ id }, d.ses[id]));
      Object.keys(d.plan || {}).forEach(id => {
        const p = d.plan[id]; let st = at_(today, p.s), en = at_(today, p.e); if (!st || !en) return;
        const mine = ses.filter(s => s.pid === id); let mark = '';
        if (mine.length) {
          const run = mine.some(s => !s.en);
          st = new Date(Math.min.apply(null, mine.map(s => s.st)));
          const last = Math.max.apply(null, mine.map(s => s.en || now.getTime()));
          en = new Date(run ? Math.max(last, Math.min(en.getTime(), last + 3600000)) : last);
          if (en.getTime() - st.getTime() < 15 * 60000) en = new Date(st.getTime() + 15 * 60000);
          mark = run ? '▶ ' : '✔ ';
        }
        want[id] = { title: `${mark}【${u.name}】${KIND_J[p.k] || ''}${p.m ? '：' + p.m : ''}`, st, en };
      });
      ses.filter(s => !s.pid).forEach(s => {
        const st = new Date(s.st); let en = new Date(s.en || now.getTime());
        if (en.getTime() - st.getTime() < 15 * 60000) en = new Date(st.getTime() + 15 * 60000);
        want['s' + s.id] = { title: `${s.en ? '✔ ' : '▶ '}【${u.name}】${KIND_J[s.k] || ''}（予定外）`, st, en };
      });
    }
    Object.keys(want).forEach(id => {
      const w = want[id], key = pre + id;
      const hash = w.title + '|' + (w.allDay ? 'all' : w.st.getTime() + '-' + w.en.getTime());
      const cur = (props[key] || '').split('|');
      if (cur[0] && cur.slice(1).join('|') === hash) return;
      let ev = null; if (cur[0]) { try { ev = getCal().getEventById(cur[0]); } catch (e) { ev = null; } }
      const guests = u.email === OWNER_MAIL ? '' : u.email, desc = '業務管理アプリから自動で入れた予定です。\n' + APP_URL;
      if (!ev) ev = w.allDay ? getCal().createAllDayEvent(w.title, dateOf_(today), { guests, sendInvites: false, description: desc }) : getCal().createEvent(w.title, w.st, w.en, { guests, sendInvites: false, description: desc });
      else { ev.setTitle(w.title); if (w.allDay) ev.setAllDayDate(dateOf_(today)); else ev.setTime(w.st, w.en); }
      const val = ev.getId() + '|' + hash; P.setProperty(key, val); props[key] = val;
    });
    Object.keys(props).filter(k => k.indexOf(pre) === 0 && !want[k.slice(pre.length)]).forEach(k => {
      try { const ev = getCal().getEventById(props[k].split('|')[0]); if (ev) ev.deleteEvent(); } catch (e) {}
      P.deleteProperty(k); delete props[k];
    });
  });
}

// ---------- 道具 ----------
function dateOf_(s) { return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); }
function at_(day, hm) { if (!hm || !/^\d{1,2}:\d{2}$/.test(hm)) return null; return Utilities.parseDate(day + ' ' + hm, 'Asia/Tokyo', 'yyyyMMdd HH:mm'); }
function esc_(t) { return String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function wrap_(html) { return `<div style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#1b2233">${html}<p style="margin-top:18px"><a href="${APP_URL}" style="background:#1B1FA8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">業務管理を開く</a></p><p style="color:#888;font-size:12px">このメールは業務管理アプリから自動で送っています。</p></div>`; }
// 3日より前の「送った印」とカレンダーの対応表を消す
function cleanup_(P, props, today) {
  if (props.n_cleaned === today) return;
  const lim = ymdJst_(new Date(dateOf_(today).getTime() - 3 * 86400000));
  Object.keys(props).forEach(k => {
    const m = k.match(/^(?:r|n|ev|calsig)_(\d{8})_/);
    if (m && m[1] < lim) { P.deleteProperty(k); delete props[k]; }
  });
  P.setProperty('n_cleaned', today); props.n_cleaned = today;
}
