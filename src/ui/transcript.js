// Transcript view: finished sentences, the sentence being spoken right now, auto-scroll.
//   Translate mode: one block per sentence (English on top, German below) + live preview.
//   Subtitle mode: one paragraph per sentence.
(() => {
  const LT = globalThis.LT ??= {};
  const { cap } = LT.text;
  const $ = s => document.querySelector(s);
  const out = $('#out'), interimEl = $('#interim');

  let mode = 'translate';
  let stick = true;
  let curP = null;                       // subtitle paragraph of the current sentence
  let cur = { txt: '', live: '' };       // last rendered unfinished sentence

  out.addEventListener('scroll', () => { stick = out.scrollHeight - out.scrollTop - out.clientHeight < 200; });
  const scrollDown = () => { if (stick) out.scrollTop = out.scrollHeight; };
  const removeHint = () => { const h = $('#hint'); if (h) h.remove(); };

  // Quick English preview of the unfinished sentence (translation mode)
  let previewTimer = null, previewSeq = 0;
  function schedulePreview() {
    if (previewTimer) return;
    previewTimer = setTimeout(async () => {
      previewTimer = null;
      const text = (cur.txt + ' ' + cur.live).trim();
      if (!text || mode !== 'translate') return;
      const seq = ++previewSeq;
      try {
        const en = await LT.translators.preview(text);
        if (seq === previewSeq && (cur.txt || cur.live)) interimEl.querySelector('.en').textContent = en;
      } catch (e) {}
    }, LT.translators.previewDelay());
  }

  LT.transcript = {
    setMode(m) {
      mode = m;
      document.body.classList.toggle('subs', mode === 'subs');
      if (curP) { curP.remove(); curP = null; }
    },

    // The unfinished sentence: txt = words already passed on, live = words Chrome may still correct
    render(txt, live) {
      cur = { txt, live };
      const liveShown = live ? (txt ? ' ' + live : cap(live)) : '';
      if (mode === 'subs') {
        if (!txt && !live) { if (curP) { curP.remove(); curP = null; } return; }
        if (!curP) {
          removeHint();
          curP = document.createElement('p');
          curP.className = 'sub';
          curP.innerHTML = '<span class="txt"></span><span class="live"></span>';
          out.insertBefore(curP, interimEl);
        }
        curP.querySelector('.txt').textContent = txt ? cap(txt) : '';
        curP.querySelector('.live').textContent = liveShown;
      } else {
        interimEl.classList.toggle('empty', !txt && !live);
        interimEl.querySelector('.txt').textContent = txt ? cap(txt) : '';
        interimEl.querySelector('.live').textContent = liveShown;
        if (!txt && !live) interimEl.querySelector('.en').textContent = '';
        else { removeHint(); schedulePreview(); }
      }
      scrollDown();
    },

    // A finished sentence in subtitle mode
    addParagraph(t) {
      removeHint();
      const p = document.createElement('p');
      p.className = 'sub';
      p.textContent = t;
      out.insertBefore(p, curP || interimEl);
      scrollDown();
    },

    // A finished sentence in translate mode → returns setEnglish(text)
    addBlock(de) {
      removeHint();
      const el = document.createElement('div');
      el.className = 'line pending';
      el.innerHTML = '<div class="en">…</div><div class="de"></div>';
      el.querySelector('.de').textContent = de;
      out.insertBefore(el, interimEl);
      scrollDown();
      return en => {
        el.querySelector('.en').textContent = en;
        el.classList.remove('pending');
        scrollDown();
      };
    },

    clear() {
      out.querySelectorAll('.line:not(#interim), p.sub').forEach(n => n.remove());
      curP = null;
    },
  };
})();
