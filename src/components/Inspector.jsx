import { useEffect, useState } from 'react';
import { invoke, thumbUrl } from '../api';
import { formatBytes, formatDate, fileName } from '../util';

export default function Inspector({ row, selectedCount, editors, series, act }) {
  const [versions, setVersions] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [editorValg, setEditorValg] = useState('');

  useEffect(() => {
    if (!row) {
      setVersions([]);
      setKeywords([]);
      return;
    }
    invoke('img:imageVersions', { imageId: row.image_id }).then(setVersions).catch(() => {});
    invoke('kw:forFile', { fileId: row.file_id }).then(setKeywords).catch(() => {});
  }, [row?.version_id, row?.file_id, row?.image_id, row?.mtime]);

  if (!row) {
    return (
      <aside className="inspector">
        <p className="tom">Vælg et billede for at se detaljer</p>
        <ul className="genvejsliste">
          <li><b>G</b> godkend</li>
          <li><b>X</b> kassér</li>
          <li><b>U</b> nulstil bedømmelse</li>
          <li><b>R</b> redigeret til/fra</li>
          <li><b>F</b> færdig til/fra</li>
          <li><b>V</b> ny virtuel kopi</li>
          <li><b>Mellemrum</b> stort preview</li>
          <li><b>Cmd+Z</b> fortryd</li>
        </ul>
      </aside>
    );
  }

  if (selectedCount > 1) {
    return (
      <aside className="inspector">
        <h3>{selectedCount} valgt</h3>
        <div className="knapraekke">
          <button onClick={() => act.setRating('godkendt')}>Godkend</button>
          <button onClick={() => act.setRating('kasseret')}>Kassér</button>
          <button onClick={() => act.setRating('ubedomt')}>Nulstil</button>
        </div>
        <div className="knapraekke">
          <button onClick={() => act.toggleFlag('edited')}>Redigeret til/fra</button>
          <button onClick={() => act.toggleFlag('finished')}>Færdig til/fra</button>
        </div>
        <h4>Serie</h4>
        <div className="knapraekke">
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'ny') act.newSeries();
              else if (v === 'fjern') act.assignSeries(null);
              else if (v) act.assignSeries(Number(v));
            }}
          >
            <option value="">Sæt serie …</option>
            {series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="ny">Ny serie …</option>
            <option value="fjern">Fjern fra serie</option>
          </select>
        </div>
      </aside>
    );
  }

  const editorList = editors.length
    ? editors
    : [{ appPath: '', label: 'Standardprogram' }];

  return (
    <aside className="inspector">
      <div className="stor-preview">
        <img src={thumbUrl(row.file_id, row.mtime, 2048)} alt={fileName(row.rel_path)} />
      </div>
      <h3 title={row.rel_path}>{fileName(row.rel_path)}</h3>
      <p className="detaljer">
        {formatBytes(row.size)} · {formatDate(row.mtime)}
        {row.series_name ? ` · Serie: ${row.series_name}` : ''}
      </p>

      <h4>Bedømmelse</h4>
      <div className="knapraekke">
        <button
          className={row.rating === 'godkendt' ? 'aktiv-godkendt' : ''}
          onClick={() => act.setRating('godkendt')}
        >
          Godkendt
        </button>
        <button
          className={row.rating === 'kasseret' ? 'aktiv-kasseret' : ''}
          onClick={() => act.setRating('kasseret')}
        >
          Kasseret
        </button>
        <button onClick={() => act.setRating('ubedomt')}>Nulstil</button>
      </div>
      <div className="knapraekke">
        <label className="tjek">
          <input type="checkbox" checked={Boolean(row.edited)} onChange={() => act.toggleFlag('edited')} />
          Redigeret
        </label>
        <label className="tjek">
          <input type="checkbox" checked={Boolean(row.finished)} onChange={() => act.toggleFlag('finished')} />
          Færdig
        </label>
      </div>

      <h4>Redigér i</h4>
      <div className="knapraekke">
        <select value={editorValg} onChange={(e) => setEditorValg(e.target.value)}>
          {editorList.map((ed) => (
            <option key={ed.appPath || 'std'} value={ed.appPath}>{ed.label}</option>
          ))}
        </select>
        <button
          onClick={() => act.editIn(editorValg || editorList[0]?.appPath || null)}
          title="Åbn filen i den valgte app. Når du gemmer, opdager Billedflow det og markerer billedet som redigeret."
        >
          Åbn
        </button>
      </div>
      <div className="knapraekke">
        <button className="lille" onClick={act.editInOther}>Anden app …</button>
        <button className="lille" onClick={act.reveal}>Vis i Finder</button>
      </div>

      <h4>Versioner</h4>
      <div className="versionsliste">
        {versions.map((v) => (
          <div key={v.id} className={`version ${v.id === row.version_id ? 'aktiv' : ''}`}>
            <span className="versionsnavn">{v.is_master ? 'Original' : v.name}</span>
            <span className="versionsinfo">
              {v.rating === 'godkendt' ? '✓' : v.rating === 'kasseret' ? '✕' : ''}
              {v.edited ? ' R' : ''}
              {v.finished ? ' F' : ''}
            </span>
            {!v.is_master && (
              <span className="versionsknapper">
                <button className="lille" onClick={() => act.renameVersion(v.id, v.name)} title="Omdøb">✎</button>
                <button className="lille" onClick={() => act.deleteVersion(v.id)} title="Slet">🗑</button>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="knapraekke">
        <button onClick={act.virtualCopy} title="Opret en virtuel kopi, fx til en anden beskæring">
          Ny virtuel kopi
        </button>
      </div>

      <h4>Serie</h4>
      <div className="knapraekke">
        <select
          value={row.series_id || ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'ny') act.newSeries();
            else act.assignSeries(v ? Number(v) : null);
          }}
        >
          <option value="">Ingen serie</option>
          {series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="ny">Ny serie …</option>
        </select>
      </div>

      {keywords.length > 0 && (
        <>
          <h4>Nøgleord (automatiske)</h4>
          <div className="chips">
            {keywords.map((k) => (
              <span key={k.word} className="chip">{k.word}</span>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
