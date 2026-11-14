// 首页：只做两件事——复制最新、粘贴。

let latest = null;

initTopbar();
refreshLatest();

async function refreshLatest() {
  const card = document.getElementById('latestCard');
  try {
    latest = await api('/api/v1/items/latest');
  } catch (e) {
    latest = null;
    card.innerHTML = '<p class="muted">还没有任何条目，在下方粘贴第一条吧。</p>';
    return;
  }
  let html = '<div class="muted">' + typeIcon(latest.type) + ' ' + typeLabel(latest.type) +
    ' · ' + fmtTime(latest.created_at) + '</div>';
  if (latest.shared_from_username) {
    html += '<div class="row-from">来自 ' + esc(latest.shared_from_username) + ' 的分享</div>';
  }
  if (latest.type === 'text' || latest.type === 'link') {
    html += '<p class="snippet">' + esc(latest.snippet || latest.body || '') + '</p>';
  } else if (latest.type === 'image') {
    html += '<img class="thumb" src="/api/v1/items/' + latest.id + '/blob" alt="' + esc(latest.title) + '">';
  } else {
    html += '<p class="snippet">📎 ' + esc(latest.filename) + ' · ' + fmtSize(latest.size) + '</p>';
  }
  card.innerHTML = html;
  const img = card.querySelector('img.thumb');
  if (img) img.addEventListener('click', () => window.SimpleBinViewer && window.SimpleBinViewer.openById(latest.id));
}

document.getElementById('copyLatestBtn').addEventListener('click', async () => {
  if (!latest) { toast('还没有任何条目'); return; }
  try {
    if (latest.type === 'text' || latest.type === 'link') {
      await copyText(latest.body);
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
    const ta = document.getElementById('pasteText');
    if (ta.value === text) ta.value = '';
    toast('已保存');
    refreshLatest();
  } catch (e) { toast(e.message); }
  finally { saving = false; }
}

// 保存按钮：保存输入框里的文本（手动输入/编辑时用）
document.getElementById('saveTextBtn').addEventListener('click', () => {
  saveTextContent(document.getElementById('pasteText').value);
});

// 粘贴并保存：直接读系统剪贴板，读到就保存。
// iOS Safari 每次读剪贴板都会弹系统确认（点“允许”），这是苹果的限制，网页绕不开；
// 桌面端授权一次后就是一次点击。读不到时退回手动粘贴（粘贴后自动保存）。
document.getElementById('pasteSaveBtn').addEventListener('click', async () => {
  const ta = document.getElementById('pasteText');
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) { saveTextContent(text); return; }
    toast('剪贴板里没有文本');
    ta.focus();
  } catch (e) {
    ta.focus();
    toast('请在输入框里粘贴，粘贴后自动保存');
  }
});

// 输入框里手动粘贴文本：粘贴后自动保存，不用再点保存。
// 只在输入框原本为空时自动保存；框里已有内容时是编辑，不自动存。
document.getElementById('pasteText').addEventListener('paste', e => {
  const ta = e.target;
  const files = e.clipboardData && e.clipboardData.files;
  if (files && files.length) return; // 图片走全局粘贴上传
  if (ta.value !== '') return;
  setTimeout(() => { if (ta.value.trim()) saveTextContent(ta.value); }, 100);
});

// 上传文件（拖拽、选择、粘贴图片共用）
async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file, file.name || 'pasted-image.png');
  try {
    await apiUpload('/api/v1/items', fd);
    toast('已上传 ' + (file.name || '图片'));
    refreshLatest();
  } catch (e) { toast(e.message); }
}

// 拖拽上传
const dz = document.getElementById('dropzone');
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => {
  e.preventDefault();
  dz.classList.add('over');
}));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => {
  e.preventDefault();
  dz.classList.remove('over');
}));
dz.addEventListener('drop', e => {
  const files = e.dataTransfer.files;
  if (files.length) uploadFile(files[0]);
});

// 选择文件上传
document.getElementById('fileInput').addEventListener('change', e => {
  if (e.target.files.length) uploadFile(e.target.files[0]);
  e.target.value = '';
});

// 页面内粘贴图片（Ctrl+V / ⌘V）：剪贴板里有文件时当文件上传
document.addEventListener('paste', e => {
  const files = e.clipboardData && e.clipboardData.files;
  if (files && files.length) {
    e.preventDefault();
    uploadFile(files[0]);
  }
});
