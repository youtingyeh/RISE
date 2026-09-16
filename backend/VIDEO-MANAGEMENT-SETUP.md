# 影音探索管理啟用
1. Supabase → SQL Editor → Create a new snippet。
2. 貼上 backend/video-management.sql 全部內容並執行。
3. 使用已驗證的管理員帳號開啟 admin-console.html，進入「影音探索管理」。
4. 填寫 YouTube 網址或影片 ID、標題、學科與簡介。勾選發布後儲存。
5. 到 explore.html 確認影片；播放仍需登入。編輯同一筆影片保留 id 和觀看紀錄的對應。
6. 在管理清單按「編輯」，取消發布並儲存即可下架。
目前支援 YouTube 連結，沒有直接上傳影片檔。非管理員不能新增或修改影片；未發布影片只有管理員可讀取。
資料表不存在時，管理區會提示安裝 SQL，前台會保留 content.js 原有資料並提示最新清單無法載入。
驗證：JS 語法、YouTube URL 驗證、發布篩選與載入順序已檢查。尚未在正式 Supabase 執行 SQL，也未以真實帳號做新增發布測試。
