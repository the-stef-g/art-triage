export const MIN_KOLONNER = 3;
export const MAX_KOLONNER = 10;

export default function StatusBar({
  counts, aiStatus, indexProgress, searchInfo, fejl, library, version, drevMangler, kwStatus, textStatus, thumbStatus, onRetryPreviews,
  kolonner, setKolonner,
}) {
  const aiTekst = (() => {
    if (!aiStatus) return '';
    if (aiStatus.state === 'model') {
      // Faserne efter download melder ingen procent; saa staar der bare
      // fasen og hvor laenge den har koert, i stedet for et tal der
      // haenger fast paa 100.
      const pct = typeof aiStatus.progress === 'number' ? ` ${aiStatus.progress}%` : '';
      return `${aiStatus.detail || 'Downloading AI model'}${pct}`;
    }
    if (aiStatus.state === 'klar') return `AI ready (${aiStatus.device === 'webgpu' ? 'GPU' : 'CPU'})`;
    if (aiStatus.state === 'offline') return aiStatus.detail || 'AI offline: the model could not be downloaded';
    if (aiStatus.state === 'fejl') return aiStatus.detail || 'AI error';
    return 'AI starting …';
  })();

  const indexTekst = (() => {
    if (!indexProgress) return '';
    if (indexProgress.phase === 'billeder') return `Analysing images ${indexProgress.done}/${indexProgress.total}`;
    return '';
  })();

  // Koersler koster penge, saa baade fremdrift og beloeb staar fremme
  // mens det sker, ikke foerst paa regningen bagefter.
  const kwTekst = (() => {
    const p = kwStatus?.progress;
    if (!kwStatus?.koerer || !p) return '';
    return `Keywords ${p.done}/${p.total} · $${p.cost.toFixed(2)}`;
  })();

  // Samme princip som noegleordene: beloebet staar fremme, ogsaa efter
  // kaldet, saa man kan laegge forbruget sammen.
  const textTekst = (() => {
    if (!textStatus) return '';
    if (textStatus.koerer) return 'Writing texts …';
    return textStatus.cost == null ? '' : `Texts · $${textStatus.cost.toFixed(3)}`;
  })();

  return (
    <footer className="statusbar">
      {version && <span className="version">Stef G Art {version}</span>}
      <span className="bibliotek" title={library?.root}>{library?.root?.split('/').pop()}</span>
      {counts && (
        <span>
          {counts.total} images
          {counts.byRating?.godkendt ? ` · ${counts.byRating.godkendt} approved` : ''}
          {counts.byRating?.kandidat ? ` · ${counts.byRating.kandidat} candidates` : ''}
          {counts.byRating?.kasseret ? ` · ${counts.byRating.kasseret} discarded` : ''}
          {` · ${counts.indexed} analysed`}
        </span>
      )}
      {searchInfo && !searchInfo.error && (
        <span className="soegeinfo">{searchInfo.matched} results</span>
      )}
      <span className="spacer" />
      <label className="kolonnevalg" title="How many images across the grid">
        <input
          type="range"
          min={MIN_KOLONNER}
          max={MAX_KOLONNER}
          value={kolonner}
          onChange={(e) => setKolonner(Number(e.target.value))}
        />
        <span className="antal">{kolonner}</span>
      </label>
      {drevMangler && (
        <span className="drev-mangler" title="The catalogue is untouched. Connect the drive and click Scan again.">
          Drive not connected
        </span>
      )}
      {kwTekst && <span className="kw-status">{kwTekst}</span>}
      {textTekst && <span className="kw-status">{textTekst}</span>}
      {thumbStatus?.failed > 0 && (
        <span className="fejl">
          {thumbStatus.failed} preview{thumbStatus.failed === 1 ? '' : 's'} failed
          {' '}
          <button className="lille" onClick={onRetryPreviews} title="Try the failed previews again. The reason for each is in Help > Show AI log.">Retry</button>
        </span>
      )}
      {indexTekst && <span className="index-status">{indexTekst}</span>}
      <span className={`ai-status ${aiStatus?.state || ''}`}>{aiTekst}</span>
      {fejl && <span className="fejl">{fejl}</span>}
    </footer>
  );
}
