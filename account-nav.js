/* RISE 全站帳號列：依 Supabase 登入狀態切換顯示。 */
(() => {
  "use strict";

  const nav = document.getElementById("site-account-nav");

  if (!nav) return;

  const base = new URL("./", document.currentScript.src);

  function makeLink(href, text) {
    const link = document.createElement("a");

    link.href = new URL(href, base).href;
    link.textContent = text;
    link.style.color = "white";

    return link;
  }

  function showLoggedOut() {
    nav.replaceChildren(
      makeLink("register.html", "註冊"),
      makeLink("login.html", "登入")
    );
  }

  function showLoggedIn(client, user) {
    if(user.email_confirmed_at) client.rpc('rise_record_activity').catch(()=>{});
    const email = document.createElement("span");

    email.textContent = user.email || "已登入帳號";
    email.title = user.email || "";
    email.style.overflowWrap = "anywhere";

    const accountLink = makeLink("account.html", "會員中心");

    const logoutButton = document.createElement("button");

    logoutButton.type = "button";
    logoutButton.textContent = "登出";

    logoutButton.style.cssText = `
      font: inherit;
      color: white;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.7);
      border-radius: 4px;
      padding: 3px 10px;
      cursor: pointer;
    `;

    logoutButton.addEventListener("click", async () => {
      if (logoutButton.disabled) return;

      logoutButton.disabled = true;
      logoutButton.textContent = "登出中…";

      const { error } = await client.auth.signOut();

      if (error) {
        logoutButton.disabled = false;
        logoutButton.textContent = "登出";

        const message = document.createElement("span");

        message.textContent = "登出失敗，請稍後再試。";
        message.setAttribute("role", "alert");

        nav.append(message);
        return;
      }

      location.assign(new URL("index.html", base).href);
    });

    nav.replaceChildren(
      email,
      accountLink,
      logoutButton
    );
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");

      const timer = setTimeout(() => {
        reject(new Error("載入逾時"));
      }, 15000);

      script.src = src;

      script.onload = () => {
        clearTimeout(timer);
        resolve();
      };

      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error("載入失敗"));
      };

      document.head.append(script);
    });
  }

  async function initializeAccountNavigation() {
    try {
      if (!window.RISE_AUTH_CONFIG) {
        await loadScript(
          new URL("auth-config.js", base).href
        );
      }

      const config = window.RISE_AUTH_CONFIG || {};

      if (!config.url || !config.publishableKey) {
        showLoggedOut();
        return;
      }

      if (!window.supabase) {
        await loadScript(
          "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js"
        );
      }

      // 受保護頁面已建立登入客戶端時直接共用，避免同頁出現兩個
      // GoTrueClient 同時操作相同瀏覽器工作階段。
      const client = window.RISE_LEARNING?.client ||
        window.supabase.createClient(
          config.url,
          config.publishableKey,
          {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true
            }
          }
        );

      const {
        data,
        error
      } = await client.auth.getUser();

      if (error || !data?.user) {
        showLoggedOut();
      } else {
        showLoggedIn(client, data.user);
      }

      client.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || !session?.user) {
          showLoggedOut();
        } else {
          showLoggedIn(client, session.user);
        }
      });
    } catch (error) {
      console.error("無法取得登入狀態：", error);
      showLoggedOut();
    }
  }

  initializeAccountNavigation();
})();
