/* RISE 帳號介面：密碼由 Supabase Auth 處理；權限由資料庫決定。 */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const root = $('#auth-root');
  const status = $('#auth-status');
  const notice = $('#auth-notice');

  if (!root) return;

  const page = document.body.dataset.authPage;
  const cfg = window.RISE_AUTH_CONFIG || {};

  const esc = v => String(v ?? '').replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c])
  );

  const labels = {
    pending: '待審核',
    returned: '待補件',
    approved: '已核准',
    rejected: '未核准'
  };

  const roles = {
    student: '一般學習帳號',
    teacher: '教師',
    ta: '助教',
    admin: '管理員／教師'
  };

  let client;
  let user;
  let profile;
  let recovery = false;

  function report(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function field(id, label, type = 'text', extra = '') {
    return `
      <div class="auth-field">
        <label for="${id}">${label}</label>
        <input
          id="${id}"
          name="${id}"
          type="${type}"
          required
          ${extra}
        >
      </div>
    `;
  }

  function password() {
    return (
      field(
        'password',
        '密碼（至少 12 個字元）',
        'password',
        'minlength="12" maxlength="128" autocomplete="new-password"'
      ) +
      field(
        'password2',
        '再次輸入密碼',
        'password',
        'minlength="12" maxlength="128" autocomplete="new-password"'
      )
    );
  }

  function email() {
    return field(
      'email',
      '電子信箱',
      'email',
      'maxlength="254" autocomplete="email"'
    );
  }

  function button(label) {
    return `<button type="submit" data-submit>${label}</button>`;
  }

  const side = `
    <aside class="auth-card auth-aside">
      <h2>從提問出發，持續探索</h2>
      <p>數學、物理與化學，從理解概念到說明自己的推理。</p>
      <ol>
        <li>建立帳號並驗證信箱。</li>
        <li>教師與助教可提交資格申請。</li>
        <li>管理員核准後取得相應身分。</li>
      </ol>
      <p>影片播放、數理學習與提問工作台需先登入。觀看紀錄會存至你的帳號。</p>
      <a href="science.html">先探索三學科 →</a>
    </aside>
  `;

  function form(body) {
    root.innerHTML = `
      <div class="auth-grid">
        <section class="auth-card">
          <form id="auth-form">${body}</form>
        </section>
        ${side}
      </div>
    `;
  }

  function errorText(err) {
    const s = String(err?.message || err);
    const code = String(err?.code || '');

    if (/Error sending (confirmation|recovery|magic link) email|smtp/i.test(s)) {
      return '驗證或通知信寄送失敗，請聯絡管理員檢查 SMTP 寄信設定。';
    }
    if (/Database error saving new user/i.test(s)) {
      return '帳號資料建立失敗，請聯絡管理員檢查資料庫註冊設定。';
    }
    if (code === 'weak_password' || /password.*(weak|least|contain)/i.test(s)) {
      return '密碼不符合帳號服務要求，請使用至少 12 個字元並混合大小寫字母、數字及符號。';
    }
    if (code === 'user_already_exists' || /already registered/i.test(s)) {
      return '此信箱已註冊，請前往登入或重設密碼。';
    }
    if (code === 'signup_disabled') {
      return '帳號服務目前未開放註冊，請聯絡管理員。';
    }

    if (['PGRST202', 'PGRST205', '42P01', '42703'].includes(code) || /Bucket not found/i.test(s)) {
      return '此功能的後端尚未完成設定，請管理員執行 backend/staff-upgrade.sql 後重試。';
    }

    if (/Invalid login credentials/i.test(s)) {
      return '信箱或密碼不正確，請重新確認。';
    }

    if (/Email not confirmed/i.test(s)) {
      return '信箱尚未驗證，請先開啟驗證信，或前往信箱驗證頁重新寄送。';
    }

    if (/rate limit|too many|security purposes/i.test(s)) {
      return '操作過於頻繁，請稍後再試。';
    }

    if (/fetch|network|timeout/i.test(s)) {
      return '無法連線，請確認網路後再試。';
    }

    if (/expired|invalid.*token/i.test(s)) {
      return '連結已失效，請重新申請驗證信或密碼重設信。';
    }

    if (/rise:/i.test(s)) {
      return s.slice(s.indexOf('rise:') + 5);
    }

    const diagnostic = /^[a-z0-9_]{1,80}$/i.test(code) ? code : '';
    const httpStatus = Number(err?.status);
    const details = [diagnostic, Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599 ? 'HTTP ' + httpStatus : ''].filter(Boolean).join('／');
    return '操作未完成，請聯絡管理員。' + (details ? '錯誤代碼：' + details : '請提供操作時間以便查詢紀錄。');
  }

  function bindForm(action) {
    $('#auth-form').addEventListener('submit', async event => {
      event.preventDefault();

      if (!client) {
        report('帳號服務尚未啟用，資料未送出。', true);
        return;
      }

      const b = event.target.querySelector('[data-submit]');

      if (b.disabled) return;

      b.disabled = true;
      report('處理中…');

      try {
        await action(new FormData(event.target));
      } catch (err) {
        report(errorText(err), true);
      } finally {
        if (b.isConnected) b.disabled = false;
      }
    });
  }

  function checkPassword(f) {
    if (f.get('password') !== f.get('password2')) {
      throw Error('rise:兩次輸入的密碼不一致。');
    }
  }

  function redirect(file) {
    return new URL(file, cfg.siteURL).href;
  }

  function checked(result) {
    if (result.error) throw result.error;
    return result.data;
  }
  
  function updateAccountNavigation(currentUser) {
    const nav = document.querySelector(".auth-nav");

    if (!nav) return;

    function makeLink(href, text) {
      const link = document.createElement("a");

      link.href = href;
      link.textContent = text;

      return link;
    }

    if (!currentUser) {
      nav.replaceChildren(
        makeLink("register.html", "註冊"),
        makeLink("login.html", "登入")
      );

      return;
    }

    const email = document.createElement("span");

    email.textContent = currentUser.email || "已登入帳號";
    email.title = currentUser.email || "";
    email.style.overflowWrap = "anywhere";

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

      try {
        checked(await client.auth.signOut());
        location.assign("index.html");
      } catch (error) {
        logoutButton.disabled = false;
        logoutButton.textContent = "登出";

        report(errorText(error), true);
      }
    });

    nav.replaceChildren(
      email,
      makeLink("account.html", "會員中心"),
      logoutButton
    );
  }
  async function loadUser() {
    const { data, error } = await client.auth.getUser();

    if (error && error.name !== 'AuthSessionMissingError') {
      throw error;
    }

    user = data?.user;

    if (!user) {
      root.innerHTML = `
        <section class="auth-card">
          <h2>請先登入</h2>
          <p>登入後才能查看帳號與申請資料。</p>
          <a class="auth-button" href="login.html?next=${encodeURIComponent(location.pathname.split('/').pop())}">前往登入</a>
        </section>
      `;
      return false;
    }

    if (!user.email_confirmed_at) {
      root.innerHTML = `
        <p>請先完成信箱驗證。</p>
        <a href="verify-email.html">信箱驗證</a>
      `;
      return false;
    }

    profile = checked(
      await client
        .from('rise_profiles')
        .select('*')
        .eq('id', user.id)
        .single()
    );

    return true;
  }

  function renderPublic() {
    if (page === 'register') {
      form(
        field(
          'name',
          '姓名',
          'text',
          'maxlength="80" autocomplete="name"'
        ) +
        email() +
        password() +
        `
          <fieldset>
            <legend>使用身分</legend>
            <div class="auth-options">
              <label>
                <input
                  type="radio"
                  name="kind"
                  value="student"
                  checked
                >
                學生／學習者
              </label>
              <label>
                <input type="radio" name="kind" value="teacher">
                教師（須審核）
              </label>
              <label><input type="radio" name="kind" value="ta">助教（須審核，可協助回答學生問題）</label>
            </div>
          </fieldset>

          <p class="auth-help">
            選擇教師只代表申請意願，不會直接取得教師權限。
            教師與助教皆須提出資格申請並經管理員核准。
          </p>

          <p>
            <label>
              <input type="checkbox" name="consent" required>
              我已閱讀並同意
              <span id="privacy-label">
                個人資料蒐集告知事項
              </span>
            </label>
          </p>

          <p>
            <label>
              <input type="checkbox" name="age-confirmation" required>
              我確認已年滿十八歲；如未滿十八歲，已由法定代理人陪同閱讀並取得其同意。
            </label>
          </p>

          ${button('建立帳號')}

          <p>已有帳號？<a href="login.html">前往登入</a></p>
        `
      );

      bindForm(async f => {
        if (!cfg.privacyURL) {
          throw Error(
            'rise:計畫團隊尚未完成個資告知設定，目前不開放註冊。'
          );
        }

        checkPassword(f);

        const data = checked(
          await client.auth.signUp({
            email: f.get('email').trim(),
            password: f.get('password'),
            options: {
              emailRedirectTo: redirect('verify-email.html'),
              data: {
                display_name: f.get('name').trim(),
                requested_kind: f.get('kind'),
                privacy_notice_version: '2026-09-14',
                privacy_consent_at: new Date().toISOString()
              }
            }
          })
        );

        $('#password').value = '';
        $('#password2').value = '';

        if (data.session) {
          report('帳號建立成功，正在前往會員中心。');
          location.assign('account.html');
          return;
        }

        const registeredEmail = f.get('email').trim();

        report('註冊資料已送出，請到信箱完成驗證。');

        root.innerHTML = `
          <div class="auth-grid">
            <section class="auth-card" aria-labelledby="registration-complete">
              <p class="eyebrow">REGISTRATION RECEIVED</p>
              <h2 id="registration-complete">請檢查你的電子信箱</h2>
              <p>
                RISE 已將驗證信寄至
                <strong>${esc(registeredEmail)}</strong>。
              </p>
              <ol>
                <li>開啟標題含有「RISE 數思新生計畫」的信件。</li>
                <li>點選信中的「驗證電子信箱」按鈕。</li>
                <li>驗證完成後回到 RISE 登入。</li>
              </ol>
              <p class="auth-help">
                幾分鐘後仍未收到時，請查看垃圾郵件或促銷郵件。
                同一信箱已註冊時不會重複建立帳號。
              </p>
              <div class="auth-actions">
                <a class="auth-button" href="verify-email.html">重新寄送驗證信</a>
                <a class="auth-button secondary" href="login.html">前往登入</a>
              </div>
            </section>
            ${side}
          </div>
        `;
      });

    } else if (page === 'login') {
      form(
        email() +
        field(
          'password',
          '密碼',
          'password',
          'autocomplete="current-password"'
        ) +
        button('登入') +
        `
          <p>
            <a href="forgot-password.html">忘記密碼</a> ·
            <a href="verify-email.html">重寄驗證信</a>
          </p>
          <p>還沒有帳號？<a href="register.html">建立帳號</a></p>
        `
      );

      bindForm(async f => {
        checked(
          await client.auth.signInWithPassword({
            email: f.get('email').trim(),
            password: f.get('password')
          })
        );

        $('#password').value = '';
        location.assign(safeLearningReturn());
      });

    } else if (page === 'forgot') {
      form(
        email() +
        button('寄送密碼重設信') +
        '<p><a href="login.html">返回登入</a></p>'
      );

      bindForm(async f => {
        checked(
          await client.auth.resetPasswordForEmail(
            f.get('email').trim(),
            {
              redirectTo: redirect('reset-password.html')
            }
          )
        );

        report(
          '若此信箱有可重設的帳號，將收到重設信。請檢查收件匣與垃圾郵件。'
        );
      });

    } else if (page === 'verify') {
      form(
        `
          <p>
            已點擊驗證信？完成後可前往會員中心。
            連結失效時，可重新寄送。
          </p>
        ` +
        email() +
        button('重新寄送驗證信') +
        `
          <p>
            <a href="login.html">前往登入</a> ·
            <a href="account.html">會員中心</a>
          </p>
        `
      );

      bindForm(async f => {
        checked(
          await client.auth.resend({
            type: 'signup',
            email: f.get('email').trim(),
            options: {
              emailRedirectTo: redirect('verify-email.html')
            }
          })
        );

        report('若此信箱有待驗證的申請，將收到新的驗證信。');
      });

    } else if (page === 'reset') {
      form(
        password() +
        button('更新密碼') +
        `
          <p>
            <a href="forgot-password.html">重新申請密碼重設信</a>
          </p>
        `
      );

      bindForm(async f => {
        if (!recovery) {
          throw Error(
            'rise:請從密碼重設信中的有效連結進入此頁。'
          );
        }

        checkPassword(f);

        checked(
          await client.auth.updateUser({
            password: f.get('password')
          })
        );

        $('#auth-form').reset();
        recovery = false;

        checked(await client.auth.signOut());
        report('密碼已更新，請使用新密碼重新登入。');

        root.innerHTML = `
          <section class="auth-card">
            <a class="auth-button" href="login.html">重新登入</a>
          </section>
        `;
      });
    }
  }

  const applicationFields = `
    <div class="auth-field">
      <label for="school">任職學校／單位</label>
      <input
        id="school"
        name="school"
        required
        maxlength="160"
        autocomplete="organization"
      >
    </div>

    <div class="auth-field">
      <label for="subject">任教學科</label>
      <select id="subject" name="subject">
        <option value="math">數學</option>
        <option value="physics">物理</option>
        <option value="chemistry">化學</option>
        <option value="multiple">跨學科</option>
      </select>
    </div>

    <div class="auth-field">
      <label for="reason">任職資訊與申請說明</label>
      <textarea
        id="reason"
        name="reason"
        required
        maxlength="2000"
        placeholder="請說明任教職務與使用計畫資源的目的。不必填寫身分證字號或學生個資。"
      ></textarea>
    </div>
  `;

  async function application() {
    return checked(
      await client
        .from('rise_teacher_applications')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()
    );
  }

  async function history(id) {
    const rows = checked(
      await client
        .from('rise_application_events')
        .select('*')
        .eq('application_id', id)
        .order('created_at', { ascending: false })
        .limit(30)
    );

    return rows.map(r => `
      <div class="auth-record">
        <strong>${esc(r.action)}</strong><br>
        ${esc(new Date(r.created_at).toLocaleString('zh-TW'))}<br>
        ${esc(r.note)}
      </div>
    `).join('') || '<p>尚無紀錄。</p>';
  }

  function safeLearningReturn() {
    const raw = new URLSearchParams(location.search).get('next');
    if (!raw) return 'account.html';
    try {
      const base = new URL('./', location.href);
      const target = new URL(raw, base);
      const allowed = ['learning.html', 'inquiry.html', 'video-detail.html', 'questions.html'];
      if (target.origin !== base.origin || !allowed.some(name => target.pathname === base.pathname + name)) return 'account.html';
      return target.pathname + target.search;
    } catch { return 'account.html'; }
  }

  async function renderWatchHistory() {
    const box = $('#watch-history');
    if (!box) return;
    let offset = 0;
    const time = n => { const s = Math.max(0, Math.floor(Number(n) || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    async function draw() {
      box.textContent = '正在讀取觀看紀錄…';
      try {
        const rows = checked(await client.from('rise_watch_history').select('*').eq('user_id', user.id).order('last_watched_at', {ascending: false}).order('video_id').range(offset, offset + 10));
        box.innerHTML = rows.length ? rows.slice(0,10).map(r => `
          <article class="auth-record"><h3>${esc(r.video_title)}</h3>
          <p>最近觀看：${esc(new Date(r.last_watched_at).toLocaleString('zh-TW'))}</p>
          <p>上次位置 ${time(r.position_seconds)}${Number(r.duration_seconds) > 0 ? '／' + time(r.duration_seconds) : ''} · 累計播放時間 ${time(r.watched_seconds)}</p>
          <p class="auth-help">${r.reached_end ? '曾播放至片尾；不代表完整看完每個段落。' : '尚無播放至片尾的紀錄。'}</p>
          <a class="auth-button" href="video-detail.html?id=${encodeURIComponent(r.video_id)}">繼續觀看</a></article>`).join('') : '<p>尚無觀看紀錄。登入後在本站播放影片，即會開始記錄。</p>';
        const controls = document.createElement('div'); controls.className = 'auth-actions';
        const prev = document.createElement('button'), next = document.createElement('button');
        prev.textContent = '上一頁'; next.textContent = '下一頁'; prev.disabled = offset === 0; next.disabled = rows.length <= 10;
        prev.onclick = () => { offset = Math.max(0, offset - 10); draw(); };
        next.onclick = () => { offset += 10; draw(); };
        controls.append(prev, next); box.append(controls);
      } catch {
        box.textContent = '觀看紀錄暫時無法讀取。請確認網路，或請管理員完成觀看紀錄資料庫設定。';
      }
    }
    await draw();
  }

  async function accountPage() {
    if (!await loadUser()) return;

    const isAdmin = profile.role === 'admin';
    const hasTeacherAccess = ['admin', 'teacher'].includes(profile.role);
    const a = await application();

    const qualification = isAdmin
      ? '已具備教師資格（管理員免申請）'
      : hasTeacherAccess
        ? '已具備教師資格'
        : profile.role === 'ta' ? '助教資格已啟用' : a ? esc(labels[a.status]) : '尚未提交申請';

    const accountSide = hasTeacherAccess
      ? `
        <aside class="auth-card auth-aside">
          <h2>
            ${isAdmin ? '管理與教學，同一個帳號' : '教師資格已啟用'}
          </h2>
          <p>
            ${isAdmin
              ? '管理員自動具備教師資格，無須填寫教師申請；原有審核權限仍然保留。'
              : '你已具備教師資格，無須再次提交申請。'}
          </p>
          <p>
            可前往教師與助教資源。
            作業批閱與課程管理功能尚未開放。
          </p>
          <a href="support.html">教師與助教資源 →</a>
        </aside>
      `
      : side;

    root.innerHTML = `
      <div class="auth-grid">
        <section class="auth-card">
          <h2>${esc(profile.display_name)}</h2>

          <span class="auth-badge">
            ${isAdmin ? '管理員／教師' : esc(roles[profile.role])}
          </span>

          <dl>
            <dt>信箱</dt>
            <dd>${esc(user.email)}</dd>

            <dt>信箱驗證</dt>
            <dd>已驗證</dd>

            <dt>教學資格</dt>
            <dd>${qualification}</dd>
          </dl>

          ${a && !hasTeacherAccess
            ? `<p>審核意見：${esc(a.review_note || '尚無')}</p>`
            : ''}

          <div class="auth-actions">
            ${hasTeacherAccess
              ? '<a class="auth-button" href="support.html">教師與助教資源</a>'
              : ''}

            ${profile.role === 'student'
              ? '<a class="auth-button" href="teacher-apply.html">教師／助教資格申請與補件</a>'
              : ''}

            ${isAdmin
              ? '<a class="auth-button" href="admin-review.html">教師／助教申請審核</a>'
              : ''}

            <a class="auth-button" href="questions.html">學生問答</a>
            <button id="logout" class="secondary">登出</button>
          </div>

          <p class="auth-help">
            觀看紀錄會儲存至帳號。提問與推理草稿仍保存在目前瀏覽器；需協助時請到「學生問答」提交，教師與助教才能查看及回覆。
          </p>

          ${a ? '<h2>我的資格證明</h2><div id="my-evidence"></div>' : ''}
          <h2>我的觀看紀錄</h2>
          <div id="watch-history" aria-live="polite"></div>

          ${a
            ? '<h2>歷次申請與審核紀錄</h2>' + await history(a.id)
            : ''}

          <section class="auth-danger-zone" aria-labelledby="delete-account-title">
            <h2 id="delete-account-title">刪除帳號</h2>
            ${isAdmin
              ? '<p>管理員帳號不可從前台自行刪除。請先確認系統仍有其他管理員，再由 Supabase 後台處理。</p>'
              : `
                <p>
                  此操作會永久刪除帳號、個人資料、教師／助教資格申請、證明附件、問答及網站觀看紀錄，
                  且無法復原。儲存在目前瀏覽器的本機草稿也會一併清除。
                </p>
                <div class="auth-field">
                  <label for="delete-account-confirmation">
                    請輸入完整信箱 <strong>${esc(user.email)}</strong> 以確認
                  </label>
                  <input
                    id="delete-account-confirmation"
                    type="email"
                    inputmode="email"
                    autocomplete="off"
                    spellcheck="false"
                  >
                </div>
                <button id="delete-account" class="danger" type="button" disabled>
                  永久刪除我的帳號
                </button>
              `}
          </section>
        </section>

        ${accountSide}
      </div>
    `;

    if (a) await showEvidence($('#my-evidence'), a.attachments || []);
    renderWatchHistory();

    const deleteInput = $('#delete-account-confirmation');
    const deleteButton = $('#delete-account');

    if (deleteInput && deleteButton) {
      const expectedEmail = String(user.email || '').trim().toLowerCase();

      deleteInput.addEventListener('input', () => {
        deleteButton.disabled =
          deleteInput.value.trim().toLowerCase() !== expectedEmail;
      });

      deleteButton.addEventListener('click', async () => {
        if (deleteButton.disabled) return;

        if (!confirm(
          '確定永久刪除這個 RISE 帳號？帳號資料與網站觀看紀錄將無法復原。'
        )) return;

        deleteButton.disabled = true;
        deleteInput.disabled = true;
        deleteButton.textContent = '正在刪除帳號…';
        report('正在永久刪除帳號，請勿關閉頁面。');

        try {
          const preparation = await client.rpc('rise_drive_prepare_delete');
          if (preparation.error?.code !== 'PGRST202') {
            const hasDriveFiles = checked(preparation);
            if (hasDriveFiles) {
              let remaining = true;
              while (remaining) remaining = (await driveRequest('purge-mine')).more;
            }
          }
          // Storage 檔案須透過 Storage API 移除，不能直接刪除資料庫中繼資料。
          while (true) {
            const files = checked(await client.storage.from('rise-credentials').list(user.id, { limit: 100 }));
            if (!files.length) break;
            checked(await client.storage.from('rise-credentials').remove(files.map(file => user.id + '/' + file.name)));
          }
          checked(await client.rpc('rise_delete_my_account'));

          try {
            const prefix = 'rise-draft-v2:' + user.id + ':';
            for (let index = localStorage.length - 1; index >= 0; index -= 1) {
              const key = localStorage.key(index);
              if (key && key.startsWith(prefix)) localStorage.removeItem(key);
            }
          } catch {}

          try {
            await client.auth.signOut({ scope: 'local' });
          } catch {}

          location.replace('index.html?account=deleted');
        } catch (err) {
          deleteInput.disabled = false;
          deleteButton.textContent = '永久刪除我的帳號';
          deleteButton.disabled =
            deleteInput.value.trim().toLowerCase() !== expectedEmail;
          report(errorText(err), true);
        }
      });
    }

    $('#logout').onclick = async () => {
      try {
        checked(await client.auth.signOut());
        location.assign('login.html');
      } catch (err) {
        report(errorText(err), true);
      }
    };
  }

  async function teacherPage() {
    if (!await loadUser()) return;

    const a = await application();

    if (profile.role !== 'student') {
      root.innerHTML = `
        <section class="auth-card">
          <p>
            目前身分：${esc(roles[profile.role])}。
            ${profile.role === 'admin'
              ? '管理員已自動具備教師資格，免申請，並保留管理員權限。'
              : '目前帳號不需重複申請。'}
          </p>
          <a href="account.html">會員中心</a>
        </section>
      `;
      return;
    }

    if (a && !['returned'].includes(a.status)) {
      root.innerHTML = `
        <section class="auth-card">
          <h2>${esc(labels[a.status])}</h2>
          <p>
            ${esc(a.review_note || '申請已送出，請等待管理員審核。')}
          </p>
          <p>
            ${a.status === 'rejected'
              ? '如需再次申請，請透過計畫正式聯絡管道處理。'
              : ''}
          </p>
          <a href="account.html">查看會員中心與紀錄</a>
        </section>
      `;
      return;
    }

    form(`
      ${a
        ? `<div class="auth-notice">補件要求：${esc(a.review_note)}</div>`
        : ''}

      <div class="auth-field"><label for="requested-role">申請身分</label>
      <select id="requested-role" name="requested-role"><option value="teacher">教師</option><option value="ta">助教（協助學生問答）</option></select></div>
      ${applicationFields}
      <div class="auth-field"><label for="evidence">資格證明附件</label>
      <input id="evidence" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" aria-describedby="evidence-help">
      <p id="evidence-help">提供 1 至 3 份 PDF、JPG、PNG 或 WebP，每份不超過 5 MB。例如任職證明、教師證或助教聘任文件；請遮蔽身分證字號等不必要資料。補件如未選新檔案，會保留原附件；選新檔案則替換整組附件。</p></div>
      <div id="existing-evidence"></div>

      <p class="auth-help">
        附件僅供本人與管理員查看。提交本表不代表資格已核准。
      </p>

      ${button(a ? '重新送審' : '提交資格申請')}

      <p><a href="account.html">返回會員中心</a></p>
    `);

    $('#requested-role').value = a?.requested_role || (profile.requested_kind === 'ta' ? 'ta' : 'teacher');
    if (a) {
      await showEvidence($('#existing-evidence'), a.attachments || []);
      $('#school').value = a.school;
      $('#subject').value = a.subject;
      $('#reason').value = a.reason;
    }

    bindForm(async f => {
      const files = [...$('#evidence').files];
      const uploaded = [];
      let committed = false;
      try {
        let attachments = a?.attachments || [];
        if (files.length > 3) throw Error('rise:最多上傳三份附件。');
        const types = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
        for (const file of files) {
          if (!types[file.type] || !file.size || file.size > 5 * 1024 * 1024 || file.name.length > 255) throw Error('rise:附件須為 PDF、JPG、PNG 或 WebP，每份不超過 5 MB。');
        }
        if (!files.length && !attachments.length) throw Error('rise:請上傳至少一份資格證明。');
        const backend = files.length ? await attachmentBackend() : 'supabase';
        for (const file of files) {
          if (backend === 'google-drive') {
            const body = new FormData(); body.append('file', file);
            uploaded.push(await driveRequest('upload', body));
          } else {
            const path = user.id + '/' + crypto.randomUUID() + '.' + types[file.type];
            checked(await client.storage.from('rise-credentials').upload(path, file, { contentType: file.type, upsert: false }));
            uploaded.push({ provider: 'supabase', path, name: file.name });
          }
        }
        if (files.length) attachments = uploaded;
        checked(await client.rpc('rise_submit_staff_application', {
          p_school: f.get('school').trim(), p_subject: f.get('subject'),
          p_reason: f.get('reason').trim(), p_expected_version: a?.version || 0,
          p_requested_role: f.get('requested-role'), p_attachments: attachments
        }));
        committed = true;
        report('資格申請與附件已送出，可至會員中心查看審核狀態。');
        await teacherPage();
      } catch (error) {
        // RPC 回應遺失時不能刪除可能已成功提交的附件；保留供重試／刪帳時清除。
        if (uploaded.length && !committed) report('上傳檔案已保留；請至會員中心確認申請狀態後再重試。', true);
        throw error;
      }
    });
  }

  async function driveRequest(action, body = null, binary = false) {
    const session = checked(await client.auth.getSession()).session;
    if (!session?.access_token) throw Error('rise:請先登入。');
    const headers = { Authorization: 'Bearer ' + session.access_token, apikey: cfg.publishableKey };
    if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(cfg.url.replace(/\/$/, '') + '/functions/v1/rise-drive?action=' + encodeURIComponent(action), {
      method: 'POST', headers, body: body instanceof FormData ? body : JSON.stringify(body || {})
    });
    if (!response.ok) {
      let detail = {};
      try { detail = await response.json(); } catch {}
      throw Error('rise:' + (typeof detail.error === 'string' ? detail.error : 'Google Drive 服務尚未部署或無法連線，請管理員確認 rise-drive 函式設定。'));
    }
    return binary ? response.blob() : response.json();
  }

  async function attachmentBackend() {
    const result = await client.rpc('rise_attachment_backend');
    if (result.error?.code === 'PGRST202') return 'supabase';
    return checked(result);
  }

  async function showEvidence(box, attachments) {
    if (!attachments.length) { box.textContent = '此申請尚無證明附件。'; return; }
    box.textContent = '證明附件（僅本人與管理員可查看）';
    for (const file of attachments) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'secondary'; button.textContent = file.name;
      button.onclick = async () => {
        button.disabled = true;
        try {
          const data = file.provider === 'google-drive'
            ? await driveRequest('download', { id: file.path }, true)
            : checked(await client.storage.from('rise-credentials').download(file.path));
          const url = URL.createObjectURL(data), a = document.createElement('a');
          a.href = url; a.download = file.name; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (err) { report(errorText(err), true); }
        finally { button.disabled = false; }
      };
      const row = document.createElement('p'); row.append(button); box.append(row);
    }
  }

  async function adminPage() {
    if (!await loadUser()) return;

    if (profile.role !== 'admin') {
      root.innerHTML = `
        <section class="auth-card">
          <h2>此頁僅供管理員使用</h2>
          <p>你的帳號沒有教師資格審核權限。</p>
          <a href="account.html">返回會員中心</a>
        </section>
      `;
      return;
    }

    root.innerHTML = `
      <section class="auth-card">
        <h2>資格附件儲存設定</h2>
        <p>完成 Google Drive 後端部署後，按下方按鈕建立私有專用資料夾，並將新附件切換至 Google Drive。既有附件仍可查看。</p>
        <button id="drive-initialize" type="button">連接 Google Drive 並啟用</button>
        <p id="drive-setup-status" role="status"></p>
      </section>
      <section class="auth-card">
        <div class="auth-field">
          <button type="button" id="retry-review-mail" class="secondary">寄送待寄審核通知</button><p id="review-mail-status" role="status" aria-live="polite"></p><label for="review-filter">審核狀態</label>
          <select id="review-filter">
            <option value="pending">待審核</option>
            <option value="returned">待補件</option>
            <option value="approved">已核准</option>
            <option value="rejected">未核准</option>
          </select>
        </div>

        <div id="review-list"></div>

        <div class="auth-actions">
          <button id="previous" class="secondary">上一頁</button>
          <button id="next" class="secondary">下一頁</button>
          <button id="refresh" class="secondary">重新整理</button>
          <span id="page-count"></span>
        </div>
      </section>

      <dialog id="review-dialog" aria-labelledby="dialog-title">
        <h2 id="dialog-title">確認審核決定</h2>
        <p id="dialog-description"></p>
        <p class="auth-help">
          審核意見會顯示給申請人。審核保存後會嘗試寄送通知信；寄送失敗不影響審核結果。
        </p>
        <div class="auth-actions">
          <button id="review-confirm">確認送出</button>
          <button id="review-cancel" class="secondary">取消</button>
        </div>
      </dialog>
    `;

    $('#drive-initialize').onclick = async () => {
      const button = $('#drive-initialize'), message = $('#drive-setup-status');
      if (button.disabled) return;
      button.disabled = true; message.textContent = '正在確認授權與專用資料夾…';
      try {
        const result = await driveRequest('initialize');
        message.textContent = result.message;
        if (result.folderURL?.startsWith('https://drive.google.com/drive/folders/')) {
          const link = document.createElement('a'); link.href = result.folderURL;
          link.textContent = '開啟專用資料夾'; link.target = '_blank'; link.rel = 'noopener noreferrer';
          message.append(document.createElement('br'), link);
        }
      } catch (error) { message.textContent = errorText(error); }
      finally { button.disabled = false; }
    };

    let offset = 0;
    let rows = [];
    let decision = null;
    const size = 20;

    async function refresh() {
      report('讀取申請中…');
      $('#review-list').innerHTML = '';

      rows = checked(
        await client
          .from('rise_teacher_applications')
          .select('*')
          .eq('status', $('#review-filter').value)
          .order('created_at', { ascending: false })
          .order('id')
          .range(offset, offset + size)
      );

      const hasNext = rows.length > size;
      rows = rows.slice(0, size);

      $('#review-list').innerHTML = rows.length
        ? rows.map(a => `
          <article class="auth-record">
            <h2>${esc(a.applicant_name)}</h2>
            <span class="auth-badge">${esc(labels[a.status])}</span>

            <dl>
              <dt>信箱</dt>
              <dd>${esc(a.email)}</dd>

              <dt>學校／單位</dt>
              <dd>${esc(a.school)}</dd>

              <dt>學科</dt>
              <dd>
                ${esc({
                  math: '數學',
                  physics: '物理',
                  chemistry: '化學',
                  multiple: '跨學科'
                }[a.subject])}
              </dd>

              <dt>申請說明</dt>
              <dd>${esc(a.reason)}</dd>

              <dt>申請身分</dt><dd>${esc(roles[a.requested_role || "teacher"])}</dd>
              <dt>案件編號</dt>
              <dd>${esc(a.id)} · 第 ${a.version} 版</dd>

              <dt>審核意見</dt>
              <dd>${esc(a.review_note || '尚無')}</dd>
            </dl>

            <div id="evidence-${a.id}"></div>
            <button class="secondary" data-history="${a.id}">
              查看紀錄
            </button>
            <div id="history-${a.id}"></div>

            ${a.status === 'pending' ? `
              <label for="note-${a.id}">
                審核意見（補件／未核准必填）
              </label>

              <textarea
                id="note-${a.id}"
                maxlength="2000"
              ></textarea>

              <div class="auth-actions">
                <button data-id="${a.id}" data-decision="approved">
                  核准
                </button>

                <button
                  class="secondary"
                  data-id="${a.id}"
                  data-decision="returned"
                >
                  退回補件
                </button>

                <button
                  class="secondary"
                  data-id="${a.id}"
                  data-decision="rejected"
                >
                  不予核准
                </button>
              </div>
            ` : ''}
          </article>
        `).join('')
        : '<p>此狀態目前沒有申請。</p>';

      for (const a of rows) await showEvidence($('#evidence-' + a.id), a.attachments || []);
      $('#previous').disabled = offset === 0;
      $('#next').disabled = !hasNext;
      $('#page-count').textContent = `第 ${offset / size + 1} 頁`;

      report('申請資料已更新。');
    }

    async function sendReviewMail() {
      const status = $('#review-mail-status');
      const retry = $('#retry-review-mail');
      if (retry.disabled) return;
      retry.disabled = true;
      status.textContent = '正在寄送待寄審核通知…';
      try {
        const session = checked(await client.auth.getSession()).session;
        if (!session) throw Error('rise:請重新登入。');
        const response = await fetch(cfg.url.replace(/\/$/, '') + '/functions/v1/rise-review-mail', {
          method: 'POST', headers: { apikey: cfg.publishableKey, Authorization: 'Bearer ' + session.access_token }
        });
        const result = await response.json();
        if (!response.ok) throw Error('rise:' + (result.error || '通知信服務無法使用。'));
        status.textContent = `本次 ${result.sent} 封已交由郵件伺服器接收；尚有 ${result.remaining} 封待寄。` +
          (result.failed ? ' 部分寄送失敗，請檢查 SMTP 設定，10 分鐘後可再按補寄。' : result.remaining ? ' 可稍後再按此按鈕處理其餘待寄通知。' : '');
      } catch (error) {
        status.textContent = '審核結果已保存，通知信尚未確認寄出。' + errorText(error) + ' 後端設定完成後可按上方按鈕補寄。';
      } finally { retry.disabled = false; }
    }
    $('#retry-review-mail').onclick = sendReviewMail;

    const safeRefresh = () => {
      return refresh().catch(e => report(errorText(e), true));
    };

    $('#review-filter').onchange = () => {
      offset = 0;
      safeRefresh();
    };

    $('#refresh').onclick = safeRefresh;

    $('#previous').onclick = () => {
      offset = Math.max(0, offset - size);
      safeRefresh();
    };

    $('#next').onclick = () => {
      offset += size;
      safeRefresh();
    };

    $('#review-list').onclick = async e => {
      const h = e.target.closest('[data-history]');

      if (h) {
        try {
          $('#history-' + h.dataset.history).innerHTML =
            await history(h.dataset.history);
        } catch (err) {
          report(errorText(err), true);
        }
        return;
      }

      const b = e.target.closest('[data-decision]');
      if (!b) return;

      const a = rows.find(r => r.id === b.dataset.id);
      const note = $('#note-' + a.id).value.trim();

      if (b.dataset.decision !== 'approved' && !note) {
        report('請填寫補件要求或未核准原因。', true);
        $('#note-' + a.id).focus();
        return;
      }

      decision = {
        p_application_id: a.id,
        p_decision: b.dataset.decision,
        p_note: note,
        p_expected_version: a.version
      };

      $('#dialog-description').textContent =
        `${a.applicant_name}：${labels[decision.p_decision]}。${note}`;

      $('#review-dialog').showModal();
    };

    $('#review-cancel').onclick = () => {
      decision = null;
      $('#review-dialog').close();
    };

    $('#review-dialog').addEventListener('cancel', () => {
      decision = null;
    });

    $('#review-confirm').onclick = async () => {
      if (!decision || $('#review-confirm').disabled) return;

      $('#review-confirm').disabled = true;

      try {
        checked(
          await client.rpc(
            'rise_review_teacher_application',
            decision
          )
        );

        decision = null;
        $('#review-dialog').close();

        await refresh();

        report(
          '審核已保存。申請人可在會員中心查看結果。'
        );
        await sendReviewMail();
      } catch (e) {
        $('#review-dialog').close();
        decision = null;
        report(errorText(e), true);
      } finally {
        $('#review-confirm').disabled = false;
      }
    };

    await refresh();
  }

  async function questionPage() {
    const staff = ['teacher', 'ta', 'admin'].includes(profile.role);
    let offset = 0;
    const size = 20;
    root.innerHTML = `<section class="auth-card">
      <h2>${staff ? '學生問答工作台' : '我的問題'}</h2>
      <p>問題與回覆會存入帳號，供提問者及已核准的教師、助教與管理員查看。請勿填寫他人個資。</p>
      <form id="question-form">
        <div class="auth-field"><label for="q-subject">學科</label><select id="q-subject"><option value="math">數學</option><option value="physics">物理</option><option value="chemistry">化學</option><option value="multiple">跨學科</option></select></div>
        <div class="auth-field"><label for="q-title">問題標題</label><input id="q-title" required maxlength="160"></div>
        <div class="auth-field"><label for="q-body">問題內容、已嘗試的方法與卡住的地方</label><textarea id="q-body" required maxlength="10000" rows="6"></textarea></div>
        <button type="submit">送出問題</button>
      </form>
      <hr><div id="question-list"></div>
      <div class="auth-actions"><button id="q-prev" type="button">上一頁</button><button id="q-next" type="button">下一頁</button><button id="q-refresh" type="button">重新整理</button></div>
    </section>`;
    async function draw() {
      const box = $('#question-list'); box.textContent = '讀取中…';
      const rows = checked(await client.from('rise_questions').select('*').order('created_at', {ascending:false}).order('id').range(offset, offset + size));
      box.innerHTML = rows.length ? '' : '<p>目前沒有問題。</p>';
      for (const q of rows.slice(0,size)) {
        const article = document.createElement('article'); article.className = 'auth-record';
        article.innerHTML = `<h3>${esc(q.title)}</h3><p>${esc(new Date(q.created_at).toLocaleString('zh-TW'))} · ${esc({math:'數學',physics:'物理',chemistry:'化學',multiple:'跨學科'}[q.subject])}</p><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(q.body)}</p>`;
        const open = document.createElement('button'); open.type='button'; open.textContent='查看對話／回覆';
        const thread = document.createElement('div');
        open.onclick = async () => {
          open.disabled = true;
          try { await discussion(q, thread); } catch(err) {report(errorText(err),true);}
          finally { open.disabled=false; }
        };
        article.append(open,thread); box.append(article);
      }
      $('#q-prev').disabled = offset === 0; $('#q-next').disabled = rows.length <= size;
    }
    async function discussion(q, box) {
      box.innerHTML = '';
      let answerOffset = 0;
      const entries = document.createElement('div');
      const more = document.createElement('button'); more.type='button'; more.textContent='載入更多回覆';
      async function answers() {
        more.disabled=true;
        try {
          const rows = checked(await client.from('rise_answers').select('*').eq('question_id',q.id).order('created_at').order('id').range(answerOffset,answerOffset+49));
          for (const r of rows) {
            const entry = document.createElement('div'); entry.className='auth-record';
            entry.innerHTML=`<strong>${esc(r.author_name)} · ${esc(roles[r.author_role])}</strong><p>${esc(new Date(r.created_at).toLocaleString('zh-TW'))}</p><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.body)}</p>`;
            entries.append(entry);
          }
          answerOffset+=rows.length; more.hidden=rows.length<50;
          if (!answerOffset) entries.textContent='尚無回覆。';
        } finally {more.disabled=false;}
      }
      more.onclick=()=>answers().catch(err=>report(errorText(err),true));
      const form=document.createElement('form');
      form.innerHTML=`<div class="auth-field"><label for="answer-${q.id}">${q.user_id===user.id?'補充問題／回覆':'回答學生'}</label><textarea id="answer-${q.id}" required maxlength="10000" rows="4"></textarea></div><button type="submit">送出回覆</button>`;
      form.onsubmit=async event=>{
        event.preventDefault();const b=form.querySelector('button');if(b.disabled)return;b.disabled=true;
        try {
          checked(await client.rpc('rise_answer_question',{p_question_id:q.id,p_body:form.querySelector('textarea').value.trim()}));
          report('回覆已保存。'); await discussion(q,box);
        } catch(err) {report(errorText(err),true);} finally {if(b.isConnected)b.disabled=false;}
      };
      box.append(entries,more,form);await answers();
    }
    const refresh = () => draw().catch(err=>report(errorText(err),true));
    $('#q-prev').onclick=()=>{offset=Math.max(0,offset-size);refresh();};
    $('#q-next').onclick=()=>{offset+=size;refresh();};
    $('#q-refresh').onclick=refresh;
    $('#question-form').onsubmit=async event=>{
      event.preventDefault();const form=event.target,b=form.querySelector('button');if(b.disabled)return;b.disabled=true;
      try {
        checked(await client.from('rise_questions').insert({user_id:user.id,subject:$('#q-subject').value,title:$('#q-title').value.trim(),body:$('#q-body').value.trim()}));
        form.reset();offset=0;report('問題已送出，教師與助教可在工作台查看。');await draw();
      } catch(err) {report(errorText(err),true);} finally {b.disabled=false;}
    };
    await draw();
  }

  function loadSDK() {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');

      const timeout = setTimeout(() => {
        reject(Error('timeout'));
      }, 15000);

      s.src =
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js';

      s.onload = () => {
        clearTimeout(timeout);
        resolve();
      };

      s.onerror = () => {
        clearTimeout(timeout);
        reject(Error('network'));
      };

      document.head.append(s);
    });
  }

  async function init() {
    renderPublic();

    const inputs = () => root.querySelectorAll(
      'input,select,textarea,[data-submit]'
    );

    inputs().forEach(i => {
      i.disabled = true;
    });

    if (!cfg.url || !cfg.publishableKey) {
      notice.textContent =
        '帳號服務尚未啟用。此頁已備妥，但尚未連接後端；不會送出資料、建立帳號或寄信。';

      if (!root.innerHTML) {
        root.innerHTML = `
          <section class="auth-card">
            <p>後端設定完成後，登入即可使用此頁。</p>
            <a href="register.html">查看註冊頁</a> ·
            <a href="login.html">查看登入頁</a>
          </section>
        `;
      }

      return;
    }

    try {
      const url = new URL(cfg.url);
      const base = new URL(cfg.siteURL);

      if (url.protocol !== 'https:' || base.protocol !== 'https:') {
        throw Error('rise:帳號服務與網站網址需使用 HTTPS。');
      }

      await loadSDK();

      client = window.supabase.createClient(
        cfg.url,
        cfg.publishableKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        }
      );

      client.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          recovery = true;
        }

        if (event === "SIGNED_OUT" || !session?.user) {
          updateAccountNavigation(null);
        } else {
          updateAccountNavigation(session.user);
        }
      });

      checked(await client.auth.getSession());

      const identity = await client.auth.getUser();

      updateAccountNavigation(
        identity.data?.user || null
      );

      notice.hidden = true;

      if (page === 'register') {
        let policy;

        try {
          policy = new URL(cfg.privacyURL);
          if (policy.protocol !== 'https:') policy = null;
        } catch {}

        if (!policy) {
          notice.hidden = false;
          notice.textContent =
            '個人資料蒐集告知事項尚未完成，註冊暫未開放。';
          return;
        }

        $('#privacy-label').innerHTML = `
          <a
            href="${esc(policy.href)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            個人資料蒐集告知事項
          </a>
        `;
      }

      inputs().forEach(i => {
        i.disabled = false;
      });

      if (page === 'verify') {
        const result = await client.auth.getUser();

        if (result.data?.user?.email_confirmed_at) {
          report('電子信箱驗證成功。');

          root.innerHTML = `
            <div class="auth-grid">
              <section class="auth-card" aria-labelledby="verification-complete">
                <p class="eyebrow">EMAIL VERIFIED</p>
                <h2 id="verification-complete">信箱驗證完成</h2>
                <p>你的 RISE 帳號已啟用，可以開始使用學習與提問功能。</p>
                <div class="auth-actions">
                  <a class="auth-button" href="account.html">進入會員中心</a>
                  <a class="auth-button secondary" href="index.html">返回首頁</a>
                </div>
              </section>
              ${side}
            </div>
          `;
        } else {
          const params = new URLSearchParams(
            location.search || location.hash.replace(/^#/, '?')
          );
          const authError =
            params.get('error_description') || params.get('error');

          report(
            authError
              ? '驗證連結無效或已過期，請在下方重新寄送驗證信。'
              : '請開啟驗證信中的連結；若連結已失效，可在下方重新寄送。',
            Boolean(authError)
          );
        }

      } else if (page === 'reset' && !recovery) {
        report(
          '請從最新的密碼重設信連結進入。重新整理後可能需要重新申請連結。',
          true
        );

        $('[data-submit]').disabled = true;

      } else if (page === 'questions') {
        if (await loadUser()) await questionPage();
      } else if (page === 'account') {
        await accountPage();

      } else if (page === 'teacher') {
        await teacherPage();

      } else if (page === 'admin') {
        await adminPage();
      }

    } catch (err) {
      report(errorText(err), true);
      notice.hidden = false;
      notice.textContent =
        '帳號服務未完成載入。請確認設定與網路；不影響公開教材頁面。';
    }
  }

  init();
})();



