'use strict';

window.RISE_QUESTION_HISTORY = async function ({ client, user, profile, question: q, root, attachments, report, reload }) {
  const result = await client.from('rise_question_versions').select('*').eq('question_id', q.id).order('version', { ascending: false });
  if (result.error) {
    if (['PGRST205', '42P01'].includes(result.error.code)) {
      throw Error('rise:提問歷程與三要素批閱尚未啟用，請管理員執行 backend/program-upgrade.sql。');
    }
    throw result.error;
  }

  const versions = result.data || [];
  const latest = versions[0];
  if (!latest) throw Error('rise:請管理員執行 backend/program/01-question-history.sql。');

  const staffRoles = ['ta', 'teacher', 'admin'];
  const staff = staffRoles.includes(profile.role);
  const own = q.user_id === user.id;
  const rubric = [['analysis', '思路分析'], ['improvement', '改進建議'], ['followup', '延伸提問']];
  const errorMessage = error => String(error.message || error).replace(/^rise:/, '');
  const dateLabel = value => new Date(value).toLocaleString('zh-TW');
  const versionLabel = number => '第 ' + number + ' 版';

  function el(tag, text, parent, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    parent.append(node);
    return node;
  }

  function renderResponse(item, target) {
    el('strong', item.author_name || '使用者', target);
    if (!rubric.every(([key]) => item[key])) {
      el('p', item.body, target, 'rise-question-text');
      return;
    }
    const notes = el('dl', '', target, 'rise-question-notes');
    for (const [key, label] of rubric) {
      const note = el('div', '', notes);
      el('dt', label, note);
      el('dd', item[key], note, 'rise-question-text');
    }
  }

  const spread = el('div', '', root, 'rise-question-spread');
  const original = el('section', '', spread, 'rise-question-paper');
  const feedback = el('section', '', spread, 'rise-question-feedback');
  el('h4', '學生原文', original);
  el('p', '最新版本 · ' + versionLabel(latest.version) + ' · ' + dateLabel(latest.created_at), original, 'rise-question-meta');
  el('h5', latest.title, original);
  el('p', latest.body, original, 'rise-question-text');
  if (latest.change_note) el('p', '修改說明：' + latest.change_note, original, 'rise-question-text rise-question-change');
  if (attachments?.children.length) {
    el('h5', '提問附圖', original);
    original.append(attachments);
  } else {
    attachments?.remove();
  }

  let latestReview;
  let offset = 0;
  let hasTimeline = false;
  let overview;
  if (!staff) {
    el('h4', '教師與助教回饋', feedback);
    overview = el('div', '', feedback);
  }

  const timeline = el('details', '', root, 'rise-question-timeline');
  el('summary', '版本與回覆紀錄', timeline);
  const events = el('ol', '', timeline, 'rise-question-events');
  const more = el('button', '載入更多歷程', timeline, 'secondary');
  more.type = 'button';
  more.hidden = true;

  function updateOverview() {
    if (!overview) return;
    overview.replaceChildren();
    if (latestReview) {
      const version = latestReview.version ? versionLabel(latestReview.version) : '舊回覆（未記錄版本）';
      const label = latestReview.version === latest.version ? '本版回饋' : '前次回饋';
      el('p', label + ' · ' + version + ' · ' + dateLabel(latestReview.created_at), overview, 'rise-question-meta');
      renderResponse(latestReview, overview);
    } else if (more.hidden) {
      el('p', '尚未有教師或助教回覆。', overview, 'rise-question-empty');
    }
    if (!more.hidden) el('p', '展開版本紀錄並載入更多，可查看尚未載入的回覆。', overview, 'rise-question-meta');
  }

  function addEvent(item) {
    const row = document.createElement('li');
    const card = el('article', '', row, 'rise-question-event');
    const submitted = item.kind === 'version';
    const version = item.version ? versionLabel(item.version) : '舊回覆（未記錄版本）';
    const detail = el('details', '', card);
    const label = (submitted ? '提交／修訂' : '回覆') + ' · ' + version + ' · ' + dateLabel(item.created_at);
    el('summary', label, detail);
    const body = el('div', '', detail, 'rise-question-event-body');
    if (submitted) {
      el('strong', item.title, body);
      el('p', item.body, body, 'rise-question-text');
      if (item.change_note) el('p', '修改說明：' + item.change_note, body, 'rise-question-text rise-question-change');
    } else {
      renderResponse(item, body);
      if (staffRoles.includes(item.author_role)) latestReview = item;
    }
    events.prepend(row);
  }

  async function loadTimeline() {
    more.disabled = true;
    try {
      const response = await client.rpc('rise_question_timeline', { p_question_id: q.id, p_offset: offset });
      if (response.error) throw response.error;
      if (!Array.isArray(response.data?.items)) throw Error('rise:歷程資料格式不正確。');

      hasTimeline = true;
      const items = response.data.items;
      const page = items.slice(0, 100);
      for (const item of page) addEvent(item);
      offset += page.length;
      more.hidden = items.length <= 100;
      updateOverview();
    } finally {
      more.disabled = false;
    }
  }

  try {
    await loadTimeline();
  } catch (error) {
    if (!['PGRST202', '42883'].includes(error.code)) throw error;
    timeline.querySelector('summary').textContent = '提問版本歷程';
    el('p', '整合歷程尚待後端更新，目前顯示既有版本與回覆。', timeline, 'rise-question-meta');
    for (const version of [...versions].reverse()) addEvent({ ...version, kind: 'version' });
    if (overview) el('p', '請查看下方既有回覆。', overview, 'rise-question-empty');
  }
  more.onclick = () => loadTimeline().catch(error => report(errorMessage(error), true));

  if (!staff && !own) return { timeline: hasTimeline };

  if (staff) {
    const ai = el('details', '', original, 'rise-question-ai');
    el('summary', 'AI 學習分析標籤（待教師確認）', ai);
    const load = el('button', '查看此提問已分享的 AI 標籤', ai, 'secondary');
    load.type = 'button';
    const output = el('div', '', ai);
    load.onclick = async () => {
      load.disabled = true;
      try {
        const response = await client.rpc('rise_question_ai_context', { p_question_id: q.id });
        if (response.error) throw response.error;
        output.replaceChildren();
        const items = Array.isArray(response.data) ? response.data : [];
        if (!items.length) el('p', '此提問沒有學生分享的 AI 分析。', output);
        const names = { calculation_slip: '運算疏忽', logic_gap: '邏輯斷層', concept_misuse: '概念誤用' };
        for (const item of items) {
          const card = el('div', versionLabel(item.version) + ' · 模型 ' + item.model, output);
          for (const tag of item.tags || []) {
            el('p', (names[tag.code] || tag.code) + '（模型信心 ' + Math.round(Number(tag.confidence || 0) * 100) + '%）：' + tag.reason, card);
          }
        }
      } catch (error) {
        report(errorMessage(error), true);
      } finally {
        load.disabled = false;
      }
    };
  }

  const editor = staff ? feedback : el('details', '', feedback, 'rise-question-revise');
  if (!staff) el('summary', '修訂並重新提交', editor);
  const form = el('form', '', editor, 'rise-question-editor');
  if (staff) el('h4', '三要素批閱 · ' + versionLabel(latest.version), form);
  const specs = staff ? rubric : [['title', '問題標題', latest.title], ['body', '完整問題與思考過程', latest.body], ['change_note', '這次修改了什麼？', '']];
  for (const [key, label, value = ''] of specs) {
    const field = el('label', label, form);
    const input = el('textarea', '', field);
    input.name = key;
    input.value = value;
    input.required = true;
    input.maxLength = staff ? 3000 : key === 'title' ? 160 : key === 'change_note' ? 2000 : 10000;
    input.rows = key === 'body' ? 7 : 3;
  }
  if (!staff) el('p', '送出會保留前一版。原有圖片繼續附於此提問。', form);
  const save = el('button', staff ? '提交三要素批閱' : '送出新版本', form);
  save.type = 'submit';
  form.onsubmit = async event => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try {
      const value = name => form.querySelector('[name="' + name + '"]').value.trim();
      const args = { p_id: q.id, p_version: latest.version };
      if (staff) {
        Object.assign(args, { p_analysis: value('analysis'), p_improvement: value('improvement'), p_followup: value('followup') });
      } else {
        Object.assign(args, { p_title: value('title'), p_body: value('body'), p_change_note: value('change_note') });
      }
      const response = await client.rpc(staff ? 'rise_review_question' : 'rise_revise_question', args);
      if (response.error) throw response.error;
      report('已保存。');
      try {
        await reload();
      } catch {
        report('已保存，但畫面更新失敗，請重新整理；不必重複提交。', true);
      }
    } catch (error) {
      report(errorMessage(error), true);
    } finally {
      save.disabled = false;
    }
  };

  return { timeline: hasTimeline };
};
