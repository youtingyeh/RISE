# 管理員專區啟用

1. Supabase → SQL Editor → ＋ → Create a new snippet。
2. 複製 `backend/admin-console.sql` 全部內容，貼上並按 Run。可重複執行，不要刪除既有資料表。
3. 以已驗證的管理員帳號登入 RISE → 會員中心 → 管理員專區。

管理員可搜尋已註冊會員，查看驗證狀態、註冊時間、最近登入與最近活動，並調整其他會員角色。自己的角色不可在此變更。角色變更會留下後端紀錄，不會寄出通知信。

活躍度以台灣時間的一天為單位，同一已驗證會員當天開啟一個或多個網站頁面都只算一人。包含管理員。此版本不記錄訪客、頁面內容、IP 或瀏覽器指紋。新紀錄從 SQL 啟用且新版網站載入後開始；啟用前不回補。最近登入沿用 Supabase 的登入時間，與最近活動分開顯示。註冊數以目前存在的 Auth 帳號計算。

本次新增 RPC：`rise_admin_members`、`rise_admin_statistics`、`rise_admin_set_role`。它們每次都由資料庫驗證管理員角色與信箱驗證狀態。前端不需要、也不可加入 service_role 或 secret key。`rise_record_activity` 只能記錄呼叫者自己的當日活動。

若看到「管理系統尚未啟用」，表示上述 SQL 尚未成功執行，或 API schema 快取尚未更新；請先查看 SQL 的完整錯誤訊息。
