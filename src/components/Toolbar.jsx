import { useEffect, useState } from 'react';
import { FASER, FASEFARVE } from '../faser';

// Handlingerne paa det markerede, med den tast der goer det samme. Foer
// stod de kun som en liste i inspektoerens tomme tilstand, altsaa netop
// naar der ikke var noget at bruge dem paa. Her er de fremme hele tiden,
// og tasten staar paa knappen, saa genvejene laeres af sig selv.
//
// Hver fase har sine egne: bedoemmelsen hoerer til fase 1, og i fase 2
// kan et vaerk kun kasseres. De andre faser arbejdes i inspektoeren.
const HANDLINGER = {
  1: [
    { tast: 'A', navn: 'approve' },
    { tast: 'C', navn: 'candidate' },
    { tast: 'X', navn: 'discard' },
    { tast: 'U', navn: 'unrated' },
  ],
  2: [
    { tast: 'X', navn: 'discard work' },
  ],
};
// Space og Cmd+Z er ikke med. De sidder i fingrene i forvejen, og en
// knap til dem ville bare fylde i raekken.

export default function Toolbar({
  filter, setFilter, searchInfo, faseTal, onNewFolder, onCleanup, onChooseLibrary, onRescan, skanner,
  act, harValg,
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

  // Chipsene er visninger, ikke afkrydsninger: der vises én ad gangen.
  // Foer kunne de staa taendt samtidig og skaere hinanden bort, saa man
  // kunne ende med et tomt grid uden at kunne se hvorfor.
  //
  // "Show discarded" er med i raekken. Den er teknisk set en anden slags
  // spoergsmaal, men den staar mellem de andre og skal opfoere sig som
  // dem. Den viser nu kun de kasserede, i stedet for at laegge dem oven i
  // den visning man var i.
  //
  // Fasen bestemmer resten: Approved, Edits og Finished er nu faser.
  const VISNINGER = ['kunKandidater', 'kunKasserede'];

  const visKun = (key) => setFilter((f) => {
    const aktiv = f[key];
    const ryddet = Object.fromEntries(VISNINGER.map((k) => [k, false]));
    // Klik paa den aktive knap slukker den igen, saa man kommer tilbage
    // til at se det hele.
    const nyt = { ...f, ...ryddet, [key]: !aktiv };
    // Kasserede er skjult som standard, saa den visning skal ogsaa slaa
    // synligheden til, ellers ville den vise ingenting.
    nyt.visKasserede = nyt.kunKasserede;
    return nyt;
  });

  // Knapperne kalder de samme handlinger som tasterne, saa der kun er ét
  // sted hvor det staar hvad fx "approve" goer.
  const koerHandling = (tast) => {
    switch (tast) {
      case 'A': act.setRating('godkendt'); break;
      case 'C': act.setRating('kandidat'); break;
      case 'X':
        if (filter.fase === 2) act.discardWork();
        else act.setRating('kasseret');
        break;
      case 'U': act.setRating('ubedomt'); break;
      default: break;
    }
  };

  return (
    <header className="toolbar">
      <div className="titel">Stef G Art</div>
      <nav className="faser">
        {FASER.map(([nr, navn]) => (
          <button
            key={nr}
            className={filter.fase === nr ? 'fase aktiv' : 'fase'}
            onClick={() => act.setFase(nr)}
            title={`${navn} (Cmd+${nr})`}
            style={{ '--fasefarve': FASEFARVE[nr] }}
          >
            <span className="fase-farve" />
            {navn}
            {faseTal && faseTal[nr] > 0 && <span className="antal">{faseTal[nr]}</span>}
          </button>
        ))}
      </nav>
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
        {filter.fase === 1 && (
          <>
            <button className={filter.kunKandidater ? 'chip aktiv' : 'chip'} onClick={() => visKun('kunKandidater')} title="Show candidates only">Candidates</button>
            <button className={filter.kunKasserede ? 'chip aktiv' : 'chip'} onClick={() => visKun('kunKasserede')} title="Show discarded only">Discarded</button>
          </>
        )}
        <select
          value={filter.sort}
          onChange={(e) => setFilter((f) => ({ ...f, sort: e.target.value }))}
          title="Sort order"
        >
          <option value="navn">Name</option>
          <option value="dato">Modified</option>
        </select>
      </div>
      <div className="handlinger">
        {(HANDLINGER[filter.fase] || []).map((h) => (
          <button
            key={h.tast}
            className="handling"
            disabled={!harValg}
            onClick={() => koerHandling(h.tast)}
            title={`${h.navn} — applies to the active image`}
          >
            <span className="tast">{h.tast}</span>
            <span className="handlingsnavn">{h.navn}</span>
          </button>
        ))}
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
        <button onClick={onCleanup} title="Move files where every version is discarded to the Discarded folder, and delete empty folders in Import">Clean up</button>
        <button onClick={onChooseLibrary} title="Switch to a different image folder">Switch library</button>
      </div>
    </header>
  );
}
