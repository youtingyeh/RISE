"use strict";

(() => {
  const D = window.RISE_DATA;
  if (!D || !Array.isArray(D.videos)) return;

  // 只處理個別影片頁。
  if (document.body.dataset.page !== "video") return;

  const id = new URLSearchParams(location.search).get("id");
  const video = D.videos.find(item => item.id === id);
  const player = document.getElementById("player");

  if (!video || !player) return;

  /* ===== 判斷 YouTube 網址 ===== */

  function getYouTubeId(value) {
    const text = String(value || "").trim();

    // 相容原本只填影片 ID 的方式。
    if (/^[A-Za-z0-9_-]{11}$/.test(text)) {
      return text;
    }

    if (!text) return "";

    try {
      const address = /^https?:\/\//i.test(text)
        ? text
        : "https://" + text;

      const url = new URL(address);
      const host = url.hostname.toLowerCase();
      const parts = url.pathname.split("/").filter(Boolean);

      let result = "";

      if (host === "youtu.be" || host === "www.youtu.be") {
        result = parts[0] || "";
      } else if (
        [
          "youtube.com",
          "www.youtube.com",
          "m.youtube.com",
          "music.youtube.com",
          "youtube-nocookie.com",
          "www.youtube-nocookie.com"
        ].includes(host)
      ) {
        if (url.pathname === "/watch") {
          result = url.searchParams.get("v") || "";
        } else if (
          ["embed", "shorts", "live"].includes(parts[0])
        ) {
          result = parts[1] || "";
        }
      }

      return /^[A-Za-z0-9_-]{11}$/.test(result) ? result : "";
    } catch {
      return "";
    }
  }

  /* ===== 允許的影片與封面路徑 ===== */

  function safeMediaURL(value) {
    const text = String(value || "").trim();

    if (!text || /[\u0000-\u001f\\]/.test(text)) {
      return "";
    }

    // 外部影片或圖片網址。
    if (/^https?:\/\//i.test(text)) {
      try {
        const url = new URL(text);

        return ["http:", "https:"].includes(url.protocol)
          ? url.href
          : "";
      } catch {
        return "";
      }
    }

    // 本機影片或封面。
    // 例如 videos/math-001.mp4、images/math-001.jpg。
    if (
      /^(?:\.\/)?(?:videos|images)\//.test(text) &&
      !text.includes("..") &&
      !text.includes(":")
    ) {
      return text;
    }

    return "";
  }

  /* ===== 建立提示與連結 ===== */

  function showMessage(title, description) {
    const heading = document.createElement("h2");
    heading.textContent = title;

    const paragraph = document.createElement("p");
    paragraph.textContent = description;

    player.replaceChildren(heading, paragraph);
    player.style.padding = "24px";
  }

  // 移除舊版播放器旁的 YouTube 備用連結，
  // 改由本檔統一產生，避免重複。
  const oldLink = player.nextElementSibling;

  if (
    oldLink &&
    oldLink.tagName === "P" &&
    oldLink.querySelector('a[href*="youtube.com/watch"]')
  ) {
    oldLink.remove();
  }

  document.getElementById("media-links")?.remove();
  document.getElementById("media-status")?.remove();

  const links = document.createElement("div");
  links.id = "media-links";
  links.className = "actions";
  links.style.margin = "0 0 24px";

  const status = document.createElement("p");
  status.id = "media-status";
  status.className = "muted";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;

  player.after(links);
  links.after(status);

  function addExternalLink(url, label) {
    const anchor = document.createElement("a");
    anchor.className = "text-link";
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = label;
    links.appendChild(anchor);
  }

  /* ===== 選擇影片來源 ===== */

  // source 可填 youtube 或 file。
  // 沒填 source 時，優先使用 videoUrl，其次 YouTube。
  const source = video.source ||
    (video.videoUrl ? "file" : "youtube");

  if (source === "file") {
    const fileURL = safeMediaURL(video.videoUrl);

    if (!fileURL) {
      showMessage(
        "影片檔案待提供",
        "尚未設定有效的影片檔案路徑。"
      );
      return;
    }

    const media = document.createElement("video");

    media.controls = true;
    media.playsInline = true;
    media.preload = "metadata";
    media.setAttribute(
      "aria-label",
      video.title || "課程影片"
    );

    // 填入的若是相對路徑，會相對於目前網頁位置載入。
    media.src = fileURL;

    const poster = safeMediaURL(video.poster);
    if (poster) media.poster = poster;

    media.style.width = "100%";
    media.style.height = "100%";
    media.style.objectFit = "contain";
    media.style.background = "#000";
    media.style.position = "absolute";
    media.style.inset = "0";

    media.addEventListener("error", () => {
      const code = media.error ? media.error.code : 0;

      const messages = {
        1: "影片載入已中止，請重新整理後再試。",
        2: "影片無法載入，請檢查網路或影片網址。",
        3: "瀏覽器無法解碼這部影片，請檢查影片編碼。",
        4: "找不到影片，或瀏覽器不支援此影片格式。"
      };

      status.hidden = false;
      status.textContent =
        messages[code] ||
        "影片無法播放，請確認檔案路徑與格式。";
    });

    media.addEventListener("loadedmetadata", () => {
      status.hidden = true;
      status.textContent = "";
    });

    player.style.padding = "0";
    player.replaceChildren(media);

    addExternalLink(fileURL, "另開影片檔案 ↗");

    // 自有影片章節：直接跳到播放器指定秒數。
    updateChapters(seconds => {
      if (!Number.isFinite(media.duration)) {
        status.hidden = false;
        status.textContent = "請先載入影片，再選擇章節。";
        return;
      }

      media.currentTime = Math.min(seconds, media.duration);

      media.play().catch(() => {
        status.hidden = false;
        status.textContent = "已跳至指定章節，請按播放。";
      });
    });

    return;
  }

  if (source !== "youtube") {
    showMessage(
      "影片來源設定有誤",
      "source 請使用 youtube 或 file。"
    );
    return;
  }

  const youtubeId = getYouTubeId(
    video.youtubeUrl || video.youtubeId
  );

  if (!youtubeId) {
    const hasValue = Boolean(video.youtubeUrl || video.youtubeId);

    showMessage(
      hasValue ? "YouTube 網址格式不正確" : "影片待提供",
      hasValue
        ? "請填入單一影片的 YouTube 網址或影片 ID。"
        : "目前沒有正式影片。"
    );

    return;
  }

  showMessage(
    "影片已就緒",
    "按下播放後，將連線至 YouTube。"
  );

  const playButton = document.createElement("button");
  playButton.type = "button";
  playButton.className = "button gold";
  playButton.textContent = "播放影片";
  player.appendChild(playButton);

  function loadYouTube(seconds = 0, autoplay = false) {
    const frame = document.createElement("iframe");

    const url = new URL(
      "https://www.youtube-nocookie.com/embed/" + youtubeId
    );

    url.searchParams.set("playsinline", "1");

    if (seconds > 0) {
      url.searchParams.set("start", String(seconds));
    }

    if (autoplay) {
      url.searchParams.set("autoplay", "1");
    }

    frame.src = url.href;
    frame.title = video.title || "YouTube 影片";
    frame.referrerPolicy = "strict-origin-when-cross-origin";

    frame.allow = [
      "accelerometer",
      "autoplay",
      "clipboard-write",
      "encrypted-media",
      "gyroscope",
      "picture-in-picture",
      "web-share"
    ].join("; ");

    frame.allowFullscreen = true;

    frame.style.position = "absolute";
    frame.style.inset = "0";
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.border = "0";

    player.style.padding = "0";
    player.replaceChildren(frame);
  }

  playButton.addEventListener("click", () => {
    loadYouTube(0, true);
  });

  addExternalLink(
    "https://www.youtube.com/watch?v=" + youtubeId,
    "在 YouTube 開啟 ↗"
  );

  // YouTube 播放器的內部錯誤不能由一般跨來源 iframe
  // 直接讀取，因此保留外部播放連結與提示。
  status.hidden = false;
  status.textContent =
    "若播放器顯示無法播放，請使用「在 YouTube 開啟」。";

  updateChapters(seconds => {
    loadYouTube(seconds, true);
  });

  /* ===== 統一章節按鈕 ===== */

  function updateChapters(onSelect) {
    const sidebar = document.querySelector(".detail-aside");

    if (!sidebar || !Array.isArray(video.chapters)) return;
    if (!video.chapters.length) return;

    // 保留側邊欄的「繼續探索」，只替換分隔線前的章節。
    const divider = sidebar.querySelector("hr");
    if (!divider) return;

    while (
      sidebar.firstChild &&
      sidebar.firstChild !== divider
    ) {
      sidebar.firstChild.remove();
    }

    const heading = document.createElement("h2");
    heading.textContent = "影片章節";
    sidebar.insertBefore(heading, divider);

    video.chapters.forEach(chapter => {
      const seconds = Math.max(
        0,
        Math.floor(Number(chapter.seconds) || 0)
      );

      const minutes = Math.floor(seconds / 60);
      const remainder = String(seconds % 60).padStart(2, "0");

      const button = document.createElement("button");
      button.type = "button";
      button.className = "button secondary";
      button.style.display = "block";
      button.style.width = "100%";
      button.style.marginBottom = "10px";
      button.style.textAlign = "left";
      button.style.justifyContent = "flex-start";

      button.textContent =
        `${minutes}:${remainder}　${chapter.title || "章節"}`;

      button.addEventListener("click", () => {
        onSelect(seconds);
        player.scrollIntoView({ block: "center" });
      });

      sidebar.insertBefore(button, divider);
    });
  }
})();