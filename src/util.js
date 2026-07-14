export function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('da-DK', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function fileName(relPath) {
  return relPath.split('/').pop();
}

export function folderOf(relPath) {
  const parts = relPath.split('/');
  parts.pop();
  return parts.join('/');
}
