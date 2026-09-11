"use strict";

(() => {
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
        return ["http:", "https:"].includes(url.protocol)
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
    const sorted = [...events].sort((a, b) =>
      String(a.date || "9999").localeCompare(String(b.date || "9999"))
    );

    let content = sorted.map(event => {
      const url = safeURL(event.url);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(event.date || "")
        ? `<time datetime="${e(event.date)}">${e(event.date)}</time>`
        : "日期待定";

      return `
        <article class="schedule-row">
          <div class="schedule-date">${date}</div>
          <div>
            <h2>${e(event.title)}</h2>
            <p>${e(event.location)}</p>
            <p class="preline">${e(event.description)}</p>
            ${url ? `
              <a class="text-link" href="${e(url)}"
                target="_blank" rel="noopener noreferrer">
                活動資訊 ↗
              </a>
            ` : ""}
          </div>
        </article>
      `;
    }).join("");

    if (!sorted.length) {
      content = emptyState(
        "尚無正式日程",
        "活動日期與參與資訊確認後，將在這裡公布。"
      );

      if (D.demo) {
        content += `
          <article class="schedule-row">
            <div><span class="badge">範例欄位</span></div>
            <div>
              <h2>活動名稱待填</h2>
              <p>日期、地點與活動說明待填。</p>
            </div>
          </article>
        `;
      }
    }

    return `
      ${heading("DATES & EVENTS", "重要日程", "計畫活動、重要日期與參與資訊。")}
      <section class="section container">${content}</section>
    `;
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

  const titles = {
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
    home: homePage,
    about: aboutPage,
    videos: videosPage,
    science: sciencePage,
    math: () => subjectPage("math"),
    physics: () => subjectPage("physics"),
    chemistry: () => subjectPage("chemistry"),
    video: videoDetailPage,
    resources: resourcesPage,
    team: teamPage,
    schedule: schedulePage,
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

  setupFilters();
  setupPlayer();
})();

  