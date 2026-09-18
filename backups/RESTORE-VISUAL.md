# 視覺更新備份與復原

更新前完整版本：`516026dc8ab7eed3bf681dbbeca9737a7747b7ff`。

完整網站程式封存下載：
https://github.com/youtingyeh/RISE/archive/516026dc8ab7eed3bf681dbbeca9737a7747b7ff.zip

`visual-20260917.json` 另保存本次修改的 33 個 HTML 與 script.js 原文，及更新後內容指紋。不包含會員資料、密碼、資料庫或 Google Drive 檔案；這些也未被本次視覺更新修改。

## 不喜歡新版時

可直接要求「還原 2026-09-17 美化前風格」，先檢查是否已有後續功能更新，再復原。

本機 clone 使用者可執行：

```sh
node tools/restore-visual-style.mjs
node tools/restore-visual-style.mjs --restore
git diff
```

第一行僅顯示說明；第二行才會復原前端檔案。若發現後續修改，程式會在写入前停止，避免覆蓋新功能。檢查後自行 commit/push 才會更新線上頁面。

只想比較配色，可暫時移除 HTML 最後的 theme-rise.css 引用；這只還原樣式，不會還原新版首頁文案及版型。

不要整個倒回舊 commit 或覆蓋整個專案，以免丟失之後新增的功能。本次復原不需要執行任何 SQL。
