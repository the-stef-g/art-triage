# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Crop: beskæringerne skal kunne ses i filmstriben** (forslaget er godkendt), lige efter den master de er lavet af (master, så dens beskæringer i rækkefølgen 1:1, 2:3, 3:2, 1:2, 2:1, så næste master). En beskæring har sit format som mærke, rødt hvis den er ældre end masteren. Klik på en beskæring viser den stort i midten, uden ramme og greb, med navn, format, størrelse og Last edit, og Show in Finder. Formatknapperne og Save crop gælder masteren, så de er der ikke, mens en beskæring vises; klik på masteren for at beskære igen.
- **Shoptekster fra appen.** Appen sender handelsbetingelserne, teksten i kassen og teksten i ordremailen til WooCommerce, ligesom værkerne: betingelserne som en side i WordPress, der vælges som shoppens side med betingelser, og mailteksten i *Additional content* i mailen *Processing order*. Teksterne står i sitets repo, `docs/shop-tekster.md`. Teksten i kassen og knappens tekst kan ikke sættes via WooCommerce' REST API; det skal afklares, hvordan de kommer ind (fx et lille plugin, der læser en indstilling appen skriver).
- **De store canvas kun i Europa.** 100 × 100, 120 × 120, 80 × 120 (og 120 × 80) og 100 × 150 (og 150 × 100), med og uden ramme, er for store til en almindelig pakke og sælges kun til Europa. I dag skjuler prislisten 120 × 120 i US og JP med `hide_in_countries`, men en liste over alle lande uden for Europa er for lang. Forslag: et nyt metafelt på varianten, `ship_only_to` med de lande den må sælges til (EU, Norge, Island, Liechtenstein, Schweiz, Storbritannien, Andorra, Monaco, San Marino og Vatikanstaten; besluttet 30. oktober 2026), og `hide_in_countries` fjernes for de størrelser. Shoppen og sitet skal så læse det nye felt.

## Venter på en afklaring

Intet lige nu. Fortrydelsesret og betaling er afgjort 30. oktober 2026: prints har 14 dages fortrydelsesret, og beløbet reserveres ved bestilling og trækkes ved afsendelse. Hele beslutningen står i sitets repo, `docs/fortrydelsesret-og-betaling.md` i `the-stef-g/stefs.cloud`.

## Til shoppen (WordPress på shop.stefg.art)

Det her ligger i WooCommerce, ikke i appen eller i sitets kode.

- **Testordre i Stripes testtilstand** med kort og MobilePay: betalingen står som Uncaptured og trækkes ved Completed.
- **Køb som gæst.** WooCommerce › Settings › Accounts & Privacy: tillad køb uden konto, og slå oprettelse af konto i kassen fra. Ingen regel kræver en konto, og EU's databeskyttelsesråd anbefaler, at man kan købe som gæst.
- **Bruges der statistik- eller reklame-cookies** (fx Google Analytics), skal privatlivspolitikken rettes, og der skal et samtykkebanner til. Får shoppen en tilmelding til nyhedsbrevet (MailerPress Pro), tages afsnittet om nyhedsbrevet med i politikken.
- **Skjul de store canvas uden for Europa i shoppen.** Varianterne får et metafelt om det (se "Venter på byg"), men WooCommerce læser det ikke selv. Kunden vælger varianten på shop.stefg.art, så det skal gøres der, fx med et lille plugin eller et snippet, der fjerner varianten for de lande.

## Til sitet (Astro)

Sitet stefg.art ligger i repoet `the-stef-g/stefs.cloud` (navnet kunne ikke ændres).

- **Siden med priser (`/prices/`)** findes ikke endnu. Når den laves, skal den skjule varianter efter `skjulILande` (fra `hide_in_countries`) og bruge materialerne som i prislisten: *Fine art paper* og *Canvas*, og canvas med ramme er *Canvas* med Frame *Black* eller *White*.
