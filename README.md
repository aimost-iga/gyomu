# 業務管理

株式会社AImost の業務管理アプリ（予定申告・開始/終了・反響対応・配布・日報・成績・チーム・ゲーム）。

- 開く場所：https://aimost-iga.github.io/gyomu/
- ログイン・名簿・データの保管場所は、訪問マップと同じ Google（Firebase：aimost-houmon-map）。訪問マップで登録した訪問・対面・獲得は自動で入る。
- 記録：`day/<日付>_<人>`（1日1人1文書）、設定：`cfg/goal`・`cfg/quest`・`cfg/reward`・`cfg/app`、スマホのお知らせ：`push/<人>`、お知らせ回数：`ntc/<日付>`。
- 入れる人のルールは訪問マップの倉庫の `firestore.rules`（同じ保管場所なので1つにまとめている）。
- 自動のお知らせ・Googleカレンダー反映は `tools/notify.gs`（訪問マップの毎晩の書き写しと同じ Apps Script に足し、`setupNotify` を一度実行）。
