# 問答圖片與教師／助教待答工作台

## 安裝
在既有 staff-upgrade.sql 專案的 Supabase SQL Editor 新增 snippet，貼上 qa-upgrade.sql 全部內容並 Run。不要重跑 setup.sql。無需新增 Edge Function、SMTP 或 Google Secrets。

- questions.html：本人問題、提問表單、最多三張圖片預覽／移除／送出。JPG/PNG/WebP 原檔各最多 5 MiB；瀏覽器重繪為 PNG、最長邊 2400 像素以移除原圖 metadata；超過 2400 萬像素拒絕處理。
- support.html：已驗證且已核准的 teacher/ta/admin 可進入。學生與未登入者只看到權限提示；角色判斷来自 Supabase，不接受網址指定。
- staff-questions.html：獨立待答工作台，无學生提問表單。預設待解答，提供已有教學回覆／全部篩選，每頁20筆，較早問題優先。
- 待解答指目前無 author_role 為 teacher/ta/admin 的回覆。學生自己的補充不算解答；已有回覆不表示學生確認解決，此版尚無結案流程。歷史回覆保留作答當時身分。
- 教學人員從會員中心進入待答工作台；也可在 questions.html 查看自己提出的問題。

## 儲存及安全
問答圖片使用 Supabase **私有** rise-question-images bucket，與 Google Drive 資格證明分開，不會自動搬移。SQL 同時建立 bucket、圖片關聯表、RLS 與受權限保護的提交／待答 RPC。圖片只供本人及經核准教學人員查看；未提交的圖片只有本人可讀。一般學生不能呼叫全站待答 RPC，也不能讀取他人問題圖片。

送出時先上传圖片再透過 RPC 同時建立問題和關聯。若中斷，重試沿用問題 UUID，避免重複提問；保留未確定是否提交的附件，不冒然刪除。未提交的圖片亦於刪帳時清除。前台自助刪帳新增清理本人問答圖片；直接在 Supabase 刪除 Auth 使用者不會自動清理 Storage，管理員仍須使用 Storage API 清理。

GitHub Pages 的 HTML/JS 本身仍是公開靜態資源；不把機密放入其中。實際問題、回覆與圖片的存取由資料庫／Storage 權限控制。

## 驗收
1. 學生 A 提問並附圖，重新整理後可在對話中查看及下載。
2. 學生 B 看不到 A 的問題與圖片，直接開 support.html / staff-questions.html 會看到權限提示。
3. 教師、助教、管理員可從 support.html 進入待答工作台，看到 A 的問題與圖；回覆後問題移至已有教學回覆。
4. 學生自己補充文字不會移出待答清單；教師被撤銷資格後再開工作台無法讀取清單。
5. 刪除學生帳號後，確認本人問答圖片已從私有 bucket 清除。
