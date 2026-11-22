import prisliste from '../electron/lib/prisliste.json';

// Paa et canvas med ImageWrap boejes yderkanten om paa siderne: blindrammen
// er 38 mm dyb, og Prodigi printer lidt stoerre, saa der regnes med 45 mm.
export const CANVAS_KANT_CM = 4.5;

// Det mindste canvas i formatet ("2:3" -> { bredde: 30, hoejde: 45 }), hvor
// kanten fylder mest. Et liggende format er det staaende vendt.
export function mindsteCanvas(format) {
  const vendt = Object.entries(prisliste.rotated_formats || {}).find(([f]) => f === format)?.[1];
  const liste = prisliste.formats[vendt || format] || [];
  const s = liste.find((x) => x.canvas != null);
  if (!s) return null;
  const [b, h] = s.size_cm.split('x').map(Number);
  return vendt ? { bredde: h, hoejde: b } : { bredde: b, hoejde: h };
}

// Det samme regnestykke som gigapixelMaal i electron/lib/printfil.mjs: hvor
// stor en forstoerrelse skal vaere i pixels, for at formatet kan printes i
// det stoerste maal ved 300 DPI. token er formatet ("2-3"), langsideCm den
// lange side af det stoerste print.
const FORHOLD = { '1-1': 1, '2-3': 2 / 3, '3-2': 3 / 2, '1-2': 1 / 2, '2-1': 2 };

export function gigapixelMaal(token, langsideCm, dpi = 300) {
  const forhold = FORHOLD[token];
  const cm = Number(langsideCm);
  if (!forhold || !(cm > 0)) return null;
  const lang = Math.round((cm / 2.54) * dpi);
  return forhold >= 1
    ? { bredde: lang, hoejde: Math.round(lang / forhold) }
    : { bredde: Math.round(lang * forhold), hoejde: lang };
}
