import { useEffect, useRef, useState } from 'react';
import { thumbUrl } from '../api';
import { fileName } from '../util';

// Escape haandteres i App sammen med de andre genveje. Laa der ogsaa en
// lytter her, ville to steder svare paa den samme tast, og det ene
// skulle saa gaette hvad det andet havde gjort.
export function PreviewOverlay({ row, onClose }) {
  // Forstoerrelsen daekker kun midterfeltet, ikke hele vinduet. Sidepanel
  // og inspektoer bliver staaende, saa man kan se serier, noegleord og
  // bedoemmelse mens man kigger stort paa billedet.
  return (
    <div className="forstoerret" onClick={onClose}>
      <img src={thumbUrl(row.file_id, row.mtime, 2048)} alt={fileName(row.rel_path)} />
      <div className="overlay-info">
        {fileName(row.rel_path)}
        {!row.is_master ? ` · ${row.version_name}` : ''}
        {row.rating === 'godkendt' ? ' · Approved'
          : row.rating === 'kandidat' ? ' · Candidate'
            : row.rating === 'kasseret' ? ' · Discarded' : ''}
      </div>
    </div>
  );
}

export function NameModal({ title, value, placeholder, onSubmit, onClose }) {
  const [text, setText] = useState(value || '');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    if (text.trim()) onSubmit(text.trim());
    else onClose();
  };

  return (
    <div className="overlay modal-baggrund" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <input
          ref={inputRef}
          value={text}
          placeholder={placeholder || ''}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className="knapraekke">
          <button onClick={submit}>OK</button>
          <button className="lille" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
