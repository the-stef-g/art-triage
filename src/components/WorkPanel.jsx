import { useEffect, useState } from 'react';
import { invoke } from '../api';

const CATEGORIES = ['Graphic Design', 'Photography', 'Paintings', 'Sculptures'];
const CROP_FORMATS = ['1:1', '2:3', '3:2', '1:2', '2:1'];

const TEXT_LABELS = {
  description: 'Description',
  short_text: 'Short text',
  alt_text: 'Alt text',
};

// Vaerk-panelet (docs/plan-shop.md). Teksterne rettes kun her; Woo er en
// kopi. Felterne gemmes naar man forlader dem, ikke for hver tast, saa
// en igangvaerende rettelse aldrig bliver skrevet over af en genindlaesning.
export default function WorkPanel({ row, versions, hasKey, onError }) {
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
      .then((w) => { if (live) adopt(w); })
      .catch(onError);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, row.rating, row.finished]);

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

  const setCrop = async (versionId, format) => {
    try {
      await invoke('work:setCrop', { imageId, versionId, format: format || null });
      adopt(await invoke('work:get', { imageId }));
    } catch (err) {
      onError(err);
    }
  };

  const cropVersion = (format) => work.crops.find((c) => c.format === format)?.versionId ?? '';
  const versionName = (v) => (v.is_master ? 'Original' : v.name);

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

      <label className="vaerk-check">
        <input
          type="checkbox"
          checked={work.prints}
          onChange={(e) => commit({ prints: e.target.checked })}
        />
        Sold as prints
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

      <h4>Crops</h4>
      {CROP_FORMATS.map((f) => (
        <div key={f} className="vaerk-crop">
          <span className="vaerk-format">{f}</span>
          <select value={cropVersion(f)} onChange={(e) => setCrop(Number(e.target.value), f)}>
            <option value="">None</option>
            {versions.map((v) => <option key={v.id} value={v.id}>{versionName(v)}</option>)}
          </select>
          {cropVersion(f) && (
            <button className="lille" onClick={() => setCrop(cropVersion(f), null)} title="Clear">×</button>
          )}
        </div>
      ))}

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
