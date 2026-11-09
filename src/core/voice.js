// Voice detection from microphone levels.
// Background noise = the quietest moments of the last ~3 seconds (minimum of 12 buckets × 250 ms).
// Even during fast speech there are tiny gaps between words, so the teacher's voice is never
// mistaken for background noise.
(() => {
  const LT = globalThis.LT ??= {};

  LT.createVoiceDetector = now => {
    const mins = [];
    let bucketStart = now, bucketMin = 1;
    // → true if this level counts as voice
    return (level, now) => {
      bucketMin = Math.min(bucketMin, level);
      if (now - bucketStart > 250) { mins.push(bucketMin); if (mins.length > 12) mins.shift(); bucketMin = 1; bucketStart = now; }
      const floor = mins.length ? Math.min(...mins) : level;
      return level > floor * 2.5 + 0.02;
    };
  };
})();
