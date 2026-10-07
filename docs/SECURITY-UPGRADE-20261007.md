# RISE 安全性與教學流程更新

基準提交：0e638012ab00d9d4e1d8027521d2c9336ab1d489。
依據：團隊提供的《數思新生計畫書》2025-11-05 修訂版，第 5–10 頁。計畫書中的行政執行與成效目標不是寫完網站即可證明完成。

## 要執行什麼

1. 在 Supabase SQL Editor 確認已安裝 `backend/program-refinement.sql` 與其前置檔案。若尚未安裝，先依 `backend/program/README.md` 順序處理；不要重跑最初的 `setup.sql`。
2. 完整執行 **`backend/security-hardening.sql`**。它可重複執行、以單一交易更新，不刪除任何帳號或教材，並內含修正後的 admin-console 定義，不必另外重跑 admin-console.sql。
3. 執行唯讀的 `backend/security-verify.sql`。RLS 欄位應全為 true，PUBLIC 特權函式查詢應為零列，四個附件 bucket 應為 private。
4. 使用測試帳號驗收權限與附件下載。正式資料刪除不可用來當測試。

**本次沒有修改 Edge Function 的 index.ts，不需要重新部署 AI、Drive 或寄信函式。** 既有服務仍需原先環境變數與 migration 正確部署。前端已對缺少安全刪除 RPC 採取拒絕執行，不會退回舊的不安全流程。

## 已確認的問題與修正

| 項目 | 具體修正 |
| --- | --- |
| admin-console.sql 語法 | 兩個函式的 `$` 改成正確 `$$`，新增實際執行整個檔案的測試，避免只檢查前端而漏掉 SQL |
| Storage 刪除 | 移除管理員 RPC 的直接 `delete from storage.objects`；這種做法只刪中繼資料，不會刪實體檔案 |
| 帳號自刪 | 新增 `rise_prepare_account_delete()`；所有操作只取 auth.uid，不接受目標 UUID；拒絕未驗證、缺少 profile、管理員、匿名帳號 |
| 刪除期間的競態 | 角色變更、準備刪除與最終刪除使用相同管理鎖；刪除準備後禁止新附件上傳與角色變更 |
| 附件清理遺漏 | 前端補上 rise-work-files 作業附件；後端確認 Storage 與 Drive 都無剩餘附件才刪 Auth 帳號 |
| 清理失敗 | 保留帳號供重試；可中止未完成流程恢復上傳，但已經透過 Storage/Drive API 移除的檔案無法復原 |
| 關聯資料 | 最後刪除 Auth 與 FK cascade 在同一 PostgreSQL 交易；任一 FK 失敗全部回滾。外部 Storage/Drive 刪檔不在該交易內，不能宣稱可原子回復 |
| 管理員刪除他人 | 仍可刪無附件帳號；有附件時安全拒絕，須由管理員透過 Storage API／Drive 管理流程先清理，不能刪中繼資料冒充成功 |
| RLS | 重申 RISE 表的 RLS、私有 schema 零直接存取；機密表讀取須驗證信箱；撤銷舊問答 column-level INSERT 權限，統一走檢核 RPC |
| 資格附件 | 保持 bucket 私有；由當前身分經 Storage RLS 產生 60 秒簽名網址，立即下載成 Blob，不保存網址、不帶 referrer |
| 提問歷程 | `question-history.js` 整合版本、三要素回饋及學生延伸回覆，100 筆一頁；舊後端則明確提示並保留原有版本與回覆 |
| 公開成果 | resources.html 新增公開年鑑／競賽作品預覽與對談徵集入口；不提供公開使用者管理或編輯權限 |

## 權限設計

RLS 不是只看畫面是否隱藏。公開 schema 的私人資料依 RLS 決定可見資料列；作業、培訓、競賽與分析位於私有 schema，啟用 deny-all RLS 並撤銷直接表存取，僅能經檢查登入身分、課程範圍、版本與角色的 security-definer RPC 操作。這些 RPC 以固定空 search_path 執行；不能把 definer 本身誤認為自動套用呼叫者 RLS。

資格證明只限本人與已驗證管理員，教師／助教不能因為是教學人員而看到證明文件。一般教師的學生私人資料仍依核准課程隔離。

Signed URL 是短效 bearer link：取得連結者在有效期間內可使用，不能保證轉傳後立即失效。60 秒為網站本次請求的效期，不代表已對 Supabase 原生 API 的所有客戶端強制相同上限。Google Drive 附件不在 Storage bucket，仍透過驗證 JWT 與擁有者的 Edge 代理下載，沒有改成公開分享。

## 計畫需求對照

| 需求 | 實作位置及狀態 |
| --- | --- |
| 數學、物理、化學 | 保留 content.js 與三個學科頁；靜態檢查強制確認三者存在，未製作教材 |
| 三要素批閱 | 既有 question-history.js + rise_review_question + 資料庫 trigger；UI 三欄 required，RPC/trigger 檢查非空與最新版本 |
| 思考演進 | 既有不可覆寫版本 + 本次整合 rise_question_timeline；新學生回覆記錄所屬版本，舊資料不捏造版本 |
| AI 顧問 | 既有 Edge Prompt 與 strict JSON schema 已包含假設、概念、關聯；前端三區顯示，無需重複改 Prompt |
| AI 錯誤標籤 | 只有服務端可寫 rise_record_ai_analysis；保存三種暫定標籤、信心、模型、hash，不把模型信心當成已校準機率或成績 |
| 競賽三分區 | 既有 learning-workflows.js 表單與資料庫 trigger 強制背景、動機、影響；保留評審與公開同意機制 |
| 對談與 OER | dialogues.html、yearbook.html、competition-gallery.html 已有資料庫流程；resources.html 本次新增公開入口與預覽 |
| 助教認證／論壇 | ta-training.html 與 account.html 已顯示資格與論壇入口；四項能力考核及有效期由人工審核，不是 TA 角色自動取得認證 |
| 背景統計 | 沿用 operation_events 的 DB triggers、私有統計 Views、rise_operations_statistics 與 rise_annual_education_report；未新增 KPI UI |

AI 標籤目前在學生主動使用顧問時採集，並不是背景掃描所有學生作業。註冊／批閱／單元提交／競賽事件由資料庫觸發器採集。完課率指系統定義的完整習作提交率，不等於理解程度或教學成效的實證證明。

## 測試與 CI

- `npm ci --ignore-scripts` → `npm run check` → `npm test`。
- Node 24，鎖定依賴與 GitHub Actions commit SHA；工作流程僅有 contents:read，不使用生產密鑰或操作正式資料。
- static-check 包含 `node --check`、inline JS 語法、重複 ID、本機連結與頁內錨點、三學科、設定欄位白名單與敏感金鑰樣式檢查。
- 可識別 service_role JWT、Supabase secret key、私鑰及常見 API 私密金鑰；日誌只輸出類型，不輸出偵測值。這是模式掃描，不是對歷史 commit、已撤銷密鑰或正式 Secrets 的完整鑑識。
- 完整 SQL 測試涵蓋 53 張 RISE 表、RLS、private grants、PUBLIC 特權函式 ACL、附件隔離、刪除交易回滾與管理員 API；另有 timeline、signed URL 與 OER 渲染測試。
- CI 是提交／PR 檢查；原本 GitHub Pages 自動部署仍獨立運作。若要強制「測試失敗不部署」，需另外設定分支保護或改用受控 Pages 部署流程，本次未擅自變更倉庫保護規則。

## 仍需正式環境驗收

本次未執行生產 SQL、刪除真實帳號、呼叫付費 AI 或寄送通知信。資料庫測試使用 PGlite + 模擬 Supabase Auth/Storage 表，不能取代 Supabase 實際 Storage 服務與 JWT 測試。後端套用後，需以隔離測試帳號驗證跨課程隔離、過期連結、附件清理重試與取消、SMTP/Drive/OpenAI 連線。

計畫書尚包括排班、隨機批閱抽查、學生滿意度、獎助金核銷、線下活動及年度成效研究；不能宣稱本次更新已 100% 完成所有教學與營運規範。

## 官方依據

- https://supabase.com/docs/guides/storage/management/delete-objects
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/database/postgres/row-level-security
