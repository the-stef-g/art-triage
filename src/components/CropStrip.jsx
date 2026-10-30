import { useEffect, useRef } from 'react';
import { thumbUrl } from '../api';
import { fileName } from '../util';

// Crop: masterne som en filmstribe under beskaeringen, som i Sort, hver med
// sine beskaeringer lige efter sig. En master viser, hvor mange beskaeringer
// den har; en beskaering sit format. Roedt er en beskaering lavet af en
// aeldre udgave af masteren.
export default function CropStrip({ rows, active, thumbRev, onSelect }) {
  const stripRef = useRef(null);

  useEffect(() => {
    const el = stripRef.current?.querySelector('.film-billede.aktiv');
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [active, rows]);

  if (!rows.length) return <p className="tom crop-strip-tom">No works to crop. A work comes here when it has a master.</p>;

  return (
    <div className="filmstrip crop-strip" ref={stripRef}>
      {rows.map((r, i) => {
        const c = r.crops || { antal: 0, foraeldet: false };
        const titel = r.crop
          ? `${fileName(r.rel_path)} · ${r.crop} crop${r.foraeldet ? ' · older than the master' : ''}`
          : `${fileName(r.rel_path)} · master${c.antal ? ` · ${c.antal} crop${c.antal === 1 ? '' : 's'}` : ' · no crops yet'}${c.foraeldet ? ' · a crop is older than the master' : ''}`;
        return (
          <button
            key={r.version_id}
            className={`film-billede ${r.crop ? 'crop-film' : 'master-film'} ${r.version_id === active ? 'aktiv' : ''}`}
            title={titel}
            onClick={() => onSelect(r.version_id, i)}
          >
            <img
              key={thumbRev}
              src={thumbUrl(r.file_id, r.mtime, 512, r.rotation)}
              alt={fileName(r.rel_path)}
              loading="lazy"
              draggable={false}
            />
            {r.crop ? (
              <span className={`film-maerke crop-antal ${r.foraeldet ? 'foraeldet' : ''}`}>{r.crop}</span>
            ) : c.antal > 0 && (
              <span className={`film-maerke crop-antal ${c.foraeldet ? 'foraeldet' : ''}`}>{c.antal}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
