// Sentence detection: a sentence ends ONLY at a real pause.
// Words shown together in one paragraph are never split afterwards.
(() => {
  const LT = globalThis.LT ??= {};
  const { cap } = LT.text;

  // A pause = no new words for the pause time P AND the microphone is quiet.
  // Very noisy room (mic never quiet): a long stop in new words also counts.
  LT.isPause = (now, lastWordAt, lastVoiceAt, P) => {
    const noWords = now - lastWordAt, quiet = now - lastVoiceAt;
    return noWords > P && (quiet > P * 0.6 || noWords > Math.max(3000, P * 3));
  };

  // Collects the words of the unfinished sentence.
  // limit(): flush anyway once this many words pile up without a pause (Infinity = never).
  LT.createSentences = ({ onSentence, limit }) => {
    let buf = [];

    function flush(n) {
      const ws = buf.slice(0, n);
      buf = buf.slice(n);
      let t = ws.join(' ').trim();
      if (!t) return;
      t = cap(t);
      if (!/[.!?…]$/.test(t)) t = t.replace(/[,;:]$/, '') + '.';
      onSentence(t);
    }

    return {
      add(ws) {
        buf.push(...ws);
        if (buf.length >= limit()) flush(buf.length);
      },
      end() { if (buf.length) flush(buf.length); },   // real pause → the whole paragraph is one sentence
      clear() { buf = []; },
      text: () => buf.join(' '),
      size: () => buf.length,
    };
  };
})();
