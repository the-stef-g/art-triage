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

// Hvad der er foraeldet i kaeden master -> beskaering -> -giga -> printfil,
// som korte saetninger til Crop og Print.
export function foraeldetTekster(foraeldet) {
  if (!foraeldet) return [];
  const ud = [];
  if (foraeldet.led.includes('master')) {
    const dato = foraeldet.masterMtime
      ? new Date(foraeldet.masterMtime).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })
      : null;
    ud.push(`The master was changed after this crop was made${dato ? ` (${dato})` : ''}. Crop again.`);
  }
  if (foraeldet.led.includes('giga')) ud.push('The crop was changed after it was enlarged. Enlarge it again.');
  if (foraeldet.led.includes('print')) ud.push('The print file is older than the crop. Make it again.');
  return ud;
}
