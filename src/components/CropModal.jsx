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
// Formater der allerede er beskaaret, springes over, hvis der er andre.
function naermeste(A, optaget = new Set()) {
  const frie = FORMATER.filter(([f]) => !optaget.has(f));
  const kandidater = frie.length ? frie : FORMATER;
  let bedst = kandidater[0];
  for (const f of kandidater) {
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
// crops: vaerkets beskaeringer, { format, versionId, foraeldet }. Et format
// der allerede er beskaaret, kan ikke vaelges igen; minus i hjoernet af
// knappen fjerner beskaeringen. meta og onFinder staar i toppen.
export default function CropModal({
  row, onClose, onDone, onError, inline = false, crops = [], meta = null, onFinder = null, onSletCrop = null,
  fra = [], onFra = null,
}) {
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
  const sceneRef = useRef(null);
  // Pladsen billedet har, og billedfeltets stoerrelse paa skaermen. Billedet
  // tilpasses pladsen, saa det aldrig gaar ind over knapperne under det.
  const [plads, setPlads] = useState(null);
  const [felt, setFelt] = useState({ w: 0, h: 0 });
  // Nettet vises, mens rammen traekkes, flyttes eller billedet drejes.
  const [traekker, setTraekker] = useState(false);
  const trak = useRef(null);
  const forhold = FORMATER.find(([f]) => f === format)[1];
  const findes = new Map(crops.map((c) => [c.format, c]));
  // Formater der er slaaet fra for vaerket, skal ikke bruges og foreslaas
  // ikke. Er alle beskaaret eller slaaet fra, er der intet at beskaere.
  const slaaetFra = new Set(fra);
  const optaget = new Set([...findes.keys(), ...slaaetFra]);
  const intetAtBeskaere = FORMATER.every(([f]) => optaget.has(f));

  useEffect(() => {
    const maal = () => {
      const sc = sceneRef.current;
      if (sc) setPlads({ w: Math.max(100, sc.clientWidth - 48), h: Math.max(100, sc.clientHeight - 48) });
      const fl = fladeRef.current;
      if (fl) setFelt({ w: fl.clientWidth, h: fl.clientHeight });
    };
    maal();
    const ro = new ResizeObserver(maal);
    if (sceneRef.current) ro.observe(sceneRef.current);
    if (fladeRef.current) ro.observe(fladeRef.current);
    return () => ro.disconnect();
  }, []);

  // Slipper man musen uden for vinduet, stopper traekket alligevel.
  useEffect(() => {
    const stop = () => { trak.current = null; setTraekker(false); };
    window.addEventListener('pointerup', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('blur', stop);
    };
  }, []);

  // Er formatet lige blevet beskaaret, gaar valget videre til det naeste
  // ledige, saa den naeste beskaering kan laves med det samme.
  const cropNoegle = `${crops.map((c) => c.format).sort().join(',')}|${[...slaaetFra].sort().join(',')}`;
  useEffect(() => {
    if (optaget.has(format) && !intetAtBeskaere) vaelgFormat(naermeste(A, optaget));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropNoegle]);

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
    setTraekker(true);
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

  // Fri drejning som i Photoshop: traek uden for rammen, og billedet
  // drejer om sin midte med musen.
  const startDrej = (e) => {
    if (e.button !== 0 || !fladeRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const b = fladeRef.current.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    trak.current = { art: 'drej', cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), v0: vinkel };
    setTraekker(true);
  };

  const flyt = (e) => {
    const t = trak.current;
    if (!t) return;
    // Knappen er sluppet, selv om slip-haendelsen ikke naaede frem.
    if (e.buttons === 0) {
      slip();
      return;
    }
    if (t.art === 'drej') {
      const a = Math.atan2(e.clientY - t.cy, e.clientX - t.cx);
      let d = ((a - t.a0) * 180) / Math.PI;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      drej(Math.round((t.v0 + d) * 10) / 10);
      return;
    }
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

  const slip = () => { trak.current = null; setTraekker(false); };

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
          {meta && <span className="detaljer crop-meta">{meta}</span>}
          {onFinder && <button className="crop-finder" onClick={onFinder}>Show in Finder</button>}
        </div>
        {/* Uden for rammen drejes billedet; rammen flyttes, og grebene
            aendrer stoerrelsen. */}
        <div
          className="crop-scene"
          ref={sceneRef}
          onPointerDown={startDrej}
          onPointerMove={flyt}
          onPointerUp={slip}
          onPointerCancel={slip}
          title="Drag outside the frame to turn the picture"
        >
          {/* Grebene ligger i et lag over billedet, saa de kan stikke ud over
              kanten uden at blive skaaret af. */}
          <div className="crop-stage">
            <div className="crop-flade" ref={fladeRef}>
              <img
                src={thumbUrl(row.file_id, row.mtime, 2048, row.rotation)}
                alt=""
                draggable={false}
                style={{
                  ...(vinkel ? { transform: `rotate(${vinkel}deg)` } : {}),
                  ...(inline && plads ? { maxWidth: plads.w, maxHeight: plads.h } : {}),
                }}
                onLoad={(e) => {
                  const nyA = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight;
                  const f = naermeste(nyA, optaget);
                  setA(nyA);
                  setFormat(f);
                  setRect(stoersteInde(f, nyA));
                }}
              />
              {!intetAtBeskaere && (
              <div
                className="crop-ramme"
                style={{
                  left: `${rect.x * 100}%`, top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`, height: `${rect.h * 100}%`,
                }}
                onPointerDown={(e) => start(e, 'flyt')}
              >
                {traekker && <Net format={format} bredde={rect.w * felt.w} />}
              </div>
              )}
            </div>
            {!intetAtBeskaere && (
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
            )}
          </div>
        </div>
        {/* Bunden: drejningen til venstre, formaterne og Gem til hoejre,
            saa musen ikke skal op og ned. */}
        <div className="crop-bund">
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
            <label className="crop-indenfor" title={!indenfor && vinkel !== 0 ? 'Blank corners are transparent, ready to fill in Photoshop.' : undefined}>
              <input type="checkbox" checked={indenfor} onChange={(e) => skiftIndenfor(e.target.checked)} />
              Keep inside the picture
            </label>
          </div>
          <span className="crop-formater">
            {FORMATER.map(([f]) => {
              const c = findes.get(f);
              const af = !c && slaaetFra.has(f);
              const valgt = !c && !af && f === format && !intetAtBeskaere;
              // Klik paa det valgte format slaar det fra; klik paa et slaaet
              // fra format slaar det til igen og vaelger det.
              const klik = () => {
                if (af) {
                  onFra?.(f, false);
                  vaelgFormat(f);
                } else if (valgt && onFra) {
                  onFra(f, true);
                } else {
                  vaelgFormat(f);
                }
              };
              return (
                <span key={f} className={`crop-format ${c ? 'findes' : ''} ${c?.foraeldet ? 'foraeldet' : ''} ${af ? 'fra' : ''}`}>
                  <button
                    className={valgt ? 'primaer' : ''}
                    disabled={Boolean(c)}
                    onClick={klik}
                    title={c
                      ? (c.foraeldet ? `${f} is cropped, but from an older master. Remove it and crop again.` : `${f} is cropped`)
                      : af ? `${f} is not used for this work. Click to use it again.`
                        : valgt && onFra ? `Click again to turn ${f} off for this work` : `Crop ${f}`}
                  >
                    {c ? `✓ ${f}` : f}
                  </button>
                  {c && onSletCrop && (
                    <button
                      className="crop-minus"
                      onClick={() => onSletCrop(c)}
                      title={`Remove the ${f} crop (to the Trash)`}
                      aria-label={`Remove the ${f} crop`}
                    >
                      −
                    </button>
                  )}
                </span>
              );
            })}
          </span>
          {!inline && <button onClick={onClose}>Cancel</button>}
          {intetAtBeskaere && <span className="tom crop-intet">Every format is cropped or turned off.</span>}
          <button className="primaer" disabled={gemmer || optaget.has(format) || intetAtBeskaere} onClick={gem}>{gemmer ? 'Saving …' : 'Save crop'}</button>
        </div>
      </div>
    </div>
  );
}

// Nettet i rammen: tredjedelene (afdaempet) og et fint, stiplet net med
// cirka en centimeter mellem stregerne, som i Photoshop og Lightroom. Alle
// tern er lige store og hele: i formatet p:q er der p·k gange q·k tern.
const CM = 38;
function Net({ format, bredde }) {
  const [p, q] = format.split(':').map(Number);
  const k = Math.max(1, Math.round(bredde / (p * CM)));
  const n = p * k;
  const m = q * k;
  const fine = [];
  for (let i = 1; i < n; i += 1) fine.push(<line key={`v${i}`} x1={i} y1={0} x2={i} y2={m} />);
  for (let j = 1; j < m; j += 1) fine.push(<line key={`h${j}`} x1={0} y1={j} x2={n} y2={j} />);
  return (
    <svg className="crop-net" viewBox={`0 0 ${n} ${m}`} preserveAspectRatio="none" aria-hidden="true">
      <g className="fin">{fine}</g>
      <g className="tredjedel">
        <line x1={n / 3} y1={0} x2={n / 3} y2={m} />
        <line x1={(2 * n) / 3} y1={0} x2={(2 * n) / 3} y2={m} />
        <line x1={0} y1={m / 3} x2={n} y2={m / 3} />
        <line x1={0} y1={(2 * m) / 3} x2={n} y2={(2 * m) / 3} />
      </g>
    </svg>
  );
}
