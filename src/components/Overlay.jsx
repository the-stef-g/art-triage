import { useEffect, useRef, useState } from 'react';
import { thumbUrl } from '../api';
import { fileName } from '../util';

export function PreviewOverlay({ row, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <img src={thumbUrl(row.file_id, row.mtime, 2048)} alt={fileName(row.rel_path)} />
      <div className="overlay-info">
        {fileName(row.rel_path)}
        {!row.is_master ? ` · ${row.version_name}` : ''}
        {row.rating === 'godkendt' ? ' · Godkendt' : row.rating === 'kasseret' ? ' · Kasseret' : ''}
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
          <button className="lille" onClick={onClose}>Annullér</button>
        </div>
      </div>
    </div>
  );
}
