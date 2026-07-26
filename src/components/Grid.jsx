import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FixedSizeGrid } from 'react-window';
import { useSize } from '../hooks';
import { thumbUrl } from '../api';
import { fileName } from '../util';

const CELL_W = 236;
const CELL_H = 264;

function Badges({ row }) {
  return (
    <div className="badges">
      {row.rating === 'godkendt' && <span className="badge godkendt" title="Approved">✓</span>}
      {row.rating === 'kandidat' && (
        <span className="badge kandidat" title="Candidate: good subject, needs editing before it can be decided">K</span>
      )}
      {row.rating === 'kasseret' && <span className="badge kasseret" title="Discarded">✕</span>}
      {Boolean(row.edited) && <span className="badge redigeret" title="Being edited">R</span>}
      {Boolean(row.finished) && <span className="badge faerdig" title="Finished">F</span>}
      {!row.is_master && <span className="badge kopi" title={`Virtual copy: ${row.version_name}`}>{row.version_name}</span>}
      {row.is_master && row.version_count > 1 && (
        <span className="badge stak" title={`${row.version_count} versions`}>⧉ {row.version_count}</span>
      )}
      {row.series_name && <span className="badge serie" title={`Series: ${row.series_name}`}>{row.series_name}</span>}
    </div>
  );
}

function Tile({ row, isSelected, onClick, onDoubleClick, onDragStart }) {
  return (
    <div
      className={`tile ${isSelected ? 'valgt' : ''} ${row.rating === 'kasseret' ? 'nedtonet' : ''} ${row.rating === 'kandidat' ? 'kandidat' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      draggable
      onDragStart={onDragStart}
    >
      <div className="tile-billede">
        <img
          src={thumbUrl(row.file_id, row.mtime, 512)}
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

export default function Grid({ rows, selected, setSelected, focusIndex, harSoegning, onOpenPreview, onColumns }) {
  const [ref, size] = useSize();
  const anchorRef = useRef(0);
  const gridRef = useRef(null);

  const columns = Math.max(1, Math.floor((size.width - 12) / CELL_W));
  useEffect(() => onColumns(columns), [columns, onColumns]);

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

  const handleClick = useCallback((row, index, e) => {
    if (e.shiftKey) {
      const from = Math.min(anchorRef.current, index);
      const to = Math.max(anchorRef.current, index);
      setSelected(rows.slice(from, to + 1).map((r) => r.version_id));
    } else if (e.metaKey || e.ctrlKey) {
      anchorRef.current = index;
      setSelected((sel) => (sel.includes(row.version_id)
        ? sel.filter((id) => id !== row.version_id)
        : [...sel, row.version_id]));
    } else {
      anchorRef.current = index;
      setSelected([row.version_id]);
    }
  }, [rows, setSelected]);

  const handleDragStart = useCallback((row, e) => {
    const ids = selectedSet.has(row.version_id) ? selected : [row.version_id];
    const fileIds = [...new Set(rows
      .filter((r) => ids.includes(r.version_id))
      .map((r) => r.file_id))];
    e.dataTransfer.setData('application/x-art-triage-files', JSON.stringify(fileIds));
    e.dataTransfer.effectAllowed = 'move';
  }, [rows, selected, selectedSet]);

  const rowCount = Math.ceil(rows.length / columns);

  const Cell = useCallback(({ columnIndex, rowIndex, style }) => {
    const index = rowIndex * columns + columnIndex;
    if (index >= rows.length) return null;
    const row = rows[index];
    return (
      <div style={style} className="celle">
        <Tile
          row={row}
          isSelected={selectedSet.has(row.version_id)}
          onClick={(e) => handleClick(row, index, e)}
          onDoubleClick={() => { setSelected([row.version_id]); onOpenPreview(); }}
          onDragStart={(e) => handleDragStart(row, e)}
        />
      </div>
    );
  }, [rows, columns, selectedSet, handleClick, handleDragStart, setSelected, onOpenPreview]);

  return (
    <section className="grid-omraade" ref={ref}>
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
          columnWidth={CELL_W}
          rowHeight={CELL_H}
          width={size.width}
          height={size.height}
        >
          {Cell}
        </FixedSizeGrid>
      )}
    </section>
  );
}
