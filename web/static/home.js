// 首页：最新三条卡片 + 粘贴按钮。
// 点卡片复制（文本/链接复制全文，图片/文件复制下载链接），
// 点图片缩略图打开查看器；下载在历史页 ⋯ 菜单里。
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
    card.addEventListener('click', e => onCardClick(e, it));
  });
}

function cardHTML(it) {
  let html = '<div class="muted">' + typeIcon(it.type) + ' ' + typeLabel(it.type) +
    ' · ' + fmtTime(it.created_at) + '</div>';
  if (it.shared_from_username) {
    html += '<div class="row-from">来自 ' + esc(it.shared_from_username) + ' 的分享</div>';
  }
  if (it.type === 'text' || it.type === 'link') {
    html += '<p class="snippet">' + esc(it.snippet || it.body || '') + '</p>';
  } else if (it.type === 'image') {
    html += '<img class="thumb" src="/api/v1/items/' + it.id + '/blob" alt="' + esc(it.title) + '">';
    html += '<p class="snippet">📎 ' + esc(it.filename) + ' · ' + fmtSize(it.size) + '</p>';
  } else {
    html += '<p class="snippet">📎 ' + esc(it.filename) + ' · ' + fmtSize(it.size) + '</p>';
    if (it.snippet) html += '<p class="snippet">' + esc(it.snippet) + '</p>';
  }
  return '<div class="latest-card clickable" data-id="' + it.id + '">' + html + '</div>';
}

// 点卡片：文本/链接复制全文，图片/文件复制下载链接；
// 图片点缩略图才打开查看器（下载改走历史页 ⋯ 菜单）。
async function onCardClick(e, it) {
  try {
    if (it.type === 'image' && e.target.closest('img.thumb')) {
      if (window.SimpleBinViewer) window.SimpleBinViewer.openById(it.id);
      return;
    }
    await copyItem(it); // 超长文本 body 不在列表里时现取全文
  } catch (err) { toast(err.message); }
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
// iOS Safari 的坑：首次弹“允许粘贴”时，用户点了允许，当次 readText 照样失败，
// 授权只对后续调用生效——所以失败时自动重试一次，用户不用再点一回。
// 读不到时提示去新建页手动粘贴。
async function doPaste() {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    try {
      await new Promise(r => setTimeout(r, 120));
      text = await navigator.clipboard.readText();
    } catch (e2) {
      toast('读不到剪贴板，请到新建页手动粘贴');
      return;
    }
  }
  if (text && text.trim()) { saveTextContent(text); return; }
  toast('剪贴板里没有文本');
}

// 粘贴按钮保持普通 button + click：touchstart 里 preventDefault 会吃掉手势，
// readText 直接失败（2026-11-14 实测）。点 bin 图标弹出的 Paste/Speak 菜单
// CSS 拦不住，用户已接受，不用再折腾；粘贴面板（大窗口）试过，要点 3 次
// 还影响体验，用户明确要求取消，不要再提。
document.getElementById('pasteSaveBtn').addEventListener('click', () => doPaste());
