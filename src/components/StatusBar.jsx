export default function StatusBar({
  counts, aiStatus, indexProgress, searchInfo, fejl, library, version, drevMangler,
}) {
  const aiTekst = (() => {
    if (!aiStatus) return '';
    if (aiStatus.state === 'model') {
      // Faserne efter download melder ingen procent; saa staar der bare
      // fasen og hvor laenge den har koert, i stedet for et tal der
      // haenger fast paa 100.
      const pct = typeof aiStatus.progress === 'number' ? ` ${aiStatus.progress}%` : '';
      return `${aiStatus.detail || 'Henter AI-model'}${pct}`;
    }
    if (aiStatus.state === 'klar') return `AI klar (${aiStatus.device === 'webgpu' ? 'GPU' : 'CPU'})`;
    if (aiStatus.state === 'offline') return aiStatus.detail || 'AI offline: modellen kunne ikke hentes';
    if (aiStatus.state === 'fejl') return aiStatus.detail || 'AI-fejl';
    return 'AI starter …';
  })();

  const indexTekst = (() => {
    if (!indexProgress) return '';
    if (indexProgress.phase === 'billeder') return `Analyserer billeder ${indexProgress.done}/${indexProgress.total}`;
    return '';
  })();

  return (
    <footer className="statusbar">
      {version && <span className="version">Billedflow {version}</span>}
      <span className="bibliotek" title={library?.root}>{library?.root?.split('/').pop()}</span>
      {counts && (
        <span>
          {counts.total} billeder
          {counts.byRating?.godkendt ? ` · ${counts.byRating.godkendt} godkendt` : ''}
          {counts.byRating?.kasseret ? ` · ${counts.byRating.kasseret} kasseret` : ''}
          {` · ${counts.indexed} analyseret`}
        </span>
      )}
      {searchInfo && !searchInfo.error && (
        <span className="soegeinfo">{searchInfo.matched} resultater</span>
      )}
      <span className="spacer" />
      {drevMangler && (
        <span className="drev-mangler" title="Kataloget er urørt. Tilslut drevet og klik Skan igen.">
          Drevet er ikke tilsluttet
        </span>
      )}
      {indexTekst && <span className="index-status">{indexTekst}</span>}
      <span className={`ai-status ${aiStatus?.state || ''}`}>{aiTekst}</span>
      {fejl && <span className="fejl">{fejl}</span>}
    </footer>
  );
}
