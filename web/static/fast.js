// 公开页（/fast 与 /s）：复制按钮、倒计时、文件大小格式化。

// 复制按钮：文本取 <pre> 全文，链接取 href。
const copyBtn = document.getElementById('copyBtn');
if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    const el = document.getElementById('content');
    const text = el.tagName === 'A' ? el.href : el.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    copyBtn.textContent = '已复制 ✓';
    setTimeout(() => { copyBtn.textContent = copyBtn.dataset.label || '复制'; }, 2000);
  });
  copyBtn.dataset.label = copyBtn.textContent;
}

// 倒计时：/fast 页显示剩余时间，到期后刷新成 404。
const cd = document.getElementById('countdown');
if (cd && cd.dataset.expires) {
  const expires = new Date(cd.dataset.expires).getTime();
  const tick = () => {
    const left = Math.max(0, Math.floor((expires - Date.now()) / 1000));
    const m = Math.floor(left / 60);
    const s = left % 60;
    cd.textContent = '剩余 ' + m + ':' + String(s).padStart(2, '0');
    if (left <= 0) location.reload();
  };
  tick();
  setInterval(tick, 1000);
}

// 文件大小格式化
document.querySelectorAll('[data-size]').forEach(el => {
  const n = Number(el.dataset.size);
  el.textContent = n < 1024 ? n + ' B' : n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
});
