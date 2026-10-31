import { useEffect, useRef } from 'react';
import { thumbUrl } from '../api';
import { fileName } from '../util';

// Crop: masterne som en filmstribe under beskaeringen, som i Sort. Hver
// master er en stak med sine beskaeringer, som i Lightroom: en ramme om
// dem, og pilen paa masteren (eller S) aabner og lukker den. Masteren viser
// de formater der er beskaaret; roedt er en beskaering lavet af en aeldre
// udgave af masteren.
export default function CropStrip({ rows, lukkede = new Set(), onStak, active, thumbRev, onSelect }) {
  const stripRef = useRef(null);

  useEffect(() => {
    const el = stripRef.current?.querySelector('.film-billede.aktiv');
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [active, rows]);

  if (!rows.length) return <p className="tom crop-strip-tom">No works to crop. A work comes here when it has a master.</p>;

  // Raekkerne i stakke: et vaerks master og beskaeringer staar i traek.
  const stakke = [];
  rows.forEach((r, i) => {
    const sidste = stakke[stakke.length - 1];
    if (sidste && sidste.imageId === r.image_id) sidste.raekker.push([r, i]);
    else stakke.push({ imageId: r.image_id, raekker: [[r, i]] });
  });

  const billede = (r, i) => {
    const c = r.crops || { antal: 0, foraeldet: false, formater: [] };
    const lukket = lukkede.has(r.image_id);
    const titel = r.crop
      ? `${fileName(r.rel_path)} · ${r.crop} crop${r.foraeldet ? ' · older than the master' : ''}`
      : `${fileName(r.rel_path)} · master${c.antal ? '' : ' · no crops yet'}${c.foraeldet ? ' · a crop is older than the master' : ''}`;
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
          <span className="stak-formater">
            {(c.formater || []).map((f) => (
              <span key={f.format} className={`film-maerke crop-antal ${f.foraeldet ? 'foraeldet' : ''}`}>{f.format}</span>
            ))}
          </span>
        )}
        {!r.crop && c.antal > 0 && (
          <span
            className="stak-pil"
            role="button"
            tabIndex={-1}
            title={lukket ? 'Show the crops (S)' : 'Hide the crops (S)'}
            onClick={(e) => { e.stopPropagation(); onStak?.(r.image_id); }}
          >
            {lukket ? '›' : '‹'}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="filmstrip crop-strip" ref={stripRef}>
      {stakke.map((s) => {
        const harCrops = s.raekker.some(([r]) => r.crop) || (s.raekker[0][0].crops?.antal > 0);
        const aaben = harCrops && !lukkede.has(s.imageId);
        return (
          <div key={s.imageId} className={`stak ${harCrops ? 'har-crops' : ''} ${aaben ? 'aaben' : ''}`}>
            {s.raekker.map(([r, i]) => billede(r, i))}
          </div>
        );
      })}
    </div>
  );
}
