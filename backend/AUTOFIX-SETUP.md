# 回報排程與管理員授權

## 上線次序

1. 核對目標 Supabase 專案。依序執行尚未套用的 `feedback.sql`、`feedback-autofix.sql`、`feedback-controls.sql`。舊版已經安裝的專案只套用缺少的增量。最後一份啟用後請使用 `feedback-controls.sql` 重跑檢查或修復。
2. 部署 `rise-feedback-repair` Edge Function，使用 `supabase/config.toml` 的設定。這支新函式在程式內核對 GitHub OIDC 簽章、有效期、對象、專案 ID、工作流程和分支。GitHub Actions 使用 `id-token: write` 取得短效身分憑證。Supabase 的服務金鑰由 Edge Function 在伺服器讀取。
3. 管理員開啟「管理員專區 → 回報彙整管理」。排程預設關閉，管理員可隨時開啟或關閉。新增的回報與人工處理在排程關閉時仍可使用。

## 修正範圍與驗收

- 排程每天臺北時間 09:00 讀取案件，也可在 GitHub Actions 手動執行 `Feedback autofix scan`。關閉時工作流程會略過修補。
- 管理員逐案核准 `join.html` 或 `schedule.html` 上的一個連結文字。只會處理管理者對照表中有明確目的頁的斷鏈；急件、結案、接受現況及未授權案件由管理員處理。
- 修補在暫存工作目錄完成，重跑獨立差異檢查、靜態檢查及瀏覽器點擊。每案至多兩次，關閉與撤回保留計數。
- 通過後由排程交付 GitHub Actions 差異檔。管理頁會顯示該次執行與檔名，差異檔保留 14 天。GitHub 排程只有讀取儲存庫的權限。由管理員檢查差異、建立並合併 PR，確認 GitHub Pages 發布後再結案。
- 若工作已開始，關閉或撤回後會阻擋下次權限檢查、交付紀錄及後續寫入。之前已下載的差異檔仍然存在，採用前請先確認案件授權。
- 每日通知與緊急通知可獨立由管理團隊設定。見 `FEEDBACK-SETUP.md`。
