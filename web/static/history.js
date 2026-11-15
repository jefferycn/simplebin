// 历史页：排序 / 筛选 / 搜索 / 分页，每行可操作。
// 筛选是胶囊 + 底部选择器（同 ReceiptBin v2.1），筛选进地址栏，刷新还在。

const params = new URLSearchParams(location.search);

// 选项与默认值（地址栏带非法值时退回默认）
const OPTIONS = {
  type: [
    { v: 'all', label: '全部类型' },
    { v: 'text', label: '文本' },
    { v: 'link', label: '链接' },
    { v: 'image', label: '图片' },
    { v: 'file', label: '文件' },
  ],
  sort: [
    { v: 'newest', label: '最新优先' },
    { v: 'oldest', label: '最旧优先' },
    { v: 'size', label: '按大小' },
    { v: 'type', label: '按类型' },
  ],
};
const DEFAULTS = { type: 'all', sort: 'newest' };
const TITLES = { type: '选择类型', sort: '选择排序' };

let state = {
  q: params.get('q') || '',
  type: params.get('type') || 'all',
  sort: params.get('sort') || 'newest',
  page: 1, per_page: 50,
};
if (!OPTIONS.type.some(o => o.v === state.type)) state.type = 'all';
if (!OPTIONS.sort.some(o => o.v === state.sort)) state.sort = 'newest';
let currentItems = [];
let searchTimer = null;

const chipsEl = document.getElementById('chips');
const clearAll = document.getElementById('clearAll');
const sheet = document.getElementById('sheet');
const sheetScrim = document.getElementById('sheetScrim');
const sheetTitle = document.getElementById('sheetTitle');
const sheetOpts = document.getElementById('sheetOpts');
let openFilter = null;

initTopbar();
document.getElementById('q').value = state.q; // 搜索框按地址栏初始值回填
renderChips();
loadList();

// 点卡片菜单以外的地方，关掉所有打开的菜单。
document.addEventListener('click', e => {
  if (!e.target.closest('.row-menu')) closeAllMenus();
});

function closeAllMenus() {
  document.querySelectorAll('.menu-pop:not([hidden])').forEach(m => { m.hidden = true; });
  document.querySelectorAll('.item-row.menu-open').forEach(r => r.classList.remove('menu-open'));
}

document.getElementById('q').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    state.page = 1;
    syncURL();
    loadList();
  }, 300);
});

function labelFor(key, val) {
  const o = OPTIONS[key].find(o => o.v === val);
  return o ? o.label : OPTIONS[key][0].label;
}

function renderChips() {
  chipsEl.querySelectorAll('.fchip').forEach(chip => {
    const key = chip.dataset.filter;
    const val = state[key];
    const active = val !== DEFAULTS[key];
    chip.querySelector('.label').textContent = labelFor(key, val);
    chip.classList.toggle('active', active);
    let x = chip.querySelector('.x');
    if (active && !x) {
      x = document.createElement('span');
      x.className = 'x';
      x.textContent = '✕';
      x.addEventListener('click', e => { e.stopPropagation(); setFilter(key, DEFAULTS[key]); });
      chip.appendChild(x);
    } else if (!active && x) x.remove();
  });
  clearAll.hidden = !(state.type !== 'all' || state.sort !== 'newest');
}

function setFilter(key, val) {
  state[key] = val;
  state.page = 1;
  syncURL();
  renderChips();
  loadList();
}

// 筛选进地址栏（replaceState，不污染历史），刷新与分享都保持筛选
function syncURL() {
  const q = new URLSearchParams();
  if (state.q) q.set('q', state.q);
  if (state.type !== 'all') q.set('type', state.type);
  if (state.sort !== 'newest') q.set('sort', state.sort);
  history.replaceState(null, '', q.toString() ? '/history?' + q : '/history');
}

function openSheet(key) {
  openFilter = key;
  sheetTitle.textContent = TITLES[key];
  sheetOpts.innerHTML = OPTIONS[key].map(o =>
    '<button class="opt' + (o.v === state[key] ? ' sel' : '') + '" data-v="' + esc(o.v) + '">' +
    esc(o.label) + '<span class="tick">✓</span></button>').join('');
  sheet.classList.add('open');
  sheetScrim.classList.add('show');
}
function closeSheet() { sheet.classList.remove('open'); sheetScrim.classList.remove('show'); openFilter = null; }

chipsEl.querySelectorAll('.fchip').forEach(chip => {
  chip.addEventListener('click', () => openSheet(chip.dataset.filter));
});
sheetOpts.addEventListener('click', e => {
  const btn = e.target.closest('.opt');
  if (!btn || !openFilter) return;
  const val = btn.dataset.v;
  const key = openFilter;
  closeSheet();
  if (val !== state[key]) setFilter(key, val);
});
sheetScrim.addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
// 下滑选择器关闭
let sheetY = null;
sheet.addEventListener('touchstart', e => { sheetY = e.touches[0].clientY; }, { passive: true });
sheet.addEventListener('touchend', e => {
  if (sheetY !== null && e.changedTouches[0].clientY - sheetY > 70) closeSheet();
  sheetY = null;
}, { passive: true });
clearAll.addEventListener('click', () => {
  state.type = 'all';
  state.sort = 'newest';
  state.page = 1;
  syncURL();
  renderChips();
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
  // 超长文本的 body 不在列表里：加载时就提前取回全文存内存里，
  // 点卡片时直接同步复制，不用现取丢手势（只有超长文本才多一次请求）。
  currentItems.forEach(it => {
    if ((it.type === 'text' || it.type === 'link') && !it.body) {
      api('/api/v1/items/' + it.id).then(full => { it.body = full.body; }).catch(() => {});
    }
  });
  if (!currentItems.length) {
    listEl.innerHTML = '<p class="muted">没有符合条件的条目。</p>';
  } else {
    listEl.innerHTML = currentItems.map(rowHTML).join('');
    listEl.querySelectorAll('.item-row').forEach(row => {
      const item = currentItems.find(i => i.id === row.dataset.id);
      // 点卡片本身就是复制（文本/链接复制全文，图片/文件复制下载地址）；
      // 图片点缩略图打开查看器；点按钮不触发，详情页改走「详情」按钮。
      row.addEventListener('click', async e => {
        if (e.target.closest('button, a')) return;
        if (item.type === 'image' && e.target.closest('img.row-thumb')) {
          if (window.SimpleBinViewer) window.SimpleBinViewer.openById(item.id);
          return;
        }
        try { await copyItem(item); } catch (err) { toast(err.message); }
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
    body = '<img class="row-thumb" loading="lazy" src="/api/v1/items/' + it.id + '/blob" alt="' + esc(it.title) + '">' +
      '<p class="row-snippet">' + esc(it.filename) + ' · ' + fmtSize(it.size) + '</p>';
  } else {
    // 预览在上、文件名和大小在下，和图片卡一致
    body = '';
    if (it.snippet) body += '<p class="row-snippet">' + esc(it.snippet) + '</p>';
    body += '<p class="row-snippet">' + esc(it.filename) + ' · ' + fmtSize(it.size) + '</p>';
  }
  const from = it.shared_from_username
    ? '<div class="row-from">来自 ' + esc(it.shared_from_username) + ' 的分享</div>' : '';
  // 卡片头只放类型与时间，不放标题：文本/链接的标题就是内容开头，
  // 和下面的摘要重复，超长时还会把卡片撑得很高。
  return '<div class="item-row" data-id="' + it.id + '">' +
    '<div class="row-head"><span class="row-kind">' + typeIcon(it.type) + ' ' + typeLabel(it.type) + '</span>' +
    '<span class="row-meta">' + fmtTime(it.created_at) + '</span>' +
    '<div class="row-menu"><button class="menu-btn" data-menu-btn aria-label="更多操作">⋯</button>' +
    '<div class="menu-pop" hidden>' + menuItems(it) + '</div></div></div>' +
    body + from + '</div>';
}

// 卡片操作收进右上角 ⋯ 菜单（复制已并入卡片点击，不再单设按钮）
function menuItems(it) {
  const b = [];
  b.push('<button class="menu-item" data-act="detail">详情</button>');
  if (it.type === 'text' || it.type === 'link') {
    b.push('<button class="menu-item" data-act="edit">编辑</button>');
    if (it.type === 'link') b.push('<button class="menu-item" data-act="open">打开</button>');
  } else if (it.type === 'image') {
    b.push('<button class="menu-item" data-act="view">查看</button>');
    b.push('<button class="menu-item" data-act="download">下载</button>');
  } else {
    b.push('<button class="menu-item" data-act="download">下载</button>');
  }
  b.push('<button class="menu-item" data-act="share-link">' + (it.share_token ? '分享链接 ✓' : '分享链接') + '</button>');
  b.push('<button class="menu-item" data-act="share-user">给用户</button>');
  b.push('<button class="menu-item" data-act="fast">快取</button>');
  b.push('<button class="menu-item danger" data-act="delete">删除</button>');
  return b.join('');
}

function bindRowActions(row, item) {
  // ⋯ 按钮开关本卡菜单（一次只开一个；卡片点击处理已忽略按钮点击，不会误复制）
  const menuBtn = row.querySelector('[data-menu-btn]');
  const menuPop = row.querySelector('.menu-pop');
  menuBtn.addEventListener('click', () => {
    const wasOpen = !menuPop.hidden;
    closeAllMenus();
    if (!wasOpen) {
      menuPop.hidden = false;
      row.classList.add('menu-open'); // 提到上层，菜单不被下一张卡盖住
    }
  });
  row.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      closeAllMenus();
      try {
        switch (act) {
          case 'detail': location.href = '/item/' + item.id; break;
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
