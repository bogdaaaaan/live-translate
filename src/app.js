// App: settings, controls, start/stop, status line. Wires the modules together:
//   recognition → pipeline → sentences → transcript (+ translators in translate mode)
(() => {
  const LT = globalThis.LT;
  const $ = s => document.querySelector(s);
  const MAX_TRANSLATE_WORDS = 60;        // translation mode only: translate very long runs anyway

  let mode = 'translate';
  let running = false, startedAt = 0, wakeLock = null;
  let lastError = '';
  let lastWordAt = 0;                    // when a new word last appeared
  let liveText = '';                     // words Chrome is still recognising

  const setStatus = t => { $('#stxt').textContent = t; };
  const words = () => $('#vocab').value.split(/[,\n;]+/).map(w => w.trim()).filter(Boolean).slice(0, 100);
  const pauseMs = () => parseInt($('#pause').value, 10);

  // ---------- saved settings ----------
  const store = {
    get: k => { try { return localStorage.getItem('ldt-' + k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem('ldt-' + k, v); } catch (e) {} }
  };
  ['topic', 'vocab'].forEach(id => {
    const v = store.get(id); if (v) $('#' + id).value = v;
    $('#' + id).addEventListener('input', e => store.set(id, e.target.value));
  });
  ['engine', 'pause', 'mode'].forEach(id => {
    const v = store.get(id); if (v && [...$('#' + id).options].some(o => o.value === v)) $('#' + id).value = v;
    $('#' + id).addEventListener('change', e => store.set(id, e.target.value));
  });

  function applyMode() {
    mode = $('#mode').value;
    LT.transcript.setMode(mode);
  }
  applyMode();

  if (!LT.recognition.supported) {
    $('#hint').innerHTML = '<p><b>Speech recognition is not available in this browser.</b> Open this file in Google Chrome.</p>';
    $('#toggle').disabled = true;
  }

  // ---------- wiring ----------
  const render = () => LT.transcript.render(sentences.text(), liveText);

  const sentences = LT.createSentences({
    limit: () => mode === 'translate' ? MAX_TRANSLATE_WORDS : Infinity,
    onSentence: t => {
      if (mode === 'subs') LT.transcript.addParagraph(t);
      else LT.translators.enqueue(t, LT.transcript.addBlock(t));
    },
  });

  const pipeline = LT.createPipeline({
    onWords: ws => { sentences.add(ws); render(); },
    onLive: t => { liveText = (t || '').trim(); render(); },
    onNewWords: () => { lastWordAt = Date.now(); },
  });

  function endSentence() {
    liveText = '';
    sentences.end();
    render();
  }

  function initTranslators() {
    return LT.translators.init({ engine: $('#engine').value, topic: $('#topic').value.trim(), words: words(), onStatus: setStatus })
      .then(statusLine);
  }

  // ---------- pause detection ----------
  setInterval(() => {
    if (!running) return;
    if (!LT.isPause(Date.now(), lastWordAt, LT.microphone.lastVoiceAt, pauseMs())) return;
    if (pipeline.hasPending()) pipeline.commitPending();
    if (sentences.size() || liveText) endSentence();
  }, 120);

  // ---------- status ----------
  setInterval(() => {
    if (!running) return;
    const s = Math.floor((Date.now() - startedAt) / 1000);
    $('#timer').textContent = ' · ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }, 1000);

  function statusLine() {
    if (!running) return;
    const what = mode === 'subs' ? 'Subtitles' : LT.translators.name();
    const local = LT.recognition.local ? ' · on-device' + (LT.recognition.phrases ? ' + words' : '') : '';
    setStatus(lastError ? '⚠ ' + lastError : 'Listening · ' + what + local);
  }
  const setError = msg => { lastError = msg; statusLine(); };

  async function keepAwake() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (running && document.visibilityState === 'visible') keepAwake();
  });

  // ---------- start / stop ----------
  const SILENT = 'microphone hears nothing: check System Settings → Privacy & Security → Microphone → Chrome';
  const bar = $('#meter > div');

  function start() {
    running = true; lastError = '';
    lastWordAt = Date.now();
    $('#toggle').textContent = 'Stop'; $('#toggle').classList.add('stop');
    $('#dot').classList.add('on');
    $('#ctx').classList.remove('open');
    startedAt = Date.now();
    keepAwake();
    LT.microphone.start({
      onLevel(level, silent) {
        bar.style.width = (level * 100) + '%';
        if (silent && running && !lastError) setError(SILENT);
        if (level > 0.005 && lastError.startsWith('microphone hears nothing')) setError('');
      },
      onError: e => setError('microphone blocked (' + e.name + '): allow it in the address bar and in macOS settings'),
    });
    const local = LT.recognition.start({                // listen immediately
      pipeline, words, local: $('#localSR').checked,
      onChange: statusLine,
      onHeard: () => { if (lastError && !lastError.startsWith('microphone')) setError(''); },
      onError: setError,
      onBlocked: () => { stop(); setStatus('Microphone blocked: allow it via the icon in the address bar'); },
      onStatus: setStatus,
    });
    if (mode === 'translate' && !LT.translators.ready) initTranslators();
    local.then(statusLine);
  }

  function stop() {
    running = false;
    $('#toggle').textContent = 'Start'; $('#toggle').classList.remove('stop');
    $('#dot').classList.remove('on');
    setStatus('Stopped'); $('#timer').textContent = '';
    LT.recognition.stop();
    LT.microphone.stop();
    bar.style.width = '0';
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  // ---------- controls ----------
  $('#toggle').onclick = () => running ? stop() : start();
  $('#mode').addEventListener('change', () => {
    pipeline.commitPending();
    endSentence();
    applyMode();
    render();
    if (running && mode === 'translate' && !LT.translators.ready) initTranslators();
    statusLine();
  });
  $('#ctxBtn').onclick = () => $('#ctx').classList.toggle('open');
  $('#engine').addEventListener('change', () => { if (running && mode === 'translate') initTranslators(); });
  $('#showDe').onchange = e => document.body.classList.toggle('hide-de', !e.target.checked);
  const fs = d => {
    const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs'));
    document.documentElement.style.setProperty('--fs', Math.max(14, Math.min(64, cur + d)) + 'px');
  };
  $('#smaller').onclick = () => fs(-3);
  $('#bigger').onclick = () => fs(3);
  $('#clear').onclick = () => {
    LT.transcript.clear();
    sentences.clear(); liveText = '';
    render();
  };
})();
