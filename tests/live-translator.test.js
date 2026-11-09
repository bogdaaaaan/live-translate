const test = require('node:test');
const assert = require('node:assert/strict');
const { load, words, toWords } = require('./harness');

test('subs: 60 fast words with no pause stay ONE paragraph', async () => {
  const sim = load({ mode: 'subs' });
  await sim.start();
  await sim.speak(words(60));
  assert.equal(sim.paragraphs().length, 1);
  await sim.silence(2000);
  assert.equal(sim.paragraphs().length, 1);
  assert.deepEqual(toWords(sim.paragraphs()[0]), words(60));
});

test('subs: a real pause starts a new paragraph', async () => {
  const sim = load({ mode: 'subs' });
  await sim.start();
  await sim.speak(words(10));
  await sim.silence(1500);
  await sim.speak(words(10, 11));
  await sim.silence(2000);
  const ps = sim.paragraphs();
  assert.equal(ps.length, 2);
  assert.deepEqual(toWords(ps[0]), words(10));
  assert.deepEqual(toWords(ps[1]), words(10, 11));
});

test('subs: a gap shorter than the pause setting does not split', async () => {
  const sim = load({ mode: 'subs', pause: '1000' });
  await sim.start();
  await sim.speak(words(10));
  await sim.silence(500);
  await sim.speak(words(10, 11));
  await sim.silence(2000);
  assert.deepEqual(sim.paragraphs().map(toWords), [words(20)]);
});

test('subs: words still arriving while the mic is quiet (Chrome lag) do not split', async () => {
  const sim = load({ mode: 'subs', pause: '1000' });
  await sim.start();
  await sim.speak(words(10));
  await sim.speak(words(4, 11), { wordMs: 450, micHears: false });
  await sim.speak(words(10, 15));
  await sim.silence(2000);
  assert.deepEqual(sim.paragraphs().map(toWords), [words(24)]);
});

test('subs: noisy room (mic never quiet) still ends the paragraph after a long stop in words', async () => {
  const sim = load({ mode: 'subs' });
  await sim.start();
  await sim.speak(words(10));
  sim.speaking = true;                       // noise, but no new words
  await sim.advance(2500);
  assert.equal(sim.doc.querySelectorAll('p.sub .txt').length, 1);   // paragraph still open
  await sim.advance(1000);
  assert.equal(sim.doc.querySelectorAll('p.sub .txt').length, 0);   // closed
  await sim.speak(words(5, 11));
  await sim.silence(2000);
  assert.deepEqual(sim.paragraphs().map(toWords), [words(10), words(5, 11)]);
});

test('no words lost or duplicated with late finals and Chrome restarts mid-sentence', async () => {
  const sim = load({ mode: 'subs' });
  await sim.start();
  await sim.speak(words(23));
  sim.finalizeAll();                         // late finals of words already shown
  await sim.chromeEnds();                    // restart
  assert.equal(sim.recs.length, 2);
  await sim.speak(words(17, 24));
  await sim.chromeEnds();                    // restart with words never finalised
  assert.equal(sim.recs.length, 3);
  await sim.speak(words(12, 41));
  await sim.silence(2000);
  assert.deepEqual(sim.paragraphs().map(toWords), [words(52)]);
});

test('translate: one block per sentence, translated with the Smart model', async () => {
  const sim = load({ mode: 'translate', engine: 'smart' });
  await sim.start();
  await sim.speak(words(12));
  await sim.silence(1500);
  await sim.speak(words(55, 13));            // long fast sentence, no pause
  await sim.silence(2000);
  const bs = sim.blocks();
  assert.equal(bs.length, 2);
  assert.deepEqual(toWords(bs[0].de), words(12));
  assert.deepEqual(toWords(bs[1].de), words(55, 13));
  bs.forEach(b => assert.equal(b.en, 'S(' + b.de + ')'));
  assert.ok(sim.doc.querySelector('#interim').classList.contains('empty'));
});

test('translate: 130 words without a pause are translated in runs of 60, nothing lost', async () => {
  const sim = load({ mode: 'translate', engine: 'chrome' });
  await sim.start();
  await sim.speak(words(130));
  await sim.silence(2000);
  const bs = sim.blocks();
  assert.deepEqual(bs.map(b => toWords(b.de).length), [60, 60, 10]);
  assert.deepEqual(bs.flatMap(b => toWords(b.de)), words(130));
  bs.forEach(b => assert.equal(b.en, 'F(' + b.de + ')'));
});

test('translate: falls back to Google when no on-device translators exist', async () => {
  const sim = load({ mode: 'translate', translator: false, model: false });
  await sim.start();
  await sim.speak(words(8));
  await sim.silence(2000);
  const bs = sim.blocks();
  assert.equal(bs.length, 1);
  assert.equal(bs[0].en, 'G(' + bs[0].de + ')');
});

test('subs mode never calls a translator', async () => {
  const sim = load({ mode: 'subs' });
  await sim.start();
  await sim.speak(words(20));
  await sim.silence(2000);
  assert.deepEqual(sim.calls, { smart: [], fast: [], google: [] });
});
