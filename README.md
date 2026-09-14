# RISE｜國立臺灣大學數思新生計畫（範例網站）

Reasoning and Inquiry for Science Education

此儲存庫是依計畫書方向建立的網站範例，服務對象以高中生為主，內容涵蓋數學、物理、化學、提問訓練、影片導讀與教師審核流程。網站目前仍是範例版本；正式教材、團隊名單、日程與聯絡資訊須依計畫營運狀況更新。

## 網站架構

- 公開頁面：首頁、關於計畫、三學科探索、影音目錄、教學資源、日程與團隊。
- 登入後頁面：學習路徑、提問工作台、個別影片與個人觀看紀錄。
- 帳號頁面：註冊、登入、信箱驗證、密碼重設、會員中心與教師資格申請。
- 管理頁面：教師申請審核；真正權限由 Supabase 資料庫角色與 RLS 判斷，不信任前端字串。

## 首次安裝

1. 建立 Supabase 專案。
2. 在 Supabase SQL Editor 執行 `backend/setup.sql`，建立帳號資料、教師申請、審核事件與權限規則。
3. 再執行 `backend/watch-history.sql`，建立個人觀看紀錄與儲存函式。此檔可重複執行，不會刪除既有觀看資料。
4. 執行 `backend/delete-account.sql`，安裝登入使用者自助永久刪除本人帳號的安全函式。
5. 在 Supabase Authentication 開啟 Email provider 與 Confirm email，密碼最低長度建議設為 12。
6. 設定 Site URL 與 Redirect URLs，詳細步驟見 `backend/ACCOUNT-SETUP.md`。
7. 在 `auth-config.js` 只填 Project URL、publishable／anon key、正式網站網址與已核定的個資告知頁網址。
8. 使用者完成註冊及信箱驗證後，才可登入受保護的學習頁面。

## 安全注意事項

- 可以公開：Project URL、publishable key 或 legacy anon key。
- 禁止放入 GitHub：`service_role`、secret key、資料庫密碼、SMTP 密碼或任何管理憑證。
- GitHub Pages 是公開靜態網站。若 MP4 放在公開儲存庫，知道網址的人仍能下載；真正私密影片須改用私有儲存與後端短效網址。
- 前端登入閘門改善使用流程，但真正資料權限必須由 Supabase RLS 與 RPC 驗證。
- `privacyURL` 必須使用 HTTPS 並連至目前有效的個人資料蒐集告知事項；未設定時註冊會保持停用。
- 自助刪除函式沒有 user id 參數，只能刪除目前登入的一般帳號；管理員帳號須由後台審慎處理。

## 新增影片

在 `content.js` 的 `videos` 陣列新增物件。每筆 `id` 必須唯一，`subject` 使用 `math`、`physics` 或 `chemistry`。

YouTube 範例：

```javascript
{
  id: "math-001",
  subject: "math",
  title: "影片標題",
  summary: "影片簡介",
  speaker: "講者姓名",
  level: "入門",
  duration: "20 分鐘",
  source: "youtube",
  youtubeId: "YouTube影片ID",
  question: "觀看前問題",
  reflection: "觀看後反思",
  chapters: [
    { seconds: 0, title: "開始" }
  ],
  demo: false
}
```

自有影片範例：

```javascript
{
  id: "physics-001",
  subject: "physics",
  title: "影片標題",
  summary: "影片簡介",
  source: "file",
  videoUrl: "videos/physics-001.mp4",
  poster: "images/physics-001.jpg",
  chapters: [],
  demo: false
}
```

## 自動檢查

每次推送至 `main` 或建立 Pull Request 時，GitHub Actions 會執行：

- 全部 JavaScript 語法檢查。
- HTML 本機連結與重複 `id` 檢查。
- 必要檔案檢查。
- `content.js` 學科與影片資料關聯檢查。
- `script.js` 動態帳號列掛載點檢查。

本機可執行：

```bash
find . -type f -name '*.js' -not -path './.git/*' -print0 | xargs -0 -n1 node --check
node tools/static-check.mjs
```

## 上線前驗收

1. 無痕視窗未登入，直接開啟 `learning.html`、`inquiry.html`、`video-detail.html?id=...`，應導向登入頁。
2. 登入後，頁首應顯示帳號信箱、會員中心與登出按鈕。
3. 播放影片約 20 秒後暫停，會員中心應出現觀看紀錄。
4. 不同帳號不能讀取彼此的申請、審核紀錄或觀看紀錄。
5. 一般使用者不能呼叫管理員審核 RPC；管理員自動具備教師資格，無須提交教師申請。
6. 一般帳號輸入完整信箱後可永久刪除自己；不得刪除其他帳號，管理員帳號不得從前台自刪。
