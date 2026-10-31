import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useKoe, koeTilfoej, koeFjern, koeRyd, koersel, vaerkDel, mb, varighed, klokken,
} from '../koe';

// Uret til tid brugt og tid tilbage, kun mens koeen koerer.
function useNu(aktiv) {
  const [nu, setNu] = useState(Date.now());
  useEffect(() => {
    if (!aktiv) return undefined;
    setNu(Date.now());
    const t = setInterval(() => setNu(Date.now()), 1000);
    return () => clearInterval(t);
  }, [aktiv]);
  return nu;
}

function Bjaelke({ del }) {
  return (
    <div className="koe-bjaelke" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(del * 100)}>
      <div style={{ width: `${Math.round(del * 1000) / 10}%` }} />
    </div>
  );
}

// Tid brugt og cirka tid tilbage. Tilbage regnes foerst, naar der er sendt
// nok til at gaette.
function tider(start, del, nu) {
  if (!start) return '';
  const brugt = nu - start;
  const tilbage = del > 0.03 ? (brugt * (1 - del)) / del : null;
  return `${varighed(brugt)} so far${tilbage != null ? ` · about ${varighed(tilbage)} left` : ''}`;
}

// Fremdriften for hele koerslen og for vaerket der sendes nu.
export function KoeFremdrift({ t, nu }) {
  const k = koersel(t);
  const f = t.fremdrift;
  const sender = t.vaerker.find((v) => v.status === 'sender');
  if (!t.koerer || !k.ialt) return null;
  return (
    <div className="koe-fremdrift">
      <div className="koe-linje">
        <span>Work {k.nr} of {k.ialt}</span>
        <span className="koe-tid">{tider(t.start, k.del, nu)}</span>
      </div>
      <Bjaelke del={k.del} />
      {sender && f && (
        <>
          <div className="koe-linje">
            <span className="koe-titel">{sender.titel}</span>
            {f.filer ? <span className="koe-tid">picture {f.fil} of {f.filer}</span> : null}
          </div>
          <Bjaelke del={vaerkDel(f)} />
          <div className="koe-linje koe-trin">
            <span>{f.tekst}</span>
            {f.total ? <span className="koe-tid">{mb(f.bytes || 0)} of {mb(f.total)} MB</span> : null}
          </div>
        </>
      )}
    </div>
  );
}

const STATUS = {
  venter: () => 'Waiting',
  sender: () => 'Sending now',
  sendt: (k) => `Sent at ${klokken(k.tid)}`,
  sprunget: () => 'Skipped',
  fejl: () => 'Error',
};

// Koeen til shoppen: alt der venter, i den raekkefoelge det sendes, og
// hvordan det gik med det der er sendt. Kan aabnes fra alle faser.
function KoePanel({ t, nu, onLuk }) {
  const faerdige = t.vaerker.some((k) => k.status !== 'venter' && k.status !== 'sender');
  return (
    <div className="koe-panel" role="dialog" aria-label="Shop queue">
      <div className="koe-hoved">
        <h4>Shop queue</h4>
        {faerdige && <button className="lille" onClick={() => koeRyd()} title="Remove the works that are done from the list">Clear finished</button>}
        <button className="lille" onClick={onLuk} title="Close (the queue keeps running)">Close</button>
      </div>
      <KoeFremdrift t={t} nu={nu} />
      {!t.vaerker.length && <p className="tom">Nothing in the queue. Select works in Product or Shop and click Send to shop.</p>}
      <ol className="koe-liste">
        {t.vaerker.map((k) => (
          <li key={k.id} className={`koe-vaerk ${k.status}`}>
            <div className="koe-linje">
              <span className="koe-titel">{k.titel}</span>
              <span className="koe-status">{STATUS[k.status]?.(k) ?? k.status}</span>
              {k.status === 'venter' && (
                <button className="lille" onClick={() => koeFjern(k.id)} title="Take the work out of the queue. Nothing is sent.">Remove</button>
              )}
            </div>
            {k.besked && <p className="koe-besked">{k.besked}{k.varighed >= 1000 ? ` (${varighed(k.varighed)})` : ''}</p>}
            {k.status === 'sprunget' && k.existing && (
              <button
                className="lille"
                onClick={() => koeTilfoej([k.imageId], k.existing.id)}
                title="The app takes over that product: its texts and images are replaced by the ones in the app"
              >
                Update product {k.existing.id} from the app
              </button>
            )}
            {k.status === 'fejl' && (
              <button className="lille" onClick={() => koeTilfoej([k.imageId])}>Try again</button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// Knappen i bundlinjen. Den viser koeen kort, og et klik aabner listen.
export default function KoeKnap() {
  const t = useKoe();
  const [aaben, setAaben] = useState(false);
  const nu = useNu(t.koerer);
  const venter = t.vaerker.filter((k) => k.status === 'venter').length;
  const fejl = t.vaerker.filter((k) => k.status === 'fejl' || k.status === 'sprunget').length;
  // Aabner af sig selv, naar noget laegges i koeen.
  const [sidstAntal, setSidstAntal] = useState(0);
  useEffect(() => {
    const n = t.vaerker.filter((k) => k.status === 'venter' || k.status === 'sender').length;
    if (n > sidstAntal) setAaben(true);
    setSidstAntal(n);
  }, [t.vaerker]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t.vaerker.length && !aaben) return null;
  const k = koersel(t);
  const tekst = t.koerer
    ? `Shop queue · ${k.nr} of ${k.ialt}`
    : fejl ? `Shop queue · ${fejl} not sent` : 'Shop queue';
  return (
    <>
      <button className={`lille koe-knap ${t.koerer ? 'koerer' : ''} ${!t.koerer && fejl ? 'fejl' : ''}`} onClick={() => setAaben((a) => !a)} title="Show the queue of works going to the shop">
        {tekst}
        {t.koerer && <span className="koe-mini"><span style={{ width: `${Math.round(k.del * 100)}%` }} /></span>}
        {!t.koerer && venter ? ` · ${venter} waiting` : ''}
      </button>
      {aaben && createPortal(<KoePanel t={t} nu={nu} onLuk={() => setAaben(false)} />, document.body)}
    </>
  );
}
