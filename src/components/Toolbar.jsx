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

  // De fire foerste chips er visninger, ikke afkrydsninger: der vises én
  // ad gangen. Foer kunne de staa taendt samtidig og skaere hinanden bort,
  // saa man kunne ende med et tomt grid uden at kunne se hvorfor.
  const VISNINGER = ['kunGodkendte', 'kunKandidater', 'kunRedigerede', 'kunFaerdige'];

  const visKun = (key) => setFilter((f) => {
    const aktiv = f[key];
    const ryddet = Object.fromEntries(VISNINGER.map((k) => [k, false]));
    // Klik paa den aktive knap slukker den igen, saa man kommer tilbage
    // til at se det hele.
    return { ...f, ...ryddet, [key]: !aktiv };
  });

  // "Show discarded" staar for sig: den svarer paa noget andet, nemlig om
  // kasserede skal med i den visning man nu er i.
  const toggle = (key) => setFilter((f) => ({ ...f, [key]: !f[key] }));

  return (
    <header className="toolbar">
      <div className="titel">Art Triage</div>
      <div className="soegefelt">
        <input
          type="search"
          placeholder="Search your images, e.g. yellow flowers"
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
            Clear
          </button>
        )}
      </div>
      {searchInfo?.error && <span className="soegebesked">{searchInfo.error}</span>}
      <div className="filtre">
        <button className={filter.kunGodkendte ? 'chip aktiv' : 'chip'} onClick={() => visKun('kunGodkendte')} title="Show approved only">Approved</button>
        <button className={filter.kunKandidater ? 'chip aktiv' : 'chip'} onClick={() => visKun('kunKandidater')} title="Show candidates only, the ones waiting for a round in the editor">Candidates</button>
        <button className={filter.kunRedigerede ? 'chip aktiv' : 'chip'} onClick={() => visKun('kunRedigerede')} title="Show only images being edited">Being edited</button>
        <button className={filter.kunFaerdige ? 'chip aktiv' : 'chip'} onClick={() => visKun('kunFaerdige')} title="Show finished only">Finished</button>
        <button className={filter.visKasserede ? 'chip aktiv' : 'chip'} onClick={() => toggle('visKasserede')} title="Also show discarded images">Show discarded</button>
        <select
          value={filter.sort}
          onChange={(e) => setFilter((f) => ({ ...f, sort: e.target.value }))}
          title="Sort order"
        >
          <option value="navn">Name</option>
          <option value="dato">Modified</option>
        </select>
      </div>
      <div className="vaerktoejer">
        <button onClick={onNewFolder}>New folder</button>
        <button
          onClick={onRescan}
          disabled={skanner}
          title="Go through the folder for new and changed files right now"
        >
          {skanner ? 'Scanning …' : 'Scan again'}
        </button>
        <button onClick={onCleanup} title="Move files where every version is discarded to the _kasseret folder">Clean up</button>
        <button onClick={onChooseLibrary} title="Switch to a different image folder">Switch library</button>
      </div>
    </header>
  );
}
