// 新建页：手动输入文本、粘贴自动保存、文件上传（从首页移出）。

initTopbar();

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
  } catch (e) { toast(e.message); }
  finally { saving = false; }
}

// 保存按钮：保存输入框里的文本（手动输入/编辑时用）
document.getElementById('saveTextBtn').addEventListener('click', () => {
  saveTextContent(document.getElementById('pasteText').value);
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
