// Fremdriftsmeldinger fra AI-vinduet. Med Content-Length paa modelfilerne
// kommer der en melding for hvert stykke data, ca. 6.000 ved en opstart, og
// hver blev til en IPC-besked, en opdatering af brugerfladen og en logline.
import { describe, it, expect } from 'vitest';
import { statusTrottle } from '../ai/throttle.js';

function lav(ms = 250) {
  const sendt = [];
  let tid = 0;
  const t = statusTrottle((p) => sendt.push(p), { ms, now: () => tid });
  return { t, sendt, gaa: (n) => { tid += n; } };
}

describe('statusTrottle', () => {
  it('sender den foerste melding med det samme', () => {
    const { t, sendt } = lav();
    expect(t(1)).toBe(true);
    expect(sendt).toEqual([1]);
  });

  it('daemper en byge af meldinger til hoejst én pr. interval', () => {
    const { t, sendt, gaa } = lav(250);
    for (let i = 0; i < 6000; i++) {
      t(Math.floor(i / 60)); // procenten stiger langsomt, tiden staar naesten stille
      gaa(0.5); // 3 sekunder i alt
    }
    // Tre sekunder med et interval paa 250 ms: hoejst ca. tolv, ikke 6.000.
    expect(sendt.length).toBeLessThanOrEqual(13);
    expect(sendt.length).toBeGreaterThan(5);
    expect(sendt).toEqual([...sendt].sort((a, b) => a - b)); // stiger hele vejen
  });

  it('sender ikke den samme procent igen, ogsaa naar der er gaaet tid', () => {
    const { t, sendt, gaa } = lav();
    t(40);
    gaa(1000);
    expect(t(40)).toBe(false);
    expect(sendt).toEqual([40]);
    gaa(1000);
    expect(t(41)).toBe(true);
  });

  it('kan tvinges, saa 100 % aldrig sluges af intervallet', () => {
    const { t, sendt, gaa } = lav();
    t(99);
    gaa(10);
    expect(t(100)).toBe(false); // for tidligt
    expect(t(100, true)).toBe(true);
    expect(sendt).toEqual([99, 100]);
  });

  it('kan nulstilles, fx naar en ny fase begynder', () => {
    const { t, sendt } = lav();
    t(50);
    t.nulstil();
    expect(t(50)).toBe(true);
    expect(sendt).toEqual([50, 50]);
  });
});
