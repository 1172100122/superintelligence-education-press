/* HTML5 chapter player. Uses local Blob media on hosted pages for reliable seeking. */
(() => {
  "use strict";
  const data = window.SIEP_EPISODE;
  const byId = (id) => document.getElementById(id);
  const video = byId("film");
  const status = byId("media-status");
  if (!data || !Array.isArray(data.chapters) || !data.chapters.length) {
    status.textContent = "章节数据缺失。请刷新页面重试；仍可使用视频原生控件。";
    status.classList.add("is-error");
    return;
  }
  const chapters = data.chapters;
  const isFinal = data.timingStatus === "final";
  const burnedIn = data.subtitlesBurnedIn === true;
  const storageKey = `siep-episode-01:${data.revision || "v1"}`;
  let currentChapter = 0;
  let playWhenReady = false;
  let pendingSeek = null;
  let resumePosition = 0;
  let metadataReady = false;
  let mediaFailed = false;
  let hasPlayed = false;
  let lastSavedAt = 0;
  let choice = "";
  let embeddedTrack = null;
  let currentCaptionText = "";
  const formatTime = (seconds) => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };
  const readSaved = () => {
    try { return JSON.parse(localStorage.getItem(storageKey) || "null") || {}; }
    catch (_) { return {}; }
  };
  const save = () => {
    if (!metadataReady || mediaFailed) return;
    const ended = video.ended || video.currentTime >= video.duration - 1;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        time: ended ? 0 : video.currentTime,
        choice,
      }));
    } catch (_) { /* Private/file contexts may block storage; playback still works. */ }
  };
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("is-error", error);
  };
  const saved = readSaved();
  if (Number.isFinite(saved.time) && saved.time > 2 && saved.time < data.duration - 1) resumePosition = saved.time;
  if (["幻觉", "神谕"].includes(saved.choice)) choice = saved.choice;

  byId("chapter-total").textContent = String(chapters.length);
  document.querySelector(".chapter-count").textContent = String(chapters.length);
  byId("film-duration").textContent = formatTime(data.duration);
  byId("duration-label").textContent = isFinal ? "片长" : "预计时长";
  byId("timing-note").textContent = isFinal ? "时间轴已与成片同步" : "暂定时间轴 · 等待成片同步";
  byId("timing-note").classList.toggle("is-temporary", !isFinal);

  const list = byId("chapter-list");
  const chapterButtons = chapters.map((chapter, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chapter-button";
    button.setAttribute("aria-controls", "film");
    button.setAttribute("aria-label", `第 ${index + 1} 章，${chapter.title}，${isFinal ? "" : "暂定 "}${formatTime(chapter.start)}`);
    const number = document.createElement("span");
    number.className = "chapter-no";
    number.textContent = String(index + 1).padStart(2, "0");
    number.setAttribute("aria-hidden", "true");
    const content = document.createElement("span");
    const title = document.createElement("span");
    title.className = "chapter-title";
    title.textContent = chapter.title;
    const time = document.createElement("span");
    time.className = "chapter-time";
    time.textContent = `${formatTime(chapter.start)} — ${formatTime(chapter.end)}`;
    content.append(title, time);
    button.append(number, content);
    button.addEventListener("click", () => seekChapter(index));
    li.append(button);
    list.append(li);
    return button;
  });

  function updateChapter(index) {
    currentChapter = Math.max(0, Math.min(chapters.length - 1, index));
    const chapter = chapters[currentChapter];
    byId("now-number").textContent = `第 ${String(currentChapter + 1).padStart(2, "0")} 章`;
    byId("now-title").textContent = chapter.title;
    byId("previous").disabled = currentChapter === 0;
    byId("next").disabled = currentChapter === chapters.length - 1;
    chapterButtons.forEach((button, i) => {
      if (i === currentChapter) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  }
  function updateProgress(time = video.currentTime) {
    const chapter = chapters[currentChapter];
    const fraction = Math.max(0, Math.min(1, (time - chapter.start) / (chapter.end - chapter.start)));
    const percent = Math.round(fraction * 100);
    const progress = byId("chapter-progress");
    progress.setAttribute("aria-valuenow", String(percent));
    progress.firstElementChild.style.width = `${percent}%`;
    byId("now-time").textContent = `${formatTime(time)} / ${formatTime(metadataReady ? video.duration : data.duration)}`;
    const cue = (data.subtitles || []).find((item) => time >= item.start && time < item.end);
    const captionText = cue ? cue.text : time > 0 ? "（当前无旁白）" : "播放影片时，这里会显示当前旁白的文字。";
    if (captionText !== currentCaptionText) {
      currentCaptionText = captionText;
      byId("current-caption").textContent = captionText;
    }
  }
  function seekTo(time) {
    resumePosition = 0;
    if (!metadataReady || video.dataset.mediaLoading === "true") {
      pendingSeek = time;
      updateProgress(time);
      if (!mediaFailed) setStatus(`已选定 ${formatTime(time)}，影片载入后即可播放。`);
      return;
    }
    const target = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05));
    try { video.currentTime = target; }
    catch (_) { pendingSeek = target; }
    updateProgress(target);
    save();
  }
  function seekChapter(index) {
    updateChapter(index);
    seekTo(chapters[currentChapter].start);
    syncPlayButton();
  }
  function syncPlayButton() {
    if (video.dataset.mediaLoading === "true") {
      byId("play-icon").textContent = playWhenReady ? "Ⅱ" : "▶";
      byId("play-label").textContent = playWhenReady ? "取消自动播放" : "准备好后播放";
      return;
    }
    byId("play-icon").textContent = video.paused ? "▶" : "Ⅱ";
    byId("play-label").textContent = !video.paused ? "暂停播放" : video.ended ? "重新观看" : resumePosition > 2 ? "继续观看" : hasPlayed || (pendingSeek ?? video.currentTime) > 0 ? "继续播放" : "开始观看";
  }
  async function play() {
    if (video.dataset.mediaLoading === "true") {
      playWhenReady = true;
      syncPlayButton();
      setStatus("正在准备影片。下载完成后即可播放和跳转章节。");
      return;
    }
    if (mediaFailed || video.dataset.mediaFailed === "true") {
      setStatus("暂未能打开成片。请稍后重新载入本页。", true);
      return;
    }
    if (video.ended) seekChapter(0);
    if (resumePosition > 2) seekTo(resumePosition);
    try { await video.play(); }
    catch (error) {
      if (error.name === "AbortError") return;
      setStatus(error.name === "NotAllowedError" ? "浏览器未开始播放，请点击视频中的播放按钮。" : "影片尚未就绪，或浏览器不支持此视频格式。请稍后重新载入本页。", true);
    }
  }
  function togglePlay() {
    if (video.dataset.mediaLoading === "true" && playWhenReady) { playWhenReady = false; syncPlayButton(); return; }
    if (video.paused) play(); else video.pause();
  }

  const choiceButtons = [...document.querySelectorAll("[data-choice]")];
  function syncChoice() {
    choiceButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.choice === choice)));
    if (choice) byId("choice-note").textContent = `你的最初选择：${choice}。带着这个直觉，继续看。`;
  }
  choiceButtons.forEach((button) => button.addEventListener("click", () => {
    choice = button.dataset.choice;
    syncChoice();
    try { localStorage.setItem(storageKey, JSON.stringify({time: resumePosition || video.currentTime || 0, choice})); } catch (_) {}
    play();
  }));
  byId("play-toggle").addEventListener("click", togglePlay);
  byId("previous").addEventListener("click", () => seekChapter(currentChapter - 1));
  byId("next").addEventListener("click", () => seekChapter(currentChapter + 1));
  byId("replay").addEventListener("click", () => { seekChapter(currentChapter); play(); });

  function enableEmbeddedSubtitles() {
    if (burnedIn || embeddedTrack || !Array.isArray(data.subtitles) || !data.subtitles.length || typeof VTTCue === "undefined") return false;
    byId("zh-track").track.mode = "disabled";
    embeddedTrack = video.addTextTrack("subtitles", "中文（本地兼容）", "zh");
    data.subtitles.forEach((cue) => {
      if (Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start) embeddedTrack.addCue(new VTTCue(cue.start, cue.end, cue.text));
    });
    embeddedTrack.mode = "showing";
    byId("subtitle-note").textContent = "中文字幕已载入本地兼容轨道，可在视频字幕菜单中关闭或开启。";
    return true;
  }
  const track = byId("zh-track");
  track.addEventListener("error", () => {
    if (burnedIn) return;
    if (!enableEmbeddedSubtitles()) byId("subtitle-note").textContent = "字幕暂时无法加载。请刷新页面重试，也可阅读同步文字或下载字幕文件。";
  });
  track.addEventListener("load", () => {
    if (!burnedIn && !embeddedTrack) byId("subtitle-note").textContent = "中文字幕已载入，可在视频字幕菜单中关闭或开启。";
  });
  // file:// subtitle requests are blocked in some browsers. The builder embeds
  // the very same VTT cues so a native TextTrack can be used without fetch/CORS.
  if (burnedIn) {
    track.track.mode = "disabled";
    byId("subtitle-note").textContent = "影片已内嵌中文字幕。播放器不会叠加另一层字幕；可在“查看同步文字”中阅读当前旁白或下载字幕文件。";
  }
  else if (location.protocol === "file:" && enableEmbeddedSubtitles()) track.track.mode = "disabled";
  else if (data.subtitlesAvailable) track.track.mode = "showing";
  if (!data.subtitlesAvailable) {
    byId("subtitle-download").hidden = true;
    byId("transcript-panel").hidden = true;
  }

  function onMetadataReady() {
    metadataReady = true;
    mediaFailed = false;
    if (resumePosition >= video.duration - 1) resumePosition = 0;
    byId("film-duration").textContent = formatTime(video.duration);
    byId("duration-label").textContent = "片长";
    if (pendingSeek !== null) { const target = pendingSeek; pendingSeek = null; seekTo(target); }
    if (resumePosition > 2) setStatus(`上次看到 ${formatTime(resumePosition)}。点击“继续观看”接着看。`);
    else setStatus(isFinal ? "影片已就绪。可连续观看，或按章节回看。" : "影片已就绪；章节时间仍为暂定值，尚未与成片同步。");
    if (isFinal && Math.abs(video.duration - data.duration) > 1) {
      byId("timing-note").textContent = "时间轴与当前视频时长不一致 · 请刷新重试";
      byId("timing-note").classList.add("is-temporary");
      setStatus("章节与影片暂时不同步。请刷新页面重试，或使用视频进度条观看。", true);
    }
    syncPlayButton();
    updateProgress();
    if (playWhenReady) { playWhenReady = false; play(); }
  }
  video.addEventListener("loadedmetadata", onMetadataReady);
  video.addEventListener("mediafailed", () => { mediaFailed = true; playWhenReady = false; syncPlayButton(); });
  video.addEventListener("timeupdate", () => {
    if (pendingSeek !== null && (!metadataReady || video.dataset.mediaLoading === "true")) return;
    const time = video.currentTime;
    let index = 0;
    chapters.forEach((chapter, i) => { if (time >= chapter.start) index = i; });
    if (index !== currentChapter) updateChapter(index);
    updateProgress();
    if (Date.now() - lastSavedAt > 2000) { save(); lastSavedAt = Date.now(); }
  });
  video.addEventListener("play", () => { hasPlayed = true; syncPlayButton(); setStatus("正在播放。章节将随影片自动切换。"); });
  video.addEventListener("pause", () => { syncPlayButton(); save(); });
  video.addEventListener("ended", () => { syncPlayButton(); save(); setStatus("本集播放完毕。可以选择章节，再看看其中的理由。"); });
  video.addEventListener("error", () => {
    mediaFailed = true;
    setStatus("暂未能打开成片。请稍后重新载入本页。", true);
  });
  // Source-element errors do not consistently bubble to <video>.
  video.querySelector("source").addEventListener("error", () => {
    mediaFailed = true;
    setStatus("影片暂时无法加载。请检查网络后刷新页面重试。", true);
  });
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
  document.querySelector(".watch-panel").addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest("button, a, summary, input, textarea, select, [contenteditable]")) return;
    // Let the native controls own their standard space/arrow behavior.
    if (event.target === video && [" ", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const key = event.key.toLowerCase();
    if (key === "k" || key === " ") { event.preventDefault(); togglePlay(); }
    if (["arrowleft", "arrowright", "j", "l"].includes(key)) {
      event.preventDefault();
      const delta = key === "j" ? -10 : key === "l" ? 10 : key === "arrowleft" ? -5 : 5;
      seekTo((pendingSeek ?? video.currentTime) + delta);
    }
  });
  byId("player").tabIndex = 0;
  updateChapter(0);
  updateProgress(0);
  syncChoice();
  syncPlayButton();
  if (video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0) onMetadataReady();
})();
