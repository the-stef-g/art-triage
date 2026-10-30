import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke, thumbUrl } from '../api';
import { formatBytes, formatDate, fileName } from '../util';
import WorkPanel from './WorkPanel';
import CropModal from './CropModal';
import { gigapixelMaal } from '../printmaal';

// dataRev taeller op hver gang kataloget melder en aendring. Uden den
// blev noegleordene kun hentet naar man skiftede billede, saa ord Claude
// lige havde skrevet foerst dukkede op hvis man gik væk og tilbage igen.
export default function Inspector({
  row, fase = 1, selectedCount, activeKeyword, editors, statusNavne = [], series, act, dataRev, tekstRev = 0, hasKey, shop, onShop, onError,
  shopNode = null, cropNode = null,
}) {
  const [versions, setVersions] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [nytOrd, setNytOrd] = useState('');
  const [beskaer, setBeskaer] = useState(false);

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
  }, [row?.version_id, row?.file_id, row?.image_id, row?.mtime, dataRev]);

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

  // Et faelles serieord ville komme igen ved naeste skanning, hvis det kun
  // blev fjernet her. Saa er valget: fjern det fra hele serien, eller lad
  // vaere.
  const fjernOrd = async (word) => {
    if (!row) return;
    try {
      const serie = await invoke('kw:serieOrd', { fileId: row.file_id, word });
      if (serie) {
        const ok = window.confirm(
          `«${word}» is shared by the series «${serie.serie}»: ${serie.fileIds.length} of its ${serie.antal} works have it. `
          + 'Removed from this work only, it would come back at the next scan.\n\n'
          + `OK removes «${word}» from all the works in the series. Cancel keeps it.`
        );
        if (!ok) return;
        await invoke('kw:removeFromFiles', { fileIds: serie.fileIds, word });
      } else {
        await invoke('kw:remove', { fileId: row.file_id, word });
      }
      loadKeywords();
    } catch {
      // ignoreres
    }
  };

  if (!row) {
    return (
      <aside className="inspector">
        <p className="tom">Select an image to see details</p>
        {/* Genvejene stod her, altsaa netop naar der ikke var noget at
            bruge dem paa. De er flyttet op i vaerktoejslinjen, hvor de
            baade er fremme hele tiden og kan klikkes. */}
      </aside>
    );
  }

  // Det der kan beskaeres er værkets master: den valgte fil hvis den ligger i
  // Master, ellers den foerste fil i Master. Uden en er vaerket ikke faerdigt.
  const iMaster = (rel) => /^Approved\/[^/]+\/Master\//.test(rel);
  const masterVersion = iMaster(row.rel_path)
    ? row
    : versions.find((v) => iMaster(v.rel_path));
  const master = masterVersion ? {
    version_id: masterVersion.version_id ?? masterVersion.id,
    file_id: masterVersion.file_id ?? masterVersion.effective_file_id,
    mtime: masterVersion.mtime,
    rotation: masterVersion.rotation || 0,
    rel_path: masterVersion.rel_path,
  } : null;

  const iArbejde = row.rel_path.startsWith('Approved/');
  const iEdits = /^Approved\/[^/]+\/Edits\//.test(row.rel_path);
  const PROGRAMMER = [['Luminar Neo', 'neo'], ['Topaz Photo AI', 'tp'], ['Photoshop', 'ps']];
  const installeret = new Set(editors.map((e) => e.label));

  return (
    <aside className="inspector">
      {/* Inspektoeren viser det aktive billede og kun de vaerktoejer, den
          fase man er i, har brug for. */}
      {selectedCount > 1 && (
        <div className="bunke">
          <h4>{selectedCount} selected</h4>
          {fase === 1 && <p className="tom">The rating applies to the active image only.</p>}
          {(fase === 5 || fase === 6) && activeKeyword && (
            <div className="knapraekke">
              <button
                className="fjern-fra-noegleord"
                onClick={() => act.removeKeywordFromSelected(activeKeyword)}
                title={`Remove the keyword "${activeKeyword}" from the selected images`}
              >
                Remove «{activeKeyword}» from all {selectedCount}
              </button>
            </div>
          )}
          {(fase === 5 || fase === 6) && (
            <div className="knapraekke">
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'ny') act.newSeries();
                  else if (v === 'fjern') act.assignSeries(null);
                  else if (v) act.assignSeries(Number(v));
                }}
                title="Applies to all the selected images"
              >
                <option value="">Set series for all {selectedCount} …</option>
                {series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="ny">New series …</option>
                <option value="fjern">Remove from series</option>
              </select>
            </div>
          )}
        </div>
      )}
      {/* Stort i Sort, hvor billederne bedoemmes; ellers er en lille
          forhaandsvisning nok. */}
      {/* I Product staar forhaandsvisningen i hoejre kolonne, ved shoppen. */}
      {!shopNode && (
      <div className={fase === 1 ? 'stor-preview' : 'stor-preview lille-preview'}>
        <img src={thumbUrl(row.file_id, row.mtime, fase === 1 ? 2048 : 512, row.rotation)} alt={fileName(row.rel_path)} />
      </div>
      )}
      {/* Drejningen hoerer til Sort og Edit. L og R virker stadig overalt. */}
      {fase <= 2 && (
      <div className="knapraekke drej">
        <button className="lille" onClick={() => act.rotate(-90)} title="Rotate left (shortcut L)">⟲ Left</button>
        <button className="lille" onClick={() => act.rotate(90)} title="Rotate right (shortcut R)">⟳ Right</button>
        {row.rotation ? (
          <button className="lille" onClick={() => act.rotate(0)} title="Back to the automatic rotation">Reset</button>
        ) : null}
      </div>
      )}
      <h3 title={row.rel_path}>{fileName(row.rel_path)}</h3>
      <p className="detaljer">
        {formatBytes(row.size)} · {formatDate(row.mtime)}
        {row.series_name ? ` · Series: ${row.series_name}` : ''}
      </p>

      {fase === 1 && (
        <>
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
        </>
      )}

      {fase === 2 && (
        <>
          <h4>Edits</h4>
          <p className="tom">
            {row.editor ? `Edited in ${row.editor}.` : iEdits ? 'An edit. The program is not in the file name.' : 'The original.'}
          </p>
          <p className="tom">Send a copy to a program. The copy goes in the Edits folder with the program&apos;s ending (-neo, -tp, -ps). Save your result in Edits too.</p>
          <div className="knapraekke">
            {PROGRAMMER.map(([navn, endelse]) => (
              <button
                key={navn}
                disabled={!installeret.has(navn)}
                onClick={() => act.sendToEditor(navn)}
                title={installeret.has(navn)
                  ? `Copy this file to Edits as …-${endelse}, and open the copy in ${navn}`
                  : `${navn} was not found in Applications`}
              >
                {navn}
              </button>
            ))}
            <button className="lille" onClick={act.editInOther} title="Open the file in another program, without a copy">Other app …</button>
          </div>
          <p className="tom">Mark as edited in{selectedCount > 1 ? ` (all ${selectedCount} selected)` : ''}:</p>
          <div className="knapraekke">
            {[...new Set([...statusNavne, ...(row.editor ? [row.editor] : [])])].map((navn) => (
              <button
                key={navn}
                className={`lille ${row.editor === navn ? 'aktiv-redigeres' : ''}`}
                onClick={() => act.setEditor(row.editor === navn ? null : navn)}
                title={row.editor === navn ? 'Click to clear the status' : `Mark as edited in ${navn}`}
              >
                {navn}
              </button>
            ))}
          </div>

          <h4>Master</h4>
          <p className="tom">The last step here: make the finished edit the work&apos;s master. The work then moves on to Crop.</p>
          <div className="knapraekke">
            <button className="primaer" onClick={act.makeMaster} title="Copies the selected file to Master, named after the work">Make master</button>
          </div>

          <h4>Discard</h4>
          <div className="knapraekke">
            <button onClick={act.discardWork} title="The original goes to Discarded, and the edits go to the Trash (shortcut X)">Discard work</button>
            <button
              onClick={() => invoke('img:openWorkFolder', { versionId: row.version_id }).catch(onError)}
              title="Open the work's folder with Original, Edits, Master and Print files"
            >
              Show in Finder
            </button>
          </div>
        </>
      )}

      {(fase === 5 || fase === 6) && (
        <>
          <WorkPanel
            key={row.image_id}
            row={row}
            versions={versions}
            tekstRev={tekstRev}
            hasKey={hasKey}
            shop={shop}
            onShop={onShop}
            onError={onError}
            shopNode={shopNode}
          >
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
                <option value="">Not in a series</option>
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
          </WorkPanel>
        </>
      )}

      {fase === 3 && (
        <>
          <h4>Crops</h4>
          <div className="knapraekke">
            {['1:1', '2:3', '3:2', '1:2', '2:1'].map((f) => (
              <button
                key={f}
                className={row.crop === f ? 'aktiv-beskaering' : ''}
                disabled={!iMaster(row.rel_path)}
                onClick={() => invoke('img:setCrop', { versionId: row.version_id, crop: row.crop === f ? null : f }).catch(onError)}
                title={iMaster(row.rel_path)
                  ? 'Gives the file this crop, in its name and as a label. Click again to remove it.'
                  : 'Crops apply to files in the Master folder.'}
              >
                {f}
              </button>
            ))}
            <button
              disabled={!iMaster(row.rel_path) || !row.crop}
              onClick={() => invoke('img:setCrop', { versionId: row.version_id, crop: null }).catch(onError)}
              title="Remove the crop from the file name"
            >
              Clear
            </button>
          </div>
        </>
      )}

      {/* En ny beskaering kan ogsaa laves af et vaerk der er i shoppen. Den
          dukker saa op i Print, til den har sin printfil. */}
      {/* Crop: beskaeringen staar midt i vinduet, for vaerkets master. */}
      {fase === 3 && cropNode && createPortal(
        master
          ? <CropModal key={master.file_id} inline row={master} onClose={() => {}} onDone={onError} onError={onError} />
          : <p className="tom crop-tom">Select a work to crop its master.</p>,
        cropNode
      )}

      {fase === 6 && (
        <>
          <h4>Crops</h4>
          <div className="knapraekke">
            <button
              className="lille"
              disabled={!master}
              onClick={() => setBeskaer(true)}
              title={master
                ? `Crop ${master.rel_path.split('/').pop()} to an exact print format. The crop is saved as a new file in Master.`
                : 'Only finished works can be cropped: put the master in the Master folder first.'}
            >
              Crop master …
            </button>
          </div>
          {!master && (
            <p className="tom">Only finished works can be cropped. Put the master in the Master folder.</p>
          )}
          {beskaer && master && (
            <CropModal
              row={master}
              onClose={() => setBeskaer(false)}
              onDone={(besked) => { setBeskaer(false); onError(besked); }}
              onError={onError}
            />
          )}
        </>
      )}

      {/* Fase 4: én linje pr. beskaering. Forstoerrelsen (-giga) hoerer til
          beskaeringen, og printfilen laves af den, af sig selv. */}
      {fase === 4 && (
        <>
          <h4>Enlargement</h4>
          <GigapixelMaal row={row} dataRev={dataRev} />
          <p className="tom">
            {row.forstoerrelse
              ? `${row.forstoerrelse.split('/').pop()} in Edits.`
              : 'Not enlarged yet. Send the crop to Gigapixel; the copy goes in Edits with -giga in its name. Save the enlargement over it, and the app makes the print file.'}
          </p>
          <div className="knapraekke">
            <button
              className="primaer"
              disabled={!installeret.has('Topaz Gigapixel')}
              onClick={() => act.sendToEditor('Topaz Gigapixel')}
              title={installeret.has('Topaz Gigapixel')
                ? 'Copy the crop (or all the selected crops) to Edits as …-giga, and open the copies in Gigapixel'
                : 'Topaz Gigapixel was not found in Applications'}
            >
              {selectedCount > 1 ? 'Enlarge the selected in Gigapixel' : 'Enlarge in Gigapixel'}
            </button>
          </div>

          <h4>Print file</h4>
          <p className="tom">
            {row.printfil
              ? `${row.printfil.rel.split('/').pop()} · ${formatBytes(row.printfil.bytes)}`
              : 'Made by itself when the enlargement is saved.'}
          </p>
          <p className="tom">A PNG in sRGB at full size, marked 300 DPI, in the work&apos;s Print files folder, made from the largest -giga file. The format is always in its name (Desert 3-2.png), and the file is exactly that format. Prodigi&apos;s ICC profiles are for proofing and are not put in the file.</p>
          <div className="knapraekke">
            {row.forstoerrelse && (
              <button
                onClick={act.makePrintFiles}
                title="Make the print file again from the enlargement. An old print file with the same name is replaced."
              >
                {selectedCount > 1 ? `Make print files (${selectedCount})` : row.printfil ? 'Make print file again' : 'Make print file'}
              </button>
            )}
            {row.printfil && (
              <button
                onClick={() => invoke('img:openWorkFolder', { versionId: row.version_id, del: 'Print files' }).catch(onError)}
              >
                Open Print files
              </button>
            )}
          </div>
        </>
      )}

      {/* I Edit staar Show in Finder ved Discard work. */}
      {fase !== 2 && (
      <div className="knapraekke">
        {iArbejde ? (
          <button
            onClick={() => invoke('img:openWorkFolder', { versionId: row.version_id }).catch(onError)}
            title="Open the work's folder with Original, Edits, Master and Print files"
          >
            Show in Finder
          </button>
        ) : (
          <button onClick={act.reveal}>Show in Finder</button>
        )}
      </div>
      )}
    </aside>
  );
}

// Det tal der skal skrives ind i Gigapixel: bredden i pixels, og hvor mange
// gange beskaeringen skal forstoerres, for det stoerste print ved 300 DPI.
function GigapixelMaal({ row, dataRev }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let aktuel = true;
    invoke('print:maal', { filer: [{ id: row.file_id, mtime: row.mtime }] })
      .then((res) => { if (aktuel) setInfo({ krop: res.maal?.[row.file_id], cm: res.langsideCm }); })
      .catch(() => {});
    return () => { aktuel = false; };
  }, [row.file_id, row.mtime, dataRev]);
  if (!info) return null;
  const maal = gigapixelMaal(row.crop ? row.crop.replace(':', '-') : null, info.cm);
  if (!maal) {
    return <p className="tom">Fill in the largest print size above the list to see what to enlarge to.</p>;
  }
  const gange = info.krop ? maal.bredde / info.krop.bredde : null;
  return (
    <p className="gigapixel-maal">
      Set the width to <b>{maal.bredde} px</b> ({maal.bredde} × {maal.hoejde}
      {gange ? `, ×${gange.toFixed(2)}` : ''}) for {info.cm} cm on the long side at 300 DPI.
    </p>
  );
}
