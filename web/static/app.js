// SimpleBin 前端公共助手：API 请求、提示、弹窗、格式化。

// api 调 JSON 接口；失败时抛 Error（message 为服务端返回的 error 字段）。
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (res.status === 401) { location.href = '/login'; throw new Error('需要登录'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('请求失败：' + res.status));
  return data;
}

// 上传文件：FormData，不设 Content-Type（浏览器自动加 boundary）。
async function apiUpload(path, formData) {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', body: formData });
  if (res.status === 401) { location.href = '/login'; throw new Error('需要登录'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('上传失败：' + res.status));
  return data;
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// esc 转义 HTML：用户内容拼进 innerHTML 前必须过一遍。
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

const TYPE_LABEL = { text: '文本', link: '链接', image: '图片', file: '文件' };
const TYPE_ICON = { text: '📄', link: '🔗', image: '🖼️', file: '📎' };
function typeLabel(t) { return TYPE_LABEL[t] || t; }
function typeIcon(t) { return TYPE_ICON[t] || '📄'; }

// copyText 写剪贴板：优先 Clipboard API，失败时退回 textarea 方案。
async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('已复制');
}

// ---------- 弹窗 ----------
// openModal(html) 渲染弹窗内容，返回根元素；调用方自己绑按钮事件。
function openModal(html) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = '<div class="modal">' + html + '</div>';
  back.addEventListener('click', e => { if (e.target === back) closeModal(); });
  document.body.appendChild(back);
  return back.querySelector('.modal');
}

function closeModal() {
  document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
}

// confirmModal 简单确认框，点确定执行 onOk。
function confirmModal(title, body, okText, onOk) {
  const m = openModal('<h3>' + esc(title) + '</h3><p>' + esc(body) + '</p>' +
    '<div class="btn-row"><button class="btn danger" id="mOk">' + esc(okText) + '</button>' +
    '<button class="btn" id="mCancel">取消</button></div>');
  m.querySelector('#mCancel').onclick = closeModal;
  m.querySelector('#mOk').onclick = async () => {
    try { await onOk(); } catch (e) { toast(e.message); return; }
    closeModal();
  };
}

// ---------- 顶栏 ----------
// 每页加载时调一次：管理员显示“管理”入口，登出按钮绑事件。
async function initTopbar() {
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.onclick = async () => {
    await api('/api/v1/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  };
  try {
    const me = await api('/api/v1/me');
    window.__me = me;
    const adminLink = document.getElementById('adminLink');
    if (adminLink && me.is_admin) adminLink.hidden = false;
  } catch { /* 未登录页不调这个 */ }
}

// ---------- 条目通用操作（历史页与详情页共用） ----------

async function deleteItem(id, title, after) {
  confirmModal('删除条目', '确定删除“' + (title || id) + '”吗？文件会一起删除，无法恢复。', '删除', async () => {
    await api('/api/v1/items/' + id, { method: 'DELETE' });
    toast('已删除');
    if (after) after();
  });
}

// 分享链接弹窗：已分享显示链接与关闭按钮，未分享显示开启按钮。
async function shareLinkModal(item, after) {
  const origin = location.origin;
  if (item.share_token) {
    const url = origin + '/s/' + item.share_token;
    const m = openModal('<h3>分享链接</h3><p class="token-once">' + esc(url) + '</p>' +
      '<div class="btn-row"><button class="btn primary" id="mCopy">复制链接</button>' +
      '<button class="btn danger" id="mOff">关闭分享</button>' +
      '<button class="btn" id="mCancel">关闭</button></div>');
    m.querySelector('#mCancel').onclick = closeModal;
    m.querySelector('#mCopy').onclick = () => copyText(url);
    m.querySelector('#mOff').onclick = async () => {
      try {
        await api('/api/v1/items/' + item.id + '/share-link', { method: 'DELETE' });
        toast('已关闭分享');
        closeModal();
        if (after) after();
      } catch (e) { toast(e.message); }
    };
    return;
  }
  const m = openModal('<h3>分享链接</h3><p class="muted">生成公开链接，知道链接的人无需登录即可查看这条内容。可随时关闭。</p>' +
    '<div class="btn-row"><button class="btn primary" id="mOn">生成链接</button>' +
    '<button class="btn" id="mCancel">取消</button></div>');
  m.querySelector('#mCancel').onclick = closeModal;
  m.querySelector('#mOn').onclick = async () => {
    try {
      const r = await api('/api/v1/items/' + item.id + '/share-link', { method: 'POST' });
      const url = origin + '/s/' + r.share_token;
      closeModal();
      const m2 = openModal('<h3>分享链接已生成</h3><p class="token-once">' + esc(url) + '</p>' +
        '<div class="btn-row"><button class="btn primary" id="mCopy">复制链接</button>' +
        '<button class="btn" id="mCancel">关闭</button></div>');
      m2.querySelector('#mCancel').onclick = closeModal;
      m2.querySelector('#mCopy').onclick = () => copyText(url);
      if (after) after();
    } catch (e) { toast(e.message); }
  };
}

// 分享给用户弹窗：选一个用户，副本成为对方最新条目。
async function shareToUserModal(item, after) {
  let users;
  try {
    users = await api('/api/v1/users');
  } catch (e) { toast(e.message); return; }
  if (!users.length) { toast('没有其他用户可分享'); return; }
  const opts = users.map(u => '<option value="' + esc(u.username) + '">' + esc(u.username) + '</option>').join('');
  const m = openModal('<h3>分享给用户</h3><p class="muted">生成一份副本归对方所有，成为对方的最新条目。对方可编辑、删除，不影响你的原件。</p>' +
    '<div class="field"><label>分享给</label><select id="mUser">' + opts + '</select></div>' +
    '<div class="btn-row"><button class="btn primary" id="mOk">分享</button>' +
    '<button class="btn" id="mCancel">取消</button></div>');
  m.querySelector('#mCancel').onclick = closeModal;
  m.querySelector('#mOk').onclick = async () => {
    const username = m.querySelector('#mUser').value;
    try {
      await api('/api/v1/items/' + item.id + '/share', {
        method: 'POST', body: JSON.stringify({ username }),
      });
      toast('已分享给 ' + username);
      closeModal();
      if (after) after();
    } catch (e) { toast(e.message); }
  };
}

// 置顶到 Fast 弹窗：选 1/5/10 分钟。
async function fastPinModal(item, after) {
  const me = window.__me || await api('/api/v1/me').catch(() => null);
  const url = location.origin + '/fast/' + (me ? me.username : '');
  const m = openModal('<h3>置顶到 Fast</h3><p class="muted">这条内容将在公开页 <span class="token-once" style="padding:2px 6px">' +
    esc(url) + '</span> 显示，无需登录。到期自动消失，每人同时只能置顶一条。</p>' +
    '<div class="btn-row">' +
    '<button class="btn" data-min="1">1 分钟</button>' +
    '<button class="btn" data-min="5">5 分钟</button>' +
    '<button class="btn primary" data-min="10">10 分钟</button></div>' +
    '<p style="margin-top:12px"><button class="btn" id="mCancel">取消</button></p>');
  m.querySelector('#mCancel').onclick = closeModal;
  m.querySelectorAll('[data-min]').forEach(b => b.onclick = async () => {
    try {
      await api('/api/v1/items/' + item.id + '/fast', {
        method: 'POST', body: JSON.stringify({ minutes: Number(b.dataset.min) }),
      });
      toast('已置顶 ' + b.dataset.min + ' 分钟');
      closeModal();
      if (after) after();
    } catch (e) { toast(e.message); }
  });
}

// 复制条目内容：文本/链接取全文，图片/文件复制下载地址。
async function copyItem(item) {
  if (item.type === 'text' || item.type === 'link') {
    const full = await api('/api/v1/items/' + item.id);
    await copyText(full.body);
  } else {
    await copyText(location.origin + '/api/v1/items/' + item.id + '/blob?download=1');
  }
}
