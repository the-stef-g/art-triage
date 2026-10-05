# datamodel.md — indholdsmodel for stefg.art

Version 3.0 (3. oktober 2026). Indholdet bor i WordPress med WooCommerce på shop.stefg.art. Hvert værk er et Woo-produkt, og værksiden på stefg.art er også produktsiden. Astro henter indholdet ved build og laver statiske sider.

Erstatter v2.0, hvor værkerne var en egen posttype (`vaerk`) på cms.stefs.cloud. Den posttype og ACPT-felterne derfra flyttes ikke med. Felterne oprettes på ny på produkterne, fordi Woo nu klarer en stor del af det, ACPT gjorde før. Feltnøglerne er på engelsk, fordi sitet er engelsk.

## Hvem klarer hvad

| Hvad | Hvor | Note |
| --- | --- | --- |
| Titel | Produktets navn | Som den skal stå. Titler oversættes aldrig |
| Historien | Produktets beskrivelse | Almindelig tekst i editoren |
| Billede | Produktbillede | Kildefilen fra Art Triage. Alt-teksten står i mediebiblioteket |
| Pris | Woo, Regular price | Skulpturer og malerier. Printpriser: se "Printpriser" |
| Solgt | Woo, lager | Unika har lagerstyring med 1 stk. Udsolgt = solgt. Solgte værker bliver stående, mærket solgt |
| Fremhævet | Woos stjerne (Featured) | Værket kan vises på forsiden |
| Kategori | Woo, produktkategorier | Graphic Design, Photography, Paintings, Sculptures |
| År, teknik, mål | Woo, attributter på produktet | Mål kun ved unikke fysiske værker |
| Moms | Woo, momsklasse | Skulpturer: Reduced rate (5 %, kunstnerordningen). Alt andet: Standard |
| Skabelon, sektionsfarve, katalognummer, video, beskæringer, print | ACPT, feltgruppen "Work" | Se nedenfor |
| Serie | ACPT, taksonomi `series` på produkter | Med egne termfelter, se nedenfor |

## ACPT-feltgruppen "Work" (på produkter)

| Feltnøgle | Label | Type | Krævet | Note |
| --- | --- | --- | --- | --- |
| `template` | Template | Select | ja | `spread` (B, tidligere Opslag) eller `poster` (C, tidligere Plakat). Flere kommer til |
| `section_colour` | Section colour | Colour | nej | Tom = seriens farve, eller en standard |
| `catalogue_number` | Catalogue number | Text | nej | Tom = Astro læser nummeret i slutningen af titlen ("Rust 01") og sætter 0 foran enkeltcifrede tal. Udfyldes kun, hvis nummeret skal være noget andet |
| `video` | Video | Video eller File | nej | Til skulpturer |
| `prints` | Available as print | Toggle | nej | Værket kan bestilles som print |
| `crop_1x1` | Crop 1:1 | Image | nej | Webfil til printvælgeren |
| `crop_2x3` | Crop 2:3 | Image | nej | Stående |
| `crop_3x2` | Crop 3:2 | Image | nej | Liggende |
| `crop_1x2` | Crop 1:2 | Image | nej | Højt |
| `crop_2x1` | Crop 2:1 | Image | nej | Bredt |

Hvilken variant af skabelonen der bruges (stående, liggende, kvadrat, højt), afgøres automatisk ud fra produktbilledets format.

## Taksonomien `series` (på produkter)

Flad (ikke hierarkisk), Show in REST slået til. Ental "Series", flertal "Series".

| Felt | Type | Note |
| --- | --- | --- |
| Navn | Termens navn | Fx "Funky Fire" |
| `intro` | Textarea | To linjer om serien |
| `series_template` | Select | `walkthrough` (tidligere gennemgang) eller `wall` (tidligere væg) |
| `series_colour` | Colour | Arves af seriens værker |
| Rækkefølge | Ingen felt | Sorteres efter tallet i slutningen af titlen, som tal, så "Rust 2" og "Rust 02" sorteres ens. Uden tal sorteres efter år |

## Printpriser

Printværker er variable produkter i Woo med en variant pr. kombination af beskæring, materiale, ramme og størrelse. Varianterne og priserne kommer fra en CSV, som Claude laver pr. værk. Se butik.md.

## Hvordan Astro får indholdet

- Ved build henter Astro produkter, kategorier og serier fra WordPress/WooCommerce.
- Billederne hentes fra mediebiblioteket og optimeres af Astro.
- Kurv og betaling foregår på shop.stefg.art.

## Arbejdsgangen ved et nyt værk

1. Eksportér kildefilen og beskæringerne fra Art Triage.
2. Opret produktet i WooCommerce: navn, beskrivelse, billede, kategori, attributter, pris eller lager, felterne under "Work" og evt. serie.
3. Claude skriver alt-tekst og hjælper med historien.
4. Udgiv. Sitet bygges igen, og værket er ude.

## Åbne punkter

- Selve printpriserne, som kræver Prodigis indkøbspriser.
- Året skal komme fra optagelsesdatoen i originalfilen, fx ved at Art Triage læser den. Filens dato duer ikke.
- Om Fremhævet er nok til forsiden, eller forsiden skal have sin egen styring.

## Varianter og nøgler i praksis (4. oktober 2026)

- ACPT gemmer felterne med gruppens navn foran: `work_template`, `work_crop_1x1` osv. Det er de nøgler, Astro skal læse.
- Printvarianterne har fire attributter: **Format** (Square 1:1, Portrait 2:3, Landscape 3:2, Tall 1:2, Wide 2:1), **Material** (Fine art paper, Canvas, Framed canvas, Framed paper), **Frame** (None, Black, White) og **Size** ("40 × 60 cm", bredde først).
- Variant-SKU: `DC04-2X3-CANVAS-NO-40X60` (værk, format, materiale, ramme, mål). Prodigis varenummer står i metafeltet `prodigi_sku`, så den manuelle bestilling er nem.
- Første CSV: woo/desert-canyon-04-varianter.csv (102 varianter).
