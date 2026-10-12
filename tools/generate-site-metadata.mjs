/* Generate static preview metadata; social crawlers do not need to execute JavaScript. */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),base='https://youtingyeh.github.io/RISE/';
const descriptions={
 'index.html':'RISE 數思新生：青少年數理能力暨提問力雙軌培育計畫。從數學、物理與化學探索概念，透過推理、提問與師生回饋持續學習。',
 'about.html':'認識數思新生的計畫理念、數理能力與提問力雙軌目標，以及學生、助教與教師共同參與的方式。',
 'science.html':'探索數學、物理與化學的學科主題，閱讀教師發布的教材與文章。教材依團隊準備情況陸續提供。',
 'math.html':'RISE 數學探索：理解結構、規律與推理，瀏覽數學主題與團隊發布的教材。',
 'physics.html':'RISE 物理探索：從自然現象建立模型、分析實驗，瀏覽物理主題與團隊發布的教材。',
 'chemistry.html':'RISE 化學探索：認識物質、結構與變化，瀏覽化學主題與團隊發布的教材。',
 'explore.html':'瀏覽 RISE 數學、物理與化學影音資源。登入後觀看影片、整理思考與保存學習紀錄。',
 'team.html':'認識數思新生的營運組織與團隊分工。正式成員與相關資訊依計畫公告更新。',
 'join.html':'了解數思助教培訓、資格申請、教師共備與合作學校參與方式。招募梯次及合作辦法待公布。',
 'schedule.html':'查看 RISE 數思新生的活動月曆與重要日程，正式時間以公告為準。',
 '404.html':'找不到指定的 RISE 頁面，請返回首頁或使用網站導覽。',
 'login.html':'登入 RISE 帳號，進入個人學習空間與教學服務。',
 'register.html':'建立 RISE 帳號，選擇學習者身分或表達教師、助教資格申請意願。',
 'account.html':'管理個人帳號、課程身分及資格申請，查看認證與學習紀錄。',
 'questions.html':'整理觀察、問題與嘗試過的方法，提交問題並查看教師與助教回饋。',
 'inquiry.html':'進入 RISE 學生提問空間，整理問題與查看回饋。',
 'staff-questions.html':'教師與助教查看待答問題，以思路分析、改進建議及延伸提問提供回饋。',
 'assignments.html':'依課程取得作業、提交答案與修訂，保留批閱回饋及修改歷程。',
 'discussions.html':'閱讀教師公告的討論題，選擇題目並參與接續討論。',
 'ta-training.html':'查看助教培訓課程、提交培訓成果與追蹤數思助教認證狀態。',
 'competitions.html':'查看提問競賽並提交背景、動機與可能影響，依權限進行評審與管理。',
 'learning-report.html':'查看個人學習紀錄；教學人員依核准課程權限檢視學習成效。',
 'support.html':'教師與助教的教學工作台，依身分進入批閱、回饋與教材管理。',
 'teacher-apply.html':'提出教師或助教資格申請，填寫課程範圍並附上資格證明。',
 'verify-email.html':'完成 RISE 電子信箱驗證並查看帳號啟用狀態。',
 'forgot-password.html':'申請 RISE 密碼重設郵件。',
 'reset-password.html':'透過有效的密碼重設連結設定 RISE 帳號新密碼。',
 'admin-console.html':'RISE 管理員專區：管理網站開放功能、會員與營運設定。',
 'admin-review.html':'管理員審核教師與助教資格申請及證明附件。',
 'admin-videos.html':'管理員新增、編輯與發布 RISE 影音探索內容。',
 'admin-teacher-access.html':'管理員依課程核准或調整教師存取範圍。',
 'admin-courses.html':'管理員建立及維護 RISE 課程分類。'
};
const esc=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const sitemap=[];
for(const filename of (await readdir(root)).filter(f=>f.endsWith('.html')).sort()){
 const path=resolve(root,filename);let html=await readFile(path,'utf8');
 const title=html.match(/<title>([^<]+)<\/title>/)?.[1]||'RISE 數思新生';
 const previous=html.match(/<meta\s+name="description"\s+content="([^"]*)"\s*>/i)?.[1];
 const description=descriptions[filename]||previous;
 if(!description)throw Error('Missing description '+filename);
 html=html.replace(/<meta\s+name="description"\s+content="[^"]*"\s*>/i,'');
 html=html.replace(/\n?<!-- generated social metadata -->[\s\S]*?<!-- end social metadata -->/,'');
 const url=base+filename;
 // Never derive preview URLs from login tokens, private resource ids or query strings.
 const tags=[`<meta name="description" content="${esc(description)}">`,
 '<meta property="og:type" content="website">','<meta property="og:locale" content="zh_TW">',
 '<meta property="og:site_name" content="RISE 數思新生">',`<meta property="og:title" content="${esc(title)}">`,
 `<meta property="og:description" content="${esc(description)}">`,`<meta property="og:url" content="${url}">`,
 `<meta property="og:image" content="${base}assets/rise-share.png">`,
 '<meta property="og:image:width" content="1200">','<meta property="og:image:height" content="630">',
 '<meta property="og:image:alt" content="RISE 數思新生：數學、物理、化學與提問力">',
 '<meta name="twitter:card" content="summary_large_image">',`<meta name="twitter:title" content="${esc(title)}">`,
 `<meta name="twitter:description" content="${esc(description)}">`,`<meta name="twitter:image" content="${base}assets/rise-share.png">`,
 '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">'];
 const privatePage=/<meta\s+name="robots"[^>]*content="[^"]*noindex/.test(html);
 // Resource details share one HTML entry; do not canonicalize all articles to the index.
 if(!privatePage&&filename!=='resources.html'){tags.push(`<link rel="canonical" href="${url}">`);sitemap.push(url);}
 html=html.replace('</head>','<!-- generated social metadata -->\n'+tags.join('\n')+'\n<!-- end social metadata -->\n</head>');
 await writeFile(path,html);
}
await writeFile(resolve(root,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+sitemap.map(u=>`  <url><loc>${u}</loc></url>`).join('\n')+'\n</urlset>\n');
console.log('Generated metadata for public and private pages; sitemap excludes noindex pages.');
