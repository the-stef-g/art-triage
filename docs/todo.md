# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Crop: beskæringerne skal kunne ses i filmstriben**, lige efter den master de er lavet af (master, så dens beskæringer i rækkefølgen 1:1, 2:3, 3:2, 1:2, 2:1, så næste master). En beskæring har sit format som mærke, rødt hvis den er ældre end masteren. Klik på en beskæring viser den stort i midten, uden ramme og greb, med navn, format, størrelse og Last edit, og Show in Finder. Formatknapperne og Save crop gælder masteren, så de er der ikke, mens en beskæring vises; klik på masteren for at beskære igen.

## Venter på en afklaring

Intet lige nu. Fortrydelsesret og betaling er afgjort 30. oktober 2026: prints har 14 dages fortrydelsesret, og beløbet reserveres ved bestilling og trækkes ved afsendelse. Hele beslutningen står i sitets repo, `docs/fortrydelsesret-og-betaling.md` i `the-stef-g/stefs.cloud`.

## Til shoppen (WordPress på shop.stefg.art)

Det her ligger i WooCommerce, ikke i appen eller i sitets kode.

- **Testordre i Stripes testtilstand** med kort og MobilePay: betalingen står som Uncaptured og trækkes ved Completed.
- **Handelsbetingelser, kassen og ordremailen** på engelsk, som beskrevet i `docs/fortrydelsesret-og-betaling.md` i sitets repo. Firmanavn, CVR og adresse skal med.
- **Skjul 120 × 120 canvas i US og JP i shoppen.** Varianterne har metafeltet `hide_in_countries`, men WooCommerce læser det ikke selv. Kunden vælger varianten på shop.stefg.art, så det skal gøres der, fx med et lille plugin eller et snippet, der fjerner varianten for de lande.

## Til sitet (Astro)

Sitet stefg.art ligger i repoet `the-stef-g/stefs.cloud` (navnet kunne ikke ændres).

- **Siden med priser (`/prices/`)** findes ikke endnu. Når den laves, skal den skjule varianter efter `skjulILande` (fra `hide_in_countries`) og bruge materialerne som i prislisten: *Fine art paper* og *Canvas*, og canvas med ramme er *Canvas* med Frame *Black* eller *White*.
