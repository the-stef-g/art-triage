import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '../api';
import { useKoe, koeTilfoej, vaerkDel, klokken, mb } from '../koe';

const HEX = /^#[0-9a-f]{6}$/i;

const CATEGORIES = ['Graphic Design', 'Photography', 'Paintings', 'Sculptures'];

const TEXT_LABELS = {
  description: 'Description',
  short_text: 'Short text',
  alt_text: 'Alt text',
};

// Vaerk-panelet (docs/plan-shop.md). Teksterne rettes kun her; Woo er en
// kopi. Felterne gemmes naar man forlader dem, ikke for hver tast, saa
// en igangvaerende rettelse aldrig bliver skrevet over af en genindlaesning.
export default function WorkPanel({ row, versions, tekstRev = 0, hasKey, shop, onShop, onError, children = null, shopNode = null, valgteVaerker = [] }) {
  const imageId = row.image_id;
  const [work, setWork] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  // Farvevaelgeren melder hver bevaegelse; der gemmes, naar den staar stille.
  const farveTimer = useRef(null);
  const [warnings, setWarnings] = useState([]);
  // Vaerket i koeen til shoppen: venter, sendes, sendt, sprunget over
  // eller fejl. Det seneste, hvis det har vaeret der flere gange.
  const koe = useKoe();
  const iKoe = [...koe.vaerker].reverse().find((k) => k.imageId === imageId) ?? null;
  const sendes = iKoe?.status === 'venter' || iKoe?.status === 'sender';
  // Dialogen der spoerger, om en ny titel skal omdoebe filerne.
  const [omdoeb, setOmdoeb] = useState(null);
  // Naar koeen har sendt vaerket, hentes det igen (produktnummer, status).
  useEffect(() => {
    if (iKoe?.status !== 'sendt') return;
    invoke('work:get', { imageId }).then(adopt).catch(() => {});
  }, [iKoe?.status, iKoe?.tid]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // En ny titel kan omdoebe vaerkets filer. Foerst en plan; har den noget
  // at omdoebe, spoerger en dialog, ellers gemmes titlen bare.
  const gemTitel = async () => {
    const ny = String(draft.title ?? '').trim();
    if (ny === String(work.title ?? '')) return;
    if (!ny) {
      commit({ title: draft.title });
      return;
    }
    try {
      const plan = await invoke('work:omdoebPlan', { imageId, title: ny });
      if (plan && plan.til !== plan.fra) setOmdoeb({ ...plan, titel: ny });
      else commit({ title: ny });
    } catch (err) {
      onError(err);
      commit({ title: ny });
    }
  };
  const udfoerOmdoeb = async () => {
    const { titel } = omdoeb;
    setOmdoeb(null);
    try {
      adopt(await invoke('work:omdoeb', { imageId, title: titel }));
    } catch (err) {
      onError(err);
      adopt(work);
    }
  };
  const kunTitel = () => {
    const { titel } = omdoeb;
    setOmdoeb(null);
    commit({ title: titel });
  };
  const fortryd = () => {
    setOmdoeb(null);
    adopt(work);
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

  // Vaerkerne laegges i koeen til shoppen og sendes ét ad gangen. Har
  // shoppen allerede et produkt med samme navn, springes vaerket over, og
  // koeen spoerger, om det produkt skal opdateres. Saa bliver der ikke lavet
  // en dublet.
  const flere = valgteVaerker.length > 1 && valgteVaerker.includes(imageId);
  const sendToShop = async (kobl = null) => {
    try {
      await koeTilfoej(flere && kobl == null ? valgteVaerker : [imageId], kobl);
    } catch (err) {
      onError(err);
    }
  };
  const publish = () => shopKald('shop:publish', (r) => `Product ${r.productId} is now ${r.status}`);
  // Af sitet igen: produktet bliver en kladde, ikke slettet, for gamle
  // ordrer peger paa det.
  const remove = () => {
    if (!window.confirm('Take the work off stefg.art? The product becomes a draft again (it is not deleted, so old orders still point to it), and the work goes back to Product.')) return;
    shopKald('shop:remove', (r) => `Product ${r.productId} is now a draft and off the site`);
  };
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

  // To kolonner: vaerkets felter, serie og soegeord til venstre, teksterne
  // til hoejre, saa det hele kan ses uden at scrolle.
  const form = (
    <div className="vaerk vaerk-kolonner">
      <div className="vaerk-kolonne">
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
          onBlur={gemTitel}
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
        {/* Ikke et valg: alle vaerker saelges som print, undtagen malerier og
            skulpturer. Appen skriver det til shoppen (work_prints), saa
            produktsiden ved, om den skal vise printmulighederne. */}
        <span
          className="vaerk-tael"
          title="Set by the app from the category, and sent to the shop so the product page knows whether to show the print options."
        >
          {work.prints ? 'Offered as prints' : 'Sold as the original, not as prints'}
        </span>
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
          <span className="farve-felt">
            {/* Farven selv; et klik aabner farvevaelgeren. Uden en gyldig
                kode staar feltet tomt (stribet). */}
            <input
              type="color"
              className={`farve-proeve ${HEX.test(draft.sectionColour) ? '' : 'tom'}`}
              value={HEX.test(draft.sectionColour) ? draft.sectionColour.toLowerCase() : '#000000'}
              title="Choose the colour"
              onChange={(e) => {
                const v = e.target.value;
                setDraft((d) => ({ ...d, sectionColour: v }));
                clearTimeout(farveTimer.current);
                farveTimer.current = setTimeout(() => commit({ section_colour: v }), 500);
              }}
            />
            <input
              value={draft.sectionColour}
              placeholder="Series colour"
              onChange={set('sectionColour')}
              onBlur={blurSave('sectionColour', 'section_colour', work.sectionColour)}
            />
          </span>
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

      {/* Serie og soegeord, fra inspektoeren, saa hver ting kun staar ét sted. */}
      {children}
      </div>

      <div className="vaerk-kolonne">
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
      {/* Serien skal staa i teksterne. Uden Stefs rettelser skriver appen dem
          selv om; ellers siges det her. */}
      {work.serieIkkeITekst && work.editedTexts.length > 0 && (
        <p className="vaerk-note">The description does not mention the series «{work.seriesName}». Write texts again to add it, or add it yourself.</p>
      )}
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
              className={column === 'description' ? 'vaerk-beskrivelse' : undefined}
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
    </div>
  );
  // Shoppen til sidst: den bruges foerst, naar alt andet er klar. I Product
  // staar den i hoejre kolonne med en tjekliste over det, der mangler.
  const mangler = [
    ['Category', Boolean(work.category)],
    ['Year', Boolean(work.effective.year)],
    ['Description', Boolean(work.description)],
    ['Alt text', Boolean(work.altText)],
    ...(work.unique ? [['Price', Boolean(work.price)]] : []),
    [`Crops (${work.crops?.length || 0})`, (work.crops?.length || 0) > 0],
  ];
  const shopDel = (
    <div className="vaerk shop-del">
      <h4>Ready for the shop</h4>
      <ul className="tjekliste">
        {mangler.map(([navn, ok]) => <li key={navn} className={ok ? 'ok' : 'mangler'}>{navn}</li>)}
      </ul>
      <h4>Shop</h4>
      {work.wooProductId && (
        <p className={work.shopAendret ? 'shop-status aendret' : 'shop-status'}>
          {work.shopAendret
            ? '● Changed in the app since it was last sent. Update shop to send it.'
            : '✓ The shop has what is here.'}
        </p>
      )}
      <p className="vaerk-note">
        {!work.wooProductId
          ? 'Not in the shop yet. A new product is created as a draft.'
          : work.wooStatus === 'publish'
            ? `Product ${work.wooProductId} is published in the shop. Sending again overwrites the texts there.`
            : `Product ${work.wooProductId} is a draft in the shop. Sending again overwrites the texts there; Publish moves the work to Shop.`}
      </p>
      <div className="knapraekke">
        <button
          className={!work.wooProductId || work.shopAendret ? 'primaer' : ''}
          disabled={busy || (!flere && sendes) || (!flere && !work.eligible) || !shop?.harWoo || !shop?.harWp || shop?.formatOk === false}
          onClick={() => sendToShop()}
          title={flere ? 'The selected works go into the shop queue and are sent one at a time' : !work.eligible ? 'The image must be Approved and Finished'
            : (!shop?.harWoo || !shop?.harWp) ? 'Add the WooCommerce key and the WordPress application password under Help'
              : shop?.formatOk === false ? 'The shop\'s product format has changed since the app was made for it. Sending is locked so no product is damaged.' : ''}
        >
          {flere ? `Send ${valgteVaerker.length} to shop` : work.wooProductId ? 'Update shop' : 'Send to shop'}
        </button>
        {work.wooProductId && work.wooStatus !== 'publish' && (
          <button disabled={busy || sendes} onClick={publish} title="Publish the draft in the shop. The work moves to Shop.">Publish</button>
        )}
        {work.wooProductId && work.wooStatus === 'publish' && (
          <button disabled={busy || sendes} onClick={remove} title="Take the product off the site. It becomes a draft again.">Remove from shop</button>
        )}
      </div>
      {iKoe && <VaerkIKoe k={iKoe} koe={koe} onKobl={(id) => sendToShop(id)} />}
      <div className="knapraekke finder-knap">
        <button
          onClick={() => invoke('img:openWorkFolder', { versionId: row.version_id }).catch(onError)}
          title="Open the work's folder with Original, Edits, Master and Print files"
        >
          Show in Finder
        </button>
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
              className="serie-intro"
              rows={4}
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

    </div>
  );
  return (
    <>
      {form}
      {shopNode ? createPortal(shopDel, shopNode) : shopDel}
      {omdoeb && createPortal(
        <OmdoebDialog plan={omdoeb} onRename={udfoerOmdoeb} onTitle={kunTitel} onCancel={fortryd} />,
        document.body
      )}
    </>
  );
}

// Dialogen naar titlen aendres: hvad der omdoebes, og et valg.
function OmdoebDialog({ plan, onRename, onTitle, onCancel }) {
  useEffect(() => {
    const taste = (e) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', taste, true);
    return () => window.removeEventListener('keydown', taste, true);
  }, [onCancel]);
  const kan = !plan.problemer.length;
  return (
    <div className="dialog-bag" onClick={onCancel}>
      <div className="dialog omdoeb-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Rename the files to «{plan.til}»?</h3>
        <p>The work folder and {plan.filer.length} file{plan.filer.length === 1 ? '' : 's'}:</p>
        <ul className="dialog-filer">
          <li><span className="tom">Folder</span> {plan.mappe.fra} → {plan.mappe.til}</li>
          {plan.filer.map((f) => (
            <li key={f.fra} title={`${f.fra} → ${f.til}`}>{f.fra} → {f.til.split('/').pop()}</li>
          ))}
        </ul>
        {plan.problemer.length > 0 && (
          <ul className="vaerk-advarsler">{plan.problemer.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
        <p className="tom">
          The series, texts, crops and the link to the shop stay as they are. The product in the shop gets the new title the next time you update the shop.
        </p>
        <div className="knapraekke dialog-knapper">
          <button onClick={onCancel}>Cancel</button>
          <button onClick={onTitle}>Only the title</button>
          <button className="primaer" disabled={!kan} onClick={onRename}>Rename files</button>
        </div>
      </div>
    </div>
  );
}

// Vaerkets linje under shopknapperne: hvor det er i koeen, hvor langt det
// er naaet, og hvordan det endte.
function VaerkIKoe({ k, koe, onKobl }) {
  if (k.status === 'venter') {
    const foran = koe.vaerker.filter((x) => (x.status === 'venter' || x.status === 'sender') && x.id < k.id).length;
    return <p className="shop-fremdrift igang" role="status">Waiting in the shop queue{foran ? ` (${foran} before it)` : ''}</p>;
  }
  if (k.status === 'sender') {
    const f = koe.fremdrift;
    return (
      <div className="shop-fremdrift igang" role="status">
        <div className="koe-bjaelke"><div style={{ width: `${Math.round(vaerkDel(f) * 100)}%` }} /></div>
        <p>{f?.tekst ?? 'Starting'}{f?.total ? ` · ${mb(f.bytes || 0)} of ${mb(f.total)} MB` : ''} …</p>
      </div>
    );
  }
  if (k.status === 'sendt') return <p className="shop-fremdrift ok" role="status">✓ {k.besked} at {klokken(k.tid)}</p>;
  if (k.status === 'sprunget') {
    return (
      <div className="shop-fremdrift fejl" role="status">
        <p>Skipped: {k.besked}</p>
        {k.existing && (
          <button className="lille" onClick={() => onKobl(k.existing.id)} title="Its texts and images are replaced by the ones here">
            Update product {k.existing.id} from the app
          </button>
        )}
      </div>
    );
  }
  return <p className="shop-fremdrift fejl" role="status">✕ Not sent: {k.besked}</p>;
}
