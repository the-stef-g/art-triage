# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Product: først når alle printfilerne er lavet.** I dag står et værk i Product, så snart det har en master, samtidig med at det står i Crop og Print. Nyt: et værk kommer først i Product, når det er færdigt i Crop og Print:
  - alle de fem formater er beskåret eller slået fra i Crop, og
  - hver beskæring har en printfil, der ikke er forældet (lavet af den nuværende beskæring og forstørrelse).
  Et værk der kun sælges som original (Paintings og Sculptures), skal kun have sin beskæring; det har ingen printfiler. Et værk der allerede er i shoppen (Shop), bliver i Shop. Værker der står i Product i dag uden alle printfiler, forsvinder fra Product, til de er færdige i Print. Fanen Print viser stadig, hvad der mangler.

- **Kandidater kan redigeres i Edit.** Nogle billeder skal redigeres, før Stef kan afgøre, om de teknisk er gode nok. Nyt:
  - En kandidat (C i Sort) står også i Edit, med et gult *?* så den kan skelnes fra de godkendte værker.
  - Program-knapperne virker på den: Luminar Neo åbner filen selv; Topaz Photo AI og Photoshop laver kopien ved siden af den i `Candidate` (`Strand-tp.tif`), og et resultat gemt der (fx en .tif eksporteret fra Neo) hører til kandidaten.
  - I Edit har en kandidat knapperne **Approve** (A) og **Discard** (X) i stedet for Original/Edit/Master. Master kan ikke trykkes, før den er godkendt, så en kandidat kommer aldrig videre til Crop.
  - Godkendes den, bliver den et værk som i dag, og redigeringerne ved siden af den (samme navn til første bindestreg) følger med i værkets `Edits`. Kasseres den, går redigeringerne med til `Discarded`.
  - Kandidaten står stadig i Sort som i dag, indtil den er godkendt eller kasseret.

## Venter på en afklaring

Intet lige nu. Fortrydelsesret og betaling er afgjort 30. oktober 2026: prints har 14 dages fortrydelsesret, og beløbet reserveres ved bestilling og trækkes ved afsendelse. Hele beslutningen står i sitets repo, `docs/fortrydelsesret-og-betaling.md` i `the-stef-g/stefs.cloud`.

## Til shoppen (WordPress på shop.stefg.art)

Det her ligger i WooCommerce, ikke i appen eller i sitets kode.

- **Testordre i Stripes testtilstand** med kort og MobilePay: betalingen står som Uncaptured og trækkes ved Completed.
- **Bruges der statistik- eller reklame-cookies** (fx Google Analytics), skal privatlivspolitikken rettes, og der skal et samtykkebanner til. Privatlivspolitikken nævner nyhedsbrevet (MailerPress Pro), så tilmeldingen skal bede om samtykke og hvert nyhedsbrev have et afmeldingslink.
- **Skjul de store canvas uden for Europa i shoppen.** Varianterne har metafeltet `ship_only_to` med de lande, de må sælges til, men WooCommerce læser det ikke selv. Kunden vælger varianten på shop.stefg.art, så det skal gøres der, fx med et lille plugin eller et snippet, der fjerner varianten for andre lande.
- **Købsknappens tekst:** *Place order* skal hedde *Buy now* eller "Order with obligation to pay" (forbrugeraftaleloven § 12). Den kan ikke sættes fra appen; i kasseblokken rettes den direkte på knappen, i den klassiske kasse med et snippet.
- **Tjek kassen efter Update shop texts:** teksten over købsknappen er WooCommerce' "checkout privacy policy text", som den klassiske kasse viser. Bruger shoppen kasseblokken, skal teksten måske sættes ind i blokken i stedet.
- **Filter på format i shoppen:** kunden skal kunne vælge Format (Square 1:1, Portrait 2:3, Landscape 3:2, Tall 1:2, Wide 2:1) i shoppens filter, i stedet for at søge på horizontal, vertical og square.

## Til sitet (Astro)

Sitet stefg.art ligger i repoet `the-stef-g/stefs.cloud` (navnet kunne ikke ændres).

- **Siden med priser (`/prices/`)** findes ikke endnu. Når den laves, skal den kun vise varianter efter `kunTilLande` (fra `ship_only_to`) for de lande, de sælges til, og bruge materialerne som i prislisten: *Fine art paper* og *Canvas*, og canvas med ramme er *Canvas* med Frame *Black* eller *White*.
