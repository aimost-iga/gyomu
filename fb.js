// 業務管理：Google（Firebase）とのつなぎ。訪問マップと同じ保管場所・同じログイン・同じ名簿を使う。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, doc, collection, query, where, getDoc, getDocs, setDoc, updateDoc, onSnapshot, FieldPath
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const CONFIG = {
  apiKey: 'AIzaSyBCfihUw4vf46SoDEYYAKDEKckUsklLV4M',
  authDomain: 'aimost-houmon-map.firebaseapp.com',
  projectId: 'aimost-houmon-map',
  storageBucket: 'aimost-houmon-map.firebasestorage.app',
  messagingSenderId: '716268085137',
  appId: '1:716268085137:web:afa98d8adf185b23c4c430'
};
const OWNER = 'igarashi@aimost.co.jp';

const app = initializeApp(CONFIG);
const auth = getAuth(app);
const fs = initializeFirestore(app, {});

const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const isPlain = v => v && typeof v === 'object' && !Array.isArray(v);
const ref = p => doc(fs, ...p.split('/'));
const ukey = e => (e || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
const wrap = e => { const x = new Error((e && e.message) || 'error'); x.code = (e && e.code) || 'unknown'; return x; };

let ME = null;
const isStaff = () => !!ME && (ME.role === 'admin' || ME.role === 'staff');
const isAdmin = () => !!ME && ME.role === 'admin';

// 1日1人1文書の中身を、2段目（plan.xxx / ses.xxx など）ごとに書き換える。無い文書なら作る。
async function patchDay(d, patch) {
  const r = ref('day/' + d + '_' + ukey(ME.email));
  const base = { u: ME.email, d };
  const pairs = [];
  const walk = (o, pre) => { for (const k of Object.keys(o)) { const v = o[k]; const s = pre.concat(k); if (isPlain(v) && s.length < 2) walk(v, s); else pairs.push(new FieldPath(...s), clean(v)); } };
  walk(Object.assign({}, patch, base), []);
  try { await updateDoc(r, ...pairs); }
  catch (e) {
    if (e && (e.code === 'not-found' || e.code === 'permission-denied')) {
      let exists = true; try { exists = (await getDoc(r)).exists(); } catch (e2) {}
      if (!exists) { try { await setDoc(r, clean(Object.assign({}, base, patch))); return; } catch (e3) { throw wrap(e3); } }
    }
    throw wrap(e);
  }
}
// 消す（2段目の1つを消す）
async function dropDay(d, field, id) {
  const { deleteField } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  try { await updateDoc(ref('day/' + d + '_' + ukey(ME.email)), new FieldPath(field, id), deleteField()); } catch (e) { throw wrap(e); }
}

const day = {
  watch: (d, next) => onSnapshot(ref('day/' + d + '_' + ukey(ME.email)), s => next(s.exists() ? s.data() : null), () => next(null)),
  patch: patchDay, drop: dropDay,
  mine: async () => { try { return (await getDocs(query(collection(fs, 'day'), where('u', '==', ME.email)))).docs.map(x => x.data()); } catch (e) { return null; } },
  range: async (from, to) => {
    if (!isAdmin()) return [];
    try { return (await getDocs(query(collection(fs, 'day'), where('d', '>=', from), where('d', '<=', to)))).docs.map(x => x.data()); } catch (e) { return null; }
  }
};
// 訪問マップの今日の活動記録（訪問・対面・獲得を自動で数えるため）
const act = {
  watchDay: (d, next) => {
    if (isStaff()) return onSnapshot(query(collection(fs, 'act'), where('d', '==', d)), s => next(s.docs.map(x => x.data())), () => next([]));
    return onSnapshot(ref('act/' + d + '_' + ukey(ME.email)), s => next(s.exists() ? [s.data()] : []), () => next([]));
  }
};
const cfg = {
  watch: (id, next) => onSnapshot(ref('cfg/' + id), s => next(s.exists() ? s.data() : null), () => next(null)),
  set: async (id, d) => { try { await setDoc(ref('cfg/' + id), clean(d)); } catch (e) { throw wrap(e); } }
};
// 名簿：users/<メール>。名前と別名（ほかの表やリストでの書き方）
const people = {
  list: async () => { try { return (await getDocs(collection(fs, 'users'))).docs.map(x => Object.assign({ email: x.id }, x.data())); } catch (e) { return null; } },
  save: async (email, d) => { try { await setDoc(ref('users/' + email.toLowerCase()), clean(d), { merge: true }); } catch (e) { throw wrap(e); } }
};
// スマホ通知の受け取り先と、通知の許可の状態
const push = {
  save: async d => { try { await setDoc(ref('push/' + ukey(ME.email)), clean(Object.assign({ u: ME.email, at: Date.now() }, d)), { merge: true }); } catch (e) {} },
  all: async () => { if (!isAdmin()) return {}; try { const o = {}; (await getDocs(collection(fs, 'push'))).docs.forEach(x => { o[x.id] = x.data(); }); return o; } catch (e) { return {}; } }
};
// 経費（経費申請管理のスプレッドシートから Apps Script が書く）：本人は自分の分、代表は全員分
const kh = {
  mine: next => onSnapshot(ref('kh/' + ukey(ME.email)), s => next(s.exists() ? s.data() : null), () => next(null)),
  all: next => isAdmin() ? onSnapshot(ref('kh/_all'), s => next(s.exists() ? s.data() : null), () => next(null)) : (next(null), () => {})
};
// 自動のお知らせを送った回数（Apps Script が書く）
const ntc = {
  watch: (d, next) => isAdmin() ? onSnapshot(ref('ntc/' + d), s => next(s.exists() ? s.data() : {}), () => next({})) : (next({}), () => {})
};

async function resolveMe(u) {
  const email = (u.email || '').toLowerCase();
  let d = null;
  try { const s = await getDoc(ref('users/' + email)); d = s.exists() ? s.data() : null; } catch (e) { d = null; }
  if (email === OWNER) d = Object.assign({ name: u.displayName || '' }, d || {}, { role: 'admin', active: true });
  if (!d || d.active === false) return null;
  return { email, id: email, name: (d.name || u.displayName || email).trim(), role: d.role || 'staff' };
}
function whenSignedIn() {
  return new Promise(resolve => {
    const off = onAuthStateChanged(auth, async u => {
      off();
      if (!u) { resolve({ state: 'out' }); return; }
      const me = await resolveMe(u);
      if (!me) { resolve({ state: 'denied', email: u.email }); return; }
      ME = me; resolve({ state: 'in', me });
    });
  });
}

window.FB = {
  app, day, act, cfg, people, push, ntc, kh, ukey,
  me: () => ME, isStaff, isAdmin, whenSignedIn,
  signIn: async () => {
    const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, p);
  },
  signOut: async () => { await signOut(auth); location.reload(); }
};
window.dispatchEvent(new Event('fb-ready'));
