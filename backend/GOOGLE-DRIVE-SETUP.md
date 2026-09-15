# RISE Google Drive 資格附件

這是「我的雲端硬碟」OAuth 版本，使用 `drive.file`，不需要服務帳戶、不需要把資料夾設為公開。管理員授權的 Google 帳號持有所有新增檔案，學生不需 Google 登入。

## 1. 密鑰

Supabase → Edge Functions → Secrets：

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`

均使用同一個 Google OAuth 用戶端與授權帳號。不得填 SMTP 應用程式密碼。授權範圍為 `https://www.googleapis.com/auth/drive.file`。

## 2. 資料庫

已安裝 `backend/staff-upgrade.sql` 的專案，在 SQL Editor 新增 snippet，執行 `backend/google-drive.sql`。可重複執行，保留所有舊資料。不要重跑 `setup.sql` 或 `staff-upgrade.sql`：後者會還原舊的附件驗證函式。

## 3. 函式

Supabase → Edge Functions → Deploy a new function → Via Editor。

- 函式名稱：`rise-drive`
- 將 `supabase/functions/rise-drive/index.ts` 的完整內容貼入編輯器中的 `index.ts`。
- 部署。
- 函式的 Details / Settings 中，將 **Verify JWT with legacy secret** 關閉並儲存。

本函式不是匿名開放：程式對每個請求呼叫 Supabase `auth.getUser()` 驗證使用者 JWT，並從資料庫讀取即時身分；不接受只填 anon key / service_role key 代替使用者登入。此設定避免舊版閘道 JWT 驗證與新版簽章不相容。

CLI 替代方式：`supabase functions deploy rise-drive --no-verify-jwt --project-ref YOUR_PROJECT_REF`。

## 4. 啟用

登入 RISE 管理員帳號 → `admin-review.html` → 「連接 Google Drive 並啟用」。

系統以授權帳號建立 `RISE 資格證明（系統專用）` 私有資料夾。先前手動建立的 `RISE` 資料夾不會自動使用，因為 `drive.file` 未授權任意既有資料夾。無需輸入資料夾 ID；資料夾 ID 由後端保存。按鈕可重試，不會每次另建資料夾。

成功後會顯示開啟資料夾連結。只有新附件改用 Google Drive；舊 Supabase 附件仍從原本儲存區讀取，不自動搬移。

## 驗收

1. 非管理員不能初始化；未登入不能上傳或下載。
2. 學生／待審教師／待審助教上傳 PDF 或圖片（每份最多 5 MiB），申請表最多三份。
3. 管理員可在審核頁下載；本人可在會員中心下載；其他帳號無法下載。
4. 上傳仍處理中時刪帳會要求等候兩分鐘，避免與上傳交錯。
5. 一般帳號自助刪除時，先鎖定新增附件，再分批清除本人 Drive 及 Supabase 附件，最後刪帳。網路失敗時帳號與清理記錄會保留，重試即可；已刪除的部分附件不能恢復。
6. Google 檔案 ID 不從瀏覽器接受。清理僅使用伺服器登記的本人檔案 ID，不掃描或刪除資料夾裡的其他檔案。

## 維運

- 不要刪除或公開分享系統專用資料夾，也不要任意改變檔案內容。
- 每帳號最多保留 30 份 Drive 證明（含補件歷史與中斷上傳的登記），避免無限制上傳。中斷上傳保留檔案 ID，以便重試刪帳時清理。
- Google OAuth 外部應用程式若仍是 Testing，Drive 的 refresh token 通常會在 7 天後失效。需重新授權更新 Secret；正式運作前調整發布狀態／組織設定並依 Google 要求處理。使用自己的 Playground OAuth 憑證只避免 Playground 的 24 小時撤銷，不免除 Google 的 7 天測試限制。
- 若 Google 帳號、OAuth 用戶端或專用資料夾要更換，需先安排舊檔案搬移，不能直接替換三項 Secrets，否則舊附件可能不可讀。
- 遷移至臺大網站時設定 Edge Function Secret `RISE_SITE_ORIGIN` 為新網站 origin（例如 `https://example.ntu.edu.tw`，不含路徑或結尾斜線）。前端網址與 Supabase Auth redirect 設定另行更新。
- PostgreSQL 中 `rise_drive_files` 刻意使用刪帳限制外鍵，避免直接刪除 Auth 使用者後遺留 Drive 附件；管理員從 Dashboard 刪帳前也需先清除對應實體檔案及登記。不要直接刪除登記來跳過清理。

已執行本機 PostgreSQL 相容整合測試、模擬 Edge API 權限測試與 DOM 回歸測試；不代表已登入或測試你的真實 Google Drive / Supabase 專案。

## 執行回歸測試

使用 Node.js 24 或以上，在儲存庫根目錄執行：

```sh
npm --prefix tests/google-drive install
npm --prefix tests/google-drive test
```

測試使用本機 PGlite 與模擬 Google HTTP，不讀取真實帳號或寄信。
