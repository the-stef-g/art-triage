import { useEffect } from 'react';
import { fileName } from '../util';

// Kassér et vaerk: hvad der sker, foer det sker. Originalen til Discarded,
// resten af vaerkmappen i papirkurven, og produktet ud af shoppen.
export default function KasserDialog({ plan, onCancel, onOk }) {
  useEffect(() => {
    const taste = (e) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onOk();
    };
    window.addEventListener('keydown', taste, true);
    return () => window.removeEventListener('keydown', taste, true);
  }, [onCancel, onOk]);
  const publiceret = plan.status === 'publish';
  return (
    <div className="dialog-bag" onClick={onCancel}>
      <div className="dialog kasser-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Discard «{plan.titel}»?</h3>
        {plan.original && (
          <p>The original <strong>{fileName(plan.original)}</strong> goes to the Discarded folder.</p>
        )}
        {plan.tilPapirkurv.length > 0 && (
          <>
            <p>These files go to the Trash, with the folder {plan.mappe}:</p>
            <ul className="dialog-filer">
              {plan.tilPapirkurv.map((rel) => (
                <li key={rel} title={rel}>
                  <span className="tom">{rel.split('/')[2]}</span> {fileName(rel)}
                </li>
              ))}
            </ul>
          </>
        )}
        {plan.productId && !publiceret && (
          <p>Product {plan.productId} is taken out of the shop (it goes to the Trash in WordPress).</p>
        )}
        {publiceret && (
          <p className="fejl">The work is published on the site. Take it off with Remove from shop first.</p>
        )}
        <p className="tom">Files in the Trash can be put back from Finder.</p>
        <div className="knapraekke dialog-knapper">
          <button onClick={onCancel}>Cancel</button>
          <button className="fare" disabled={publiceret} onClick={onOk}>Discard</button>
        </div>
      </div>
    </div>
  );
}
