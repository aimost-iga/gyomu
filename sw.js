// スマホ通知の受け取り役（画面を閉じていても通知を出す）
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: 'AIzaSyBCfihUw4vf46SoDEYYAKDEKckUsklLV4M',
  authDomain: 'aimost-houmon-map.firebaseapp.com',
  projectId: 'aimost-houmon-map',
  storageBucket: 'aimost-houmon-map.firebasestorage.app',
  messagingSenderId: '716268085137',
  appId: '1:716268085137:web:afa98d8adf185b23c4c430'
});
const messaging = firebase.messaging();
// 通知を押したらアプリを開く（開いていればそこへ）
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && (e.notification.data.link || (e.notification.data.FCM_MSG && e.notification.data.FCM_MSG.notification && e.notification.data.FCM_MSG.notification.click_action))) || self.registration.scope;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return clients.openWindow(url);
  }));
});
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
