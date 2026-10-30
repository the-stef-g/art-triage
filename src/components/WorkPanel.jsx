import { useEffect, useState } from 'react';
import { invoke } from '../api';

const CATEGORIES = ['Graphic Design', 'Photography', 'Paintings', 'Sculptures'];

const TEXT_LABELS = {
  description: 'Description',
  short_text: 'Short text',
  alt_text: 'Alt text',
};

// Vaerk-panelet (docs/plan-shop.md). Teksterne rettes kun her; Woo er en
// kopi. Felterne gemmes naar man forlader dem, ikke for hver tast, saa
// en igangvaerende rettelse aldrig bliver skrevet over af en genindlaesning.
export default function WorkPanel({ row, versions, tekstRev = 0, hasKey, shop, onShop, onError }) {
  const imageId = row.image_id;
  const [work, setWork] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState([]);

  const adopt = (w) => {
    setWork(w);
    setDraft({
      title: w.title ?? '',
      year: w.year ?? '',
      technique: w.technique ?? '',
      sectionColour: w.sectionColour ?? '',
      catalogueNumber: w.catalogueNumber ?? '',
      dimensions: w.dimensions ?? '',
      price: w.price ?? '',
      notes: w.notes ?? '',
      description: w.description ?? '',
      shortText: w.shortText ?? '',
      altText: w.altText ?? '',
    });
  };

  // Genindlaeses kun naar billedet skifter, eller naar det bliver godkendt
  // eller faerdigt: ellers ville katalogets haendelser, fx noegleord der
  // skrives loebende, nulstille det Stef er i gang med at skrive.
  useEffect(() => {
    let live = true;
    setWarnings([]);
    invoke('work:get', { imageId })
      .then((w) => {
        if (!live) return;
        adopt(w);
        // Et faerdigt vaerk uden tekster faar dem nu, sammen med skabelon,
        // sektionsfarve og noegleord, som et nyt vaerk ville have faaet.
        if (hasKey && w.eligible && !w.description && !w.shortText && !w.altText) {
          invoke('work:auto', { imageId }).catch(() => {});
        }
      })
      .catch(onError);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, row.rating, row.finished, tekstRev]);

  if (!work) return null;

  // patch bruger databasens feltnavne. Ved en fejl rulles feltet tilbage
  // til det gemte, saa det der staar paa skaermen er det der er gemt.
  const commit = async (patch) => {
    try {
      adopt(await invoke('work:save', { imageId, patch }));
    } catch (err) {
      onError(err);
      adopt(work);
    }
  };

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  // Gemmer kun hvis feltet faktisk er aendret, saa et klik ind og ud ikke
  // skriver noget.
  const blurSave = (draftKey, column, saved) => () => {
    if (String(draft[draftKey] ?? '') !== String(saved ?? '')) commit({ [column]: draft[draftKey] });
  };

  const writeTexts = async (overwrite = false) => {
    setBusy(true);
    try {
      const res = await invoke('work:writeTexts', { imageId, overwrite });
      if (res.needsConfirm) {
        const navne = res.edited.map((f) => TEXT_LABELS[f].toLowerCase()).join(', ');
        setBusy(false);
        if (window.confirm(`You have edited the ${navne}. Replace what you wrote with new drafts from Claude?`)) {
          await writeTexts(true);
        }
        return;
      }
      adopt(res.work);
      setWarnings(res.warnings);
    } catch (err) {
      onError(err);
    }
    setBusy(false);
  };

  const pickVideo = async () => {
    try {
      const path = await invoke('work:pickVideo');
      if (path) commit({ video: path });
    } catch (err) {
      onError(err);
    }
  };


  // Shop-knapperne gaar gennem hovedprocessen, som ejer noeglerne.
  const shopKald = async (kanal, besked) => {
    setBusy(true);
    try {
      const res = await invoke(kanal, { imageId });
      adopt(await invoke('work:get', { imageId }));
      onShop(besked(res));
    } catch (err) {
      onError(err);
    }
    setBusy(false);
  };

  const sendToShop = () => shopKald('shop:send', (r) =>
    (r.created ? `Created draft product ${r.productId} in the shop` : `Updated product ${r.productId} in the shop`));
  const publish = () => shopKald('shop:publish', (r) => `Product ${r.productId} is now ${r.status}`);
  // Seriens felter til shoppen. En ny serie faar altid en skabelon i
  // shoppen; en der findes, faar kun de felter der er udfyldt her.
  const saveSeries = async (patch) => {
    try {
      await invoke('ser:setShop', { seriesId: work.series.id, patch });
      adopt(await invoke('work:get', { imageId }));
    } catch (err) {
      onError(err);
      adopt(work);
    }
  };

  const kanSkrive = work.eligible && hasKey;
  const skriveHint = !work.eligible
    ? 'Texts unlock when the image is Approved and Finished'
    : !hasKey ? 'Add your Claude API key under Help first' : '';

  return (
    <div className="vaerk">
      <h4>Work</h4>
      <p className="vaerk-note">
        Texts are edited here only. The shop is a copy: anything changed in
        WooCommerce is overwritten the next time the work is sent.
      </p>

      <label>Title
        <input
          value={draft.title}
          placeholder={work.effective.title}
          onChange={set('title')}
          onBlur={blurSave('title', 'title', work.title)}
        />
      </label>
      <div className="vaerk-raekke">
        <label>Year
          <input
            value={draft.year}
            inputMode="numeric"
            placeholder={work.effective.year ? String(work.effective.year) : 'from the photo'}
            onChange={set('year')}
            onBlur={blurSave('year', 'year', work.year)}
          />
        </label>
        <label>Catalogue no.
          <input
            value={draft.catalogueNumber}
            placeholder={work.effective.catalogueNumber || 'none'}
            onChange={set('catalogueNumber')}
            onBlur={blurSave('catalogueNumber', 'catalogue_number', work.catalogueNumber)}
          />
        </label>
      </div>
      <label>Category
        <select value={work.category || ''} onChange={(e) => commit({ category: e.target.value })}>
          <option value="">Not set</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label>Technique
        <input
          value={draft.technique}
          placeholder="Digital art"
          onChange={set('technique')}
          onBlur={blurSave('technique', 'technique', work.technique)}
        />
      </label>
      <div className="vaerk-raekke">
        <label>Template
          <select value={work.template} onChange={(e) => commit({ template: e.target.value })}>
            <option value="spread">Spread</option>
            <option value="poster">Poster</option>
          </select>
        </label>
        <label>Section colour
          <input
            value={draft.sectionColour}
            placeholder="Series colour"
            onChange={set('sectionColour')}
            onBlur={blurSave('sectionColour', 'section_colour', work.sectionColour)}
          />
        </label>
      </div>
      <label>Video
        <span className="vaerk-video">
          <span className="vaerk-sti" title={work.video || ''}>
            {work.video ? work.video.split('/').pop() : 'None'}
          </span>
          <button className="lille" onClick={pickVideo}>Choose …</button>
          {work.video && <button className="lille" onClick={() => commit({ video: '' })}>Remove</button>}
        </span>
      </label>

      {/* Ikke et valg: alle vaerker saelges som print, undtagen malerier og
          skulpturer. Appen skriver det til shoppen (work_prints). */}
      <p
        className="vaerk-note"
        title="Set by the app from the category: every work is offered as prints, except Paintings and Sculptures, which are sold as the original."
      >
        {work.prints
          ? 'Offered as prints.'
          : 'Sold as the original, not as prints.'}
      </p>

      {work.unique && (
        <div className="vaerk-raekke">
          <label>Dimensions
            <input
              value={draft.dimensions}
              placeholder="60 × 80 cm"
              onChange={set('dimensions')}
              onBlur={blurSave('dimensions', 'dimensions', work.dimensions)}
            />
          </label>
          <label>Price
            <input
              value={draft.price}
              inputMode="decimal"
              placeholder="1200"
              onChange={set('price')}
              onBlur={blurSave('price', 'price', work.price)}
            />
          </label>
        </div>
      )}

      <h4>Shop</h4>
      <p className="vaerk-note">
        {!work.wooProductId
          ? 'Not in the shop yet. A new product is created as a draft.'
          : work.wooStatus === 'publish'
            ? `Product ${work.wooProductId} is published in the shop. Sending again overwrites the texts there.`
            : `Product ${work.wooProductId} is a draft in the shop. Sending again overwrites the texts there; Publish moves the work to 6 Shop.`}
      </p>
      <div className="knapraekke">
        <button
          disabled={busy || !work.eligible || !shop?.harWoo || !shop?.harWp || shop?.formatOk === false}
          onClick={sendToShop}
          title={!work.eligible ? 'The image must be Approved and Finished'
            : (!shop?.harWoo || !shop?.harWp) ? 'Add the WooCommerce key and the WordPress application password under Help'
              : shop?.formatOk === false ? 'The shop\'s product format has changed since the app was made for it. Sending is locked so no product is damaged.' : ''}
        >
          Send to shop
        </button>
        {work.wooProductId && work.wooStatus !== 'publish' && (
          <button disabled={busy} onClick={publish} title="Publish the draft in the shop. The work moves to 6 Shop.">Publish</button>
        )}
      </div>
      {shop?.formatOk === false && (
        <ul className="vaerk-advarsler">
          {shop.formatProblems.slice(0, 4).map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {work.series && (
        <>
          <p className="vaerk-note">Series «{work.series.name}» in the shop. Empty fields are left as they are there.</p>
          <label>Series intro
            <textarea
              rows={2}
              defaultValue={work.series.intro ?? ''}
              key={`intro-${work.series.id}`}
              onBlur={(e) => { if (e.target.value !== (work.series.intro ?? '')) saveSeries({ intro: e.target.value }); }}
            />
          </label>
          <div className="vaerk-raekke">
            <label>Series template
              <select value={work.series.template || ''} onChange={(e) => saveSeries({ template: e.target.value })}>
                <option value="">Not set</option>
                <option value="walkthrough">Walkthrough</option>
                <option value="wall">Wall</option>
              </select>
            </label>
            <label>Series colour
              <input
                defaultValue={work.series.colour ?? ''}
                key={`colour-${work.series.id}-${work.series.colour}`}
                placeholder="#dd9933"
                onBlur={(e) => { if (e.target.value !== (work.series.colour ?? '')) saveSeries({ colour: e.target.value }); }}
              />
            </label>
          </div>
        </>
      )}

      <h4>Texts</h4>
      <label>Your notes (sent to Claude)
        <textarea
          rows={3}
          value={draft.notes}
          placeholder="What, why, how"
          onChange={set('notes')}
          onBlur={blurSave('notes', 'notes', work.notes)}
        />
      </label>
      <div className="knapraekke">
        <button disabled={!kanSkrive || busy} onClick={() => writeTexts(false)} title={skriveHint}>
          {busy ? 'Writing …' : 'Write texts'}
        </button>
        {skriveHint && <span className="vaerk-note">{skriveHint}</span>}
      </div>
      {warnings.length > 0 && (
        <ul className="vaerk-advarsler">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {[['description', 'description', 'Description', 7],
        ['short_text', 'shortText', 'Short text', 2],
        ['alt_text', 'altText', 'Alt text', 2]].map(([column, key, label, rows]) => (
          <label key={column}>
            {label}
            {work.editedTexts.includes(column) && <span className="vaerk-rettet"> · edited by you</span>}
            <textarea
              rows={rows}
              value={draft[key]}
              onChange={set(key)}
              onBlur={blurSave(key, column, work[key])}
            />
            {column === 'description' && (
              <span className="vaerk-tael">{(draft[key].match(/\S+/g) || []).length} words</span>
            )}
            {column === 'alt_text' && <span className="vaerk-tael">{draft[key].length} characters</span>}
          </label>
        ))}
    </div>
  );
}
