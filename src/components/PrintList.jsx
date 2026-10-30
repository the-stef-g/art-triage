import { useEffect, useRef, useState } from 'react';
import { invoke, thumbUrl } from '../api';
import { fileName } from '../util';
import { gigapixelMaal } from '../printmaal';

const px = (m) => (m ? `${m.bredde} × ${m.hoejde}` : '…');

// Fase 4 som en liste: én linje pr. beskaering, med det Gigapixel skal
// forstoerre til, hvor stor forstoerrelsen er, og om printfilen er lavet.
// Saa kan det ses med det samme, hvad der mangler. Markeringen virker som i
// grid'et: klik, Cmd+klik og Skift+klik.
export default function PrintList({ rows, selected, active, setSelected, setActive, ankerRef, thumbRev, dataRev }) {
  const [maal, setMaal] = useState({});
  const [langsideCm, setLangsideCm] = useState(null);
  const [udkast, setUdkast] = useState('');
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
        setLangsideCm(res.langsideCm);
        setUdkast(res.langsideCm ? String(res.langsideCm) : '');
      })
      .catch(() => {});
    return () => { aktuel = false; };
  }, [rows, dataRev]);

  useEffect(() => {
    listeRef.current?.querySelector('.print-linje.aktiv')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const gemLangside = () => {
    if (String(langsideCm ?? '') === udkast.trim()) return;
    invoke('print:setLangside', { cm: udkast.trim() })
      .then((res) => setLangsideCm(res.langsideCm))
      .catch(() => {});
  };

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
        <label htmlFor="print-langside">Largest print, long side</label>
        <input
          id="print-langside"
          inputMode="decimal"
          value={udkast}
          placeholder="e.g. 100"
          onChange={(e) => setUdkast(e.target.value)}
          onBlur={gemLangside}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        <span>cm at 300 DPI.</span>
        <span className="tom">
          {langsideCm ? 'The Gigapixel column is the size to enlarge each crop to.' : 'Fill it in to see the size to enlarge each crop to in Gigapixel.'}
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
        const maalet = gigapixelMaal(token, langsideCm);
        const krop = maal[r.file_id];
        const giga = r.giga_fil ? maal[r.giga_fil.id] : null;
        const stor = giga && krop && giga.bredde * giga.hoejde > krop.bredde * krop.hoejde;
        const nok = stor && maalet && giga.bredde >= maalet.bredde * 0.99 && giga.hoejde >= maalet.hoejde * 0.99;
        return (
          <div
            key={r.version_id}
            role="row"
            className={`print-linje ${valgt.has(r.version_id) ? 'valgt' : ''} ${r.version_id === active ? 'aktiv' : ''}`}
            onClick={(e) => klik(r, i, e)}
          >
            <img key={thumbRev} src={thumbUrl(r.file_id, r.mtime, 512, r.rotation)} alt="" draggable={false} />
            <span className="navn" title={r.rel_path}>
              {fileName(r.rel_path)}
              <span className="badge beskaering">{r.crop}</span>
            </span>
            <span className="tal">{px(krop)}</span>
            <span className="tal">{maalet ? px(maalet) : '–'}</span>
            <span className={`tal ${!r.giga_fil ? 'mangler' : nok ? 'ok' : stor ? 'halv' : 'mangler'}`}>
              {!r.giga_fil ? 'Not sent' : !stor ? 'Not yet' : `${nok ? '✓' : '○'} ${px(giga)}`}
            </span>
            <span className={r.printfil ? 'ok' : 'mangler'}>
              {r.printfil ? `✓ ${fileName(r.printfil.rel)}` : '○'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
