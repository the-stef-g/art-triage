import { useEffect, useState } from 'react';

export default function Toolbar({
  filter, setFilter, searchInfo, onNewFolder, onCleanup, onChooseLibrary, onRescan, skanner,
}) {
  const [text, setText] = useState(filter.search);

  useEffect(() => setText(filter.search), [filter.search]);

  // Søgningen kører når man trykker Enter eller efter en kort pause.
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== filter.search) setFilter((f) => ({ ...f, search: text }));
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const toggle = (key) => setFilter((f) => ({ ...f, [key]: !f[key] }));

  return (
    <header className="toolbar">
      <div className="titel">Billedflow</div>
      <div className="soegefelt">
        <input
          type="search"
          placeholder="Søg i billederne, fx gule blomster"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setFilter((f) => ({ ...f, search: text }));
          }}
        />
        {(filter.search || filter.keyword) && (
          <button
            className="lille"
            onClick={() => { setText(''); setFilter((f) => ({ ...f, search: '', keyword: null })); }}
          >
            Ryd
          </button>
        )}
      </div>
      {searchInfo?.error && <span className="soegebesked">{searchInfo.error}</span>}
      <div className="filtre">
        <button className={filter.kunGodkendte ? 'chip aktiv' : 'chip'} onClick={() => toggle('kunGodkendte')} title="Vis kun godkendte">Godkendte</button>
        <button className={filter.kunRedigerede ? 'chip aktiv' : 'chip'} onClick={() => toggle('kunRedigerede')} title="Vis kun redigerede">Redigerede</button>
        <button className={filter.kunFaerdige ? 'chip aktiv' : 'chip'} onClick={() => toggle('kunFaerdige')} title="Vis kun færdige">Færdige</button>
        <button className={filter.visKasserede ? 'chip aktiv' : 'chip'} onClick={() => toggle('visKasserede')} title="Vis også kasserede billeder">Vis kasserede</button>
        <select
          value={filter.sort}
          onChange={(e) => setFilter((f) => ({ ...f, sort: e.target.value }))}
          title="Sortering"
        >
          <option value="navn">Navn</option>
          <option value="dato">Ændret</option>
        </select>
      </div>
      <div className="vaerktoejer">
        <button onClick={onNewFolder}>Ny mappe</button>
        <button
          onClick={onRescan}
          disabled={skanner}
          title="Gennemgå mappen for nye og ændrede filer med det samme"
        >
          {skanner ? 'Skanner …' : 'Skan igen'}
        </button>
        <button onClick={onCleanup} title="Flyt filer hvor alle versioner er kasseret til mappen _kasseret">Ryd op</button>
        <button onClick={onChooseLibrary} title="Skift til en anden billedmappe">Skift bibliotek</button>
      </div>
    </header>
  );
}
