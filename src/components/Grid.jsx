import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FixedSizeGrid } from 'react-window';
import { useSize } from '../hooks';
import { thumbUrl } from '../api';
import { fileName, foraeldetTekster } from '../util';

// Fliserne fylder hele bredden af midterfeltet, delt paa det antal
// kolonner brugeren har valgt. Foer var bredden fast, og de kolonner der
// ikke gik op, blev til en stribe bar baggrund langs hoejre kant.
//
// Billedfeltet foelger flisens bredde, men navn og badges under det er
// tekst i fast stoerrelse og maa ikke skaleres med. Derfor et fast
// tillaeg oven i den skalerede billedhoejde.
const BILLED_FORHOLD = 0.78;
const TEKST_HOEJDE = 92;
// Plads til den lodrette rullebjaelke, saa den sidste kolonne ikke bliver
// klemt eller skubbet ud, naar der er flere raekker end der er plads til.
const RULLEBREDDE = 14;

// En fil i Master er per definition godkendt og faerdig, saa de to maerker
// siger ikke noget dér.
const iMaster = (rel) => /^Approved\/[^/]+\/Masters\//.test(rel);
// Alt under Approved er godkendt; maerket siger kun noget i Import.
const iApproved = (rel) => rel.startsWith('Approved/');

// Versionsnavnet kommer tit fra editorens endelse ("Mur 2-neo" bliver
// "Neo", "Roofs 2-3-giga" bliver "2-3-giga"), og saa siger det det samme
// som editor-maerket og beskaeringsmaerket.
function samme(row) {
  const navn = String(row.version_name || '').trim().toLowerCase();
  if (!navn) return true;
  if (/(^|[-_ ])(neo|tp|ps|giga)([-_ ]|$)/.test(navn)) return true;
  return Boolean(row.editor) && row.editor.toLowerCase().includes(navn);
}

function Badges({ row }) {
  const master = iMaster(row.rel_path);
  return (
    <div className="badges">
      {row.rating === 'godkendt' && !iApproved(row.rel_path) && <span className="badge godkendt" title="Approved">✓</span>}
      {row.rating === 'kandidat' && (
        <span className="badge kandidat" title="Candidate: good subject, needs editing before it can be decided">?</span>
      )}
      {row.rating === 'kasseret' && <span className="badge kasseret" title="Discarded">✕</span>}
      {Boolean(row.edited) && <span className="badge redigeret" title={row.editor ? `Edited in ${row.editor}` : 'Has edits'}>{row.editor || 'Edits'}</span>}
      {Boolean(row.finished) && !master && <span className="badge faerdig" title="Finished">F</span>}
      {row.rating === 'godkendt' && !row.is_master && !samme(row) && <span className="badge kopi" title={`Version: ${row.version_name}. A separate version of the original image, either a file with the same name in another format or an edit.`}>{row.version_name}</span>}
      {row.rating === 'godkendt' && row.crop && (
        <span className="badge beskaering" title={`Crop ${row.crop === 'free' ? 'free' : row.crop}`}>
          {row.crop === 'free' ? 'Free' : row.crop}
        </span>
      )}
      {row.rating === 'godkendt' && Boolean(row.is_master) && row.version_count > 1 && (
        <span className="badge stak" title={`${row.version_count} versions`}>⧉ {row.version_count}</span>
      )}
      {/* Printfilen er lavet af -giga-filen, saa det er dér den vises. */}
      {row.foraeldet && <span className="badge foraeldet" title={foraeldetTekster(row.foraeldet).join(' ')}>Out of date</span>}
      {row.printfil && row.giga && <span className="badge print" title={`Print file: ${row.printfil.rel.split('/').pop()}`}>Print file</span>}
      {row.series_name && <span className="badge serie" title={`Series: ${row.series_name}`}>{row.series_name}</span>}
    </div>
  );
}

// isActive er billedet man staar paa inde i markeringen. Det er det
// inspektoeren viser, og det pilene flytter, saa det skal kunne skelnes
// fra resten af de markerede.
function Tile({ row, isSelected, isActive, onClick, onDoubleClick, onDragStart, thumbRev }) {
  return (
    <div
      className={`tile ${isSelected ? 'valgt' : ''} ${isActive ? 'aktiv' : ''} ${row.rating === 'kasseret' ? 'nedtonet' : ''} ${row.rating === 'kandidat' ? 'kandidat' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      draggable
      onDragStart={onDragStart}
    >
      <div className="tile-billede" key={thumbRev}>
        <img
          src={thumbUrl(row.file_id, row.mtime, 512, row.rotation)}
          alt={fileName(row.rel_path)}
          loading="lazy"
          draggable={false}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            e.currentTarget.nextSibling.style.display = 'flex';
          }}
        />
        <div className="pladsholder" style={{ display: 'none' }}>
          {fileName(row.rel_path).split('.').pop().toUpperCase()}
        </div>
      </div>
      <div className="tile-navn" title={row.rel_path}>{fileName(row.rel_path)}</div>
      <Badges row={row} />
    </div>
  );
}

// ankerRef ejes af App, saa Skift+klik og Skift+piletast regner
// omraade-markeringen fra det samme udgangspunkt.
export default function Grid({
  rows, selected, active, setSelected, setActive, focusIndex, harSoegning,
  onOpenPreview, onColumns, ankerRef, columns, thumbRev = 0,
}) {
  const [ref, size] = useSize();
  const gridRef = useRef(null);

  useEffect(() => onColumns(columns), [columns, onColumns]);

  const rowCount = Math.ceil(rows.length / columns);
  // Rullebjaelken tages fra bredden foerst, saa fliserne passer uanset om
  // der er én raekke eller tusind.
  const brugbar = Math.max(columns * 40, size.width - (rowCount > 1 ? RULLEBREDDE : 0));
  const cellW = Math.floor(brugbar / columns);
  const billedHoejde = Math.round((cellW - 16) * BILLED_FORHOLD);
  const cellH = billedHoejde + TEKST_HOEJDE;

  // Det markerede billede skal altid blive i synsfeltet, ogsaa ved
  // piletast-navigation.
  useEffect(() => {
    if (focusIndex >= 0 && gridRef.current) {
      gridRef.current.scrollToItem({
        rowIndex: Math.floor(focusIndex / columns),
        columnIndex: focusIndex % columns,
        align: 'smart',
      });
    }
  }, [focusIndex, columns]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Et klik saetter altid det aktive billede til det man klikkede paa,
  // ogsaa naar markeringen er en hel raekke: det er dér man staar.
  const handleClick = useCallback((row, index, e) => {
    if (e.shiftKey) {
      const anker = Math.max(0, Math.min(rows.length - 1, ankerRef.current));
      setSelected(rows.slice(Math.min(anker, index), Math.max(anker, index) + 1)
        .map((r) => r.version_id));
      setActive(row.version_id);
    } else if (e.metaKey || e.ctrlKey) {
      ankerRef.current = index;
      setSelected((sel) => (sel.includes(row.version_id)
        ? sel.filter((id) => id !== row.version_id)
        : [...sel, row.version_id]));
      setActive(row.version_id);
    } else {
      ankerRef.current = index;
      setSelected([row.version_id]);
      setActive(row.version_id);
    }
  }, [rows, setSelected, setActive, ankerRef]);

  const handleDragStart = useCallback((row, e) => {
    const ids = selectedSet.has(row.version_id) ? selected : [row.version_id];
    const fileIds = [...new Set(rows
      .filter((r) => ids.includes(r.version_id))
      .map((r) => r.file_id))];
    e.dataTransfer.setData('application/x-art-triage-files', JSON.stringify(fileIds));
    e.dataTransfer.effectAllowed = 'move';
  }, [rows, selected, selectedSet]);


  const Cell = useCallback(({ columnIndex, rowIndex, style }) => {
    const index = rowIndex * columns + columnIndex;
    if (index >= rows.length) return null;
    const row = rows[index];
    return (
      <div style={style} className="celle">
        <Tile
          row={row}
          isSelected={selectedSet.has(row.version_id)}
          isActive={row.version_id === active}
          onClick={(e) => handleClick(row, index, e)}
          onDoubleClick={() => {
            setSelected([row.version_id]);
            setActive(row.version_id);
            onOpenPreview();
          }}
          onDragStart={(e) => handleDragStart(row, e)}
          thumbRev={thumbRev}
        />
      </div>
    );
  }, [rows, columns, selectedSet, active, handleClick, handleDragStart, setSelected, setActive, onOpenPreview, thumbRev]);

  return (
    // Billedhoejden gives videre som CSS-variabel: den skal skalere med
    // flisens bredde, og det er kun her tallet er kendt.
    <section className="grid-omraade" ref={ref} style={{ '--billedhoejde': `${billedHoejde}px` }}>
      {rows.length === 0 ? (
        <div className="tom-tilstand">
          {harSoegning ? (
            <>
              <p>No images match the search</p>
              <p className="tom">Try another word, or clear the search to see every image.</p>
            </>
          ) : (
            <>
              <p>No images here</p>
              <p className="tom">Pick another folder, adjust the filters, or put images in the folder in Finder.</p>
            </>
          )}
        </div>
      ) : (
        <FixedSizeGrid
          ref={gridRef}
          columnCount={columns}
          rowCount={rowCount}
          columnWidth={cellW}
          rowHeight={cellH}
          width={size.width}
          height={size.height}
        >
          {Cell}
        </FixedSizeGrid>
      )}
    </section>
  );
}
