import { useEffect, useState } from 'react';
import { invoke, thumbUrl } from '../api';
import { formatBytes, formatDate, fileName } from '../util';

export default function Inspector({ row, selectedCount, activeKeyword, editors, series, act }) {
  const [versions, setVersions] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [editorValg, setEditorValg] = useState('');
  const [nytOrd, setNytOrd] = useState('');

  const loadKeywords = () => {
    if (row) invoke('kw:forFile', { fileId: row.file_id }).then(setKeywords).catch(() => {});
  };

  useEffect(() => {
    if (!row) {
      setVersions([]);
      setKeywords([]);
      return;
    }
    invoke('img:imageVersions', { imageId: row.image_id }).then(setVersions).catch(() => {});
    loadKeywords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.version_id, row?.file_id, row?.image_id, row?.mtime]);

  const tilfoejOrd = async () => {
    const ord = nytOrd.trim();
    if (!ord || !row) return;
    try {
      await invoke('kw:add', { fileId: row.file_id, word: ord });
      setNytOrd('');
      loadKeywords();
    } catch {
      // ignoreres; chippen dukker ikke op
    }
  };

  const fjernOrd = async (word) => {
    if (!row) return;
    try {
      await invoke('kw:remove', { fileId: row.file_id, word });
      loadKeywords();
    } catch {
      // ignoreres
    }
  };

  if (!row) {
    return (
      <aside className="inspector">
        <p className="tom">Select an image to see details</p>
        <ul className="genvejsliste">
          <li><b>G</b> approve</li>
          <li><b>K</b> candidate</li>
          <li><b>X</b> discard</li>
          <li><b>U</b> clear rating</li>
          <li><b>R</b> stage: being edited</li>
          <li><b>F</b> stage: finished</li>
          <li><b>V</b> new virtual copy</li>
          <li><b>Space</b> large preview</li>
          <li><b>Cmd+Z</b> undo</li>
        </ul>
      </aside>
    );
  }

  if (selectedCount > 1) {
    return (
      <aside className="inspector">
        <h3>{selectedCount} selected</h3>
        {activeKeyword && (
          <>
            <h4>Keywords</h4>
            <div className="knapraekke">
              <button
                className="fjern-fra-noegleord"
                onClick={() => act.removeKeywordFromSelected(activeKeyword)}
                title={`Remove the keyword "${activeKeyword}" from the selected images`}
              >
                Remove «{activeKeyword}» from the {selectedCount} selected
              </button>
            </div>
          </>
        )}
        <h4>Rating</h4>
        <div className="knapraekke">
          <button onClick={() => act.setRating('godkendt')}>Approve</button>
          <button onClick={() => act.setRating('kandidat')}>Candidate</button>
          <button onClick={() => act.setRating('kasseret')}>Discard</button>
          <button onClick={() => act.setRating('ubedomt')}>Clear</button>
        </div>
        <h4>Workflow stage</h4>
        <div className="knapraekke">
          <button onClick={() => act.setStage('edited')}>Being edited</button>
          <button onClick={() => act.setStage('finished')}>Finished</button>
          <button onClick={() => act.setStage(null)}>Clear</button>
        </div>
        <h4>Series</h4>
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
            <option value="">Set series …</option>
            {series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="ny">New series …</option>
            <option value="fjern">Remove from series</option>
          </select>
        </div>
      </aside>
    );
  }

  const editorList = editors.length
    ? editors
    : [{ appPath: '', label: 'Default app' }];

  return (
    <aside className="inspector">
      <div className="stor-preview">
        <img src={thumbUrl(row.file_id, row.mtime, 2048)} alt={fileName(row.rel_path)} />
      </div>
      <h3 title={row.rel_path}>{fileName(row.rel_path)}</h3>
      <p className="detaljer">
        {formatBytes(row.size)} · {formatDate(row.mtime)}
        {row.series_name ? ` · Series: ${row.series_name}` : ''}
      </p>

      <h4>Rating</h4>
      <div className="knapraekke">
        <button
          className={row.rating === 'godkendt' ? 'aktiv-godkendt' : ''}
          onClick={() => act.setRating('godkendt')}
        >
          Approved
        </button>
        <button
          className={row.rating === 'kandidat' ? 'aktiv-kandidat' : ''}
          onClick={() => act.setRating('kandidat')}
          title="Good subject, but needs editing before it can be decided"
        >
          Candidate
        </button>
        <button
          className={row.rating === 'kasseret' ? 'aktiv-kasseret' : ''}
          onClick={() => act.setRating('kasseret')}
        >
          Discarded
        </button>
        <button onClick={() => act.setRating('ubedomt')}>Clear</button>
      </div>
      <h4>Workflow stage</h4>
      <div className="knapraekke">
        <button
          className={row.edited ? 'aktiv-redigeres' : ''}
          onClick={() => act.setStage('edited')}
          title="The image is out with an editor right now"
        >
          Being edited
        </button>
        <button
          className={row.finished ? 'aktiv-faerdig' : ''}
          onClick={() => act.setStage('finished')}
          title="The work on this image is over"
        >
          Finished
        </button>
        <button onClick={() => act.setStage(null)}>Clear</button>
      </div>

      <h4>Edit in</h4>
      <div className="knapraekke">
        <select value={editorValg} onChange={(e) => setEditorValg(e.target.value)}>
          {editorList.map((ed) => (
            <option key={ed.appPath || 'std'} value={ed.appPath}>{ed.label}</option>
          ))}
        </select>
        <button
          onClick={() => act.editIn(editorValg || editorList[0]?.appPath || null)}
          title="Open the file in the chosen app. When you save, Art Triage notices and marks the image as being edited."
        >
          Open
        </button>
      </div>
      <div className="knapraekke">
        <button className="lille" onClick={act.editInOther}>Other app …</button>
        <button className="lille" onClick={act.reveal}>Reveal in Finder</button>
      </div>

      <h4>Versions</h4>
      <div className="versionsliste">
        {versions.map((v) => (
          <div key={v.id} className={`version ${v.id === row.version_id ? 'aktiv' : ''}`}>
            <span className="versionsnavn">{v.is_master ? 'Original' : v.name}</span>
            <span className="versionsinfo">
              {v.rating === 'godkendt' ? '✓' : v.rating === 'kandidat' ? 'K' : v.rating === 'kasseret' ? '✕' : ''}
              {v.edited ? ' R' : ''}
              {v.finished ? ' F' : ''}
            </span>
            {!v.is_master && (
              <span className="versionsknapper">
                <button className="lille" onClick={() => act.renameVersion(v.id, v.name)} title="Rename">✎</button>
                <button className="lille" onClick={() => act.deleteVersion(v.id)} title="Delete">🗑</button>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="knapraekke">
        <button onClick={act.virtualCopy} title="Create a virtual copy, e.g. for a different crop">
          New virtual copy
        </button>
      </div>

      <h4>Series</h4>
      <div className="knapraekke">
        <select
          value={row.series_id || ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'ny') act.newSeries();
            else act.assignSeries(v ? Number(v) : null);
          }}
        >
          <option value="">No series</option>
          {series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="ny">New series …</option>
        </select>
      </div>

      <h4>Keywords</h4>
      {activeKeyword && keywords.some((k) => k.word === activeKeyword) && (
        <div className="knapraekke">
          <button
            className="fjern-fra-noegleord"
            onClick={() => fjernOrd(activeKeyword)}
            title={`Remove this image from the keyword "${activeKeyword}"`}
          >
            Does not belong to «{activeKeyword}»
          </button>
        </div>
      )}
      <div className="chips">
        {keywords.map((k) => (
          <span
            key={k.word}
            className={`chip ${k.manual ? 'manuel' : ''}`}
            title={k.manual ? 'Your own keyword' : 'Automatic keyword'}
          >
            {k.word}
            <button className="chip-fjern" onClick={() => fjernOrd(k.word)} title="Remove keyword">×</button>
          </span>
        ))}
        {keywords.length === 0 && <span className="tom">No keywords yet</span>}
      </div>
      <div className="knapraekke">
        <input
          value={nytOrd}
          placeholder="Add keyword"
          onChange={(e) => setNytOrd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') tilfoejOrd();
          }}
        />
        <button className="lille" onClick={tilfoejOrd}>Add</button>
      </div>
    </aside>
  );
}
