// Translators DE → EN, in order of preference:
//   Smart: Chrome Prompt API / Gemini Nano with lesson context (fixes misheard words)
//   Fast:  Chrome Translator API, on-device
//   Fallback: Google's free translate_a/single endpoint
(() => {
  const LT = globalThis.LT ??= {};

  let fast = null, smartBase = null, ready = false;
  let setStatus = () => {};
  const history = [];                    // recent German sentences, context for Smart
  const queue = []; let busy = false;

  async function initFast() {
    if (!('Translator' in self)) return null;
    try {
      const opts = { sourceLanguage: 'de', targetLanguage: 'en' };
      const a = await Translator.availability(opts);
      if (a === 'unavailable') return null;
      if (a !== 'available') setStatus('Downloading translation model…');
      return await Translator.create({ ...opts, monitor(m) {
        m.addEventListener('downloadprogress', e => setStatus('Downloading translation model… ' + Math.round(e.loaded * 100) + '%'));
      }});
    } catch (e) { console.warn('Translator API unavailable', e); return null; }
  }

  function translatePrompt(topic, words) {
    return [
      'You translate a live German classroom lesson into English for a student.',
      'The German comes from automatic speech recognition and often contains misheard words',
      '(words that sound similar to what was really said). Use the lesson topic, the word list and the earlier text',
      'to work out what the teacher most likely meant, and translate that meaning.',
      topic ? 'Lesson topic: ' + topic : '',
      words.length ? 'Words likely to come up: ' + words.join(', ') : '',
      'Reply with ONLY the English translation of the new sentence. No explanations, no quotes, no German.'
    ].filter(Boolean).join('\n');
  }

  async function createModel(systemPrompt, variants) {
    if (!('LanguageModel' in self)) return null;
    for (const opts of variants) {
      try {
        const a = await LanguageModel.availability(opts);
        if (a === 'unavailable') continue;
        if (a !== 'available') setStatus('Downloading Chrome AI model…');
        return await LanguageModel.create({
          ...opts,
          initialPrompts: [{ role: 'system', content: systemPrompt }],
          monitor(m) { m.addEventListener('downloadprogress', e => setStatus('Downloading Chrome AI model… ' + Math.round(e.loaded * 100) + '%')); }
        });
      } catch (e) { console.warn('Prompt API variant failed', e); }
    }
    return null;
  }

  async function smartTranslate(text) {
    const s = await smartBase.clone();
    try {
      const before = history.slice(-3, -1).join(' ');
      const res = await s.prompt(
        (before ? 'Earlier (German, for context only): ' + before + '\n\n' : '') +
        'New sentence (German): ' + text + '\n\nEnglish translation of the new sentence:');
      return res.trim().replace(/^["„“]|["“”]$/g, '');
    } finally { s.destroy(); }
  }

  async function googleTranslate(text) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=de&tl=en&dt=t&q=' + encodeURIComponent(text);
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    return d[0].map(x => x[0]).join('');
  }

  async function translate(text, allowSmart) {
    if (allowSmart && smartBase) {
      try { return await smartTranslate(text); } catch (e) { console.warn('smart translate failed', e); }
    }
    if (fast) {
      try { return await fast.translate(text); } catch (e) { console.warn('fast translate failed', e); }
    }
    return googleTranslate(text);
  }

  async function pump() {
    if (busy) return; busy = true;
    while (queue.length) {
      const job = queue[0];
      const allowSmart = queue.length <= 2;   // smart model too slow for a fast speaker → catch up with fast translator
      try {
        job.done(await translate(job.de, allowSmart));
        queue.shift();
      } catch (e) {
        job.tries++;
        if (job.tries >= 3) {
          job.done('[translation failed]');
          queue.shift();
        } else {
          await new Promise(r => setTimeout(r, 1000 * job.tries));
        }
      }
    }
    busy = false;
  }

  LT.translators = {
    get ready() { return ready; },
    name: () => smartBase ? 'Smart' : fast ? 'Fast' : 'Google',

    // engine: 'smart' | 'chrome' | 'google'. Downloads run in the background.
    async init({ engine, topic, words, onStatus }) {
      ready = true;
      setStatus = onStatus;
      fast = null;
      if (smartBase) { try { smartBase.destroy(); } catch (e) {} smartBase = null; }
      if (engine !== 'google') fast = await initFast();
      if (engine === 'smart') smartBase = await createModel(translatePrompt(topic, words), [
        { expectedInputs: [{ type: 'text', languages: ['de', 'en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] },
        { expectedOutputs: [{ type: 'text', languages: ['en'] }] }, {}
      ]);
    },

    // Translate a finished sentence in order; done(english) is called once.
    enqueue(de, done) {
      history.push(de); if (history.length > 20) history.shift();
      queue.push({ de, done, tries: 0 });
      pump();
    },

    // Quick preview of the unfinished sentence (no Smart: too slow)
    preview: text => fast ? fast.translate(text) : googleTranslate(text),
    previewDelay: () => fast ? 700 : 2000,   // Google online: less often, to avoid being blocked
  };
})();
