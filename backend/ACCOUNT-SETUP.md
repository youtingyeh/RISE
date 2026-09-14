# RISE 帳號與 Supabase 設定

本文件說明目前網站的帳號、教師審核與觀看紀錄設定。網站已接上 Supabase 公開設定，但資料庫 migration、郵件寄送與正式環境驗收仍須由專案管理者在自己的 Supabase 後台確認。

## 1. 一次需要更換／新增的檔案

目前 GitHub 根目錄的共用核心檔案如下：

| 檔案 | 修改 |
| --- | --- |
| index.html | 首頁與載入失敗時的備用畫面 |
| script.js | 公開頁面、學習頁面與共用導覽 |
| account-nav.js | 依 Supabase 工作階段切換帳號列與登出鍵 |
| learning-session.js | 學習頁登入閘門與觀看紀錄介面 |
| media.js | YouTube／自有影片播放器與觀看紀錄追蹤 |

新增下列檔案，與 index.html 放同一層。若你已建立舊版 admin-review.html，請用這次版本整份替換。

| 檔案 | 功能 |
| --- | --- |
| register.html | 註冊：姓名、信箱、密碼、學生／教師意願、個資告知同意 |
| login.html | 信箱密碼登入 |
| verify-email.html | 驗證信返回頁、重新寄送驗證信 |
| forgot-password.html | 寄送密碼重設信 |
| reset-password.html | 驗證重設流程後更新密碼 |
| account.html | 個人帳號、教師申請狀態、審核意見、登出 |
| teacher-apply.html | 教師任職資料、申請、補件再送審 |
| admin-review.html | 管理員案件分頁、狀態篩選、紀錄、核准／補件／不予核准 |
| auth.css | 這些新頁面的共用樣式 |
| auth.js | 所有帳號頁面共同使用的操作程式 |
| auth-config.js | 公開的帳號服務設定 |

另有 `backend/setup.sql` 與 `backend/watch-history.sql`：兩者都在 Supabase SQL Editor 執行，不能當成網頁 JavaScript 貼入。
`ACCOUNT-SETUP.md` 是這份說明，不是網站必需檔案。
`style.css`、`content.js` 與各 HTML 頁面必須和上述檔案放在同一個 GitHub Pages 根目錄。

## 2. 訪客與角色流程

公開影片、學科探索與計畫介紹維持不必登入。
首頁 → 註冊 → 收取並點擊驗證信 → 登入 → 會員中心。

- 學生／學習者：完成信箱驗證後使用一般學習帳號。
- 教師：註冊時可選教師意願；驗證並登入後再提交任職資訊，等待審核。
- 待審核或待補件的教師申請人：僅有一般學習帳號，不是正式教師權限。
- 助教：由團隊指派，不能自行選擇升級。
- 管理員：由專案擁有者在後台指派，不能透過註冊表指定。
- 已核准教師：具有教師角色；此更新未建立課程或學生作業資料表，因此不代表已能查看全體學生。

教師送件後：待審核 → 核准（同時授予教師角色）／退回補件（可修改再送審）／不予核准（結案）。
管理員不能核准自己；同一案件若被其他管理員處理，舊頁面的決定會被拒絕，須重新整理。

## 3. 尚未設定後端時

可以先開啟 register.html、login.html 查看表單與導覽。
未填 auth-config.js 時，輸入及送出停用，畫面說明服務尚未啟用。沒有假帳號、假登入或假寄信。
這是預期行為，不是白畫面或程式遺漏。正式操作要透過 HTTPS 網站，不能依賴直接雙擊本機檔案。

## 4. 完整啟用順序

1. 使用計畫團隊可持續管理的帳號建立 Supabase 專案。
2. 在 SQL Editor 執行 `backend/setup.sql` 一次。此檔供首次安裝；已有同名表時不要刪表重跑。接著執行可重複套用的 `backend/watch-history.sql`。
3. 在 Authentication 開啟 Email provider、允許註冊，並開啟 Confirm email。
4. 將 Auth 密碼最低長度設為 12；本頁也會檢查兩次密碼一致。
5. URL Configuration 設定：
   - Site URL：`https://youtingyeh.github.io/RISE/`
   - Redirect URLs：`https://youtingyeh.github.io/RISE/verify-email.html`
   - Redirect URLs：`https://youtingyeh.github.io/RISE/reset-password.html`
   - 路徑大小寫必須一致。
6. 在 Auth Email/SMTP 設定團隊寄件服務，完成寄件網域驗證。使用 Supabase 預設確認與密碼重設郵件範本，保留 ConfirmationURL；不要任意改成不相容的返回連結。
7. 團隊完成個資蒐集告知網頁：實際蒐集目的／欄位、使用與保存方式、權利申請及聯絡管道等內容由計畫團隊確認。本更新不杜撰機構承諾。
8. 編輯 auth-config.js：填 Project URL、publishable key（或 legacy anon key）、privacyURL。siteURL 已填好目前 GitHub Pages 網址。
9. 將上表檔案一次上傳到 GitHub。同名檔案覆蓋，新頁面與 index.html 同一層；不要上傳成多一層 RISE 子資料夾。
10. 自己先註冊一個帳號並完成信箱驗證。到 Authentication Users 取得該帳號 UUID；按照 setup.sql 最下方註解，在 SQL Editor 明確授予自己 admin。
11. 以另一個測試信箱建立教師申請，測試核准／補件／重送；用第三個一般帳號確認無法讀取別人的申請或呼叫審核。

只有 Project URL 與 publishable／anon key 可以放公開 GitHub。service_role、secret key、SMTP 密碼不可放進 auth-config.js、content.js 或任何網頁程式碼。資料表的列層級權限規則已包含在 SQL 中。

## 5. 新增完成與仍待接續的範圍

| 功能 | 本次交付 |
| --- | --- |
| 首頁和所有既有頁面的註冊／登入入口 | 已修改程式 |
| 註冊、登入、登出、驗證、重寄、密碼重設 | 已寫入 Supabase 接線，須完成真實服務設定與端到端驗收 |
| 教師送件、補件、管理員審核、版本與紀錄 | 已寫入介面與資料庫函式，須執行 SQL 並驗收 |
| 會員中心顯示審核結果 | 已寫入查詢與呈現 |
| 信箱驗證信與密碼重設信 | 由 Supabase Auth 寄出，正式寄件需設定 SMTP |
| 教師送件／核准／補件「通知信」 | 本次未實作寄送服務；結果可在會員中心查看 |
| 教師證明文件上傳 | 尚未實作；未開放上傳入口 |
| 助教／教師課程分派、學生作業、雲端學習歷程 | 尚未實作，不會因註冊成功自動具備 |
| 個資告知正式文案 | 待團隊提供；未設定網址前停用註冊 |

後續通知信需增加伺服器端寄送函式與待寄佇列：由送件或審核事件建立通知，背景工作寄出、失敗重試、避免重複寄送，並記錄寄件結果。不能把郵件金鑰放前端，也不能把「審核成功」當作「通知信已寄出」。

## 6. 技術交接

- 帳號與審核使用 3 張表：rise_profiles、rise_teacher_applications、rise_application_events；觀看紀錄另使用 rise_watch_sessions 與 rise_watch_history 檢視表。
- 所有一般使用者只能 SELECT 自己的資料；沒有直接 INSERT／UPDATE／DELETE 授權。
- 寫入只走兩個具權限驗證的 RPC：rise_submit_teacher_application、rise_review_teacher_application。
- 審核、角色變更、紀錄在同一交易內完成；版本參數與列鎖防止重複審核或覆寫新版本。
- roles 不由 raw_user_meta_data 決定；requested_kind 只是註冊意願。
- 目前以固定版本的 Supabase JS v2 CDN 載入 SDK；CDN 失敗會顯示載入錯誤。
- 沒有自行儲存密碼。Supabase SDK 管理瀏覽器工作階段；不要將登入權限替換成 localStorage 裡的 role 字串。
- 未新增第三方追蹤程式。舊的本機學習草稿不會自動歸戶或同步。

官方參考：
https://supabase.com/docs/reference/javascript/auth-signup
https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
https://supabase.com/docs/guides/auth/auth-smtp
https://supabase.com/docs/guides/database/postgres/row-level-security

## 7. 本次驗證

通過 JavaScript 語法檢查、檔案連結檢查，以及模擬 DOM 的註冊與未設定後端狀態檢查。
使用本機 PGlite（PostgreSQL）與模擬 Supabase 身分環境，驗證 SQL 建表、信箱驗證門檻、資料隔離、升權阻擋、補件重送、版本衝突、核准角色與紀錄同步。
靜態檔案通過語法與連結檢查；實際郵件點擊、Supabase RLS、跨帳號隔離與正式瀏覽器流程仍應在每次資料庫或登入功能變更後重新驗收。
