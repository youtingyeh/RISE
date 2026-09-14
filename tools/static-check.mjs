import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const failures = [];

async function filesUnder(dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries
    .filter(entry => !['.git', 'node_modules'].includes(entry.name))
    .map(entry => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    }));
  return nested.flat();
}

const files = await filesUnder();
const relativeFiles = new Set(files.map(file => relative(root, file).replaceAll('\\', '/')));

for (const file of files.filter(file => extname(file) === '.html')) {
  const html = await readFile(file, 'utf8');
  const name = relative(root, file).replaceAll('\\', '/');
  if (name !== '404.html' && !/<meta\s+name=["']description["']/i.test(html)) {
    failures.push(`${name}：缺少 meta description`);
  }

  const privatePages = new Set([
    'learning.html', 'inquiry.html', 'video-detail.html', 'register.html',
    'login.html', 'verify-email.html', 'forgot-password.html',
    'reset-password.html', 'account.html', 'teacher-apply.html',
    'admin-review.html', '404.html'
  ]);
  if (privatePages.has(name) && !/<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) {
    failures.push(`${name}：登入／錯誤頁缺少 noindex`);
  }

  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  for (const id of new Set(ids)) {
    if (ids.filter(value => value === id).length > 1) failures.push(`${relative(root, file)}：重複 id ${id}`);
  }

  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [index, match] of inlineScripts.entries()) {
    try {
      new vm.Script(match[1], { filename: `${name} inline script ${index + 1}` });
    } catch (error) {
      failures.push(`${name}：內嵌 JavaScript 語法錯誤（${error.message}）`);
    }
  }

  for (const match of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const reference = match[1];
    if (reference.includes('${')) continue;
    if (/^(?:[a-z]+:|#|\/\/)/i.test(reference)) continue;
    const pathname = reference.split(/[?#]/, 1)[0];
    if (!pathname) continue;
    const target = normalize(join(dirname(relative(root, file)), pathname)).replaceAll('\\', '/').replace(/^\.\//, '');
    if (!relativeFiles.has(target)) failures.push(`${relative(root, file)}：找不到 ${reference}`);
  }
}

const required = [
  'index.html', 'style.css', 'content.js', 'script.js', 'auth-config.js',
  'auth.js', 'account-nav.js', 'learning-session.js', 'media.js',
  'privacy.html', 'backend/setup.sql', 'backend/watch-history.sql',
  'backend/delete-account.sql'
];
for (const file of required) if (!relativeFiles.has(file)) failures.push(`缺少必要檔案：${file}`);

const script = await readFile(join(root, 'script.js'), 'utf8');
if (!script.includes('id="site-account-nav"')) failures.push('script.js 缺少 #site-account-nav，登入帳號列無法更新');

for (const file of files.filter(file => extname(file) === '.js')) {
  const source = await readFile(file, 'utf8');
  const name = relative(root, file).replaceAll('\\', '/');
  try {
    new vm.Script(source, { filename: name });
  } catch (error) {
    failures.push(`${name}：JavaScript 語法錯誤（${error.message}）`);
  }
  if (/sb_secret_[A-Za-z0-9_-]+/.test(source)) failures.push(`${relative(root, file)}：疑似包含 Supabase secret key`);
  if (/@supabase\/supabase-js@2(?:\/|['"])/.test(source)) failures.push(`${relative(root, file)}：Supabase SDK 使用浮動主版本`);
}

const dataSource = await readFile(join(root, 'content.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(dataSource, sandbox, { filename: 'content.js' });
const data = sandbox.window.RISE_DATA;
if (!data || !Array.isArray(data.subjects) || !Array.isArray(data.videos)) failures.push('content.js 的 RISE_DATA 結構不完整');
else {
  const subjectIds = new Set(data.subjects.map(subject => subject.id));
  const videoIds = data.videos.map(video => video.id);
  for (const id of new Set(videoIds)) if (videoIds.filter(value => value === id).length > 1) failures.push(`影片 id 重複：${id}`);
  for (const video of data.videos) if (!subjectIds.has(video.subject)) failures.push(`影片 ${video.id} 使用不存在的學科 ${video.subject}`);
}

if (failures.length) {
  console.error(failures.map(failure => `ERROR: ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`PASS: ${files.length} 個檔案；本機連結、必要檔案、重複 id 與內容資料結構正常。`);
