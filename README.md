# RISE｜國立臺灣大學數思新生計畫

Reasoning and Inquiry for Science Education

RISE 是數學、物理、化學與提問力的教育平台。前端採靜態 HTML/CSS/JavaScript；帳號、資料與附件使用 Supabase。正式教材、團隊名單與活動由團隊維護，頁面中的範例與規劃不代表已開課或完成營運驗收。

## 本機開發

使用 Node.js 24（與 CI 一致），在儲存庫根目錄執行：

```bash
npm ci --ignore-scripts
npm run check
npm test
python3 -m http.server 8000 --bind 127.0.0.1
```

依賴統一由根目錄的 `package.json` 與 `package-lock.json` 管理，不需在測試子目錄另行安裝。`npm run check` 包含 JavaScript 語法、本機連結、重複 id、三學科資料與敏感金鑰樣式檢查；`npm test` 會在各腳本所需的工作目錄執行完整測試。

資料庫測試使用 PGlite 與模擬的 Auth/Storage；前端與 Edge Function 測試會模擬外部服務。通過測試不代表正式 Supabase、SMTP、Google Drive 或 AI 已部署或連通。

GitHub Actions 會在推送至 `main` 或建立 Pull Request 時執行相同檢查。CI 與網站部署流程獨立，不能把測試通過當作部署完成。

## 網站與程式入口

- 公開資訊：首頁、關於計畫、加入我們、核心團隊、重要日程。
- 學生：科學探索、三學科、單元教材與習作、我的提問、作業、競賽、學習紀錄及討論題公告。
- 教師／助教：依核准角色及課程範圍存取待答、批閱、培訓與共備功能。
- 管理員：會員、資格審核、課程權限、影音與網站功能開關。
- `learning.html`、`inquiry.html` 保留舊連結相容性；不重新加入「學習路徑」學生導覽。現在的主要入口為 `science.html`、`modules.html`、`questions.html`。

| 位置 | 用途 |
| --- | --- |
| `content.js`、`site-info.js` | 學科、內容欄位與公開計畫資訊 |
| `script.js` | 首頁、三學科、影音與其他動態公開頁 |
| `auth.js`、`role-navigation.js` | 登入、帳號、問答及角色導覽 |
| `learning-workflows.js`、`program.js` | 作業、培訓、競賽、單元與社群流程 |
| `theme-rise.css` | 全站主題，設計說明見 [視覺指引](docs/VISUAL-20261013.md) |
| `backend/`、`supabase/` | SQL、部署指引與 Edge Functions |
| `tools/`、`tests/` | 維護工具與回歸測試 |

教材與影片請使用教師／管理員的既有管理入口；影音管理見 [部署與操作說明](backend/VIDEO-MANAGEMENT-SETUP.md)。`content.js` 保留基本內容與範例欄位，不能以它取代後端的已發布資料與權限。

## 後端與部署文件

未來目標是校內網頁伺服器與自架 Supabase；目前設定與正式部署狀態仍須核實。先讀 [Codex 交接與部署約束](docs/CODEX-HANDOFF.md)。

既有專案**不要重跑初始 `backend/setup.sql`**。先盤點目前 schema 與備份，再依相依順序補齊增量更新；舊 migration 仍可能是新環境的必要前置，不能因日期較早就刪除或隨意重跑。初始帳號安裝文件只涵蓋基礎功能，不能代替完整部署。

| 項目 | 文件 |
| --- | --- |
| 帳號與 Auth URL | [基礎帳號設定](backend/ACCOUNT-SETUP.md) |
| 教學／社群更新及前置檢查 | [模組與 SQL 順序](backend/program/README.md) |
| RLS、附件與安全刪帳 | [安全補強與驗收](docs/SECURITY-UPGRADE-20261007.md) |
| 教師課程授權 | [課程範圍設定](backend/TEACHER-COURSE-ACCESS.md) |
| 教材與附件 | [教學資源](backend/TEACHING-RESOURCES-SETUP.md)、[Google Drive](backend/GOOGLE-DRIVE-SETUP.md) |
| 審核通知與 AI | [通知信](backend/REVIEW-MAIL-SETUP.md)、[AI 顧問](backend/QUESTION-ADVISOR-SETUP.md) |
| 網站功能開關 | [開放控制與限制](docs/SITE-FEATURES.md) |

## 維護與安全

- 前端只放 Supabase Project URL、publishable／anon key 等公開設定。`service_role`、資料庫密碼、SMTP 密碼與其他私密金鑰不得提交到 GitHub。
- 角色與課程隔離由後端 RLS／RPC 驗證，不能只靠隱藏前端入口。附件維持私有；公開儲存庫內的影片不能視為私密內容。
- `privacyURL` 必須以 HTTPS 指向有效個資告知頁；自助刪帳只處理本人，附件透過 Storage／Drive API 清理，不直接刪除 `storage.objects` 冒充實體檔案刪除。
- 調整頁面標題或介紹後，可執行 `node tools/generate-site-metadata.mjs` 更新 metadata 與 sitemap，檢查差異後再跑完整檢查。此工具會改寫 HTML 與 sitemap，不是唯讀檢查。
- GitHub Pages 現有基址為 `/RISE/`；搬站時須分別核對 Auth callback、redirect、CORS、Edge Function 設定及外部服務，不能只更換網頁網址。
- 舊版程式與一次性檢查記錄可用 `git log --all -- <path>`、`git show <commit>:<path>` 查閱。還原時只取需要的變更，避免覆蓋後續功能。

上線前仍須以隔離測試帳號驗證登入／重設密碼、跨帳號與跨課程隔離、提問及批閱、觀看紀錄、附件下載與清理失敗重試。不要刪除真實學生資料作為測試，也不要把 GitHub 更新當成正式資料庫遷移已完成。
