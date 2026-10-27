import { useEffect, useRef, useState } from 'react';
import { invoke, thumbUrl } from '../api';

// Fase 1: billederne i mappen, i den raekkefoelge de er skudt. Grid'et
// sorterer efter navn, og det er ikke altid skudrækkefoelgen; her ses
// serien af skud som de blev taget, saa man kan vaelge det bedste af dem.
export default function Filmstrip({ row, rows, visKasserede, dataRev, thumbRev, onSelect }) {
  const [billeder, setBilleder] = useState([]);
  const stripRef = useRef(null);
  const fileIdRef = useRef(row.file_id);
  fileIdRef.current = row.file_id;
  // Hentes kun igen naar man skifter mappe eller kataloget aendres, ikke
  // ved hvert skridt med pilene.
  const mappe = row.rel_path.includes('/') ? row.rel_path.slice(0, row.rel_path.lastIndexOf('/')) : '';

  useEffect(() => {
    let aktuel = true;
    invoke('img:filmstrip', { fileId: fileIdRef.current, visKasserede })
      .then((r) => { if (aktuel) setBilleder(r || []); })
      .catch(() => { if (aktuel) setBilleder([]); });
    return () => { aktuel = false; };
  }, [mappe, dataRev, visKasserede]);

  // Det aktive billede holdes inde i synsfeltet.
  useEffect(() => {
    const el = stripRef.current?.querySelector('.film-billede.aktiv');
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [row.file_id, billeder]);

  if (billeder.length < 2) return null;
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
            title={`${i + 1}. ${navn}${findes ? '' : ' (not in this view)'}`}
            onClick={() => findes && onSelect(b.version_id)}
          >
            <img
              key={thumbRev}
              src={thumbUrl(b.file_id, b.mtime, 512, b.rotation)}
              alt={navn}
              loading="lazy"
              draggable={false}
            />
          </button>
        );
      })}
    </div>
  );
}
