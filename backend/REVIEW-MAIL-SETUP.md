# 審核通知信啟用

1. 已有 staff-upgrade.sql 的專案，在 SQL Editor 新增 snippet，執行 backend/review-mail.sql。不要重跑 setup.sql 或 staff-upgrade.sql。
2. Edge Functions → Secrets 新增 RISE_SMTP_USER（ytyeh@g.ntu.edu.tw）及 RISE_SMTP_PASSWORD（此 Google 帳號的應用程式密碼）。Authentication 的 SMTP 設定不會自動供此函式讀取；Google Drive Refresh token 也不是 SMTP 密碼。不要將密碼放進 GitHub。
3. 新增 Edge Function；首次部署前名稱必須填 rise-review-mail。將 supabase/functions/rise-review-mail/index.ts 全部貼入編輯器 index.ts 後 Deploy。確認 URL 最後為 /functions/v1/rise-review-mail。
4. 關閉此函式 Verify JWT with legacy secret。程式自行透過 getUser 驗證已驗證的登入帳號與即時 admin 角色；只允許管理員呼叫。
5. 管理員到 admin-review.html，重新整理後審核一件新案件。畫面分別顯示審核結果與寄信結果。收件人須檢查收件匣／垃圾郵件。

## 行為與限制

- 核准、退回補件、不予核准皆產生通知。主旨及寄件者標示 RISE 國立臺灣大學數思新生計畫。信件包含申請身分、審核意見及會員中心連結，不夾帶證明附件。
- 收件人從 Supabase Auth 取得，通知內容從交易內建立的待寄紀錄取得。前端不能指定任意收件人或內容。
- SQL 安裝之後的新審核才會加入待寄紀錄，不回溯寄送舊審核。
- 前端在審核成功後自動呼叫寄信後端，每次最多處理三封。若頁面關閉或網路中斷，待寄紀錄仍保留；管理員按「寄送待寄審核通知」即可處理。此版沒有排程常駐重試。
- 寄信失敗不回滾審核。失敗項目延後十分鐘可重試；已確認寄出不重寄。SMTP 已收信但回應或資料庫寫入遺失的極端情況仍可能重複寄送，不能保證 exactly-once。
- 顯示已交由郵件伺服器接收不等於已送進收件匣，退信與垃圾信仍須查看寄件信箱。
- 刪除申請／帳號會連帶刪除待寄紀錄；已寄出的信件無法收回。
- 搬移網站時設定 RISE_SITE_URL 為完整 HTTPS 網站目錄（含結尾 /），RISE_SITE_ORIGIN 為 origin（例如 https://example.ntu.edu.tw，不含路徑）。
- 此函式固定使用 Gmail SMTP 465 TLS；未來換郵件供應商需修改傳輸設定。
