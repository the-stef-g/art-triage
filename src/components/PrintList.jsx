import { useEffect, useRef, useState } from 'react';
import { invoke, thumbUrl } from '../api';
import { fileName, foraeldetTekster, formatBytes } from '../util';
import { gigapixelMaal } from '../printmaal';

const px = (m) => (m ? `${m.bredde} × ${m.hoejde}` : '…');
// Prodigis graense for en printfil (1 MB = 1.000.000 bytes, som i Finder).
const MAKS_PRINT = 300 * 1000 * 1000;
const str = (bytes) => (bytes ? <span className="stoerrelse">{formatBytes(bytes)}</span> : null);

// Fase 4 som en liste: én linje pr. beskaering, med det Gigapixel skal
// forstoerre til, hvor stor forstoerrelsen er, og om printfilen er lavet.
// Saa kan det ses med det samme, hvad der mangler. Markeringen virker som i
// grid'et: klik, Cmd+klik og Skift+klik.
export default function PrintList({ rows, selected, active, setSelected, setActive, ankerRef, thumbRev, dataRev }) {
  const [maal, setMaal] = useState({});
  // Den lange side af det stoerste print i hvert format, fra prislisten.
  const [langsider, setLangsider] = useState({});
  const listeRef = useRef(null);

  // Maalene paa beskaeringerne og deres -giga-filer, i pixels.
  useEffect(() => {
    const filer = [];
    for (const r of rows) {
      filer.push({ id: r.file_id, mtime: r.mtime });
      if (r.giga_fil) filer.push({ id: r.giga_fil.id, mtime: r.giga_fil.mtime });
    }
    let aktuel = true;
    invoke('print:maal', { filer })
      .then((res) => {
        if (!aktuel) return;
        setMaal(res.maal || {});
        setLangsider(res.langsider || {});
      })
      .catch(() => {});
    return () => { aktuel = false; };
  }, [rows, dataRev]);

  useEffect(() => {
    listeRef.current?.querySelector('.print-linje.aktiv')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const klik = (r, i, e) => {
    if (e.shiftKey) {
      const anker = Math.max(0, Math.min(rows.length - 1, ankerRef.current));
      setSelected(rows.slice(Math.min(anker, i), Math.max(anker, i) + 1).map((x) => x.version_id));
    } else if (e.metaKey || e.ctrlKey) {
      ankerRef.current = i;
      setSelected((sel) => (sel.includes(r.version_id)
        ? sel.filter((id) => id !== r.version_id)
        : [...sel, r.version_id]));
    } else {
      ankerRef.current = i;
      setSelected([r.version_id]);
    }
    setActive(r.version_id);
  };

  const valgt = new Set(selected);

  return (
    <div className="print-liste" ref={listeRef}>
      <div className="print-indstilling">
        <span className="tom">
          The Gigapixel target is the largest print in each format in the price list, at 300 DPI:
          {' '}1:1 {langsider['1-1'] ?? '…'} cm, 2:3 and 3:2 {langsider['2-3'] ?? '…'} cm,
          {' '}1:2 and 2:1 {langsider['1-2'] ?? '…'} cm on the long side.
        </span>
      </div>
      <div className="print-linje hoved" role="row">
        <span />
        <span>Crop</span>
        <span>Crop size</span>
        <span>Gigapixel target</span>
        <span>Enlarged</span>
        <span>Print file</span>
      </div>
      {rows.length === 0 && <p className="tom">No crops yet. Make them under Crop.</p>}
      {rows.map((r, i) => {
        const token = r.crop ? r.crop.replace(':', '-') : null;
        const maalet = gigapixelMaal(token, token ? langsider[token] : null);
        const krop = maal[r.file_id];
        const giga = r.giga_fil ? maal[r.giga_fil.id] : null;
        const stor = giga && krop && giga.bredde * giga.hoejde > krop.bredde * krop.hoejde;
        const nok = stor && maalet && giga.bredde >= maalet.bredde * 0.99 && giga.hoejde >= maalet.hoejde * 0.99;
        return (
          <div
            key={r.version_id}
            role="row"
            className={`print-linje ${valgt.has(r.version_id) ? 'valgt' : ''} ${r.version_id === active ? 'aktiv' : ''} ${r.foraeldet ? 'foraeldet' : ''}`}
            onClick={(e) => klik(r, i, e)}
          >
            <img key={thumbRev} src={thumbUrl(r.file_id, r.mtime, 512, r.rotation)} alt="" draggable={false} />
            <span className="navn" title={r.rel_path}>
              <span className="navn-linje">
                {fileName(r.rel_path)}
                <span className="badge beskaering">{r.crop}</span>
              </span>
              {r.foraeldet && <span className="foraeldet-tekst">{foraeldetTekster(r.foraeldet)[0]}</span>}
            </span>
            <span className="tal">{px(krop)}{str(r.size)}</span>
            <span className="tal">{maalet ? px(maalet) : '–'}</span>
            <span className={`tal ${!r.giga_fil ? 'mangler' : nok ? 'ok' : stor ? 'halv' : 'mangler'}`}>
              {!r.giga_fil ? 'Not sent' : !stor ? 'Not yet' : `${nok ? '✓' : '○'} ${px(giga)}`}
              {r.giga_fil && str(r.giga_fil.size)}
            </span>
            <span className={!r.printfil ? 'mangler' : r.printfil.bytes > MAKS_PRINT ? 'for-stor' : 'ok'}>
              {r.printfil ? `${r.printfil.bytes > MAKS_PRINT ? '✕' : '✓'} ${fileName(r.printfil.rel)}` : '○'}
              {r.printfil && str(r.printfil.bytes)}
              {r.printfil && r.printfil.bytes > MAKS_PRINT && <span className="stoerrelse">Over Prodigi&apos;s 300 MB</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
