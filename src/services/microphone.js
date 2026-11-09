// Microphone level meter + voice detection (getUserMedia + AnalyserNode).
(() => {
  const LT = globalThis.LT ??= {};

  let stream = null, ctx = null, raf = 0, lastVoiceAt = 0;

  LT.microphone = {
    // When the microphone last heard voice (set to "now" on start, so a broken mic
    // just means pauses are detected from missing words alone)
    get lastVoiceAt() { return lastVoiceAt; },

    // onLevel(level 0..1, silent): silent = the mic has heard total silence for 15 s
    async start({ onLevel, onError }) {
      lastVoiceAt = Date.now();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        ctx = new AudioContext(); ctx.resume().catch(() => {});
        const an = ctx.createAnalyser(); an.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf32 = new Float32Array(an.fftSize);
        const isVoice = LT.createVoiceDetector(Date.now());
        let quietSince = Date.now();
        const tick = () => {
          an.getFloatTimeDomainData(buf32);
          let sum = 0; for (const v of buf32) sum += v * v;
          const level = Math.min(1, Math.sqrt(sum / buf32.length) * 8);
          const now = Date.now();
          if (isVoice(level, now)) lastVoiceAt = now;
          if (level > 0.005) quietSince = now;
          onLevel(level, now - quietSince > 15000);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) { onError(e); }
    },

    stop() {
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (ctx) ctx.close().catch(() => {});
      stream = ctx = null;
    },
  };
})();
