// 历史页：排序 / 筛选 / 搜索 / 分页，每行可操作。

let state = { q: '', type: 'all', sort: 'newest', page: 1, per_page: 50 };
let currentItems = [];
let searchTimer = null;

initTopbar();
loadList();

document.getElementById('q').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    state.page = 1;
    loadList();
  }, 300);
});
document.getElementById('typeFilter').addEventListener('change', e => {
  state.type = e.target.value;
  state.page = 1;
  loadList();
});
document.getElementById('sortSelect').addEventListener('change', e => {
  state.sort = e.target.value;
  state.page = 1;
  loadList();
});

async function loadList() {
  const listEl = document.getElementById('list');
  const params = new URLSearchParams({
    q: state.q, type: state.type, sort: state.sort,
    page: state.page, per_page: state.per_page,
  });
  let data;
  try {
    data = await api('/api/v1/items?' + params.toString());
  } catch (e) {
    listEl.innerHTML = '<p class="muted">加载失败：' + esc(e.message) + '</p>';
    return;
  }
  currentItems = data.items || [];
  if (!currentItems.length) {
    listEl.innerHTML = '<p class="muted">没有符合条件的条目。</p>';
  } else {
    listEl.innerHTML = currentItems.map(rowHTML).join('');
    listEl.querySelectorAll('.item-row').forEach(row => {
      const item = currentItems.find(i => i.id === row.dataset.id);
      row.addEventListener('click', e => {
        if (e.target.closest('button, a')) return; // 点按钮不跳转
        location.href = '/item/' + item.id;
      });
      bindRowActions(row, item);
    });
  }
  renderPager(data.total);
  document.getElementById('stats').textContent =
    '共 ' + data.total + ' 条 · 总占用 ' + fmtSize(data.total_size || 0);
}

function rowHTML(it) {
  let body = '';
  if (it.type === 'text' || it.type === 'link') {
    body = '<p class="row-snippet">' + esc(it.snippet || '') + '</p>';
  } else if (it.type === 'image') {
    body = '<img class="row-thumb" loading="lazy" src="/api/v1/items/' + it.id + '/blob" alt="' + esc(it.title) + '">';
  } else {
    body = '<p class="row-snippet">📎 ' + esc(it.filename) + ' · ' + fmtSize(it.size) + '</p>';
  }
  const from = it.shared_from_username
    ? '<div class="row-from">来自 ' + esc(it.shared_from_username) + ' 的分享</div>' : '';
  const actions = actionButtons(it);
  return '<div class="item-row" data-id="' + it.id + '">' +
    '<div class="row-head"><span class="row-title">' + typeIcon(it.type) + ' ' + esc(it.title || it.id) + '</span>' +
    '<span class="row-meta">' + fmtTime(it.created_at) + '</span></div>' +
    body + from +
    '<div class="row-actions">' + actions + '</div></div>';
}

// 按类型显示相关操作按钮
function actionButtons(it) {
  const b = [];
  if (it.type === 'text' || it.type === 'link') {
    b.push('<button class="mini-btn" data-act="copy">复制</button>');
    b.push('<button class="mini-btn" data-act="edit">编辑</button>');
    if (it.type === 'link') b.push('<button class="mini-btn" data-act="open">打开</button>');
  } else if (it.type === 'image') {
    b.push('<button class="mini-btn" data-act="view">查看</button>');
    b.push('<button class="mini-btn" data-act="download">下载</button>');
  } else {
    b.push('<button class="mini-btn" data-act="download">下载</button>');
  }
  b.push('<button class="mini-btn" data-act="share-link">' + (it.share_token ? '分享链接 ✓' : '分享链接') + '</button>');
  b.push('<button class="mini-btn" data-act="share-user">给用户</button>');
  b.push('<button class="mini-btn" data-act="fast">快取</button>');
  b.push('<button class="mini-btn danger" data-act="delete">删除</button>');
  return b.join('');
}

function bindRowActions(row, item) {
  row.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      try {
        switch (act) {
          case 'copy': await copyItem(item); break;
          case 'edit': location.href = '/item/' + item.id + '?edit=1'; break;
          case 'open': {
            const full = await api('/api/v1/items/' + item.id);
            window.open(full.body, '_blank', 'noopener');
            break;
          }
          case 'view':
            if (window.SimpleBinViewer) window.SimpleBinViewer.openById(item.id);
            break;
          case 'download':
            location.href = '/api/v1/items/' + item.id + '/blob?download=1';
            break;
          case 'share-link': shareLinkModal(item, loadList); break;
          case 'share-user': shareToUserModal(item); break;
          case 'fast': fastPinModal(item); break;
          case 'delete': deleteItem(item.id, item.title, loadList); break;
        }
      } catch (e) { toast(e.message); }
    });
  });
}

function renderPager(total) {
  const pager = document.getElementById('pager');
  const pages = Math.max(1, Math.ceil(total / state.per_page));
  let html = '';
  if (state.page > 1) html += '<button class="btn" id="prevPage">上一页</button>';
  html += '<span class="muted">第 ' + state.page + ' / ' + pages + ' 页</span>';
  if (state.page < pages) html += '<button class="btn" id="nextPage">下一页</button>';
  pager.innerHTML = html;
  const prev = document.getElementById('prevPage');
  const next = document.getElementById('nextPage');
  if (prev) prev.onclick = () => { state.page--; loadList(); window.scrollTo(0, 0); };
  if (next) next.onclick = () => { state.page++; loadList(); window.scrollTo(0, 0); };
}
