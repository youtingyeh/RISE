# Supabase 唯讀健康檢查

GitHub Actions 每天台灣時間 01:17、09:17、17:17 排程執行，亦可在 Actions → Supabase database health check → Run workflow 手動執行。

每次以網站現有公開金鑰 GET 呼叫 rise_course_catalog，確認資料庫傳回 JSON 陣列（無課程的空陣列也算成功）。此 SQL 函式唯讀，不新增使用者、不修改學生資料、不寫入網站活動統計；僅增加少量 API／資料庫請求。成功不輸出課程資料或金鑰。网络與伺服器錯誤最多重試一次，每次連線上限20秒，工作上限3分鐘。

須已安裝 backend/course-assignments.sql。若回傳404，先查看工作紀錄與確認該 SQL 是否執行。若專案已暫停，需到 Supabase 後台恢復；本程式不會自動恢復專案，也不使用 service_role 或管理 API 金鑰。

GitHub 排程可能延遲或漏跑，不能保證每日必定執行。公開儲存庫若60天沒有活動，排程可能自動停用，需在 Actions 確認並重新啟用。健康檢查不保證符合 Supabase 所有活躍度判定，仍應注意 Supabase 通知。

停止檢查：在 GitHub Actions 選擇此工作流程，再選 Disable workflow；不會影響網站其他功能。
