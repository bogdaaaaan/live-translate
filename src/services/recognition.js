// Speech recognition: Chrome Web Speech API, de-DE, continuous + interim results.
// Restarts by itself in onend; a watchdog restarts it if there are no events for 30 s.
// Optional on-device recognition with word biasing; switches back to online recognition
// if it hears speech but returns nothing for 10 s.
(() => {
  const LT = globalThis.LT ??= {};
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  const DEBUG = location.hash === '#debug';

  let running = false, rec = null, lastEvent = 0;
  let useLocal = false, usePhrases = false;
  let o = null;   // options from start()

  function startRec() {
    rec = new SR();
    rec.lang = 'de-DE';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const isLocal = useLocal;
    if (isLocal) {
      try {
        rec.processLocally = true;
        if (usePhrases) rec.phrases = o.words().map(w => new SpeechRecognitionPhrase(w, 2.0));
      } catch (e) { console.warn(e); usePhrases = false; }
    }
    o.pipeline.reset();
    let gotResult = false;

    rec.onstart = () => { lastEvent = Date.now(); o.onChange(); };
    rec.onspeechstart = () => {
      if (isLocal) setTimeout(() => {
        if (running && !gotResult && useLocal) {
          useLocal = false; usePhrases = false;
          console.warn('On-device recognition gave no results, switching to online');
          try { rec.abort(); } catch (e) {}
        }
      }, 10000);
    };

    rec.onresult = e => {
      lastEvent = Date.now(); gotResult = true;
      o.onHeard();
      if (DEBUG) console.debug([...e.results].map(r => (r.isFinal ? 'F:' : 'i:') + r[0].transcript));
      o.pipeline.results(e.results);
    };

    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        o.onBlocked();
      } else if (e.error === 'phrases-not-supported') {
        usePhrases = false;
      } else if (e.error === 'language-not-supported') {
        useLocal = false; usePhrases = false;
      } else if (e.error === 'audio-capture') {
        o.onError('no microphone found');
      } else if (e.error === 'network') {
        o.onError('network problem, retrying');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        o.onError(e.error);
      }
    };
    rec.onend = () => {
      o.pipeline.commitPending();       // keep words that were not finalised yet
      if (!running) return;
      try { startRec(); } catch (err) { setTimeout(() => running && startRec(), 500); }
    };
    rec.start();
  }

  // Check whether on-device recognition can be used; restarts recognition if so.
  async function prepareLocal(wanted) {
    useLocal = false; usePhrases = false;
    if (!wanted || !o.words().length || typeof SR.available !== 'function') return;
    try {
      const opts = { langs: ['de-DE'], processLocally: true };
      let a = await SR.available(opts);
      if (a === 'downloadable' || a === 'downloading') {
        o.onStatus('Downloading German speech model…');
        const ok = await SR.install(opts);
        a = ok ? 'available' : 'unavailable';
      }
      if (a === 'available') {
        useLocal = true;
        usePhrases = typeof globalThis.SpeechRecognitionPhrase === 'function';
      }
    } catch (e) { console.warn('On-device speech recognition unavailable', e); }
    if (useLocal && running && rec) { try { rec.abort(); } catch (e) {} }
  }

  setInterval(() => {                   // watchdog: restart if recognition silently hangs
    if (running && rec && Date.now() - lastEvent > 30000) {
      lastEvent = Date.now();
      try { rec.abort(); } catch (e) {}
    }
  }, 5000);

  LT.recognition = {
    supported: !!SR,
    get local() { return useLocal; },
    get phrases() { return usePhrases; },

    // opts: { pipeline, words(), local (bool), onChange(), onHeard(), onError(msg), onBlocked(), onStatus(msg) }
    // Listening starts immediately; the on-device check runs in the background.
    start(opts) {
      o = opts;
      running = true;
      startRec();
      return prepareLocal(opts.local);
    },

    stop() {
      running = false;
      try { rec && rec.stop(); } catch (e) {}
    },
  };
})();
