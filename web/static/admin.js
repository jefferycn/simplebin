// 管理页：用户列表、创建用户、禁用/启用、重置密码。

initTopbar();
loadUsers();

async function loadUsers() {
  const el = document.getElementById('userList');
  let users;
  try {
    users = await api('/api/v1/admin/users');
  } catch (e) {
    el.innerHTML = '<p class="muted">加载失败：' + esc(e.message) + '</p>';
    return;
  }
  el.innerHTML = '<table><tr><th>用户名</th><th>管理员</th><th>状态</th><th>创建</th><th></th></tr>' +
    users.map(u => '<tr><td>' + esc(u.username) + '</td><td>' + (u.is_admin ? '是' : '否') + '</td>' +
      '<td>' + (u.disabled ? '已禁用' : '正常') + '</td><td>' + fmtTime(u.created_at) + '</td>' +
      '<td><button class="mini-btn" data-reset="' + u.id + '">重置密码</button> ' +
      (u.disabled
        ? '<button class="mini-btn" data-enable="' + u.id + '">启用</button>'
        : '<button class="mini-btn danger" data-disable="' + u.id + '">禁用</button>') +
      '</td></tr>').join('') + '</table>';
  el.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => resetPasswordModal(b.dataset.reset));
  el.querySelectorAll('[data-disable]').forEach(b => b.onclick = async () => {
    try {
      await api('/api/v1/admin/users/' + b.dataset.disable + '/disable', { method: 'POST' });
      toast('已禁用');
      loadUsers();
    } catch (e) { toast(e.message); }
  });
  el.querySelectorAll('[data-enable]').forEach(b => b.onclick = async () => {
    try {
      await api('/api/v1/admin/users/' + b.dataset.enable + '/enable', { method: 'POST' });
      toast('已启用');
      loadUsers();
    } catch (e) { toast(e.message); }
  });
}

function resetPasswordModal(userId) {
  const m = openModal('<h3>重置密码</h3><p class="muted">重置后该用户需用新密码重新登录。</p>' +
    '<div class="field"><label>新密码（最短 8 位）</label><input type="password" id="mPw"></div>' +
    '<p class="err" id="mErr"></p>' +
    '<div class="btn-row"><button class="btn primary" id="mOk">重置</button>' +
    '<button class="btn" id="mCancel">取消</button></div>');
  m.querySelector('#mCancel').onclick = closeModal;
  m.querySelector('#mOk').onclick = async () => {
    const pw = m.querySelector('#mPw').value;
    try {
      await api('/api/v1/admin/users/' + userId + '/reset-password', {
        method: 'POST', body: JSON.stringify({ password: pw }),
      });
      toast('密码已重置');
      closeModal();
    } catch (e) { m.querySelector('#mErr').textContent = e.message; }
  };
}

document.getElementById('createUserForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('err');
  err.textContent = '';
  try {
    await api('/api/v1/admin/users', { method: 'POST', body: JSON.stringify({
      username: document.getElementById('newUsername').value,
      password: document.getElementById('newPassword').value,
      is_admin: document.getElementById('newIsAdmin').checked,
    }) });
    toast('用户已创建');
    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newIsAdmin').checked = false;
    loadUsers();
  } catch (ex) { err.textContent = ex.message; }
});
