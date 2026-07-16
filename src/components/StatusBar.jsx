export default function StatusBar({ counts, aiStatus, indexProgress, searchInfo, fejl, library, version }) {
  const aiTekst = (() => {
    if (!aiStatus) return '';
    if (aiStatus.state === 'model') {
      return `${aiStatus.detail || 'Henter AI-model'} ${aiStatus.progress || 0}%`;
    }
    if (aiStatus.state === 'klar') return `AI klar (${aiStatus.device === 'webgpu' ? 'GPU' : 'CPU'})`;
    if (aiStatus.state === 'offline') return aiStatus.detail || 'AI offline: modellen kunne ikke hentes';
    if (aiStatus.state === 'fejl') return aiStatus.detail || 'AI-fejl';
    return 'AI starter …';
  })();

  const indexTekst = (() => {
    if (!indexProgress) return '';
    if (indexProgress.phase === 'ordliste') return `Forbereder ordliste ${indexProgress.done}/${indexProgress.total}`;
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
      {indexTekst && <span className="index-status">{indexTekst}</span>}
      <span className={`ai-status ${aiStatus?.state || ''}`}>{aiTekst}</span>
      {fejl && <span className="fejl">{fejl}</span>}
    </footer>
  );
}
