// 历史页：排序 / 筛选 / 搜索 / 分页。
// 筛选是胶囊 + 底部选择器（同 ReceiptBin v2.1），筛选进地址栏，刷新还在。
// 点标题行（类型 + 时间）进详情页，编辑、下载、分享等操作都在详情页；
// 点其他处复制；批量删除不弹确认框。

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

// 批量删除：进入选择模式后点卡片切换选中，底部栏删除所选。
let selecting = false;
const selected = new Set();

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
  // 只处理带 data-filter 的筛选胶囊，批量删除按钮也在 chips 行里但不是筛选
  chipsEl.querySelectorAll('.fchip[data-filter]').forEach(chip => {
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

chipsEl.querySelectorAll('.fchip[data-filter]').forEach(chip => {
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
      // 选择模式下点卡片切换选中；否则点标题行进详情页，
      // 点卡片其他处复制（文本/链接复制全文，图片/文件复制下载地址）；
      // 图片点缩略图打开查看器。
      row.addEventListener('click', async e => {
        if (selecting) { toggleSelect(item, row); return; }
        if (e.target.closest('.row-title')) { location.href = '/item/' + item.id; return; }
        if (item.type === 'image' && e.target.closest('img.row-thumb')) {
          if (window.SimpleBinViewer) window.SimpleBinViewer.openById(item.id);
          return;
        }
        try { await copyItem(item); } catch (err) { toast(err.message); }
      });
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
  return '<div class="item-row' + (selected.has(it.id) ? ' selected' : '') + '" data-id="' + it.id + '">' +
    '<div class="row-head"><input type="checkbox" class="row-check" tabindex="-1"' +
    (selecting && selected.has(it.id) ? ' checked' : '') + '>' +
    '<span class="row-kind row-title">' + typeIcon(it.type) + ' ' + typeLabel(it.type) + '</span>' +
    '<span class="row-meta row-title">' + fmtTime(it.created_at) + '</span></div>' +
    body + from + '</div>';
}

// ---------- 批量删除 ----------
// 勾选框只做显示（pointer-events:none），点卡片切换选中，
// 避免勾选框与卡片点击各管各的、双重切换。
function updateBatchBar() {
  const del = document.getElementById('batchDelete');
  del.textContent = '删除选中（' + selected.size + '）';
  del.disabled = selected.size === 0;
}

function enterSelectMode() {
  selecting = true;
  document.getElementById('list').classList.add('selecting');
  document.getElementById('batchBar').classList.add('show');
  const btn = document.getElementById('batchBtn');
  btn.textContent = '取消';
  btn.classList.add('active');
  updateBatchBar();
}

function exitSelectMode() {
  selecting = false;
  selected.clear();
  document.getElementById('list').classList.remove('selecting');
  document.getElementById('batchBar').classList.remove('show');
  const btn = document.getElementById('batchBtn');
  btn.textContent = '批量删除';
  btn.classList.remove('active');
}

function toggleSelect(item, row) {
  if (selected.has(item.id)) selected.delete(item.id);
  else selected.add(item.id);
  const cb = row.querySelector('.row-check');
  if (cb) cb.checked = selected.has(item.id);
  row.classList.toggle('selected', selected.has(item.id));
  updateBatchBar();
}

// 全选只针对当前页；已全选时再点一次取消本页全选。
function selectAllPage() {
  const allSelected = currentItems.length > 0 && currentItems.every(it => selected.has(it.id));
  currentItems.forEach(it => { if (allSelected) selected.delete(it.id); else selected.add(it.id); });
  document.querySelectorAll('#list .item-row').forEach(row => {
    const cb = row.querySelector('.row-check');
    if (cb) cb.checked = selected.has(row.dataset.id);
    row.classList.toggle('selected', selected.has(row.dataset.id));
  });
  updateBatchBar();
}

async function deleteSelected() {
  if (!selected.size) return;
  let d;
  try {
    d = await api('/api/v1/items', { method: 'DELETE', body: JSON.stringify({ ids: [...selected] }) });
  } catch (e) { toast(e.message); return; }
  toast('已删除 ' + d.deleted + ' 条');
  exitSelectMode();
  loadList();
}

document.getElementById('batchBtn').addEventListener('click', () => {
  if (selecting) exitSelectMode(); else enterSelectMode();
});
document.getElementById('batchAll').addEventListener('click', selectAllPage);
document.getElementById('batchDelete').addEventListener('click', deleteSelected);
document.getElementById('batchCancel').addEventListener('click', exitSelectMode);

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
