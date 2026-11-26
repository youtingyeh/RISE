# 意見與修正回報啟用

## 功能
- `feedback.html`：已驗證信箱的會員送出回報，類型為「功能異常、疑似安全問題、改善建議、其他」；每則有案件編號（FB-日期-流水號），可追蹤處理狀態與管理員回覆。涉及登入、角色、個資、資料遺失的回報會被標為緊急並通知管理員，且不進入自動修復。頁尾「意見回報」會自動帶入目前頁面。
- `admin-feedback.html`：僅管理員。顯示新收集、未處理、高優先、逾 3 天未處理、同頁重複回報；逐則設定狀態、優先順序、內部備註、對外回覆、標記重複；可立即寄出當日彙整。
- 每日 08:30（臺北時間）GitHub Actions 檢查公開頁面，排程只在有新回報時寄出彙整。信件只帶案件編號、類型、各狀態數量、異常頁面數量與公開頁面檔名（最多 10 個）、管理頁連結；不含回報內容；管理員登入後可查看完整回報；回報者可在「我的回報」查看自己的案件內容與管理員對外回覆。回報文字一律視為不可信資料。

## 啟用步驟（需管理員手動；GitHub 更新不等於資料庫已部署）
1. 依 `AUTOFIX-SETUP.md` 的順序套用資料庫變更（`feedback.sql` → `feedback-autofix.sql` → `feedback-controls.sql`；升級後不可重跑舊檔，檔內有防護）。私有回報和管理功能可以先使用，通知和排程各自設定。
2. 若需寄信，部署 `rise-feedback-digest` 和 `rise-feedback-alert`，沿用 `supabase/config.toml` 的函式認證設定。函式自行驗證呼叫者。
3. Edge Functions → Secrets：沿用 `RISE_SMTP_USER`、`RISE_SMTP_PASSWORD`（審核通知信已設定）；新增 `RISE_DIGEST_TOKEN`（自訂 32 字元以上隨機字串）；可選 `RISE_FEEDBACK_TO`。
4. GitHub → Settings → Secrets and variables → Actions 新增：`RISE_SUPABASE_URL`、`RISE_SUPABASE_ANON_KEY`（公開 publishable key）、`RISE_DIGEST_TOKEN`（與上一步相同）。到 Actions 手動執行 "Daily site check and feedback digest" 驗證收信。
5. 以管理員登入開 `admin-feedback.html`，按「立即寄出今日彙整信」測試。

## 行為與限制
- 只有已驗證信箱的會員能送出（防垃圾訊息）；24 小時最多 10 則，相同內容不重複建立。未登入訪客請寄信給管理員。
- 資料表不開放直接讀寫；一般會員只能讀自己的回報，看不到內部備註。刪除帳號會一併刪除該會員的回報。
- 沒有新回報的日子不寄信，包括頁面排查有異常但無新回報時（異常只會附在有新回報的那封）；管理頁按鈕可手動寄出。
- 每日彙整同一天只寄一封；SMTP 失敗 10 分鐘後可重試。SMTP 已接收但回應遺失時理論上可能重複，固定 Message-ID 方便辨識。
- 自動排查只檢查頁面能否開啟，不登入，無法偵測登入後功能故障。
- 若未設定 GitHub Secrets，排程只輸出結果、不寄信，不影響網站。

## 分流與自動修正
見 `backend/AUTOFIX-SETUP.md`。目前自動修復只處理 `join.html`、`schedule.html` 的站內壞連結，且需管理員開啟開關並逐案授權；驗證通過的補丁以 GitHub Actions 附件提供，由管理員人工審查後自行合併，系統不會自動發布。
