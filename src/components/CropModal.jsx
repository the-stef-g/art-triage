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

export default function CropModal({ row, onClose, onDone, onError }) {
  const [A, setA] = useState(1.5);
  const [format, setFormat] = useState('3:2');
  const [rect, setRect] = useState(() => stoerste(1.5, 1.5));
  const [gemmer, setGemmer] = useState(false);
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
    const taste = (e) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', taste, true);
    return () => window.removeEventListener('keydown', taste, true);
  }, [onClose]);

  const vaelgFormat = (f, nyA = A) => {
    setFormat(f);
    setRect(stoerste(FORMATER.find(([n]) => n === f)[1], nyA));
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
      setRect((r) => ({ ...r, x: klem(p.x - t.dx, 0, 1 - r.w), y: klem(p.y - t.dy, 0, 1 - r.h) }));
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
    setRect({ x: p.x >= t.ax ? t.ax : t.ax - w, y: p.y >= t.ay ? t.ay : t.ay - h, w, h });
  };

  const slip = () => { trak.current = null; };

  const gem = async () => {
    setGemmer(true);
    try {
      const res = await invoke('crop:save', { versionId: row.version_id, rect, ratio: format });
      onDone(res.bit8
        ? `Saved ${res.rel}. It is 8 bit: the 16 bit crop needs macOS.`
        : `Saved ${res.rel}`);
    } catch (err) {
      onError(err);
      setGemmer(false);
    }
  };

  return (
    <div className="crop-bag" onClick={onClose}>
      <div className="crop-vindue" onClick={(e) => e.stopPropagation()}>
        <div className="crop-top">
          <strong title={row.rel_path}>Crop {fileName(row.rel_path)}</strong>
          <span className="crop-formater">
            {FORMATER.map(([f]) => (
              <button
                key={f}
                className={f === format ? 'aktiv-redigeres' : ''}
                onClick={() => vaelgFormat(f)}
              >
                {f === 'free' ? 'Free' : f}
              </button>
            ))}
          </span>
        </div>
        <div className="crop-scene">
          <div
            className="crop-flade"
            ref={fladeRef}
            onPointerMove={flyt}
            onPointerUp={slip}
            onPointerCancel={slip}
          >
            <img
              src={thumbUrl(row.file_id, row.mtime, 2048, row.rotation)}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const nyA = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight;
                setA(nyA);
                setRect(stoerste(forhold, nyA));
              }}
            />
            <div
              className="crop-ramme"
              style={{
                left: `${rect.x * 100}%`, top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`, height: `${rect.h * 100}%`,
              }}
              onPointerDown={(e) => start(e, 'flyt')}
            >
              {['nw', 'ne', 'sw', 'se'].map((h) => (
                <span key={h} className={`crop-greb ${h}`} onPointerDown={(e) => start(e, 'stoerrelse', h)} />
              ))}
            </div>
          </div>
        </div>
        <div className="crop-bund">
          <span className="tom">
            Saved in Master as «{nytNavn}», exactly {format}. Under 5 Print it is
            enlarged in Gigapixel and becomes the print file.
          </span>
          <button onClick={onClose}>Cancel</button>
          <button disabled={gemmer} onClick={gem}>{gemmer ? 'Saving …' : 'Save crop'}</button>
        </div>
      </div>
    </div>
  );
}
