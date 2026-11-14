// 图片查看器：PhotoSwipe 5 + photo-culler 验证过的手势层。
// 手势：左右滑切换图片，下滑关闭，捏合缩放；上滑无动作。
// 上滑保存是 photo-culler 专属的，SimpleBin 没有收藏语义，已去掉。

import PhotoSwipeLightbox from './vendor/photoswipe-lightbox.esm.js';

const lightbox = new PhotoSwipeLightbox({
  pswpModule: () => import('./vendor/photoswipe.esm.js'),
  preload: [2, 3],
  bgOpacity: 1,
  showHideAnimationType: 'fade',
  zoom: true,
  loop: false, // 看到最后一张就停，不循环回开头
  spacing: 0.06, // 左右滑时下一张跟得更紧（默认 0.1）
  closeOnVerticalDrag: false, // 竖直手势自己接管：下滑关闭
});

let progressEl = null, progressFill = null, progressLabel = null;
let viewerOpen = false;
let viewerImages = []; // 打开那一刻的图片快照：看的过程中列表可能变，索引以快照为准

function viewerZoomed() {
  const pswp = lightbox.pswp;
  return !!(pswp && pswp.currSlide && pswp.currSlide.currZoomLevel > 1);
}

// 底部进度条：第几张 / 共几张
function buildViewerOverlay() {
  progressEl = document.createElement('div');
  progressEl.className = 'viewer-progress';
  progressEl.innerHTML = '<div class="vp-track"><div class="vp-fill"></div></div>' +
    '<span class="vp-label"></span>';
  lightbox.pswp.element.appendChild(progressEl);
  progressFill = progressEl.querySelector('.vp-fill');
  progressLabel = progressEl.querySelector('.vp-label');
}

function syncViewerOverlay() {
  const pswp = lightbox.pswp;
  if (!pswp || !progressEl) return;
  const total = viewerImages.length;
  const idx = pswp.currIndex;
  progressFill.style.width = total ? `${((idx + 1) / total) * 100}%` : '0%';
  progressLabel.textContent = total ? `${idx + 1} / ${total}` : '';
}

// ---------- 竖直手势（改写自 photo-culler） ----------
// 下滑关闭：图片跟手指下移（0.6 阻尼），松手即关。
// 双指放大（捏合）不参与手势：第二根手指落下就取消竖直拖动，
// 一根手指抬起也不算手势结束——捏合时抬起一根手指，dy 会误触发关闭。
// 背景透明度绝对不能碰：.pswp__bg 的 CSS 默认 opacity 是 0.005，全靠
// PhotoSwipe 的 applyBgOpacity() 用内联样式维持不透明；直接改
// pswp.bg.style.opacity 再清掉，内联样式一丢背景就变透明，
// 之后每次左右滑列表页都会从背后透出来。所以下滑时只动图片，背景交给 PhotoSwipe 自己管。
let vTouch = null; // { x, y, axis, samples: [{t, y}] }（samples 用来算松手速度）
let viewerPinching = false;
let viewerResetTimer = null;
let viewerCloseTimer = null;

function resetViewerDrag() {
  // 没过线弹回原位：带一点回弹的弹簧曲线，别生硬
  const pswp = lightbox.pswp;
  if (!pswp) return;
  clearTimeout(viewerResetTimer);
  const wrap = pswp.scrollWrap;
  if (wrap) {
    wrap.style.transition = 'transform .35s cubic-bezier(.2,.9,.3,1.15), opacity .3s ease';
    wrap.style.transform = '';
    wrap.style.opacity = '';
    viewerResetTimer = setTimeout(() => { if (wrap) wrap.style.transition = ''; }, 380);
  }
  if (progressEl) { progressEl.style.transition = 'opacity .3s ease'; progressEl.style.opacity = ''; }
}

function resetViewerDragInstant() {
  const pswp = lightbox.pswp;
  if (!pswp) return;
  clearTimeout(viewerResetTimer);
  const wrap = pswp.scrollWrap;
  if (wrap) { wrap.style.transition = 'none'; wrap.style.transform = ''; wrap.style.opacity = ''; }
  if (progressEl) { progressEl.style.transition = 'none'; progressEl.style.opacity = ''; }
}

function touchVelocityY() {
  // 松手前 100ms 内的平均速度（px/ms），用来判定“甩一下也关”
  if (!vTouch || vTouch.samples.length < 2) return 0;
  const s = vTouch.samples;
  const dt = s[s.length - 1].t - s[0].t;
  if (dt <= 0) return 0;
  return (s[s.length - 1].y - s[0].y) / dt;
}

function onViewerTouchStart(e) {
  if (e.touches.length > 1) {
    viewerPinching = true;
    vTouch = null;
    resetViewerDragInstant();
    return;
  }
  clearTimeout(viewerResetTimer);
  const t = e.changedTouches[0];
  vTouch = { x: t.clientX, y: t.clientY, axis: null, samples: [{ t: e.timeStamp, y: t.clientY }] };
}

function onViewerTouchMove(e) {
  const pswp = lightbox.pswp;
  if (!vTouch || !pswp || viewerPinching) return;
  if (e.touches.length !== 1) { // 第二根手指落下：捏合开始，取消竖直拖动
    viewerPinching = true;
    vTouch = null;
    resetViewerDragInstant();
    return;
  }
  if (viewerZoomed()) return; // 放大看细节时竖直拖动是平移图片，PhotoSwipe 自己处理
  const t = e.changedTouches[0];
  const dx = t.clientX - vTouch.x;
  const dy = t.clientY - vTouch.y;
  vTouch.samples.push({ t: e.timeStamp, y: t.clientY });
  while (vTouch.samples.length > 1 && e.timeStamp - vTouch.samples[0].t > 100) vTouch.samples.shift();
  if (!vTouch.axis) {
    // 方向判定要够严：斜着滑时先别定方向，等一方明显占优再定
    if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx) * 1.5) vTouch.axis = 'y';
    else if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.5) vTouch.axis = 'x';
    else return;
  }
  if (vTouch.axis === 'y' && Math.abs(dx) > Math.abs(dy) * 1.5) {
    // 竖直拖着拖着转成横向了：立刻把图片恢复干净，交给 PhotoSwipe 横滑
    vTouch.axis = 'x';
    resetViewerDragInstant();
    return;
  }
  if (vTouch.axis !== 'y') return;
  if (dy > 0) {
    // 下滑关闭：图片跟手下移（背景不动），同时微微缩小、淡出；
    // 拉过 160px 后阻尼加大，越拉越费劲
    const wrap = pswp.scrollWrap;
    const eff = dy <= 160 ? dy * 0.6 : 160 * 0.6 + (dy - 160) * 0.3;
    const k = Math.min(1, dy / 160);
    wrap.style.transition = 'none';
    wrap.style.transform = `translateY(${eff}px) scale(${1 - 0.15 * k})`;
    wrap.style.opacity = String(1 - 0.16 * k);
    if (progressEl) progressEl.style.opacity = String(1 - 0.16 * k);
  }
  // 上滑无动作：图片不动，松手弹回
}

function onViewerTouchEnd(e) {
  const pswp = lightbox.pswp;
  if (e.touches.length > 0) return; // 还有手指没抬起（比如捏合时先抬一根），不算结束
  if (viewerPinching) {
    viewerPinching = false;
    vTouch = null;
    resetViewerDragInstant();
    return;
  }
  if (!vTouch) return;
  const t = e.changedTouches[0];
  const dy = t.clientY - vTouch.y;
  const axis = vTouch.axis;
  const vy = touchVelocityY(); // 先算速度：下面就把 vTouch 清掉了
  vTouch = null;
  if (!pswp) return;
  const zoomed = viewerZoomed();
  if (!zoomed && axis === 'y' && dy > 0 && (dy > 90 || (vy > 0.65 && dy > 28))) {
    // 下滑关闭：按松手速度继续下滑、缩小、淡出再关，不直接切
    const wrap = pswp.scrollWrap;
    const eff = dy <= 160 ? dy * 0.6 : 160 * 0.6 + (dy - 160) * 0.3;
    const extra = Math.min(vy * 180, 260);
    const dur = vy > 1 ? 0.18 : 0.28;
    wrap.style.transition = `transform ${dur}s cubic-bezier(.5,0,.8,.4), opacity ${dur}s ease`;
    wrap.style.transform = `translateY(${eff + extra}px) scale(0.8)`;
    wrap.style.opacity = '0';
    if (progressEl) {
      progressEl.style.transition = `opacity ${dur}s ease`;
      progressEl.style.opacity = '0';
    }
    clearTimeout(viewerCloseTimer);
    viewerCloseTimer = setTimeout(() => { if (viewerOpen && lightbox.pswp) lightbox.pswp.close(); }, dur * 1000);
    return;
  }
  // 其他情况：弹回原位
  resetViewerDrag();
}

lightbox.on('afterInit', () => {
  // PhotoSwipe 核心没有 'open' 事件，afterInit 是初始化完成后的一刻，
  // 此时看图器根元素已在页面上，可以挂自己的进度条和手势监听
  viewerOpen = true;
  buildViewerOverlay();
  syncViewerOverlay();
  const el = lightbox.pswp.element;
  el.addEventListener('touchstart', onViewerTouchStart, { passive: true });
  el.addEventListener('touchmove', onViewerTouchMove, { passive: true });
  el.addEventListener('touchend', onViewerTouchEnd, { passive: true });
  // 下滑关闭进行时，PhotoSwipe 别跟着横移：竖直手势是自己接管的，
  // 但 PhotoSwipe 不知道——closeOnVerticalDrag 关掉后，竖直拖动也会让主滚动
  // 跟着横向位移（fit 缩放下图片不可平移，任何 x 位移都直接推主滚动），
  // 所以竖直滑时手指一斜图片就左右晃。
  // 锁的时机不能等自己的锁轴（16px + 1.5 倍）：那样 PhotoSwipe 在锁轴前已经
  // 把图片推偏了十几 px，而且 pointermove 比 touchmove 先到，每 tick 还要再
  // 慢一拍。直接用这次移动自己的坐标判断：竖直占优就拦，零延迟；
  // 8px 是为了抢在 PhotoSwipe 自己的 10px 轴判定之前。
  // 一旦转成横向立刻放开，左右滑不受影响；放大平移、捏合也不锁。
  lightbox.pswp.on('pointerMove', (e) => {
    if (!vTouch || viewerPinching || viewerZoomed()) return;
    const ev = e.originalEvent;
    if (!ev) return;
    const t = ev.touches ? ev.touches[0] : ev;
    if (!t || t.clientX === undefined) return;
    const dx = t.clientX - vTouch.x;
    const dy = t.clientY - vTouch.y;
    if (Math.abs(dy) >= 8 && Math.abs(dy) > Math.abs(dx) * 1.5) e.preventDefault();
  });
});
lightbox.on('change', () => {
  syncViewerOverlay();
});
lightbox.on('close', () => {
  viewerOpen = false;
  const el = lightbox.pswp.element;
  el.removeEventListener('touchstart', onViewerTouchStart);
  el.removeEventListener('touchmove', onViewerTouchMove);
  el.removeEventListener('touchend', onViewerTouchEnd);
  vTouch = null;
  viewerPinching = false;
  clearTimeout(viewerResetTimer);
  clearTimeout(viewerCloseTimer);
  if (progressEl) progressEl.remove();
  progressEl = null;
  progressFill = null;
  progressLabel = null;
});
lightbox.init();

// ---------- 对外接口 ----------
// openById(id)：打开查看器，左右滑遍历当前用户的图片条目（最多 200 张，最新优先）。
async function openById(id) {
  const data = await api('/api/v1/items?type=image&per_page=200&sort=newest');
  const images = data.items || [];
  const index = images.findIndex(i => i.id === id);
  if (index < 0) return;
  viewerImages = images;
  const slides = images.map(p => {
    // 宽高来自服务端，比例一定对；读不出来的不给宽高，让 PhotoSwipe 按原图实测，不猜
    const slide = {
      src: '/api/v1/items/' + p.id + '/blob',
      alt: p.title || p.id,
    };
    if (p.width && p.height) {
      slide.width = p.width;
      slide.height = p.height;
    }
    return slide;
  });
  lightbox.loadAndOpen(index, slides);
  syncViewerOverlay();
}

window.SimpleBinViewer = { openById };
