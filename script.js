"use strict";

(async () => {
  const D = window.RISE_DATA;
  const app = document.getElementById("app");

  if (!app) return;

  if (!D || !D.site || !Array.isArray(D.subjects)) {
    const message =
      "網站資料未完整載入，請確認 content.js 使用的是「15 個檔案版本」。";

    if (typeof window.riseReport === "function") {
      window.riseReport(message);
    } else {
      app.textContent = message;
    }

    return;
  }

  // 先驗證登入，再建立表單或播放器；直接輸入網址也適用。
  if (['learning', 'inquiry', 'video'].includes(document.body.dataset.page)) {
    app.innerHTML = '<main class="container section"><h1>確認登入狀態</h1><p>正在準備你的學習空間…</p></main>';
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        const timer = setTimeout(() => reject(Error('登入功能載入逾時。')), 15000);
        s.src = new URL('learning-session.js', document.baseURI).href;
        s.onload = () => { clearTimeout(timer); resolve(); };
        s.onerror = () => { clearTimeout(timer); reject(Error('請確認 learning-session.js 已上傳。')); };
        document.head.append(s);
      });
      if (!await window.RISE_LEARNING.ready) return;
    } catch (err) {
      app.innerHTML = '<main class="container section"><h1>暫時無法進入學習功能</h1><p id="gate-error"></p><a class="button" href="login.html">前往登入</a> <a href="index.html">返回首頁</a></main>';
      document.getElementById('gate-error').textContent = err.message;
      return;
    }
  }

  /* ===== 共用工具 ===== */

  const $ = (selector) => document.querySelector(selector);

  function e(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character];
    });
  }

  const videos = D.videos || [];
  const resources = D.resources || [];
  const team = D.team || [];
  const events = D.events || [];

  function getSubject(id) {
    return D.subjects.find((item) => item.id === id);
  }

  function validYouTubeId(id) {
    return /^[A-Za-z0-9_-]{11}$/.test(id || "");
  }

  function safeURL(value) {
    const raw = String(value || "").trim();

    if (!raw || /[\u0000-\u0020\\]/.test(raw)) return "";

    if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw);
        return url.protocol === "https:"
          ? url.href
          : "";
      } catch {
        return "";
      }
    }

    if (
      /^files\/[^?#]+$/i.test(raw) &&
      !raw.includes("..") &&
      !raw.includes(":")
    ) {
      return raw;
    }

    return "";
  }

  function link(href, label, className = "button") {
    return `
      <a class="${className}" href="${e(href)}">
        ${e(label)}
      </a>
    `;
  }

  function emptyState(title, description = "正式內容尚未提供。") {
    return `
      <div class="empty">
        <h2>${e(title)}</h2>
        <p>${e(description)}</p>
      </div>
    `;
  }

  function heading(english, title, description) {
    return `
      <header class="page-heading">
        <div class="container">
          <p class="eyebrow">${e(english)}</p>
          <h1>${e(title)}</h1>
          <p>${e(description)}</p>
        </div>
      </header>
    `;
  }

  function sectionHeading(english, title, href = "", label = "") {
    return `
      <div class="section-heading">
        <div>
          <p class="eyebrow">${e(english)}</p>
          <h2>${e(title)}</h2>
        </div>
        ${href ? link(href, label, "text-link") : ""}
      </div>
    `;
  }

  function videoURL(video) {
    return `video-detail.html?id=${encodeURIComponent(video.id)}`;
  }

  function selectedVideo() {
    const id = new URLSearchParams(location.search).get("id");
    return videos.find((video) => video.id === id);
  }

  /* ===== 全站導覽 ===== */

  const page = document.body.dataset.page || "home";

  const navigation = [
    ["home", "index.html", "首頁"],
    ["learning", "learning.html", "學習路徑"],
    ["inquiry", "inquiry.html", "提問工作台"],
    ["support", "support.html", "教師與助教"],
    ["about", "about.html", "關於計畫"],
    ["videos", "explore.html", "影音探索"],
    ["science", "science.html", "科學探索"],
    ["resources", "resources.html", "教學資源"],
    ["schedule", "schedule.html", "重要日程"],
    ["team", "team.html", "核心團隊"]
  ];

  function activePage() {
    if (["math", "physics", "chemistry"].includes(page)) {
      return "science";
    }

    return page === "video" ? "videos" : page;
  }

  function siteHeader() {
    return `
      <a class="skip-link" href="#main">跳至主要內容</a>

      ${
        D.demo
          ? `<div class="demo-bar">
               範例網站
               <span>｜內容、團隊與日程尚未正式公布</span>
             </div>`
          : ""
      }

      <div style="background:#132d4c;color:white">
        <nav
          class="container"
          id="site-account-nav"
          aria-label="帳號導覽"
          aria-live="polite"
          style="display:flex;justify-content:flex-end;align-items:center;flex-wrap:wrap;gap:12px 20px;padding-top:8px;padding-bottom:8px"
        >
          <span>確認登入狀態…</span>
        </nav>
      </div>
      <header class="site-header">
        <div class="container nav-wrap">
          <a class="brand" href="index.html" aria-label="RISE 首頁">
            <strong>${e(D.site.name)}</strong>
            <span>${e(D.site.chineseName)}</span>
          </a>

          <button
            class="menu-button"
            type="button"
            aria-expanded="false"
            aria-controls="main-nav"
          >
            選單
          </button>

          <nav class="main-nav" id="main-nav" aria-label="主要導覽">
            ${navigation.map(([key, href, label]) => `
              <a
                href="${href}"
                ${activePage() === key ? 'aria-current="page"' : ""}
              >
                ${label}
              </a>
            `).join("")}
          </nav>
        </div>
      </header>
    `;
  }

  function siteFooter() {
    return `
      <footer class="site-footer">
        <div class="container footer-grid">
          <div>
            <a class="footer-brand" href="index.html">
              ${e(D.site.name)}
            </a>
            <p>${e(D.site.chineseName)}</p>
            <p class="small">${e(D.site.englishName)}</p>
          </div>

          <nav class="footer-nav" aria-label="頁尾導覽">
            ${navigation.slice(1).map(([, href, label]) => `
              <a href="${href}">${label}</a>
            `).join("")}
          </nav>
        </div>

        <div class="container footer-bottom">
          <span>數學 · 物理 · 化學</span>
          ${D.demo ? "<span>範例版 · 非正式課程或活動公告</span>" : ""}
        </div>
      </footer>
    `;
  }

  function breadcrumb(title) {
    if (page === "home") return "";

    let parent = "";

    if (["math", "physics", "chemistry"].includes(page)) {
      parent = `
        <a href="science.html">科學探索</a>
        <span aria-hidden="true">/</span>
      `;
    } else if (page === "video") {
      parent = `
        <a href="explore.html">影音探索</a>
        <span aria-hidden="true">/</span>
      `;
    }

    return `
      <nav class="container breadcrumb" aria-label="所在位置">
        <a href="index.html">首頁</a>
        <span aria-hidden="true">/</span>
        ${parent}
        <span aria-current="page">${e(title)}</span>
      </nav>
    `;
  }

  /* ===== 共用卡片 ===== */

  function subjectCards() {
    return D.subjects.map((subject, index) => `
      <a class="subject-card ${e(subject.id)}"
         href="${e(subject.id)}.html">
        <span class="eyebrow">
          0${index + 1} / ${e(subject.english)}
        </span>
        <h3>${e(subject.name)}</h3>
        <p>${e(subject.focus)}</p>
        <span class="text-link">進入學科探索 →</span>
      </a>
    `).join("");
  }

  function videoCard(video) {
    const subject = getSubject(video.subject);
    if (!subject) return "";

    const cover = validYouTubeId(video.youtubeId)
      ? `
        <img
          src="https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg"
          alt=""
          loading="lazy"
        >
      `
      : `
        <span class="eyebrow">${e(subject.english)}</span>
        <strong>${e(subject.name)}</strong>
        <div class="cover-bottom">
          <span>${video.demo ? "範例影片" : "影片封面待提供"}</span>
          <span>${e(video.duration || "片長待填")}</span>
        </div>
      `;

    return `
      <article class="video-card ${e(subject.id)}">
        <a href="${e(videoURL(video))}">
          <div class="video-cover">${cover}</div>
          <div class="video-body">
            <span class="badge">${e(subject.name)}</span>
            <span class="small muted">${e(video.level)}</span>
            <h3>${e(video.title)}</h3>
            <p>${e(video.summary)}</p>
            <span class="text-link">查看影片導讀 →</span>
          </div>
        </a>
      </article>
    `;
  }

  function resourceRow(resource) {
    const url = safeURL(resource.url);

    return `
      <article class="resource-row">
        <div>
          <span class="badge">${e(resource.type || "資源")}</span>
          <h3>${e(resource.title)}</h3>
          <p>${e(resource.description)}</p>
        </div>
        ${
          url
            ? `<a class="button secondary"
                  href="${e(url)}"
                  target="_blank"
                  rel="noopener noreferrer">
                 開啟資源 ↗
               </a>`
            : '<span class="badge">檔案待提供</span>'
        }
      </article>
    `;
  }

  /* ===== 首頁 ===== */

  function homePage() {
    const entries = [
      ["about.html", "01", "關於計畫", "計畫緣起、目標與聯絡資訊"],
      ["team.html", "02", "核心團隊", "參與成員與專長領域"],
      ["schedule.html", "03", "重要日程", "活動與時程公告"],
      ["resources.html", "04", "教學資源", "講義、學習單與延伸材料"]
    ];

    return `
      <section class="hero">
        <div class="container hero-grid">
          <div>
            <p class="eyebrow">${e(D.site.englishName)}</p>
            <div class="hero-wordmark">${e(D.site.name)}</div>
            <h1>${e(D.site.chineseName)}</h1>
            <p class="hero-description">${e(D.site.introduction)}</p>

            <div class="actions">
              ${link("explore.html", "瀏覽影音", "button gold")}
              ${link("science.html", "探索三學科", "button light")}
            </div>
          </div>

          <aside class="hero-directory" aria-label="學科入口">
            <p class="eyebrow">EXPLORE THE DISCIPLINES</p>
            ${D.subjects.map((subject, index) => `
              <a href="${e(subject.id)}.html">
                <span class="small">
                  0${index + 1} / ${e(subject.english)}
                </span>
                <strong>${e(subject.name)}</strong>
                <span class="focus">${e(subject.focus)} ↗</span>
              </a>
            `).join("")}
          </aside>
        </div>
      </section>

      <section class="section container">
        ${sectionHeading(
          "LEARNING COLLECTION",
          "影音探索",
          "explore.html",
          "完整影音目錄 →"
        )}
        <p class="muted">依學科尋找影片，進入單元導讀與反思。</p>
        <div class="card-grid">
          ${
            videos.length
              ? videos.slice(0, 3).map(videoCard).join("")
              : emptyState("影音內容準備中")
          }
        </div>
      </section>

      <section class="section soft">
        <div class="container">
          ${sectionHeading(
            "DISCIPLINES",
            "三個學科，三種探索入口",
            "science.html",
            "科學探索 →"
          )}
          <div class="card-grid">${subjectCards()}</div>
        </div>
      </section>

      <section class="section container">
        ${sectionHeading("PROGRAM INFORMATION", "認識計畫")}
        <div class="info-grid">
          ${entries.map(([href, number, title, text]) => `
            <a class="info-card" href="${href}">
              <span class="eyebrow">${number}</span>
              <h3>${title}</h3>
              <p>${text}</p>
              <span class="text-link">查看內容 →</span>
            </a>
          `).join("")}
        </div>
      </section>
    `;
  }

  /* ===== 科學探索與三學科頁 ===== */

  function sciencePage() {
    return `
      ${heading(
        "SCIENCE EXPLORATION",
        "科學探索",
        "從學科介紹、探索主題到學習資源，選擇你的起點。"
      )}
      <section class="section container">
        <div class="card-grid">${subjectCards()}</div>
        <div class="note">
          <h2>從哪裡開始？</h2>
          <p>
            想了解各學科的探索方向，可以先進入學科頁；
            想直接找影片，可以前往影音目錄。
          </p>
          ${link("explore.html", "前往影音目錄 →", "text-link")}
        </div>
      </section>
    `;
  }

  function subjectPage(id) {
    const subject = getSubject(id);
    if (!subject) return notFoundPage();

    const subjectVideos = videos.filter((item) => item.subject === id);
    const subjectResources = resources.filter((item) => item.subject === id);
    const topics = subject.topics || [];

    return `
      ${heading(subject.english, `${subject.name}探索`, subject.focus)}

      <section class="section container">
        <div class="content-layout">
          <aside class="section-index">
            <h2>本頁內容</h2>
            <a href="#overview">學科介紹</a>
            <a href="#topics">探索主題</a>
            <a href="#subject-videos">學科影音</a>
            <a href="#materials">教學資源</a>
            <a class="text-link" href="science.html">全部學科 →</a>
          </aside>

          <div>
            <section id="overview" class="content-section">
              <h2>學科介紹</h2>
              <p class="preline">${e(subject.description)}</p>
            </section>

            <section id="topics" class="content-section">
              <h2>探索主題</h2>
              ${
                topics.length
                  ? topics.map((topic) => `
                    <article class="resource-row">
                      <div>
                        <h3>${e(topic.title)}</h3>
                        <p>${e(topic.description)}</p>
                      </div>
                    </article>
                  `).join("")
                  : emptyState(
                    "探索主題待填",
                    "正式主題與探究活動將顯示於此。"
                  )
              }
            </section>

            <section id="subject-videos" class="content-section">
              ${sectionHeading(
                "VIDEOS",
                `${subject.name}影音`,
                `explore.html?subject=${id}`,
                "查看全部 →"
              )}
              <div class="card-grid two">
                ${
                  subjectVideos.length
                    ? subjectVideos.slice(0, 4).map(videoCard).join("")
                    : emptyState("學科影音準備中")
                }
              </div>
            </section>

            <section id="materials" class="content-section">
              <h2>${e(subject.name)}教學資源</h2>
              ${
                subjectResources.length
                  ? subjectResources.map(resourceRow).join("")
                  : emptyState("教學資源待提供")
              }
            </section>
          </div>
        </div>
      </section>
    `;
  }

  /* ===== 影音目錄 ===== */

  function videosPage() {
    return `
      ${heading(
        "VIDEO LIBRARY",
        "影音探索",
        "依學科、關鍵字與程度尋找影片。"
      )}

      <section class="section container">
        <div class="content-layout">
          <aside class="filters">
            <h2>篩選影片</h2>

            <form id="filter-form">
              <label for="search">搜尋關鍵字</label>
              <input id="search" type="search"
                placeholder="影片名稱、講者、關鍵字">

              <label for="subject-filter">學科</label>
              <select id="subject-filter">
                <option value="all">全部學科</option>
                ${D.subjects.map(s => `
                  <option value="${e(s.id)}">${e(s.name)}</option>
                `).join("")}
              </select>

              <label for="level-filter">程度</label>
              <select id="level-filter">
                <option value="all">全部程度</option>
                <option value="入門">入門</option>
                <option value="進階">進階</option>
                <option value="挑戰">挑戰</option>
              </select>

              <button class="button secondary" type="reset">
                清除篩選
              </button>
            </form>
          </aside>

          <div>
            <div class="results-toolbar">
              <p id="result-count" role="status" aria-live="polite"></p>
              <label class="sort-label">
                排序
                <select id="sort">
                  <option value="original">編輯排序</option>
                  <option value="title">標題排序</option>
                </select>
              </label>
            </div>

            <div id="video-grid" class="card-grid two"></div>

            <div id="empty-results" hidden>
              ${emptyState("找不到符合條件的影片", "請調整或清除篩選條件。")}
            </div>

            <nav id="pagination" class="pagination"
              aria-label="影片分頁"></nav>
          </div>
        </div>
      </section>
    `;
  }

  function setupFilters() {
    const form = $("#filter-form");
    if (!form) return;

    const search = $("#search");
    const subject = $("#subject-filter");
    const level = $("#level-filter");
    const sort = $("#sort");

    let currentPage = 1;
    const pageSize = 12;

    function readURL() {
      const params = new URLSearchParams(location.search);
      search.value = params.get("q") || "";

      const selected = params.get("subject");
      subject.value = getSubject(selected) ? selected : "all";

      const selectedLevel = params.get("level");
      level.value = ["入門", "進階", "挑戰"].includes(selectedLevel)
        ? selectedLevel : "all";

      sort.value = params.get("sort") === "title" ? "title" : "original";
      currentPage = Math.max(1, parseInt(params.get("page"), 10) || 1);
    }

    function render(updateURL = true) {
      const query = search.value.trim().toLocaleLowerCase();

      const results = videos.filter(v => {
        const text = [
          v.title,
          v.summary,
          v.speaker,
          getSubject(v.subject)?.name,
          ...(v.keywords || [])
        ].join(" ").toLocaleLowerCase();

        return (
          (subject.value === "all" || v.subject === subject.value) &&
          (level.value === "all" || v.level === level.value) &&
          text.includes(query)
        );
      });

      if (sort.value === "title") {
        results.sort((a, b) =>
          String(a.title).localeCompare(String(b.title), "zh-Hant")
        );
      }

      const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
      currentPage = Math.min(currentPage, totalPages);

      const start = (currentPage - 1) * pageSize;

      $("#video-grid").innerHTML = results
        .slice(start, start + pageSize)
        .map(videoCard)
        .join("");

      $("#result-count").textContent =
        `${results.length} 筆內容${D.demo ? "（含範例）" : ""}`;

      $("#empty-results").hidden = results.length !== 0;

      $("#pagination").innerHTML = totalPages > 1 ? `
        <button class="button secondary" data-page="${currentPage - 1}"
          ${currentPage === 1 ? "disabled" : ""}>上一頁</button>
        <span>${currentPage} / ${totalPages}</span>
        <button class="button secondary" data-page="${currentPage + 1}"
          ${currentPage === totalPages ? "disabled" : ""}>下一頁</button>
      ` : "";

      if (updateURL) {
        const params = new URLSearchParams();

        if (query) params.set("q", search.value.trim());
        if (subject.value !== "all") params.set("subject", subject.value);
        if (level.value !== "all") params.set("level", level.value);
        if (sort.value !== "original") params.set("sort", sort.value);
        if (currentPage > 1) params.set("page", String(currentPage));

        const suffix = params.toString();

        try {
          history.replaceState(
            null, "", location.pathname + (suffix ? "?" + suffix : "")
          );
        } catch {
          // 本機網址若禁止更新，不影響搜尋功能。
        }
      }
    }

    form.addEventListener("submit", event => event.preventDefault());

    search.addEventListener("input", () => {
      currentPage = 1;
      render();
    });

    [subject, level, sort].forEach(element => {
      element.addEventListener("change", () => {
        currentPage = 1;
        render();
      });
    });

    form.addEventListener("reset", event => {
      event.preventDefault();
      search.value = "";
      subject.value = "all";
      level.value = "all";
      sort.value = "original";
      currentPage = 1;
      render();
    });

    $("#pagination").addEventListener("click", event => {
      const target = event.target.closest("[data-page]");
      if (!target || target.disabled) return;

      currentPage = Number(target.dataset.page);
      render();
      $("#result-count").scrollIntoView({ block: "center" });
    });

    window.addEventListener("popstate", () => {
      readURL();
      render(false);
    });

    readURL();
    render(false);
  }

  /* ===== 個別影片 ===== */

  function videoDetailPage() {
    const video = selectedVideo();

    if (!video) {
      return `
        ${heading("VIDEO GUIDE", "請選擇一部影片",
          "此網址未指定影片，或影片已移除。")}
        <section class="section container">
          ${link("explore.html", "前往影音探索")}
        </section>
      `;
    }

    const subject = getSubject(video.subject);
    if (!subject) return notFoundPage();

    const playable = validYouTubeId(video.youtubeId);

    const chapters = (video.chapters || []).map(chapter => {
      const seconds = Math.max(0, Math.floor(Number(chapter.seconds) || 0));

      return playable ? `
        <a class="text-link"
          href="https://www.youtube.com/watch?v=${video.youtubeId}&t=${seconds}s"
          target="_blank" rel="noopener noreferrer">
          ${e(chapter.title)} ↗
        </a>
      ` : `<p>${e(chapter.title)}</p>`;
    }).join("");

    return `
      <section class="section container">
        <div class="detail-layout">
          <article class="${e(subject.id)}">
            <span class="badge">${e(subject.name)}</span>
            ${video.demo ? '<span class="badge">範例內容</span>' : ""}
            <h1 class="detail-title">${e(video.title)}</h1>

            <div class="detail-meta">
              <span>講者：${e(video.speaker || "待填")}</span>
              <span>程度：${e(video.level || "待填")}</span>
              <span>片長：${e(video.duration || "待填")}</span>
            </div>

            <div class="player" id="player">
              ${playable ? `
                <h2>影片已就緒</h2>
                <p>播放時將連線至 YouTube。</p>
                <button id="load-video" class="button gold" type="button">
                  載入影片
                </button>
              ` : `
                <h2>影片待提供</h2>
                <p>目前沒有正式影片。</p>
              `}
            </div>

            ${playable ? `
              <p>
                <a class="text-link"
                  href="https://www.youtube.com/watch?v=${video.youtubeId}"
                  target="_blank" rel="noopener noreferrer">
                  在 YouTube 開啟 ↗
                </a>
              </p>
            ` : ""}

            <section class="content-section">
              <h2>單元導讀</h2>
              <p class="preline">${e(video.summary)}</p>
            </section>

            <section class="note">
              <h2>觀看前先想一想</h2>
              <p class="preline">${e(video.question || "引導問題待填。")}</p>
            </section>

            <section class="note">
              <h2>觀看後的反思</h2>
              <p class="preline">${e(video.reflection || "反思問題待填。")}</p>
            </section>
          </article>

          <aside class="detail-aside">
            <h2>影片章節</h2>
            ${chapters || '<p class="muted">章節與時間碼待填。</p>'}
            <hr>
            <h2>繼續探索</h2>
            ${link(subject.id + ".html", subject.name + "探索 →", "text-link")}
            ${link(
              "explore.html?subject=" + subject.id,
              "更多" + subject.name + "影片 →",
              "text-link"
            )}
            ${link("resources.html", "教學資源 →", "text-link")}
          </aside>
        </div>
      </section>
    `;
  }

  function setupPlayer() {
    const loadButton = $("#load-video");
    const video = selectedVideo();

    if (!loadButton || !video || !validYouTubeId(video.youtubeId)) return;

    loadButton.addEventListener("click", () => {
      const frame = document.createElement("iframe");

      frame.src = "https://www.youtube-nocookie.com/embed/" + video.youtubeId;
      frame.title = video.title;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; " +
        "gyroscope; picture-in-picture; web-share";
      frame.allowFullscreen = true;

      $("#player").replaceChildren(frame);
    });
  }

  /* ===== 關於計畫 ===== */

  function aboutPage() {
    const about = D.about || {};

    const sections = [
      ["origin", "計畫緣起", about.origin],
      ["goals", "核心目標", about.goals],
      ["audience", "適合對象", about.audience],
      ["contact", "聯絡資訊", about.contact]
    ];

    return `
      ${heading("ABOUT RISE", "關於計畫", D.site.englishName)}
      <section class="section container">
        <div class="content-layout">
          <aside class="section-index">
            <h2>關於 RISE</h2>
            ${sections.map(([id, title]) =>
              `<a href="#${id}">${title}</a>`
            ).join("")}
            ${link("team.html", "認識核心團隊 →", "text-link")}
          </aside>

          <article>
            <h2>${e(D.site.chineseName)}</h2>
            ${sections.map(([id, title, text]) => `
              <section id="${id}" class="content-section">
                <h3>${title}</h3>
                <p class="preline">${e(text || "內容待填。")}</p>
              </section>
            `).join("")}
          </article>
        </div>
      </section>
    `;
  }

  /* ===== 核心團隊 ===== */

  function teamPage() {
    let content;

    if (team.length) {
      content = team.map(member => {
        const subject = getSubject(member.subject);

        return `
          <article class="member ${subject ? e(subject.id) : ""}">
            <p class="eyebrow">${subject ? e(subject.name) : "RISE"}</p>
            <h2>${e(member.name)}</h2>
            <strong>${e(member.role)}</strong>
            <p>${e(member.affiliation)}</p>
            <p class="preline">${e(member.bio)}</p>
          </article>
        `;
      }).join("");
    } else if (D.demo) {
      content = D.subjects.map(subject => `
        <article class="member ${e(subject.id)}">
          <p class="eyebrow">${e(subject.english)}</p>
          <span class="badge">範例欄位</span>
          <h2>成員姓名待填</h2>
          <p>職稱與所屬單位待填。</p>
          <p>專長與參與工作待填。</p>
        </article>
      `).join("");
    } else {
      content = emptyState("核心團隊資訊待公布");
    }

    return `
      ${heading("OUR TEAM", "核心團隊", "參與成員與專長領域。")}
      <section class="section container">
        <div class="card-grid">${content}</div>
      </section>
    `;
  }

/* ===== 重要日程 ===== */

function schedulePage() {
  const sorted = [...events]
    .filter(event =>
      /^\d{4}-\d{2}-\d{2}$/.test(event.date || "")
    )
    .sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    );

  let content = sorted.map(event => {
    const url = safeURL(event.url);

    return `
      <article class="schedule-row">
        <div class="schedule-date">
          <time datetime="${e(event.date)}">
            ${e(event.date)}
          </time>
        </div>

        <div>
          <h2>${e(event.title)}</h2>

          ${event.location ? `
            <p>${e(event.location)}</p>
          ` : ""}

          ${event.description ? `
            <p class="preline">${e(event.description)}</p>
          ` : ""}

          ${url ? `
            <a
              class="text-link"
              href="${e(url)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              活動資訊 ↗
            </a>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");

  if (!sorted.length) {
    content = emptyState(
      "目前尚無公開活動",
      "活動日期及參與方式確認後，將統一公布於此。"
    );
  }

  return `
    ${heading(
      "PUBLIC CALENDAR",
      "重要日程",
      "公開活動日期與參與資訊將統一公告於此。"
    )}

    <section class="section container">
      <div class="calendar" aria-labelledby="calendar-title">

        <div class="calendar-toolbar">
          <button
            class="calendar-nav"
            id="calendar-prev"
            type="button"
            aria-label="上一個月"
          >
            ←
          </button>

          <h2 id="calendar-title" aria-live="polite"></h2>

          <button
            class="calendar-nav"
            id="calendar-next"
            type="button"
            aria-label="下一個月"
          >
            →
          </button>
        </div>

        <div class="calendar-weekdays" aria-hidden="true">
          ${["日", "一", "二", "三", "四", "五", "六"]
            .map(day => `<span>${day}</span>`)
            .join("")}
        </div>

        <div
          class="calendar-grid"
          id="calendar-grid"
        ></div>

        <p class="calendar-note">
          本頁僅刊登已確認可公開的活動；內部規劃與未定案時程不在此顯示。
        </p>
      </div>
    </section>

    <section
      class="section container public-events"
      aria-labelledby="public-events-title"
    >
      <p class="eyebrow">PUBLIC EVENTS</p>
      <h2 id="public-events-title">活動公告</h2>
      ${content}
    </section>
  `;
}

function setupCalendar() {
  const grid = document.getElementById("calendar-grid");
  const title = document.getElementById("calendar-title");
  const previous = document.getElementById("calendar-prev");
  const next = document.getElementById("calendar-next");

  if (!grid || !title || !previous || !next) return;

  const today = new Date();

  let visibleMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    1
  );

  const publicEvents = events.filter(event =>
    /^\d{4}-\d{2}-\d{2}$/.test(event.date || "")
  );

  function renderCalendar() {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();

    const firstWeekday = new Date(
      year,
      month,
      1
    ).getDay();

    const dayCount = new Date(
      year,
      month + 1,
      0
    ).getDate();

    title.textContent = new Intl.DateTimeFormat(
      "zh-TW",
      {
        year: "numeric",
        month: "long"
      }
    ).format(visibleMonth);

    const cells = [];

    for (
      let index = 0;
      index < firstWeekday;
      index += 1
    ) {
      cells.push(`
        <div
          class="calendar-day is-empty"
          aria-hidden="true"
        ></div>
      `);
    }

    for (let day = 1; day <= dayCount; day += 1) {
      const dateKey =
        `${year}-` +
        `${String(month + 1).padStart(2, "0")}-` +
        `${String(day).padStart(2, "0")}`;

      const dayEvents = publicEvents.filter(
        event => event.date === dateKey
      );

      const isToday =
        year === today.getFullYear() &&
        month === today.getMonth() &&
        day === today.getDate();

      const eventMarkup = dayEvents
        .slice(0, 2)
        .map(event => `
          <li title="${e(event.title)}">
            ${e(event.title)}
          </li>
        `)
        .join("");

      const moreCount = dayEvents.length - 2;

      cells.push(`
        <div class="
          calendar-day
          ${isToday ? "is-today" : ""}
          ${dayEvents.length ? "has-event" : ""}
        ">
          <time datetime="${dateKey}">
            ${day}
          </time>

          ${dayEvents.length ? `
            <ul>
              ${eventMarkup}

              ${moreCount > 0 ? `
                <li>另有 ${moreCount} 項</li>
              ` : ""}
            </ul>
          ` : ""}
        </div>
      `);
    }

    grid.innerHTML = cells.join("");
  }

  previous.addEventListener("click", () => {
    visibleMonth = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth() - 1,
      1
    );

    renderCalendar();
  });

  next.addEventListener("click", () => {
    visibleMonth = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth() + 1,
      1
    );

    renderCalendar();
  });

  renderCalendar();
}

/* ===== 教學資源 ===== */

  function resourcesPage() {
    const content = D.subjects.map(subject => {
      const items = resources.filter(item => item.subject === subject.id);

      return `
        <section class="content-section ${e(subject.id)}">
          <p class="eyebrow">${e(subject.english)}</p>
          <h2>${e(subject.name)}</h2>

          ${items.length ? items.map(resourceRow).join("") : `
            <article class="resource-row">
              <div>
                <h3>講義與學習單</h3>
                <p>檔案名稱、說明與下載連結待填。</p>
              </div>
              <span class="badge">尚未提供</span>
            </article>
          `}
        </section>
      `;
    }).join("");

    return `
      ${heading(
        "TEACHING RESOURCES", "教學資源",
        "依學科查找講義、學習單與延伸材料。"
      )}
      <section class="section container">${content}</section>
    `;
  }

  function notFoundPage() {
    return `
      ${heading(
        "PAGE NOT FOUND", "找不到這個頁面",
        "請使用上方導覽尋找內容。"
      )}
      <section class="section container">
        ${link("index.html", "返回首頁")}
      </section>
    `;
  }

  /* ===== 顯示頁面並啟動 ===== */

  /* 計畫書 2025-11-05：雙軌入口、在此裝置保存的練習草稿。 */
  function programHomePage() {
    return `${heading("REASONING × QUESTIONING", "練習推理，也練習提出好問題", "數思新生以數理能力與提問力雙軌培育，陪你從理解概念、寫出思路，到修正問題與展開對話。")}
      <section class="section container"><div class="card-grid two">
      <article class="subject-card math"><p class="eyebrow">TRACK 01 / REASONING</p><h2>數理能力</h2><p>先理解概念，再寫出每一步的理由；從錯誤中修正推理。此功能需登入使用。</p>${link("learning.html", "查看學習路徑", "button")}</article>
      <article class="subject-card physics"><p class="eyebrow">TRACK 02 / QUESTIONING</p><h2>提問力</h2><p>說明你觀察到什麼、為什麼想問，以及這個問題值得探索的原因。此功能需登入使用。</p>${link("inquiry.html", "開始整理我的問題", "button")}</article></div>
      <div class="note"><h2>第一次來？</h2><p>對數理有興趣的高中生，可以先看學習路徑；想練習把想法問清楚，也可以直接使用提問工作台。範例階段尚未開放正式教材、作業繳交與助教批閱。</p></div>
      ${sectionHeading("DISCIPLINES", "學科探索", "science.html", "查看三學科 →")}<div class="card-grid">${subjectCards()}</div></section>
      <section class="section soft"><div class="container">${sectionHeading("LEARNING CYCLE", "看懂之後，把思路留下來")}
      <ol class="learning-steps"><li><strong>理解概念</strong><p>查看先備概念、核心講義與教學影片。</p></li><li><strong>寫出推理</strong><p>記錄解題策略、理由與卡住的位置。</p></li><li><strong>修正想法</strong><p>對照回饋，說明修改了什麼、為什麼。</p></li><li><strong>提出新問題</strong><p>把學到的概念轉成可探索的問題。</p></li></ol>
      <div class="actions">${link("explore.html", "影音與單元導讀")}${link("support.html", "教師與助教支持", "button secondary")}</div></div></section>
      <section class="section container">${sectionHeading("PROGRAM INFORMATION", "計畫資訊")}<div class="info-grid">${[["about.html","關於計畫"],["team.html","核心團隊"],["schedule.html","重要日程"],["resources.html","教學資源"]].map(([url,label])=>`<a class="info-card" href="${url}"><h3>${label}</h3><span class="text-link">查看內容 →</span></a>`).join("")}</div></section>`;
  }

  function learningPage() {
    return `${heading("LEARNING PATHWAYS", "我的學習起點", "先知道要練什麼能力，再選擇單元。下列是計畫主題，不代表教材已上線，也不是固定先修順序。")}
      <section class="section container"><div class="note"><h2>一個單元怎麼學？</h2><p>計畫規劃每堂課以 30 分鐘為限，搭配 3–5 題練習；教材分為核心講義、延伸閱讀與挑戰題。學習重點是完整演算、思考註記與修改理由。</p><p>正式教材與單元先備條件尚待課程團隊提供。</p></div>
      ${D.subjects.map(s=>`<section class="content-section"><p class="eyebrow">${e(s.english)}</p><h2>${e(s.name)}</h2><p>${e(s.description)}</p><div class="card-grid two">${(s.topics||[]).map(t=>`<article class="member ${e(s.id)}"><span class="badge">規劃主題・教材待提供</span><h3>${e(t.title)}</h3><p>${e(t.description)}</p></article>`).join("")||emptyState("課程範圍待確認","保留學科入口，待課程團隊提供正式規劃。")}</div><div class="actions">${link(s.id+".html", "查看"+s.name+"探索", "button secondary")}${link("explore.html?subject="+s.id,"查看影音範例","text-link")}</div></section>`).join("")}</section>`;
  }

  const questionFields = [
    ["background","我觀察到什麼？","描述現象、教材段落或問題出現的情境。"],
    ["question","我真正想問什麼？","把問題寫成一句具體、可以討論的問句。"],
    ["motivation","為什麼我想問？","說明你的疑惑，以及它與已學內容的關係。"],
    ["assumptions","我用了哪些假設？","哪些是已知事實？哪些還只是猜想？"],
    ["evidence","我可以怎麼探索？","列出需要的證據、比較方式或驗證方法。"],
    ["impact","如果釐清了，能幫助我們理解什麼？","說明問題的可能影響，不必誇大。"],
    ["revision","這次改了什麼？","記錄相較上一版的修改與理由。"]
  ];

  function draftPanel(kind, fields, contextLabel) {
    return `<section class="draft-panel" data-draft-kind="${kind}" data-draft-context="${e(contextLabel)}"><h2>${kind==="question"?"我的問題草稿":"我的推理紀錄"}</h2>
      <p class="note">這是草稿工具：只有按「保存版本」才會儲存在此瀏覽器，不會上傳，也不會送交助教。共用電腦請匯出後清除此份紀錄；清除瀏覽器資料也會刪除紀錄。</p>
      <form id="draft-form">${fields.map(([id,label,hint])=>`<div class="draft-field"><label for="draft-${id}">${label}</label><p id="hint-${id}" class="small muted">${hint}</p><textarea id="draft-${id}" name="${id}" rows="4" maxlength="12000" aria-describedby="hint-${id}"></textarea></div>`).join("")}
      <div class="actions"><button type="submit" class="button">保存版本</button><button type="button" id="export-draft" class="button secondary">匯出目前草稿</button><button type="button" id="clear-draft" class="button secondary">清除此份紀錄</button></div></form>
      <p id="draft-status" role="status" aria-live="polite"></p><h3>此裝置上的版本</h3><div id="draft-history"></div></section>`;
  }

  function inquiryPage() {
    return `${heading("QUESTION WORKSHOP", "把疑問變成值得探索的問題", "先留下想法，再檢查背景、假設與證據。問題可以修改，不必第一次就問得完整。")}
      <section class="section container"><div class="content-layout"><aside class="section-index"><h2>提問自我檢查</h2><p>這些提示是依計畫設計的練習輔助，不是自動評分。</p><ul><li>我在問事實、關係，還是假設是否成立？</li><li>問題的範圍是否清楚？</li><li>是否存在其他解釋？</li><li>什麼證據會讓我改變想法？</li></ul><p class="small muted">計畫中的競賽關注創新性、深度、適切性與啟發性；目前未開放投稿。</p></aside>
      <div><section class="note"><h2>需要教師或助教協助？</h2><p>本頁保留提問草稿；整理好之後，可到學生問答頁提交問題，並查看回覆。</p>${link("questions.html","提交問題／查看回覆","button")}</section>${draftPanel("question",questionFields,"提問練習")}</div></div></section>`;
  }

  function supportPage() {
    return `${heading("TEACHING & FEEDBACK", "教師與助教支持", "共同關注學生怎麼想，以及下一次能怎麼改進。已核准的教師與助教可進入學生問答工作台。")}
      <section class="section container"><div class="card-grid"><article class="member"><p class="eyebrow">01</p><h2>思路分析</h2><p>指出推理中使用的概念、成立的步驟與發生斷層的位置。</p></article><article class="member"><p class="eyebrow">02</p><h2>改進建議</h2><p>給出能實際採取的下一步，協助學生重新整理推理。</p></article><article class="member"><p class="eyebrow">03</p><h2>延伸提問</h2><p>透過再提問，引導學生檢查假設、比較方法與拓展理解。</p></article></div>
      <section class="note"><h2>學生怎麼準備求助？</h2><p>留下題目或單元、已嘗試的方法、完整推理與卡住的位置。你可以在影片導讀頁保存推理紀錄，再匯出草稿。</p></section>
      <section class="content-section"><h2>助教培訓與回饋品質</h2><p>計畫規劃教學溝通、錯誤診斷、批閱標準與學生回饋倫理等培訓，並透過試批考核與教師抽查維持品質。招募時間、資格與正式聯絡管道尚待公告。</p></section>
      <section class="content-section"><h2>教師共備與學者對談</h2><p>教師共備聚焦教材、教案與學習案例；學者對談以學生事先整理的問題為出發點。未來可將問題、回應與延伸閱讀整理為開放資源。</p>${link("inquiry.html","先整理一份問題摘要","button secondary")}</section>
      <section class="note"><h2>學生問答</h2><p>教師、助教與管理員可查看學生提交的問題並回覆。作業繳交、助教分派、草稿同步與競賽投稿尚未開放。</p>${link("questions.html","進入學生問答","button")}</section></section>`;
  }

  function addLearningRecord() {
    if(page!=="video" || !selectedVideo())return;
    const v=selectedVideo(), article=document.querySelector(".detail-layout > article");
    if(!article)return;
    const tasks=Array.isArray(v.exercises)?v.exercises:[];
    article.insertAdjacentHTML("beforeend",`<section class="note"><h2>單元練習</h2><p>先備概念：${e(v.prerequisites||"待課程團隊提供")}</p>${tasks.length?`<ol>${tasks.map(t=>`<li>${e(typeof t==="string"?t:t.prompt)}</li>`).join("")}</ol>`:"<p>正式練習題尚未提供。計畫規劃每單元 3–5 題；下方可先試用推理紀錄，不代表已完成正式課程。</p>"}</section>${draftPanel("reasoning",[["task","題目或討論的問題","記下你正在處理的題目。"],["strategy","我的推理與理由","列出已知條件、使用的概念，以及每一步為什麼成立。"],["stuck","我卡在哪裡？","指出不確定的概念、步驟或假設。"],["revision","修改與反思","說明你修改了什麼，以及修改的依據。"]],v.id)}`);
  }

  function setupDrafts() {
    const panel=document.querySelector("[data-draft-kind]");if(!panel)return;
    const form=document.getElementById("draft-form"),status=document.getElementById("draft-status"),historyBox=document.getElementById("draft-history");
    const inputs=[...form.querySelectorAll("textarea")];
    const key="rise-draft-v2:"+window.RISE_LEARNING.user.id+":"+panel.dataset.draftKind+":"+panel.dataset.draftContext;
    let versions=[],dirty=false,storageAvailable=true;
    try{const stored=JSON.parse(localStorage.getItem(key)||"[]");if(!Array.isArray(stored))throw Error("invalid");versions=stored.filter(v=>v&&typeof v.time==="string"&&v.values&&typeof v.values==="object").slice(-20);}catch{storageAvailable=false;status.textContent="無法讀取本機紀錄。請使用匯出保留本次草稿。";}
    function values(){return Object.fromEntries(inputs.map(input=>[input.name,input.value]));}
    function fill(v){inputs.forEach(input=>input.value=typeof v[input.name]==="string"?v[input.name]:"");}
    function history(){historyBox.replaceChildren();if(!versions.length){historyBox.textContent="尚無保存版本。";return;}versions.forEach((v,i)=>{const row=document.createElement("p"),button=document.createElement("button");button.type="button";button.className="button secondary";button.textContent="載入版本 "+(i+1)+" · "+new Date(v.time).toLocaleString();button.onclick=()=>{if(dirty&&!confirm("載入舊版會替換目前未保存文字，是否繼續？"))return;fill(v.values);dirty=false;status.textContent="已載入版本 "+(i+1)+"。編輯後可另存新版本。";};row.append(button);historyBox.append(row);});}
    if(versions.length)fill(versions[versions.length-1].values);history();
    form.addEventListener("input",()=>{dirty=true;status.textContent="有未保存的修改。";});
    form.onsubmit=event=>{event.preventDefault();const v=values();if(!Object.values(v).some(x=>x.trim())){status.textContent="請先寫下內容。";return;}if(!storageAvailable){status.textContent="本機儲存不可用，請匯出草稿。";return;}const next=[...versions,{time:new Date().toISOString(),values:v}].slice(-20);try{localStorage.setItem(key,JSON.stringify(next));versions=next;dirty=false;history();status.textContent="已保存於此瀏覽器（最多保留 20 個版本），尚未送交任何人。";}catch{status.textContent="儲存失敗，請匯出草稿保留內容。";}};
    document.getElementById("export-draft").onclick=()=>{const lines=["RISE 學習草稿",panel.dataset.draftContext,"匯出時間："+new Date().toLocaleString(),"此檔為個人草稿，不代表繳交、批閱或課程完成。",...inputs.flatMap(input=>["",form.querySelector('label[for="'+input.id+'"]').textContent,input.value])];const url=URL.createObjectURL(new Blob(["\uFEFF"+lines.join("\n")],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="RISE-draft.txt";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent="已產生目前草稿的文字檔；保存版本仍留在此瀏覽器。";};
    document.getElementById("clear-draft").onclick=()=>{if(!confirm("確定清除此份草稿及其所有本機版本？"))return;try{localStorage.removeItem(key);}catch{status.textContent="無法清除本機儲存，請至瀏覽器設定處理。";return;}versions=[];fill({});dirty=false;history();status.textContent="已清除此份本機紀錄。";};
    window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});
  }

  function programTeamPage() {
    if(team.length)return teamPage();
    const roles=[["主持人與共同主持人","總體規劃、資源整合、年度策略與進度監督。"],["行政統籌","行政作業管理與法規行政支援。"],["課程組","數理教材重構、提問課程與影音製作。"],["助教組","助教招募培訓、任務管理與批閱制度。"],["活動組","營隊、提問競賽、講座與學者對談。"],["媒體與出版組","影片、文字紀錄、年鑑與平台維運。"],["諮詢委員會","教育策略、品質監控與成效檢討。"]];
    return `${heading("PROGRAM TEAM","核心團隊","以下為計畫書規劃的職責架構；營運中心與實際成員名單尚待確認。")}
      <section class="section container"><div class="card-grid">${roles.map(([name,description])=>`<article class="member"><span class="badge">規劃職責</span><h2>${name}</h2><p>${description}</p><p class="small muted">成員待公布</p></article>`).join("")}</div></section>`;
  }

  function programSchedulePage() {
  return schedulePage();
  }

  const titles = {
    learning: "學習路徑",
    inquiry: "提問工作台",
    support: "教師與助教",
    home: "首頁",
    about: "關於計畫",
    videos: "影音探索",
    science: "科學探索",
    math: "數學探索",
    physics: "物理探索",
    chemistry: "化學探索",
    video: "影片導讀",
    resources: "教學資源",
    team: "核心團隊",
    schedule: "重要日程",
    notfound: "找不到頁面"
  };

  const renderers = {
    home: programHomePage,
    learning: learningPage,
    inquiry: inquiryPage,
    support: supportPage,
    about: aboutPage,
    videos: videosPage,
    science: sciencePage,
    math: () => subjectPage("math"),
    physics: () => subjectPage("physics"),
    chemistry: () => subjectPage("chemistry"),
    video: videoDetailPage,
    resources: resourcesPage,
    team: programTeamPage,
    schedule: programSchedulePage,
    notfound: notFoundPage
  };

  const currentVideo = page === "video" ? selectedVideo() : null;
  const title = currentVideo
    ? currentVideo.title
    : titles[page] || "找不到頁面";

  const renderer = renderers[page] || notFoundPage;

  document.title = `${title}｜${D.site.name} ${D.site.chineseName}`;

  app.innerHTML = `
    ${siteHeader()}
    <main id="main">
      ${breadcrumb(title)}
      ${renderer()}
    </main>
    ${siteFooter()}
  `;

  const menuButton = $(".menu-button");
  const mainNav = $("#main-nav");

  function closeMenu() {
    mainNav.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.textContent = "選單";
  }

  menuButton.addEventListener("click", () => {
    const open = mainNav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.textContent = open ? "關閉選單" : "選單";
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && mainNav.classList.contains("open")) {
      closeMenu();
      menuButton.focus();
    }
  });

  mainNav.addEventListener("click", event => {
    if (event.target.closest("a")) closeMenu();
  });
  // 讀取 Supabase 登入狀態並更新最上方帳號列
  const accountScript = document.createElement("script");

  accountScript.src = new URL(
    "./account-nav.js",
    document.currentScript
      ? document.currentScript.src
      : document.baseURI
  ).href;

  accountScript.onerror = () => {
    const accountNav = document.getElementById("site-account-nav");

    if (accountNav) {
      accountNav.innerHTML = `
        <a style="color:white" href="register.html">註冊</a>
        <a style="color:white" href="login.html">登入</a>
      `;
    }
  };

  document.head.append(accountScript);
  
  addLearningRecord();
  setupDrafts();
  setupFilters();
  setupCalendar();
  // 播放器只由 media.js 建立，避免舊播放器繞過觀看紀錄。
  if(page === "video") {
    const mediaScript=document.createElement("script");
    mediaScript.src=new URL("./media.js", document.currentScript ? document.currentScript.src : document.baseURI).href;
    mediaScript.onerror=()=>{const p=document.createElement("p");p.textContent="影片加強功能載入失敗，請確認 media.js。";document.querySelector("#player")?.after(p);};
    document.head.append(mediaScript);
  }
})();

  

