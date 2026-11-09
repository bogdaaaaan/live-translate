// Word pipeline: Chrome recognition results → stable words + live words.
// The newest KEEP_LIVE words stay "live" (Chrome may still correct them); older ones are
// passed on right away. `sent` counts pending words already passed on, so Chrome's late
// finals don't duplicate text.
(() => {
  const LT = globalThis.LT ??= {};
  const { split } = LT.text;
  const KEEP_LIVE = 5;

  LT.createPipeline = ({ onWords, onLive, onNewWords }) => {
    const s = { finalsDone: 0, sent: 0, pend: [], totalWords: 0 };
    const emit = ws => { if (ws.length) onWords(ws); };

    return {
      // New recognition session: Chrome starts a fresh result list
      reset() { s.finalsDone = 0; s.sent = 0; s.pend = []; s.totalWords = 0; },

      // Read the whole result list on every event (fast speech = many tiny results)
      results(res) {
        let allWords = 0;
        for (let j = 0; j < res.length; j++) allWords += split(res[j][0].transcript).length;
        if (allWords > s.totalWords) onNewWords();
        s.totalWords = allWords;

        // Finished results
        while (s.finalsDone < res.length && res[s.finalsDone].isFinal) {
          const w = split(res[s.finalsDone][0].transcript);
          if (w.length > s.sent) emit(w.slice(s.sent));
          s.sent = Math.max(0, s.sent - w.length);
          s.finalsDone++;
        }
        // Still in progress
        let pending = '';
        for (let j = s.finalsDone; j < res.length; j++) pending += ' ' + res[j][0].transcript;
        const w = split(pending);
        s.pend = w;
        if (s.sent > w.length) s.sent = w.length;
        // Newest words stay live; older ones go to sentence detection right away
        if (w.length - s.sent > KEEP_LIVE) {
          emit(w.slice(s.sent, w.length - KEEP_LIVE));
          s.sent = w.length - KEEP_LIVE;
        }
        onLive(w.slice(s.sent).join(' '));
      },

      hasPending: () => s.pend.length > s.sent,

      // Session ended or pause: keep words that were not finalised yet
      commitPending() {
        if (s.pend.length > s.sent) {
          const ws = s.pend.slice(s.sent);
          s.sent = s.pend.length;
          emit(ws);
        }
        onLive('');
      },
    };
  };
})();
