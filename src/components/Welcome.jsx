export default function Welcome({ recent, onChoose, onOpen }) {
  return (
    <div className="velkomst">
      <h1>art-triage</h1>
      <p>Sort and organise your images. Pick the folder your images live in, and art-triage keeps track of the rest.</p>
      <button className="stor" onClick={onChoose}>Choose image folder …</button>
      {recent.length > 0 && (
        <div className="seneste">
          <h3>Recent</h3>
          {recent.map((r) => (
            <button key={r} className="seneste-knap" onClick={() => onOpen(r)} title={r}>
              {r.split('/').pop()}
              <span className="sti">{r}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
