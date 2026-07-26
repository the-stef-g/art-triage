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

  return (
    <footer className="statusbar">
      {version && <span className="version">art-triage {version}</span>}
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
      {drevMangler && (
        <span className="drev-mangler" title="The catalogue is untouched. Connect the drive and click Scan again.">
          Drive not connected
        </span>
      )}
      {indexTekst && <span className="index-status">{indexTekst}</span>}
      <span className={`ai-status ${aiStatus?.state || ''}`}>{aiTekst}</span>
      {fejl && <span className="fejl">{fejl}</span>}
    </footer>
  );
}
