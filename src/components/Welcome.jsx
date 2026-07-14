export default function Welcome({ recent, onChoose, onOpen }) {
  return (
    <div className="velkomst">
      <h1>Billedflow</h1>
      <p>Sortering og organisering af dine billeder. Vælg den mappe dine billeder ligger i, så holder Billedflow styr på resten.</p>
      <button className="stor" onClick={onChoose}>Vælg billedmappe …</button>
      {recent.length > 0 && (
        <div className="seneste">
          <h3>Seneste</h3>
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
