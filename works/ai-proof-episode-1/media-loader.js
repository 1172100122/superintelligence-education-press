/* A complete local Blob keeps seeking independent of HTTP Range support. */
(() => {
  'use strict';
  if (location.protocol === 'file:') return;
  function prepare(video, status) {
  const source = video && video.querySelector('source');
  if (!source) return;
  const url = source.getAttribute('src');
  if (!url) return;
  video.dataset.mediaLoading = 'true';
  video.dataset.mediaFailed = 'false';
  source.removeAttribute('src');
  video.preload = 'none';
  const announce = (text) => { status.textContent = text; };
  announce('正在准备完整影片，完成后可任意拖动进度或切换章节…');
  (async () => {
    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok || !(response.headers.get('content-type') || '').includes('video/')) throw new Error('media-response');
      const total = Number(response.headers.get('content-length')) || 0;
      let blob;
      if (response.body && response.body.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          announce(total ? `正在准备影片 ${Math.min(100, Math.round(received / total * 100))}% · 完成后可自由跳转` : '正在准备完整影片，完成后可自由跳转…');
        }
        if (!received || (total && received !== total)) throw new Error('incomplete-media');
        blob = new Blob(chunks, { type: 'video/mp4' });
      } else blob = await response.blob();
      if (!blob.size) throw new Error('empty-media');
      const objectUrl = URL.createObjectURL(blob);
      video.dataset.mediaLoading = 'false';
      window.addEventListener("pagehide", (event) => {
        if (!event.persisted) URL.revokeObjectURL(objectUrl);
      });
      video.src = objectUrl;
      video.preload = 'auto';
      video.load();
      video.dispatchEvent(new Event('mediaready'));
    } catch (_) {
      video.dataset.mediaLoading = 'false';
      video.dataset.mediaFailed = 'true';
      status.classList.add('is-error');
      announce('影片下载未完成。请检查网络后刷新页面重试。');
      video.dispatchEvent(new Event('mediafailed'));
    }
  })();
  }
  prepare(document.getElementById('film'), document.getElementById('media-status'));
  const preview = document.getElementById('opening-preview');
  if (preview) prepare(preview, document.getElementById('opening-preview-status'));
})();
