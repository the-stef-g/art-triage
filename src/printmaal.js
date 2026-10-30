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
