'use strict';
(function (root) {
  const clock = value => {
    let seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    return `${hours ? `${hours}:` : ''}${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  function normalizeManifest(raw, manifestURL) {
    if (!raw || !Number.isFinite(raw.duration) || raw.duration <= 0 || !Array.isArray(raw.chapters) || !raw.chapters.length) throw new Error('Invalid film manifest');
    const asset = (path, required = false) => {
      if (!path) { if (required) throw new Error('Missing video asset'); return null; }
      const url = new URL(path, manifestURL);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported asset URL');
      return url.href;
    };
    const chapters = raw.chapters.map((chapter, index) => {
      if (!chapter || typeof chapter.title !== 'string' || !chapter.title.trim() || !Number.isFinite(chapter.start) || !Number.isFinite(chapter.end) || chapter.start < 0 || chapter.end <= chapter.start || chapter.end > raw.duration + 0.25) throw new Error(`Invalid chapter ${index + 1}`);
      if (index === 0 && chapter.start !== 0 || index && Math.abs(chapter.start - raw.chapters[index - 1].end) > 0.1) throw new Error('Chapter times must be contiguous');
      return { id: String(chapter.id || index + 1), title: chapter.title, start: chapter.start, end: chapter.end, summary: typeof chapter.summary === 'string' ? chapter.summary : '' };
    });
    if (Math.abs(chapters[chapters.length - 1].end - raw.duration) > 0.25) throw new Error('Chapters must cover the whole film');
    return { title: typeof raw.title === 'string' ? raw.title : '差一点，还是等于？', duration: raw.duration, video: asset(raw.video, true), poster: asset(raw.poster), captions: asset(raw.captions), transcript: asset(raw.transcript), chapters };
  }
  const chapterAt = (time, chapters) => chapters.reduce((found, chapter, index) => time >= chapter.start ? index : found, 0);
  function createController(video, chapters, notify = () => {}, options = {}) {
    if (!chapters || !chapters.length) throw new Error('Chapters are required');
    const timeoutMs = options.timeoutMs || 12000;
    let ready = false, pending = null, replay = null, intent = false, epoch = 0, timer;
    let replayStopped = false, ignoredPauses = 0, destroyed = false;
    let message = '正在准备完整视频，加载后可自由前后跳转。';
    const listeners = [];
    const on = (event, fn) => { video.addEventListener(event, fn); listeners.push([event, fn]); };
    const currentChapter = () => replayStopped && replay !== null ? replay : chapterAt(video.currentTime || 0, chapters);
    const selected = () => pending ? pending.index : currentChapter();
    const snapshot = () => ({ ready, pending: pending && pending.index, chapter: currentChapter(), selected: selected(), replay, replayStopped, intent, message });
    const emit = () => { if (!destroyed) notify(snapshot()); };
    function pause() {
      // Browsers queue pause events. Ignore only events caused by this controller.
      if (!video.paused) ++ignoredPauses;
      video.pause();
    }
    function cancelSeek() { clearTimeout(timer); pending = null; ++epoch; }
    async function play() {
      if (!ready || pending || destroyed) return;
      const token = epoch;
      try { await video.play(); }
      catch (error) {
        if (token !== epoch || destroyed) return;
        intent = false;
        message = '视频已准备好。浏览器未能开始播放，请点“继续播放”或视频播放按钮开启声音。';
        emit();
      }
    }
    function confirm() {
      if (!pending || video.seeking || video.readyState < 2 || Math.abs(video.currentTime - pending.target) > 0.15) return false;
      const index = pending.index;
      clearTimeout(timer); pending = null;
      message = replay !== null ? `重播“${chapters[index].title}”，到幕末暂停。` : `已定位到“${chapters[index].title}”。${intent ? '连续播放中。' : '保持暂停。'}`;
      emit();
      if (intent) play();
      return true;
    }
    function applySeek() {
      if (!ready || !pending || pending.applied || video.readyState < 1) return;
      try {
        const request = pending;
        video.currentTime = request.target;
        request.applied = true;
        confirm();
      } catch (error) { message = '正在等待视频数据，以完成章节跳转…'; emit(); }
    }
    function armTimeout() {
      clearTimeout(timer);
      const request = pending;
      timer = setTimeout(() => {
        if (request !== pending || !pending) return;
        cancelSeek(); intent = false; replay = null; replayStopped = false; pause();
        message = '这次跳转未完成。请重新选择章节，或用下方链接打开原始视频。'; emit();
      }, timeoutMs);
    }
    function seek(index, replayOnly = false) {
      if (!Number.isFinite(index)) return;
      index = Math.max(0, Math.min(chapters.length - 1, Math.floor(index)));
      cancelSeek();
      replay = replayOnly ? index : null;
      replayStopped = false;
      if (replayOnly) intent = true;
      else if (ready) intent = !video.paused && !video.ended || intent;
      pause();
      pending = { index, target: chapters[index].start };
      message = ready ? `正在跳转到“${chapters[index].title}”…` : `正在加载视频，随后跳转到“${chapters[index].title}”…`;
      if (ready) armTimeout();
      emit(); applySeek();
    }
    function setReady(value) {
      ready = value;
      if (!value) { pause(); emit(); return; }
      if (pending) { armTimeout(); applySeek(); }
      else { message = '完整视频已准备好。默认连续播放，也可跳转或重播本幕。'; if (intent) play(); }
      emit();
    }
    function fail(text) { ready = false; cancelSeek(); replay = null; replayStopped = false; intent = false; pause(); message = text; emit(); }
    function start() {
      replay = null; replayStopped = false; intent = true;
      if (video.ended) seek(0);
      else if (!ready) { message = '正在加载完整视频，完成后尝试开始播放。'; emit(); }
      else if (pending) { message = '正在定位，完成后连续播放。'; emit(); }
      else { message = '正在开始连续播放…'; emit(); play(); }
    }
    function toggle() {
      if (video.ended) { intent = true; seek(0); return; }
      if (replay !== null && (replayStopped || !intent)) { start(); return; }
      // A playing replay can be paused without abandoning its boundary.
      if (intent || !video.paused && !video.ended) {
        intent = false; ++epoch; pause(); message = '已暂停。点“继续播放”接着看。'; emit(); return;
      }
      start();
    }
    function checkBoundary() {
      if (replay !== null && !replayStopped && !pending && video.currentTime >= chapters[replay].end) {
        const completed = replay;
        replayStopped = true; intent = false; pause();
        message = `“${chapters[completed].title}”重播结束，已在幕末暂停。点“继续播放”看后续。`; emit();
      }
    }
    on('play', () => {
      if (!ready || pending) { pause(); return; }
      if (replayStopped) { replay = null; replayStopped = false; }
      intent = true; message = replay !== null ? `重播“${chapters[replay].title}”，到幕末暂停。` : '电影连续播放中。'; emit();
    });
    on('pause', () => {
      if (ignoredPauses > 0) { --ignoredPauses; return; }
      if (pending || !video.paused || replayStopped || video.ended) return;
      intent = false; ++epoch; message = '已暂停。点“继续播放”接着看。'; emit();
    });
    on('seeking', () => { if (!pending) { replay = null; replayStopped = false; message = '正在定位…'; emit(); } });
    on('seeked', () => { if (!confirm() && !pending && !replayStopped) { message = '已定位，可继续连续播放。'; emit(); } });
    on('loadedmetadata', applySeek);
    on('loadeddata', () => { if (!confirm()) applySeek(); });
    on('canplay', () => { if (!confirm()) applySeek(); });
    on('timeupdate', () => { confirm(); checkBoundary(); emit(); });
    on('ended', () => {
      intent = false;
      if (replay !== null) replayStopped = true;
      message = replay !== null ? `“${chapters[replay].title}”重播结束。` : '完整电影已结束。可以从头再看，或留下你的问题。'; emit();
    });
    on('error', () => fail('视频解码或载入失败。请重新加载，或用下方链接打开原始视频。'));
    emit();
    return { seek, next: () => seek(selected() + 1), previous: () => seek(selected() - 1), replay: () => seek(replay !== null ? replay : selected(), true), toggle, start, setReady, fail, snapshot, checkBoundary,
      destroy: () => { destroyed = true; cancelSeek(); listeners.forEach(([event, fn]) => video.removeEventListener(event, fn)); } };
  }
  async function fetchVideo(url, progress = () => {}, signal, onActivity = () => {}) {
    const response = await fetch(url, { signal, credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    onActivity();
    const total = Number(response.headers.get('content-length')) || 0;
    const chunks = []; let received = 0;
    if (response.body && response.body.getReader) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); received += value.byteLength; onActivity(); progress(received, total);
        }
      } finally { if (reader.releaseLock) reader.releaseLock(); }
    } else { const blob = await response.blob(); chunks.push(blob); received = blob.size; onActivity(); }
    if (!received) throw new Error('Empty video');
    progress(received, received);
    return new Blob(chunks, { type: 'video/mp4' });
  }
  const plainCueText = text => String(text || '').replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|nbsp|quot|apos);/g, (_, entity) => ({amp:'&',lt:'<',gt:'>',nbsp:' ',quot:'"',apos:"'"})[entity]);
  function parseVTT(text) {
    const toSeconds = timestamp => {
      const values = timestamp.split(':').map(Number);
      return values.length === 3 ? values[0] * 3600 + values[1] * 60 + values[2] : values[0] * 60 + values[1];
    };
    const cues = [];
    for (const block of String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
      const lines = block.split('\n');
      if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
      const index = lines.findIndex(line => line.includes('-->'));
      if (index < 0) continue;
      const match = lines[index].match(/^\s*((?:\d+:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}\.\d{3})(?:\s|$)/);
      if (!match) continue;
      const startTime = toSeconds(match[1]), endTime = toSeconds(match[2]);
      if (Number.isFinite(startTime) && endTime > startTime) cues.push({startTime, endTime, text: plainCueText(lines.slice(index + 1).join('\n')).trim()});
    }
    return cues.sort((a, b) => a.startTime - b.startTime);
  }
  function createCaptionController(video, trackElement, output, toggle, strip, note, options = {}) {
    const document = options.document;
    let enabled = true, nativeFullscreen = false, destroyed = false, track = null, fallbackCues = [], aborter = null;
    let nativeFailed = false, fallbackFailed = false, initialized = false;
    const listeners = [];
    const on = (target, event, fn) => { if (target && target.addEventListener) { target.addEventListener(event, fn); listeners.push([target, event, fn]); } };
    const notifyFailure = () => {
      if (nativeFailed && fallbackFailed) { note.hidden = false; note.textContent = '字幕未能载入。仍可收听中文讲解，或下载下方讲解文稿。'; }
    };
    function applyMode() {
      if (!track) return;
      const mode = !enabled ? 'disabled' : nativeFullscreen ? 'showing' : 'hidden';
      if (track.mode !== mode) track.mode = mode;
    }
    function render() {
      if (destroyed) return;
      const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      // Look up cues by currentTime, never by a possibly stale activeCues list.
      // This changes the text on seeking, before a delayed cuechange event.
      const cues = track && track.cues && track.cues.length ? Array.from(track.cues) : fallbackCues;
      const active = enabled ? cues.filter(cue => time >= cue.startTime && time < cue.endTime).map(cue => plainCueText(cue.text)).filter(Boolean).join('\n') : '';
      const text = !enabled ? '字幕已关闭' : active || '字幕将随讲解显示';
      if (output.textContent !== text) output.textContent = text;
      output.dataset.idle = String(!active);
      output.setAttribute('aria-hidden', String(nativeFullscreen));
      strip.dataset.nativeFullscreen = String(nativeFullscreen);
      toggle.textContent = enabled ? '字幕 开' : '字幕 关';
      toggle.setAttribute('aria-pressed', String(enabled));
      toggle.setAttribute('aria-label', `中文字幕已${enabled ? '开启，点击关闭' : '关闭，点击开启'}`);
    }
    function connectTrack() {
      const next = trackElement.track || video.textTracks && video.textTracks[0];
      if (next && next !== track) { track = next; on(track, 'cuechange', render); }
      initialized = true; applyMode(); render();
    }
    function setEnabled(value) { enabled = Boolean(value); applyMode(); render(); }
    function modesChanged() {
      if (!initialized || !track) return;
      // Honor native CC actions while keeping ordinary playback below the frame.
      if (track.mode === 'showing') enabled = true;
      else if (track.mode === 'disabled') enabled = false;
      applyMode(); render();
    }
    function fullScreen(value) { nativeFullscreen = Boolean(value); applyMode(); render(); }
    on(toggle, 'click', () => setEnabled(!enabled));
    on(trackElement, 'load', () => { nativeFailed = false; note.hidden = true; connectTrack(); });
    on(trackElement, 'error', () => { nativeFailed = true; notifyFailure(); });
    on(video.textTracks, 'change', modesChanged);
    on(video.textTracks, 'addtrack', connectTrack);
    for (const event of ['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'loadeddata', 'ended']) on(video, event, render);
    on(video, 'webkitbeginfullscreen', () => fullScreen(true));
    on(video, 'webkitendfullscreen', () => fullScreen(false));
    on(document, 'fullscreenchange', () => fullScreen(document.fullscreenElement === video));
    connectTrack();
    async function load(url) {
      if (!url) { setEnabled(false); toggle.disabled = true; output.textContent = '本片未提供字幕'; return; }
      if (aborter) aborter.abort();
      const activeAborter = new AbortController(); aborter = activeAborter;
      const timer = setTimeout(() => activeAborter.abort(), 30000);
      try {
        const response = await fetch(url, {signal:activeAborter.signal, credentials:'same-origin'});
        if (!response.ok) throw new Error(`Captions HTTP ${response.status}`);
        const parsed = parseVTT(await response.text());
        if (!parsed.length) throw new Error('Empty captions');
        if (destroyed || activeAborter !== aborter) return;
        fallbackCues = parsed; fallbackFailed = false; note.hidden = true; render();
      } catch (error) {
        if (destroyed || activeAborter !== aborter) return;
        fallbackFailed = true; notifyFailure();
      } finally { clearTimeout(timer); }
    }
    render();
    return { load, render, setEnabled, setCues: cues => { fallbackCues = cues; render(); }, snapshot: () => ({enabled, nativeFullscreen, fallbackCueCount:fallbackCues.length}), destroy: () => { destroyed = true; if (aborter) aborter.abort(); listeners.forEach(([target, event, fn]) => target.removeEventListener(event, fn)); } };
  }
  function boot(document, window) {
    const byId = id => document.getElementById(id);
    const video = byId('lecture-video');
    if (!video) return null;
    const status = byId('playback-status'), progress = byId('load-progress'), retry = byId('retry-load');
    const choices = [...document.querySelectorAll('[data-choice]')];
    let manifest = null, controller = null, captions = null, buttons = [], loading = true, started = false;
    let objectURL = null, aborter = null, loadToken = 0, destroyed = false, raf = null;
    let stallTimer = null, manifestTimer = null;
    const manifestURL = new URL('film-manifest.json', document.baseURI).href;
    function showStatus(text) { if (status.textContent !== text) status.textContent = text; }
    function update(state) {
      if (!loading) showStatus(state.message);
      buttons.forEach((button, index) => {
        if (index === state.chapter) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
        button.dataset.pending = String(state.pending === index);
      });
      byId('previous-chapter').disabled = state.selected === 0;
      byId('next-chapter').disabled = state.selected === manifest.chapters.length - 1;
      byId('replay-chapter').disabled = false;
      byId('replay-chapter').setAttribute('aria-label', `重播本幕：${manifest.chapters[state.replay !== null ? state.replay : state.selected].title}，幕末暂停`);
      byId('play-button').textContent = state.intent ? '暂停播放 Ⅱ' : video.ended ? '从头再看 ▶' : started || video.currentTime > 0 || state.replay !== null ? '继续播放 ▶' : '开始完整电影 ▶';
      byId('time-display').textContent = `${clock(video.currentTime)} / ${clock(Number.isFinite(video.duration) ? video.duration : manifest.duration)}`;
      byId('chapter-counter').textContent = `${String(state.chapter + 1).padStart(2, '0')} / ${String(manifest.chapters.length).padStart(2, '0')}`;
      byId('chapter-summary').textContent = manifest.chapters[state.selected].summary || `第 ${state.selected + 1} 幕 · ${manifest.chapters[state.selected].title}`;
    }
    function buildChapters() {
      byId('chapters').replaceChildren();
      buttons = manifest.chapters.map((chapter, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.chapter = String(index);
        const number = document.createElement('span'); number.className = 'chapter-number'; number.textContent = String(index + 1).padStart(2, '0'); number.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span'); name.className = 'chapter-name'; name.textContent = chapter.title;
        const time = document.createElement('span'); time.className = 'chapter-time'; time.textContent = clock(chapter.start);
        button.append(number, name, time); button.setAttribute('aria-label', `第 ${index + 1} 幕：${chapter.title}，${clock(chapter.start)}`);
        button.addEventListener('click', () => controller.seek(index)); byId('chapters').append(button); return button;
      });
    }
    function startFromChoice() {
      started = true; byId('opening-choice').hidden = true; video.muted = false;
      if (controller) controller.start();
      else showStatus('正在加载电影信息，准备好后会尝试开始播放。');
      if (!loading && !retry.hidden) load();
    }
    choices.forEach(button => button.addEventListener('click', startFromChoice));
    byId('skip-choice').addEventListener('click', startFromChoice);
    byId('play-button').addEventListener('click', () => {
      if (!started) { startFromChoice(); return; }
      if (controller) controller.toggle();
    });
    byId('previous-chapter').addEventListener('click', () => controller && controller.previous());
    byId('next-chapter').addEventListener('click', () => controller && controller.next());
    byId('replay-chapter').addEventListener('click', () => { started = true; byId('opening-choice').hidden = true; if (controller) controller.replay(); });
    video.addEventListener('play', () => { started = true; byId('opening-choice').hidden = true; byId('after-film').hidden = true; });
    video.addEventListener('ended', () => { byId('after-film').hidden = false; });
    async function load() {
      const token = ++loadToken;
      if (aborter) aborter.abort();
      clearTimeout(stallTimer); clearTimeout(manifestTimer);
      aborter = new AbortController();
      const activeAborter = aborter;
      loading = true; byId('play-button').disabled = false; video.controls = false; retry.hidden = true; progress.hidden = false; progress.removeAttribute('value');
      if (controller) controller.setReady(false);
      showStatus(manifest ? '正在加载完整视频，完成后可自由前后跳转…' : '正在读取电影信息…');
      try {
        if (!manifest) {
          manifestTimer = setTimeout(() => activeAborter.abort(), 30000);
          const response = await fetch(manifestURL, { signal: activeAborter.signal, credentials: 'same-origin' });
          if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
          const raw = await response.json();
          if (token !== loadToken || destroyed) return;
          clearTimeout(manifestTimer);
          manifest = normalizeManifest(raw, manifestURL);
          document.title = `${manifest.title} · SIEP 智教版`;
          if (byId('film-title').textContent !== manifest.title) byId('film-title').textContent = manifest.title;
          byId('film-duration').textContent = `${manifest.chapters.length} 幕 · ${clock(manifest.duration)} · 中文讲解`;
          byId('video-link').href = manifest.video;
          if (manifest.poster) video.poster = manifest.poster;
          if (manifest.captions) byId('caption-track').src = manifest.captions;
          captions = createCaptionController(video, byId('caption-track'), byId('caption-text'), byId('caption-toggle'), byId('caption-strip'), byId('caption-note'), {document});
          if (manifest.transcript) { byId('transcript-link').href = manifest.transcript; byId('transcript-link').hidden = false; }
          buildChapters(); controller = createController(video, manifest.chapters, update);
          if (started) controller.start();
        }
        if (captions) captions.load(manifest.captions);
        // Reset the timeout when bytes arrive: large films can take minutes.
        const activity = () => { clearTimeout(stallTimer); stallTimer = setTimeout(() => activeAborter.abort(), 60000); };
        activity();
        const blob = await fetchVideo(manifest.video, (received, total) => {
          if (token !== loadToken || destroyed) return;
          if (total) { progress.max = Math.max(total, received); progress.value = received; }
          const queued = controller.snapshot().pending;
          showStatus(`正在加载视频：${(received / 1048576).toFixed(1)} MB${total ? ` / ${(Math.max(total, received) / 1048576).toFixed(1)} MB` : ''}${queued !== null ? `，随后跳转到“${manifest.chapters[queued].title}”` : ''}…`);
        }, activeAborter.signal, activity);
        if (token !== loadToken || destroyed) return;
        clearTimeout(stallTimer);
        const old = objectURL;
        objectURL = URL.createObjectURL(blob); video.src = objectURL; video.load();
        if (old) URL.revokeObjectURL(old);
        loading = false; progress.hidden = true; video.controls = true; controller.setReady(true);
      } catch (error) {
        if (token !== loadToken || destroyed) return;
        loading = false; progress.hidden = true; retry.hidden = false; byId('play-button').disabled = true;
        const message = manifest ? '完整视频加载失败或连接长时间无响应。请重新加载，或用下方“原始视频”链接观看。' : '电影信息加载失败。请重新加载，或用下方“原始视频”链接观看。';
        if (controller) controller.fail(message); else showStatus(message);
      } finally { if (token === loadToken) { clearTimeout(stallTimer); clearTimeout(manifestTimer); } }
    }
    retry.addEventListener('click', load);
    video.addEventListener('error', () => { if (!loading) { retry.hidden = false; byId('play-button').disabled = true; } });
    function frame() { if (destroyed) return; if (controller) controller.checkBoundary(); raf = window.requestAnimationFrame(frame); }
    raf = window.requestAnimationFrame(frame);
    window.addEventListener('pagehide', event => {
      if (event.persisted) return;
      destroyed = true; ++loadToken; if (aborter) aborter.abort();
      clearTimeout(stallTimer); clearTimeout(manifestTimer); window.cancelAnimationFrame(raf);
      if (controller) controller.destroy(); if (captions) captions.destroy(); if (objectURL) URL.revokeObjectURL(objectURL);
    });
    load();
    return { load, getController: () => controller, getManifest: () => manifest, getCaptions: () => captions };
  }
  const api = { clock, normalizeManifest, chapterAt, createController, fetchVideo, plainCueText, parseVTT, createCaptionController, boot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) root.FilmPlayer = boot(root.document, root);
})(typeof window !== 'undefined' ? window : globalThis);
