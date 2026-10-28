import { useEffect, useRef, useState } from 'react';
import { invoke, thumbUrl } from '../api';

// Fase 1: billederne i Import, i den raekkefoelge de er skudt. Grid'et
// sorterer efter navn og viser én mappe ad gangen; her ses hele importen
// som den blev taget, ogsaa i den store visning.
export default function Filmstrip({ row, rows, visKasserede, dataRev, thumbRev, onSelect }) {
  const [billeder, setBilleder] = useState([]);
  const stripRef = useRef(null);
  const hentetRef = useRef({ dataRev: null, visKasserede: null, omfang: null, filer: new Set() });

  // Hentes igen naar kataloget aendres. Uden en Import-mappe ogsaa naar man
  // staar paa et billede i en anden mappe. Ikke ved hvert skridt med pilene.
  useEffect(() => {
    const h = hentetRef.current;
    const samme = h.dataRev === dataRev && h.visKasserede === visKasserede;
    if (samme && (h.omfang === 'import' || h.filer.has(row.file_id))) return undefined;
    let aktuel = true;
    invoke('img:filmstrip', { fileId: row.file_id, visKasserede })
      .then((r) => {
        if (!aktuel) return;
        const liste = r?.billeder || [];
        hentetRef.current = { dataRev, visKasserede, omfang: r?.omfang ?? null, filer: new Set(liste.map((b) => b.file_id)) };
        setBilleder(liste);
      })
      .catch(() => { if (aktuel) setBilleder([]); });
    return () => { aktuel = false; };
  }, [row.file_id, dataRev, visKasserede]);

  // Det aktive billede holdes inde i synsfeltet.
  useEffect(() => {
    const el = stripRef.current?.querySelector('.film-billede.aktiv');
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [row.file_id, billeder]);

  if (!billeder.length) return null;
  const iGrid = new Set(rows.map((r) => r.version_id));

  return (
    <div className="filmstrip" ref={stripRef}>
      {billeder.map((b, i) => {
        const navn = b.rel_path.slice(b.rel_path.lastIndexOf('/') + 1);
        const findes = iGrid.has(b.version_id);
        return (
          <button
            key={b.version_id}
            className={`film-billede ${b.file_id === row.file_id ? 'aktiv' : ''} ${findes ? '' : 'udenfor'} ${b.rating === 'kandidat' ? 'kandidat' : ''} ${b.rating === 'kasseret' ? 'kasseret' : ''}`}
            title={`${i + 1}. ${b.rel_path}${b.rating === 'kandidat' ? ' (Candidate)' : ''}`}
            onClick={() => onSelect(b.version_id, findes)}
          >
            <img
              key={thumbRev}
              src={thumbUrl(b.file_id, b.mtime, 512, b.rotation)}
              alt={navn}
              loading="lazy"
              draggable={false}
            />
            {/* Samme maerke som i grid'et, saa det kan genkendes. */}
            {b.rating === 'kandidat' && <span className="film-maerke" title="Candidate">?</span>}
          </button>
        );
      })}
    </div>
  );
}
