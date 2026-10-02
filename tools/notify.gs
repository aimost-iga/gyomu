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
  report: '20:30',  // 日報がまだ
  yreport: ['08:30', '12:00'], // 昨日の日報がまだ（朝のうち）
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
  // カレンダーの読み取りは、お知らせのオン・オフに関係なくいつも行う（分析のため）
  try { readCals_(now); } catch (e) { log_('カレンダー読み取りの失敗：' + e.message); }
  // 代表がアプリの「設定」で「動かす」にするまでは、お知らせはしない
  const appCfg = getDoc_('cfg/app') || {};
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
      if (hhmm >= NT.report && active && !d.sub) due.push(['rep', '今日の日報がまだです', '振り返りをひとこと書いて提出してください。1分で終わります。']);
    }
    const y = ydays[u.email];
    if (yday >= '20261003' && y && !y.off && !(y.cal && y.cal.off) && !y.sub && (Object.keys(y.plan || {}).length || Object.keys(y.ses || {}).length || (y.v && y.v.doors)) && hhmm >= NT.yreport[0] && hhmm < NT.yreport[1])
      due.push(['yrep', '昨日の日報がまだです', 'アプリを開くと一番上に出ています。ひとことで出せます。']);

    due.forEach(([kind, title, body]) => {
      const key = 'r_' + today + '_' + uk + '_' + kind;
      const [n0, last] = (props[key] || '0|0').split('|').map(Number);
      if (now.getTime() - last < NT.every * 60000 - 60000) return;
      const n = n0 + 1;
      const how = send_(u, title + (n > 1 ? `（${n}回目）` : ''), body, kind.split('_')[0]);
      const v = n + '|' + now.getTime(); P.setProperty(key, v); props[key] = v;
      const c = counts[uk] = counts[uk] || {}; const kk = kind.split('_')[0]; c[kk] = (c[kk] || 0) + 1;
      if (n === NT.escalate && u.email !== OWNER_MAIL) {
        const what = { plan: '今日の予定の申告', start: '開始', end: '終了', rep: '今日の日報', yrep: '昨日の日報' }[kk];
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
    const state = s.off ? '休み' : s.sub ? '日報済み' : (s.plan || s.work) ? '<b style="color:#c0392b">日報なし</b>' : '<b style="color:#c0392b">申告なし</b>';
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
  html += `<li>日報 ${w1.subs}日・休み ${w1.offs}日${w1.none ? `・<b style="color:#c0392b">申告なし ${w1.none}日</b>` : ''}</li></ul>`;
  html += '<p>くわしくはアプリの「成績」で。今週もいきましょう！</p>';
  mail_(u, '先週の振り返り', html);
}

// ---------- Googleカレンダーの読み取り ----------
// 各自が代表に共有したカレンダーを読み、その日の予定を day/<日付>_<人> の cal に書く。
// 名簿で「仕事用カレンダー」を指定した人はそれを、なければ本人のメールのカレンダーを読む。
const CAL_KIND = [['door', /訪販|訪問|ドア|ローラー/], ['call', /反響|架電|電話|コール|テレ/], ['post', /配布|ポスティング|ポスト|チラシ/], ['apo', /アポ|商談|面談|訪問予約/]];
const OFF_RE = /休み|休暇|有給|公休|休日|OFF|オフ/i;
function calKind_(t) { for (const [k, re] of CAL_KIND) if (re.test(t)) return k; return 'other'; }
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
