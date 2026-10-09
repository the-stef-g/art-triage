export default function Welcome({ recent, onChoose, onOpen }) {
  return (
    <div className="velkomst">
      <h1>Stef G Art</h1>
      <p>Sort and organise your images. Pick your Stef G Art folder. If it has an Import folder, only Import, Approved, Candidate and Discarded are read; anything else in it is left alone.</p>
      <button className="stor" onClick={onChoose}>Choose the Stef G Art folder …</button>
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
