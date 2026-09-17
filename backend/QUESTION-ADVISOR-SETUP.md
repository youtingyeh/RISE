# AI 問題顧問啟用

GitHub 更新只會新增畫面與後端原始碼，不會自動部署 Supabase 函式或設定 OpenAI 金鑰。一般提問不依賴 AI。

## 1. 建立用量限制

在既有 RISE 專案的 Supabase → SQL Editor，完整執行 `backend/question-advisor.sql`。
此檔僅新增用量資料表與服務端 RPC，不改動既有問題。

## 2. 設定後端 Secrets

Supabase → Edge Functions → Secrets：

| 名稱 | 填寫內容 |
| --- | --- |
| `OPENAI_API_KEY` | 你在 OpenAI API 專案建立的金鑰；不可放進 auth-config.js 或 GitHub |
| `OPENAI_MODEL` | 可先填 `gpt-4.1-mini`，或你專案可用且支援 Responses API Structured Outputs 的模型 |
| `RISE_SITE_ORIGIN` | `https://youtingyeh.github.io`（不包含 `/RISE`） |

`SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY` 使用 Supabase Edge Functions 提供的環境變數，不必放到網頁。
OpenAI API 需有可用額度；先在 API 專案設定適合測試的預算及模型權限。此功能每次分析都可能產生 API 費用。

## 3. 部署函式

Dashboard → Edge Functions → Deploy a new function → 編輯器，將 `supabase/functions/rise-question-advisor/index.ts` 全文放入 `index.ts`，函式名稱必須是 `rise-question-advisor`。
此專案採函式內 `auth.getUser` 驗證使用者 JWT；依 `supabase/config.toml` 設定 `verify_jwt = false`，不要移除程式內的驗證。

若用 CLI，在已連結的專案目錄執行：

```sh
supabase functions deploy rise-question-advisor
```

## 4. 驗收

用已驗證的學生帳號開啟「我的提問」，填標題、問題與選填整理，按「請 AI 檢查我的提問」。
應看到假設、概念、關聯、下一步與改寫參考。分析不會自動送出，也不會自動覆寫學生內容。
可以測試：「物體越重是不是掉得越快？我用紙張和硬幣測試。」合理的建議應提醒空氣阻力、形狀與控制變因，不直接把觀察當成普遍結論。

同時驗證：

- 未登入請求應被拒絕，匿名金鑰本身不足以使用 AI。
- 缺少金鑰／模型／SQL 時顯示尚未啟用，仍能直接送出問題。
- 30 秒內連續分析應被限制；每人每日 10 次、全站每日 200 次（UTC 日界）。開始呼叫 AI 後，即使上游失敗也計入次數。
- 修改問題後，舊的 AI 建議不能直接套用；正常送出後表單與當次 AI 回覆清空。
- 分析文字只包含表單文字，不包含圖片或自動附加的姓名、信箱。使用者自行填在文字中的個資須先移除。

目前不提供圖片辨識、跨學生問題比對、文獻檢索、成績、證書或歷年學習分析。關聯強度是語意上的定性建議，不是經驗證的量化量表。
RISE 不保存 AI 提問文字及回覆；用量紀錄在後續請求時清理超過 30 天的資料。API 使用 `store:false`，但不代表供應商完全不保留服務紀錄。

## 技術參考

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [Supabase Edge Function configuration](https://supabase.com/docs/guides/functions/function-configuration)

本次測試使用模擬 Auth／OpenAI 回覆；正式環境仍需完成上述部署與學生帳號驗收。
