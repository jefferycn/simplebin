// 首页：最新条目卡片（点按复制）+ 粘贴并保存。
// 手动输入文本与文件上传已移到 /new（new.js）。

let latest = null;

initTopbar();
refreshLatest();

async function refreshLatest() {
  const card = document.getElementById('latestCard');
  try {
    latest = await api('/api/v1/items/latest');
  } catch (e) {
    latest = null;
    card.classList.remove('clickable');
    card.innerHTML = '<p class="muted">还没有任何条目，在下方粘贴第一条吧。</p>';
    return;
  }
  let html = '<div class="muted">' + typeIcon(latest.type) + ' ' + typeLabel(latest.type) +
    ' · ' + fmtTime(latest.created_at) + '</div>';
  if (latest.shared_from_username) {
    html += '<div class="row-from">来自 ' + esc(latest.shared_from_username) + ' 的分享</div>';
  }
  let hint = '点按复制';
  if (latest.type === 'text' || latest.type === 'link') {
    html += '<p class="snippet">' + esc(latest.snippet || latest.body || '') + '</p>';
  } else if (latest.type === 'image') {
    html += '<img class="thumb" src="/api/v1/items/' + latest.id + '/blob" alt="' + esc(latest.title) + '">';
    hint = '点按查看';
  } else {
    html += '<p class="snippet">📎 ' + esc(latest.filename) + ' · ' + fmtSize(latest.size) + '</p>';
    hint = '点按下载';
  }
  html += '<div class="card-hint">' + hint + '</div>';
  card.innerHTML = html;
  card.classList.add('clickable');
}

// 点卡片：文本/链接复制全文，图片打开查看器，文件下载。
document.getElementById('latestCard').addEventListener('click', async () => {
  if (!latest) return;
  try {
    if (latest.type === 'text' || latest.type === 'link') {
      await copyItem(latest); // 超长文本 body 不在列表里时现取全文
    } else if (latest.type === 'image') {
      if (window.SimpleBinViewer) window.SimpleBinViewer.openById(latest.id);
    } else {
      location.href = '/api/v1/items/' + latest.id + '/blob?download=1';
    }
  } catch (e) { toast(e.message); }
});

// 保存文本（防重复提交：一次只跑一个保存）
let saving = false;
async function saveTextContent(text) {
  if (!text.trim()) { toast('内容不能为空'); return; }
  if (saving) return;
  saving = true;
  try {
    await api('/api/v1/items', { method: 'POST', body: JSON.stringify({ text }) });
    toast('已保存');
    refreshLatest();
  } catch (e) { toast(e.message); }
  finally { saving = false; }
}

// 粘贴并保存：直接读系统剪贴板，读到就保存。
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
