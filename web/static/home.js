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
// iOS Safari 的坑：首次弹“允许粘贴”时，用户点了允许，当次 readText 照样失败，
// 授权只对后续调用生效——所以失败时自动重试一次，用户不用再点一回。
// 读不到时打开粘贴面板（不用再跑去新建页手动粘贴）。
async function doPaste() {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    try {
      await new Promise(r => setTimeout(r, 120));
      text = await navigator.clipboard.readText();
    } catch (e2) {
      openPasteSheet();
      return;
    }
  }
  if (text && text.trim()) { saveTextContent(text); return; }
  toast('剪贴板里没有文本');
}

// 粘贴按钮保持普通 button + click：touchstart 里 preventDefault 会吃掉手势，
// readText 直接失败（2026-11-14 实测）。Paste/Speak 菜单 CSS 拦不住，
// 先不管它，等真机再看。
// 注意：不要先查权限、未授权就改走粘贴面板——2026-11-14 试过，面板要点
// 3 次（打开面板+长按+粘贴），比直接 readText 弹确认窗点允许（2 次）还多
// 一次，已改回直接 readText；面板只留作 readText 失败时的兜底。
document.getElementById('pasteSaveBtn').addEventListener('click', () => doPaste());

// ---------- 粘贴面板 ----------
// 用户主动粘贴（键盘上的“粘贴”按钮或长按菜单）触发的 paste 事件，
// clipboardData 直接可用，不用权限、不弹系统窗。
const pasteSheet = document.getElementById('pasteSheet');
const pasteBackdrop = document.getElementById('pasteSheetBackdrop');
const pasteInput = document.getElementById('pasteSheetInput');
function openPasteSheet() {
  pasteInput.value = '';
  pasteSheet.classList.add('open');
  pasteBackdrop.classList.add('open');
  pasteInput.focus(); // 打开键盘，剪贴板有内容时键盘栏会显示“粘贴”按钮
}
function closePasteSheet() {
  pasteSheet.classList.remove('open');
  pasteBackdrop.classList.remove('open');
  pasteInput.blur();
}
pasteBackdrop.addEventListener('click', closePasteSheet);
document.getElementById('pasteSheetCancel').addEventListener('click', closePasteSheet);
document.getElementById('pasteSheetSave').addEventListener('click', () => {
  const text = pasteInput.value;
  if (!text.trim()) { closePasteSheet(); return; }
  closePasteSheet();
  saveTextContent(text);
});
pasteInput.addEventListener('paste', e => {
  const text = e.clipboardData ? e.clipboardData.getData('text') : '';
  if (text && text.trim()) {
    e.preventDefault(); // 直接保存，不用先贴进框里再点保存
    closePasteSheet();
    saveTextContent(text);
  }
});
