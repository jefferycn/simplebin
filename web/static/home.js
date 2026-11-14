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

// 保存文本
document.getElementById('saveTextBtn').addEventListener('click', saveText);
async function saveText() {
  const ta = document.getElementById('pasteText');
  const text = ta.value;
  if (!text.trim()) { toast('内容不能为空'); return; }
  try {
    await api('/api/v1/items', { method: 'POST', body: JSON.stringify({ text }) });
    ta.value = '';
    toast('已保存');
    refreshLatest();
  } catch (e) { toast(e.message); }
}

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
