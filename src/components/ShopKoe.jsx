import { useEffect, useState } from 'react';
import {
  useKoe, koeTilfoej, koeFjern, koersel, vaerkDel, mb, varighed, klokken,
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

// Koeen til shoppen, lige under Send to shop: alt der venter, i den
// raekkefoelge det sendes, og hvordan det gik. Er der intet i koeen, staar
// der intet. De sendte vaerker forsvinder af sig selv, naar koeen er
// faerdig; sprunget over og fejl bliver staaende med aarsagen.
export default function ShopKoe() {
  const t = useKoe();
  const nu = useNu(t.koerer);
  if (!t.vaerker.length) return null;
  return (
    <div className="koe-panel" aria-label="Shop queue">
      <h4>Shop queue</h4>
      <KoeFremdrift t={t} nu={nu} />
      <ol className="koe-liste">
        {t.vaerker.map((k) => (
          <li key={k.id} className={`koe-vaerk ${k.status}`}>
            <div className="koe-linje">
              <span className="koe-titel">{k.titel}</span>
              <span className="koe-status">{STATUS[k.status]?.(k) ?? k.status}</span>
              {(k.status === 'venter' || k.status === 'sprunget' || k.status === 'fejl') && (
                <button
                  className="lille"
                  onClick={() => koeFjern(k.id)}
                  title={k.status === 'venter' ? 'Take the work out of the queue. Nothing is sent.' : 'Remove from the list'}
                >
                  Remove
                </button>
              )}
            </div>
            {k.besked && k.status !== 'sendt' && <p className="koe-besked">{k.besked}</p>}
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
