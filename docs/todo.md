# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Fejl: pil op og ned i Print springer hver anden fil over.** Listen i Print er én kolonne, men pilene bruger stadig grid'ets antal kolonner fra den fase, man kom fra (fx 2 fra Product). I Print skal op og ned flytte én linje, som i Crop.
- **Printfilen som JPEG i stedet for PNG.** Prodigi har en grænse på 300 MB, og en PNG på 120 × 120 cm ved 300 DPI blev 547,5 MB. Samme pixels, 300 DPI og sRGB, men JPEG i kvalitet 95 med fuld farveopløsning (4:4:4). Er filen alligevel over 300 MB, sænkes kvaliteten et trin ad gangen. Navnet bliver `Desert 2-3.jpg`; en gammel PNG med samme navn går i papirkurven.
- **MB som i Finder.** Appen regner 1 MB som 1.048.576 bytes, Finder som 1.000.000, så appen viste 522,2 MB, hvor Finder viste 547,5 MB. Appen skal regne som Finder.
- **-giga-kopier der aldrig blev forstørret.** Sendes en beskæring til Gigapixel igen, genbruges en gammel -giga-kopi, der ikke er større end beskæringen, i stedet for at lave `… -giga 2`. En -giga-kopi, der efter 24 timer stadig ikke er større end beskæringen, flyttes i papirkurven ved næste skanning, og det står i loggen.

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
