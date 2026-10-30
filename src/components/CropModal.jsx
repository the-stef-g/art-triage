import { useEffect, useRef, useState } from 'react';
import { invoke, thumbUrl } from '../api';
import { fileName } from '../util';

// Formaterne er de samme som printfilerne: forholdet er bredde / hoejde.
const FORMATER = [
  ['1:1', 1], ['2:3', 2 / 3], ['3:2', 3 / 2], ['1:2', 1 / 2], ['2:1', 2],
];
const MIN = 0.03;

// Den stoerste beskaering med forholdet, midt i billedet. A er billedets
// bredde / hoejde, saa en normaliseret ramme med forholdet f har w/h = f / A.
function stoerste(forhold, A) {
  if (forhold === null) return { x: 0, y: 0, w: 1, h: 1 };
  let w = 1;
  let h = A / forhold;
  if (h > 1) {
    h = 1;
    w = forhold / A;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

const klem = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Det format der ligner billedet mest, saa beskaeringen starter der.
function naermeste(A) {
  let bedst = FORMATER[0];
  for (const f of FORMATER) {
    if (Math.abs(Math.log(f[1] / A)) < Math.abs(Math.log(bedst[1] / A))) bedst = f;
  }
  return bedst[0];
}

// Ligger rammens fire hjoerner inde i billedet, naar det er drejet vinkel
// grader om sin midte? Regnet i enheder hvor billedet er A bredt og 1 hoejt.
function inde(r, vinkel, A) {
  if (!vinkel) return true;
  const rad = (-vinkel * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].every(([x, y]) => {
    const px = (x - 0.5) * A;
    const py = y - 0.5;
    const qx = px * cos - py * sin;
    const qy = px * sin + py * cos;
    return Math.abs(qx) <= A / 2 + 1e-6 && Math.abs(qy) <= 0.5 + 1e-6;
  });
}

// Formindsker rammen mod et fast punkt (ax, ay), til den ligger inde i det
// drejede billede. Formatet holdes, for hoejde og bredde skaleres ens.
function krymp(r, vinkel, A, ax, ay) {
  if (inde(r, vinkel, A)) return r;
  const skaleret = (s) => ({ x: ax + (r.x - ax) * s, y: ay + (r.y - ay) * s, w: r.w * s, h: r.h * s });
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const m = (lo + hi) / 2;
    if (inde(skaleret(m), vinkel, A)) lo = m; else hi = m;
  }
  return skaleret(lo);
}

// inline: beskaeringen staar midt i vinduet i Crop i stedet for oven paa
// det. Saa fanger den ikke tasterne, og den bliver staaende efter Gem, saa
// den naeste beskaering kan laves med det samme.
export default function CropModal({ row, onClose, onDone, onError, inline = false }) {
  const [A, setA] = useState(1.5);
  const [format, setFormat] = useState('3:2');
  const [rect, setRect] = useState(() => stoerste(1.5, 1.5));
  const [gemmer, setGemmer] = useState(false);
  // Fri drejning af beskaeringen, fx for at rette horisonten op. Indenfor:
  // rammen holdes inde i det drejede billede, saa der ingen tomme hjoerner
  // kommer. Ellers bliver de gennemsigtige og kan fyldes ud i Photoshop.
  const [vinkel, setVinkel] = useState(0);
  const [indenfor, setIndenfor] = useState(true);
  const fladeRef = useRef(null);
  const trak = useRef(null);
  const forhold = FORMATER.find(([f]) => f === format)[1];
  // Samme navn som crop.mjs giver filen: "Mur 2 3-2.tif".
  const kildeNavn = fileName(row.rel_path);
  const punkt = kildeNavn.lastIndexOf('.');
  const nytNavn = punkt > 0
    ? `${kildeNavn.slice(0, punkt)} ${format.replace(':', '-')}${kildeNavn.slice(punkt)}`
    : `${kildeNavn} ${format.replace(':', '-')}`;

  // Escape lukker, og ingen anden genvej maa ramme billederne bag vinduet.
  useEffect(() => {
    if (inline) return undefined;
    const taste = (e) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', taste, true);
    return () => window.removeEventListener('keydown', taste, true);
  }, [onClose, inline]);

  // Den stoerste ramme med formatet, der passer i det (drejede) billede.
  const stoersteInde = (f, nyA, v = vinkel, ind = indenfor) => {
    const r = stoerste(FORMATER.find(([n]) => n === f)[1], nyA);
    return ind ? krymp(r, v, nyA, 0.5, 0.5) : r;
  };

  const vaelgFormat = (f, nyA = A) => {
    setFormat(f);
    setRect(stoersteInde(f, nyA));
  };

  // Ved en ny vinkel bliver rammen saa stor som muligt om sin midte.
  const drej = (v) => {
    const ny = klem(Number(v) || 0, -45, 45);
    setVinkel(ny);
    setRect((r) => {
      if (!indenfor) return r;
      const fuld = stoerste(forhold, A);
      const cx = klem(r.x + r.w / 2, fuld.w / 2, 1 - fuld.w / 2);
      const cy = klem(r.y + r.h / 2, fuld.h / 2, 1 - fuld.h / 2);
      return krymp({ x: cx - fuld.w / 2, y: cy - fuld.h / 2, w: fuld.w, h: fuld.h }, ny, A, cx, cy);
    });
  };

  const skiftIndenfor = (ind) => {
    setIndenfor(ind);
    if (ind) setRect((r) => krymp(r, vinkel, A, r.x + r.w / 2, r.y + r.h / 2));
  };

  const pos = (e) => {
    const r = fladeRef.current.getBoundingClientRect();
    return { x: klem((e.clientX - r.left) / r.width, 0, 1), y: klem((e.clientY - r.top) / r.height, 0, 1) };
  };

  const start = (e, art, hjoerne) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = pos(e);
    if (art === 'flyt') {
      trak.current = { art, dx: p.x - rect.x, dy: p.y - rect.y };
    } else {
      // Det modsatte hjoerne staar fast.
      trak.current = {
        art,
        ax: hjoerne.includes('w') ? rect.x + rect.w : rect.x,
        ay: hjoerne.includes('n') ? rect.y + rect.h : rect.y,
      };
    }
  };

  const flyt = (e) => {
    const t = trak.current;
    if (!t) return;
    const p = pos(e);
    if (t.art === 'flyt') {
      setRect((r) => {
        const ny = { ...r, x: klem(p.x - t.dx, 0, 1 - r.w), y: klem(p.y - t.dy, 0, 1 - r.h) };
        // Indenfor kan rammen ikke flyttes ud over billedets kant.
        return indenfor && !inde(ny, vinkel, A) ? r : ny;
      });
      return;
    }
    const mod = p.x >= t.ax ? 1 - t.ax : t.ax; // plads at vokse i x
    const modY = p.y >= t.ay ? 1 - t.ay : t.ay;
    let w = Math.abs(p.x - t.ax);
    let h = Math.abs(p.y - t.ay);
    if (forhold !== null) {
      w = Math.min(w, mod, (modY * forhold) / A);
      h = (w * A) / forhold;
    } else {
      w = Math.min(w, mod);
      h = Math.min(h, modY);
    }
    w = Math.max(w, MIN);
    h = Math.max(h, forhold !== null ? (w * A) / forhold : MIN);
    const ny = { x: p.x >= t.ax ? t.ax : t.ax - w, y: p.y >= t.ay ? t.ay : t.ay - h, w, h };
    setRect(indenfor ? krymp(ny, vinkel, A, t.ax, t.ay) : ny);
  };

  const slip = () => { trak.current = null; };

  const gem = async () => {
    setGemmer(true);
    try {
      const res = await invoke('crop:save', { versionId: row.version_id, rect, ratio: format, vinkel });
      onDone(res.bit8
        ? `Saved ${res.rel}. It is 8 bit: the 16 bit crop needs macOS.`
        : `Saved ${res.rel}`);
      if (inline) setGemmer(false);
    } catch (err) {
      onError(err);
      setGemmer(false);
    }
  };

  return (
    <div className={inline ? 'crop-inline' : 'crop-bag'} onClick={inline ? undefined : onClose}>
      <div className="crop-vindue" onClick={(e) => e.stopPropagation()}>
        <div className="crop-top">
          <strong title={row.rel_path}>Crop {fileName(row.rel_path)}</strong>
          <span className="crop-formater">
            {FORMATER.map(([f]) => (
              <button
                key={f}
                className={f === format ? 'primaer' : ''}
                onClick={() => vaelgFormat(f)}
              >
                {f === 'free' ? 'Free' : f}
              </button>
            ))}
          </span>
        </div>
        <div className="crop-drej">
          <label htmlFor="crop-vinkel">Straighten</label>
          <input
            id="crop-vinkel"
            type="range"
            min="-45"
            max="45"
            step="0.1"
            value={vinkel}
            onChange={(e) => drej(e.target.value)}
          />
          <input
            className="crop-vinkel-tal"
            type="number"
            min="-45"
            max="45"
            step="0.1"
            value={vinkel}
            onChange={(e) => drej(e.target.value)}
            aria-label="Angle in degrees"
          />
          <span>°</span>
          {vinkel !== 0 && <button className="lille" onClick={() => drej(0)}>Reset</button>}
          <label className="crop-indenfor">
            <input type="checkbox" checked={indenfor} onChange={(e) => skiftIndenfor(e.target.checked)} />
            Keep inside the picture
          </label>
          {!indenfor && vinkel !== 0 && (
            <span className="tom">Blank corners are transparent, ready to fill in Photoshop.</span>
          )}
        </div>
        <div className="crop-scene">
          {/* Grebene ligger i et lag over billedet, saa de kan stikke ud over
              kanten uden at blive skaaret af. */}
          <div className="crop-stage" onPointerMove={flyt} onPointerUp={slip} onPointerCancel={slip}>
            <div className="crop-flade" ref={fladeRef}>
              <img
                src={thumbUrl(row.file_id, row.mtime, 2048, row.rotation)}
                alt=""
                draggable={false}
                style={vinkel ? { transform: `rotate(${vinkel}deg)` } : undefined}
                onLoad={(e) => {
                  const nyA = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight;
                  const f = naermeste(nyA);
                  setA(nyA);
                  setFormat(f);
                  setRect(stoersteInde(f, nyA));
                }}
              />
              <div
                className="crop-ramme"
                style={{
                  left: `${rect.x * 100}%`, top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`, height: `${rect.h * 100}%`,
                }}
                onPointerDown={(e) => start(e, 'flyt')}
              />
            </div>
            <div className="crop-greb-lag">
              <div
                className="crop-greb-ramme"
                style={{
                  left: `${rect.x * 100}%`, top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`, height: `${rect.h * 100}%`,
                }}
              >
                {['nw', 'ne', 'sw', 'se'].map((h) => (
                  <span key={h} className={`crop-greb ${h}`} onPointerDown={(e) => start(e, 'stoerrelse', h)} />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="crop-bund">
          <span className="tom">
            Saved in Master as «{nytNavn}», exactly {format}. Under Print it is
            enlarged in Gigapixel and becomes the print file.
          </span>
          {!inline && <button onClick={onClose}>Cancel</button>}
          <button className="primaer" disabled={gemmer} onClick={gem}>{gemmer ? 'Saving …' : 'Save crop'}</button>
        </div>
      </div>
    </div>
  );
}
