// 登录与注册页逻辑（两个页面共用一个文件，按表单 id 区分）。

const loginForm = document.getElementById('loginForm');
if (loginForm) {
  // 首次使用时显示注册入口
  api('/api/v1/status').then(s => {
    if (s.needs_setup) document.getElementById('setupHint').hidden = false;
  }).catch(() => {});
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('err');
    err.textContent = '';
    try {
      await api('/api/v1/login', { method: 'POST', body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }) });
      location.href = '/';
    } catch (ex) { err.textContent = ex.message; }
  });
}

const registerForm = document.getElementById('registerForm');
if (registerForm) {
  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('err');
    err.textContent = '';
    const pw = document.getElementById('password').value;
    if (pw !== document.getElementById('password2').value) {
      err.textContent = '两次密码不一致';
      return;
    }
    try {
      await api('/api/v1/register', { method: 'POST', body: JSON.stringify({
        username: document.getElementById('username').value,
        password: pw,
      }) });
      location.href = '/';
    } catch (ex) { err.textContent = ex.message; }
  });
}
