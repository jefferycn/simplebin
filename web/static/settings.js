// 设置页：快取状态、API token 管理、修改密码。

initTopbar();
loadSettings();

async function loadSettings() {
  const me = window.__me || await api('/api/v1/me').catch(() => null);
  if (me) document.getElementById('whoami').textContent = '当前用户：' + me.username + (me.is_admin ? '（管理员）' : '');
  loadFast();
  loadTokens();
}

async function loadFast() {
  const el = document.getElementById('fastStatus');
  try {
    const r = await api('/api/v1/fast');
    if (!r.pinned) {
      el.textContent = '当前没有置顶内容。在历史或详情页点“快取”可置顶一条到公开页。';
      return;
    }
    const it = await api('/api/v1/items/' + r.item_id).catch(() => null);
    const left = Math.max(0, Math.round((new Date(r.expires_at) - Date.now()) / 1000));
    el.innerHTML = '已置顶：' + esc(it ? (it.title || it.id) : r.item_id) +
      '，剩余约 ' + Math.floor(left / 60) + ' 分 ' + (left % 60) + ' 秒到期。' +
      ' <button class="mini-btn danger" id="unpinBtn">取消置顶</button>';
    document.getElementById('unpinBtn').onclick = async () => {
      await api('/api/v1/fast', { method: 'DELETE' });
      toast('已取消置顶');
      loadFast();
    };
  } catch (e) {
    el.textContent = '加载失败：' + e.message;
  }
}

async function loadTokens() {
  const el = document.getElementById('tokenList');
  let tokens;
  try {
    tokens = await api('/api/v1/tokens');
  } catch (e) {
    el.innerHTML = '<p class="muted">加载失败：' + esc(e.message) + '</p>';
    return;
  }
  if (!tokens.length) {
    el.innerHTML = '<p class="muted">还没有 token。</p>';
    return;
  }
  el.innerHTML = '<table><tr><th>名称</th><th>前缀</th><th>创建</th><th>最后使用</th><th></th></tr>' +
    tokens.map(t => '<tr><td>' + esc(t.name || '未命名') + '</td><td><code>' + esc(t.prefix) + '…</code></td>' +
      '<td>' + fmtTime(t.created_at) + '</td><td>' + (t.last_used_at ? fmtTime(t.last_used_at) : '—') + '</td>' +
      '<td><button class="mini-btn danger" data-tid="' + t.id + '">吊销</button></td></tr>').join('') + '</table>';
  el.querySelectorAll('[data-tid]').forEach(b => b.onclick = async () => {
    try {
      await api('/api/v1/tokens/' + b.dataset.tid, { method: 'DELETE' });
      toast('已吊销');
      loadTokens();
    } catch (e) { toast(e.message); }
  });
}

document.getElementById('tokenForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('tokenName').value.trim();
  try {
    const r = await api('/api/v1/tokens', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('tokenName').value = '';
    const m = openModal('<h3>Token 已生成</h3><p class="muted">原文只显示一次，请立即保存。丢失后需重新生成。</p>' +
      '<p class="token-once">' + esc(r.token) + '</p>' +
      '<div class="btn-row"><button class="btn primary" id="mCopy">复制</button>' +
      '<button class="btn" id="mClose">关闭</button></div>');
    m.querySelector('#mClose').onclick = closeModal;
    m.querySelector('#mCopy').onclick = () => copyText(r.token);
    loadTokens();
  } catch (ex) { toast(ex.message); }
});

document.getElementById('passwordForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('pwErr');
  err.textContent = '';
  try {
    await api('/api/v1/me/password', { method: 'POST', body: JSON.stringify({
      current: document.getElementById('curPw').value,
      new: document.getElementById('newPw').value,
    }) });
    toast('密码已修改，请重新登录');
    setTimeout(() => { location.href = '/login'; }, 800);
  } catch (ex) { err.textContent = ex.message; }
});
