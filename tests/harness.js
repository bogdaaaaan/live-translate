// Loads live-translator.html in jsdom with fake browser APIs and a fake clock.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Inline the <script src> files so they run synchronously in jsdom (a missing file throws here)
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'live-translator.html'), 'utf8')
  .replace(/<script src="([^"]+)"><\/script>/g, (_, src) => '<script>' + fs.readFileSync(path.join(ROOT, src), 'utf8') + '</script>');
const tick = () => new Promise(r => setImmediate(r));

const SILENCE = 0.0005, SPEECH = 0.05;

function load({ mode = 'subs', engine = 'smart', pause = '1000', translator = true, model = true, fetchFn } = {}) {
  const sim = {
    now: 1_000_000,
    timers: [], nextId: 1,
    recs: [],                                  // every fake SpeechRecognition created
    speaking: false,                           // drives the fake microphone amplitude
    calls: { smart: [], fast: [], google: [] },
  };

  // ---------- fake clock ----------
  const addTimer = (fn, ms, every) => {
    const id = sim.nextId++;
    sim.timers.push({ id, fn, at: sim.now + Math.max(0, ms || 0), every: every ? Math.max(1, ms || 0) : 0 });
    return id;
  };
  const clearTimer = id => { sim.timers = sim.timers.filter(t => t.id !== id); };

  // Advance the fake clock, firing timers in order and letting promises settle in between.
  sim.advance = async ms => {
    const end = sim.now + ms;
    for (;;) {
      await tick();
      const due = sim.timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      sim.now = Math.max(sim.now, due.at);
      if (due.every) due.at += due.every; else clearTimer(due.id);
      due.fn();
    }
    sim.now = end;
    await tick();
  };

  // ---------- fake speech recognition ----------
  class FakeSR {
    constructor() { this.running = false; this.results = []; sim.recs.push(this); }
    start() { this.running = true; addTimer(() => this.onstart && this.onstart(), 0); }
    stop() { this.end(); }
    abort() { this.end(); }
    end() {                                    // Chrome fires onend asynchronously
      if (!this.running) return;
      this.running = false;
      addTimer(() => this.onend && this.onend(), 0);
    }
  }
  sim.rec = () => sim.recs[sim.recs.length - 1];
  // results: [[transcript, isFinal], ...] — the WHOLE list Chrome currently holds
  sim.result = results => {
    const r = sim.rec();
    const list = results.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: !!f }));
    r.onresult && r.onresult({ results: list, resultIndex: 0 });
  };

  // ---------- fake microphone ----------
  class FakeAudioContext {
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() {
      return {
        fftSize: 1024,
        getFloatTimeDomainData(b) {
          // speech: loud, with a tiny gap between words every 250 ms
          const amp = sim.speaking && sim.now % 250 > 40 ? SPEECH : SILENCE;
          b.fill(amp);
        }
      };
    }
  }

  const dom = new JSDOM(HTML, {
    url: 'http://localhost/live-translator.html',
    runScripts: 'dangerously',
    beforeParse(w) {
      w.localStorage.setItem('ldt-mode', mode);
      w.localStorage.setItem('ldt-engine', engine);
      w.localStorage.setItem('ldt-pause', pause);
      w.Date.now = () => sim.now;
      w.setTimeout = (fn, ms) => addTimer(fn, ms, false);
      w.setInterval = (fn, ms) => addTimer(fn, ms, true);
      w.clearTimeout = w.clearInterval = clearTimer;
      w.requestAnimationFrame = fn => addTimer(fn, 20, false);
      w.cancelAnimationFrame = clearTimer;
      w.webkitSpeechRecognition = FakeSR;
      w.AudioContext = FakeAudioContext;
      Object.defineProperty(w.navigator, 'mediaDevices', {
        value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }
      });
      w.fetch = fetchFn || (async url => {
        const q = decodeURIComponent(new URL(url).searchParams.get('q'));
        sim.calls.google.push(q);
        return { ok: true, json: async () => [[['G(' + q + ')']]] };
      });
      if (translator) w.Translator = {
        availability: async () => 'available',
        create: async () => ({ translate: async t => { sim.calls.fast.push(t); return 'F(' + t + ')'; } })
      };
      if (model) w.LanguageModel = {
        availability: async () => 'available',
        create: async () => ({
          destroy() {},
          clone: async () => ({
            destroy() {},
            prompt: async p => {
              const t = p.match(/New sentence \(German\): (.*)\n/)[1];
              sim.calls.smart.push(t);
              return 'S(' + t + ')';
            }
          })
        })
      };
    }
  });
  sim.window = dom.window;
  sim.doc = dom.window.document;

  sim.start = async () => { sim.doc.querySelector('#toggle').click(); await sim.advance(50); };
  sim.silence = ms => { sim.speaking = false; return sim.advance(ms); };

  // Speak words the way Chrome reports fast speech: one new word every wordMs, the interim
  // text split into many tiny results, and finals arriving late (after more words were heard).
  // Continues from the current session's results, so it can be called repeatedly.
  // micHears: false = words still arrive while the mic is already quiet (Chrome lags behind audio)
  sim.speak = async (words, { wordMs = 250, finalEvery = 8, finalLag = 3, micHears = true } = {}) => {
    sim.speaking = micHears;
    const r = sim.rec();
    r.finals = r.finals || [];                 // finalised chunks (strings)
    r.interim = r.interim || [];               // words not yet finalised
    for (const w of words) {
      r.interim.push(w);
      if (r.interim.length >= finalEvery + finalLag) r.finals.push(r.interim.splice(0, finalEvery).join(' '));
      const tiny = [];
      for (let i = 0; i < r.interim.length; i += 3) tiny.push([r.interim.slice(i, i + 3).join(' '), false]);
      sim.result([...r.finals.map(t => [t, true]), ...tiny]);
      await sim.advance(wordMs);
    }
  };
  // Chrome finalises everything it still has as interim (usually right before it ends)
  sim.finalizeAll = () => {
    const r = sim.rec();
    if (r.interim && r.interim.length) r.finals.push(r.interim.splice(0).join(' '));
    sim.result((r.finals || []).map(t => [t, true]));
  };
  // Chrome ends the session on its own (the page restarts it)
  sim.chromeEnds = async () => { sim.rec().end(); await sim.advance(10); };

  sim.paragraphs = () => [...sim.doc.querySelectorAll('p.sub')].map(p => p.textContent);
  sim.blocks = () => [...sim.doc.querySelectorAll('.line:not(#interim)')].map(b => ({
    en: b.querySelector('.en').textContent, de: b.querySelector('.de').textContent
  }));
  return sim;
}

const words = (n, from = 1) => Array.from({ length: n }, (_, i) => 'wort' + (i + from));
// Paragraph text → lowercase words without the added capital letter / final period
const toWords = t => t.replace(/[.]$/, '').toLowerCase().split(/\s+/).filter(Boolean);

module.exports = { load, words, toWords };
