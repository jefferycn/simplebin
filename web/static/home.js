// 首页：最新三条卡片（点按复制/查看/下载）+ 粘贴按钮。
// 手动输入文本与文件上传已移到 /new（new.js）。

let recentItems = [];

initTopbar();
refreshRecent();

async function refreshRecent() {
  const list = document.getElementById('recentList');
  let data;
  try {
    data = await api('/api/v1/items?page=1&per_page=3&sort=newest');
  } catch (e) {
    recentItems = [];
    list.innerHTML = '<p class="muted">加载失败：' + esc(e.message) + '</p>';
    return;
  }
  recentItems = data.items || [];
  // 超长文本的 body 不在列表里：加载时就提前取回全文存内存里，
  // 点卡片时直接同步复制，不用现取丢手势。
  recentItems.forEach(it => {
    if ((it.type === 'text' || it.type === 'link') && !it.body) {
      api('/api/v1/items/' + it.id).then(full => { it.body = full.body; }).catch(() => {});
    }
  });
  if (!recentItems.length) {
    list.innerHTML = '<p class="muted">还没有任何条目，点右下角的按钮粘贴第一条吧。</p>';
    return;
  }
  list.innerHTML = recentItems.map(cardHTML).join('');
  list.querySelectorAll('.latest-card').forEach(card => {
    const it = recentItems.find(i => i.id === card.dataset.id);
    card.addEventListener('click', () => onCardClick(it));
  });
}

function cardHTML(it) {
  let html = '<div class="muted">' + typeIcon(it.type) + ' ' + typeLabel(it.type) +
    ' · ' + fmtTime(it.created_at) + '</div>';
  if (it.shared_from_username) {
    html += '<div class="row-from">来自 ' + esc(it.shared_from_username) + ' 的分享</div>';
  }
  let hint = '点按复制';
  if (it.type === 'text' || it.type === 'link') {
    html += '<p class="snippet">' + esc(it.snippet || it.body || '') + '</p>';
  } else if (it.type === 'image') {
    html += '<img class="thumb" src="/api/v1/items/' + it.id + '/blob" alt="' + esc(it.title) + '">';
    hint = '点按查看';
  } else {
    html += '<p class="snippet">📎 ' + esc(it.filename) + ' · ' + fmtSize(it.size) + '</p>';
    hint = '点按下载';
  }
  html += '<div class="card-hint">' + hint + '</div>';
  return '<div class="latest-card clickable" data-id="' + it.id + '">' + html + '</div>';
}

// 点卡片：文本/链接复制全文，图片打开查看器，文件下载。
async function onCardClick(it) {
  try {
    if (it.type === 'text' || it.type === 'link') {
      await copyItem(it); // 超长文本 body 不在列表里时现取全文
    } else if (it.type === 'image') {
      if (window.SimpleBinViewer) window.SimpleBinViewer.openById(it.id);
    } else {
      location.href = '/api/v1/items/' + it.id + '/blob?download=1';
    }
  } catch (e) { toast(e.message); }
}

// 保存文本（防重复提交：一次只跑一个保存）
let saving = false;
async function saveTextContent(text) {
  if (!text.trim()) { toast('内容不能为空'); return; }
  if (saving) return;
  saving = true;
  try {
    await api('/api/v1/items', { method: 'POST', body: JSON.stringify({ text }) });
    toast('已保存');
    refreshRecent();
  } catch (e) { toast(e.message); }
  finally { saving = false; }
}

// 粘贴：直接读系统剪贴板，读到就保存。
// iOS Safari 每次读剪贴板都会弹系统确认（点“允许”），这是苹果的限制，网页绕不开；
// 桌面端授权一次后就是一次点击。读不到时提示去新建页手动粘贴。
document.getElementById('pasteSaveBtn').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) { saveTextContent(text); return; }
    toast('剪贴板里没有文本');
  } catch (e) {
    toast('读不到剪贴板，请到新建页手动粘贴');
  }
});
