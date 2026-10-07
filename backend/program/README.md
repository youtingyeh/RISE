# 數思新生教學與營運功能更新（2026-10-06）

## 核對範圍與原始專案

依據使用者提供的《數思新生計畫書》2025-11-05 版全文，共13頁。教學實作依第4–8頁，社群與營運依第8–10頁；計畫中的目標、預定活動與認證不是既已達成的成果。

核對基準：GitHub main `e3b905ff60a2d7536163a1e4a3df307bafd9e8b8`。

- 靜態 GitHub Pages：`content.js` 提供內容設定；`script.js` 產生公開頁與舊學習頁。
- `auth.js`：Supabase 登入、角色、申請審核、學生問答；原本問答只有單一回覆欄，沒有提問修改歷程。
- `learning-workflows.js`、`rise_work`：已有作業不可覆寫版本、三要素批閱、試批培訓與四維競賽評分。競賽原本把背景、動機、影響合為同一欄。
- `teacher-course-access.sql`：既有教師課程範圍，這次新增流程沿用，不把教師權限擴大為全站。
- AI Edge Function：原有假設／概念／關聯建議及每日配額，未紀錄模型錯誤標籤。
- 原本沒有對談徵集、OER 年鑑、PLC、月度助教論壇或社團補助流程。

## 上線順序

2026-10-07 安全補強：完成下列既有更新（含 `program-refinement.sql`）後，最後執行 `backend/security-hardening.sql`，再執行唯讀 `backend/security-verify.sql`。詳見 `docs/SECURITY-UPGRADE-20261007.md`；安全補強本身不需要重新部署 Edge Function。

1. 先執行唯讀的 `backend/program-preflight.sql`；它會逐項顯示存在／缺少及原始碼連結，不能只憑舊錯誤訊息認定所有項目都缺少。在既有 Supabase 專案備份後，確認原站後端已安裝。必要前置：`course-assignments.sql`、`training-course-management.sql`、`teacher-course-access.sql`、`qa-upgrade.sql`、`watch-history.sql`、`question-advisor.sql`。原有帳號、審核、Storage 設定應保留。**不要重跑初始 setup.sql。**
   若需補裝 `course-assignments.sql`，後續重套 `training-course-management.sql` 與 `teacher-course-access.sql`；若補裝 `qa-upgrade.sql`，後續重套 `teacher-course-access.sql`，最後再執行本次更新，避免舊 RPC 覆蓋課程權限。若連 `rise_profiles` 都缺少，先確認是否選錯 Supabase 專案，不要重跑 `setup.sql`。
2. 在 SQL Editor 執行 **`backend/program-upgrade.sql` 全文**。它包含本次四個 migration，單一交易，可重複執行。失敗時不留下半套本次更新。
2a. 本階段若要啟用問答歷程、AI 標籤連結、會員中心認證狀態與年度報告，再執行 `backend/program-refinement.sql`。此檔案不建立教材、不修改三學科頁面，也不替既有單元指定學科。
3. 或依序執行 `01-question-history.sql` → `02-learning-modules.sql` → `03-community-events.sql` → `04-operations-data.sql`；與上一步擇一。
4. 重新部署 `supabase/functions/rise-question-advisor/index.ts`。既有 `OPENAI_API_KEY`、`OPENAI_MODEL`、`RISE_SITE_ORIGIN` 保留；service-role key 僅於後端使用。前端不可填入秘密金鑰。
5. GitHub Pages 部署後以管理員、指定課程教師、其他課程教師及學生測試。新頁面若提示尚未啟用，先確認 SQL 執行成功。
競賽新版投稿與認證核發會先檢查後端版本；尚未更新時阻止送出並保留輸入，避免舊版 RPC 忽略新欄位。

6. 若日後重新執行舊 workflow/teacher-course migration，最後必須再執行本次更新，避免覆寫新版 RPC。

本次沒有新開公開 Storage bucket。原提問圖片保留原有安全規則；提問修訂目前針對文字，沿用原圖片。PLC 可附已授權教材的 HTTPS 分享連結；既有教材檔案上傳仍由教學資源功能處理。

## 四大模組對照

| 模組 | HTML／JS | 後端與行為 |
| --- | --- | --- |
| 提問三要素與版本 | `staff-questions.html`、`questions.html`、`auth.js`、`question-history.js` | `rise_question_versions`；`rise_review_question` 強制三欄，`rise_revise_question` 檢查本人及最新版本。舊回覆保留，教學人員無法以舊單欄 RPC 繞過必填。 |
| 作業歷程 | `assignments.html`、`learning-workflows.js` | 沿用 `rise_work.revisions/reviews`，保留課程隔離及不可覆寫版本。 |
| 三層教材／習作 | `modules.html`、`program.js`、`content.js`、`learning.html`、`script.js` | `rise_program.units/practice/practice_reviews/unit_visits`；後端強制1–30分鐘、3–5題；完整回答才可提交；有習作後單元內容不可覆寫，需建立新版單元。管理員／單元教師可發布或下架。 |
| AI 建議／錯誤標籤 | `question-advisor.js`、`supabase/functions/rise-question-advisor/index.ts` | strict JSON 三類建議 + `error_tags`，三種受限代碼、0–1模型信心、原因與練習建議；service-role 專用 `rise_record_ai_analysis` 寫入，客戶端不能偽造。 |
| 競賽三區、評分、展覽 | `competitions.html`、`learning-workflows.js`、`competition-gallery.html` | 背景／動機／影響各自必填；既有指定評審四項0–5分保留。得獎者由管理員指定，不把自動排名當作獎項。結賽、最新版本、投稿人同意公開才可上架。 |
| 對談徵集／評選 | `dialogues.html` | 活動建立、截止時間、學生版本化摘要、入選及理由。本人／管理員／主辦教師在其課程授權內可讀。入選與公開出版分開。 |
| 年鑑 OER | `yearbook.html`、`admin-publication.html` | 影音、文字稿、問題、解答、延伸閱讀；需作者來源及開放授權確認。YouTube 安全嵌入，其他來源提供連結。匿名可讀已發布內容，不能讀草稿。 |
| 助教認證與論壇 | `ta-training.html`、`ta-forum.html` | 核發時強制確認溝通、診斷、試批標準、回饋倫理四項；舊認證不回填假考核資料。月度主題與回覆限教學人員。認證是本計畫內部資格，並非學位或法定資格。 |
| PLC／社團補助 | `plc.html`、`club-grants.html` | 教師分享教案與匿名案例、回覆；教師申請社團補助，管理員核准／退回／拒絕並留紀錄。本人不可審核本人申請；核准不代表實際撥款。退回後可依審核意見另送新申請，舊案保留。 |

「學習路徑」未重新加入學生導覽。舊 `learning.html` 保留並指向三層單元，主要入口為科學探索與單元教材。既有已上傳教材仍可透過科學探索查看；不會自動編造／移植成滿足3–5題的新課程，需教師完成單元編排。

## RPC 使用範例

```javascript
// 學生提交提問修訂；舊版本不覆寫。
await client.rpc('rise_revise_question', {
  p_id: questionId, p_version: 2,
  p_title: '修訂的問題', p_body: '完整思考與問題內容',
  p_change_note: '補上控制變因與推理依據'
});
// 教學人員批閱；後端檢查角色、課程、最新提問版本。
await client.rpc('rise_review_question', {
  p_id: questionId, p_version: 3,
  p_analysis: '分析目前的推理路徑',
  p_improvement: '指出缺漏的條件', p_followup: '改變條件後會如何？'
});
// 自動從登入帳號辨識學生，不接受外部 student_id 指定。
await client.rpc('rise_module_api', {
  p_action: 'submit', p_data: {
    id: unitId, expected_version: 0,
    answers: ['第一題的推理', '第二題的推理', '第三題的推理'], change_note: ''
  }
});
// 管理員背景統計呼叫。網站沒有新增 KPI 儀表板。
await client.rpc('rise_operations_statistics');
```

## 資料紀錄與指標定義

- `rise_program.operation_events`：資料庫觸發器紀錄註冊、作業批閱、問答批閱、習作批閱、習作版本、競賽版本與單元初次開啟。保留事件時間、來源鍵、執行者及角色；前端無直接寫入權限。
- `registration_statistics`：累計已記錄註冊數、現存帳號、現存角色分布。安裝前已刪除且無原紀錄的帳號無法追溯，不能宣稱已補齊全歷史。
- `review_statistics`：各批閱來源／角色的紀錄數及批閱者人數。個別助教日誌可依事件 actor_id、時間及來源鍵查核；不同版本的批閱分別計數，不等於學生人數或回饋品質。
- `module_progress`：分母是曾開啟或提交單元的學生；完整提交最新習作算完成，最新版本最近一次人工批閱通過才算通過。未批閱不算通過，新增修訂會重新待閱；零分母為 null。
- `competition_statistics`：版本投稿數、參與帳號數及最新作品件數依競賽／組別／領域彙整。舊版本換組時，歷史分組的人數不可相加當作唯一人數。
- `rise_watch_sessions`：沿用既有播放器觀看紀錄；單元的 `unit_visits` 是開啟紀錄，不冒充觀看時長或理解程度。
- `ai_analyses` 與 `ai_error_statistics`：保存帳號、草稿雜湊、模型版本、提示版本、標籤和建議摘要，不保存AI分析草稿全文。相同學生重複分析會形成多筆事件；模型信心不是經過校準的正確率，標籤不能直接作為教師診斷或成績。
- 可於受信任的 SQL Editor 查詢私有 Views。`rise_operations_statistics` 僅允許已驗證管理員，不向教師或學生暴露全站數據。沒有新增 KPI UI。

## 權限與公開範圍

新資料表均啟用 RLS 並撤銷匿名及 authenticated 的直接資料表權限。`rise_program` 私有 schema 不開放給用戶；所有操作透過明確檢查角色、本人、課程或活動主辦權限的 security-definer RPC，固定空 search_path。

提問版本以原問題 RLS 為準。教師只能存取授權課程學生的私人資料。單元習作目前由授權教師／管理員批閱；助教仍使用既有作業與問答批閱入口。共享 PLC 與助教論壇要求移除個資且確認分享權，不是公開展示私人學習紀錄的管道。

公開 RPC 只輸出已發布年鑑或同意公開的已結賽作品，不輸出學生帳號 UUID、信箱或審核草稿。出版者仍須在發布前檢查文本是否含個資。未提供正式獎項、影片、學者回答、課程內容及授權時顯示空狀態，不虛構內容。

## 本次仍不代表已落實的營運事項

軟體可支援上述工作流程，但計畫書中的固定助教在線排班、隨機抽查與品質評鑑、滿意度問卷、獎助金實際核銷、學者聘任／報酬、線下活動簽到、國際合作、正式能力成效研究仍需另訂規則與行政執行。本次沒有自動評定助教資格、判定研究成效或取代行政審核。

## 驗證

- `node tests/workflows/test-program-db.mjs`：實際 PostgreSQL 相容引擎中執行前置與新版 migration，重複執行、學生隔離、跨課程、權限拒絕、版本衝突、必填欄位、統計分母／最新批閱、公開授權、認證考核。
- `node tests/workflows/test-program-ui.mjs`：五身分 × 八頁面，共40組情境，對話框、限制入口、版本與三要素表單。
- `node tests/advisor/test.mjs`：實際 Edge handler 搭配模型／Supabase 邊界 mock；驗證結構、身分、配額、錯誤、標籤界限與前端過期回覆。
- `node tests/workflows/test-ui.mjs` 與 `test-admin-navigation.mjs`：既有工作流程與導覽回歸。

未使用生產帳號投稿、寄信、核發認證或實際呼叫付費AI。Supabase 生產 migration 與 Edge 部署需管理員執行後再驗收。
