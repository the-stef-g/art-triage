// Prislisten for print (electron/lib/prisliste.json) og de varianter, et
// vaerk faar ud fra den. Priserne er i kroner med moms og fri fragt. Aendres
// priserne, rettes filen, og en ny version af appen bygges; knappen Update
// all prints laegger dem ud paa alle printprodukter.
import { readFileSync } from 'node:fs';

export const PRISLISTE = JSON.parse(readFileSync(new URL('./prisliste.json', import.meta.url), 'utf8'));

// Navnene paa formaterne, som Format-attributten paa produkt 20.
export const FORMAT_NAVN = {
  '1:1': 'Square 1:1', '2:3': 'Portrait 2:3', '3:2': 'Landscape 3:2', '1:2': 'Tall 1:2', '2:1': 'Wide 2:1',
};
const MATERIALE_KODE = { paper: 'PAPER', canvas: 'CANVAS', canvas_framed: 'CANVAS' };
const RAMME_KODE = { None: 'NO', Black: 'BLACK', White: 'WHITE' };

// Et vendt format (3:2, 2:1) bruger listen for det staaende (2:3, 1:2), med
// bredde og hoejde byttet om.
function grundformat(format, liste = PRISLISTE) {
  const grund = liste.rotated_formats?.[format] || format;
  return { grund, vendt: grund !== format };
}

// Den lange side af det stoerste print i formatet, i cm. Til Gigapixel.
export function stoersteLangside(format, liste = PRISLISTE) {
  const { grund } = grundformat(format, liste);
  const rk = liste.formats?.[grund] || [];
  return rk.reduce((m, r) => Math.max(m, ...r.size_cm.split('x').map(Number)), 0) || null;
}

// Alle varianter for de formater et vaerk har beskaeringer i. sku er
// produktets egen SKU, som varianternes SKU begynder med.
export function printVarianter(formater, sku, liste = PRISLISTE) {
  const ud = [];
  for (const format of formater) {
    const { grund, vendt } = grundformat(format, liste);
    for (const r of liste.formats?.[grund] || []) {
      let [b, h] = r.size_cm.split('x').map(Number);
      if (vendt) [b, h] = [h, b];
      for (const [noegle, mat] of Object.entries(liste.materials)) {
        const pris = r[noegle];
        if (pris == null) continue;
        const skjul = (liste.hide_for_shipping_countries || []).find((x) => x.format === grund
          && x.size_cm === r.size_cm && x.materials.includes(noegle));
        for (const ramme of mat.frames) {
          ud.push({
            format: FORMAT_NAVN[format],
            materiale: mat.label,
            ramme,
            stoerrelse: `${b} × ${h} cm`,
            pris,
            sku: `${sku}-${format.replace(':', 'X')}-${MATERIALE_KODE[noegle]}-${RAMME_KODE[ramme]}-${b}X${h}`,
            prodigi: `${mat.prodigi_sku_prefix}-${r.prodigi_size}`,
            prodigiValg: { ...(mat.prodigi_options || {}), ...(noegle === 'canvas_framed' ? { color: ramme.toLowerCase() } : {}) },
            skjulILande: skjul ? skjul.countries : [],
          });
        }
      }
    }
  }
  return ud;
}

// Variationsattributterne paa produktet: de vaerdier varianterne bruger, i
// listens raekkefoelge.
export function variantAttributter(varianter) {
  const unik = (felt) => [...new Set(varianter.map((v) => v[felt]))];
  return [
    { name: 'Format', options: unik('format') },
    { name: 'Material', options: unik('materiale') },
    { name: 'Frame', options: unik('ramme') },
    { name: 'Size', options: unik('stoerrelse') },
  ];
}
