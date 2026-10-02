// スマホ通知の受け取り登録。許可の状態は名簿の横（push/<人>）に残し、代表が見られるようにする。
import { getMessaging, getToken, onMessage, isSupported } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';

export async function state() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  try { if (!(await isSupported())) return 'unsupported'; } catch (e) { return 'unsupported'; }
  return Notification.permission; // granted / denied / default
}
// 許可をもらって、受け取り先を保存する。vapid は Firebase の「ウェブプッシュ証明書」の鍵
export async function enable(vapid, ask) {
  const st = await state();
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (st === 'unsupported') { await FB.push.save({ perm: ios && !standalone ? 'needhome' : 'unsupported', ua: navigator.userAgent.slice(0, 120) }); return ios && !standalone ? 'needhome' : 'unsupported'; }
  let perm = st;
  if (perm === 'default' && ask) perm = await Notification.requestPermission();
  if (perm !== 'granted') { await FB.push.save({ perm }); return perm; }
  if (!vapid) { await FB.push.save({ perm: 'granted' }); return 'novapid'; }
  const reg = await navigator.serviceWorker.register('sw.js');
  const token = await getToken(getMessaging(FB.app), { vapidKey: vapid, serviceWorkerRegistration: reg });
  if (token) await FB.push.save({ perm: 'granted', tokens: { [token.slice(-40).replace(/[^A-Za-z0-9_-]/g, '_')]: token }, ua: navigator.userAgent.slice(0, 120) });
  // 画面を開いている間に届いた通知は、画面の中で知らせる
  onMessage(getMessaging(FB.app), p => { const n = p.notification || {}; window.dispatchEvent(new CustomEvent('push-in', { detail: { title: n.title, body: n.body } })); });
  return 'granted';
}
