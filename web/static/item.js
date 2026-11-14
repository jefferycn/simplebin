// 详情页：按类型渲染全文/图片/链接/文件，可编辑文本、可删除、可分享、可置顶。

const id = location.pathname.split('/').pop();
const wantEdit = new URLSearchParams(location.search).get('edit') === '1';
let item = null;

initTopbar();
loadItem();

async function loadItem() {
  const el = document.getElementById('detail');
  try {
    item = await api('/api/v1/items/' + id);
  } catch (e) {
    el.innerHTML = '<p class="muted">条目不存在或已被删除。</p><p><a href="/history">回历史</a></p>';
    return;
  }
  let html = '<h1>' + typeIcon(item.type) + ' ' + esc(item.title || item.id) + '</h1>';
  if (item.shared_from_username) {
    html += '<p class="muted">来自 ' + esc(item.shared_from_username) + ' 的分享</p>';
  }
  html += '<div class="kv"><div>类型：' + typeLabel(item.type) + '</div>' +
    '<div>创建时间：' + fmtTime(item.created_at) + '</div>' +
    '<div>更新时间：' + fmtTime(item.updated_at) + '</div>';
  if (item.type === 'file' || item.type === 'image') {
    html += '<div>文件：' + esc(item.filename) + ' · ' + fmtSize(item.size) + ' · ' + esc(item.mime) + '</div>';
  }
  html += '</div>';

  if (item.type === 'text' || item.type === 'link') {
    html += '<div id="viewArea"><pre class="detail-text">' + esc(item.body) + '</pre></div>';
    html += '<div id="editArea" hidden><textarea id="editText"></textarea>' +
      '<p class="btn-row"><button class="btn primary" id="saveEdit">保存</button>' +
      '<button class="btn" id="cancelEdit">取消</button></p></div>';
  } else if (item.type === 'image') {
    html += '<p><img class="detail-img" id="detailImg" src="/api/v1/items/' + item.id + '/blob" alt="' + esc(item.title) + '"></p>';
  } else {
    html += '<p>📎 ' + esc(item.filename) + ' · ' + fmtSize(item.size) + '</p>';
  }

  html += '<div class="btn-row" style="margin-top:16px">';
  if (item.type === 'text' || item.type === 'link') {
    html += '<button class="btn primary" id="copyBtn">复制</button>';
    html += '<button class="btn" id="editBtn">编辑</button>';
    if (item.type === 'link') html += '<button class="btn" id="openBtn">打开链接</button>';
  } else if (item.type === 'image') {
    html += '<button class="btn primary" id="viewBtn">查看</button>';
    html += '<button class="btn" id="dlBtn">下载</button>';
  } else {
    html += '<button class="btn primary" id="dlBtn">下载</button>';
  }
  html += '<button class="btn" id="shareLinkBtn">' + (item.share_token ? '分享链接 ✓' : '分享链接') + '</button>' +
    '<button class="btn" id="shareUserBtn">分享给用户</button>' +
    '<button class="btn" id="fastBtn">置顶到 Fast</button>' +
    '<button class="btn danger" id="delBtn">删除</button></div>';
  el.innerHTML = html;

  const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };
  on('#copyBtn', () => copyItem(item));
  on('#openBtn', () => window.open(item.body, '_blank', 'noopener'));
  on('#dlBtn', () => { location.href = '/api/v1/items/' + item.id + '/blob?download=1'; });
  on('#viewBtn', () => window.SimpleBinViewer && window.SimpleBinViewer.openById(item.id));
  on('#shareLinkBtn', () => shareLinkModal(item, loadItem));
  on('#shareUserBtn', () => shareToUserModal(item));
  on('#fastBtn', () => fastPinModal(item));
  on('#delBtn', () => deleteItem(item.id, item.title, () => { location.href = '/history'; }));

  const img = el.querySelector('#detailImg');
  if (img) img.addEventListener('click', () => window.SimpleBinViewer && window.SimpleBinViewer.openById(item.id));

  // 文本编辑：原地修改
  on('#editBtn', () => {
    el.querySelector('#viewArea').hidden = true;
    el.querySelector('#editArea').hidden = false;
    el.querySelector('#editText').value = item.body;
    el.querySelector('#editText').focus();
  });
  on('#cancelEdit', () => {
    el.querySelector('#viewArea').hidden = false;
    el.querySelector('#editArea').hidden = true;
  });
  on('#saveEdit', async () => {
    const text = el.querySelector('#editText').value;
    if (!text.trim()) { toast('内容不能为空'); return; }
    try {
      await api('/api/v1/items/' + item.id, { method: 'PUT', body: JSON.stringify({ text }) });
      toast('已保存');
      loadItem();
    } catch (e) { toast(e.message); }
  });

  if (wantEdit && (item.type === 'text' || item.type === 'link')) {
    el.querySelector('#editBtn').click();
  }
}
