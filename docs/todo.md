# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Shop: upload-beskeden viser den JPEG, der sendes,** fx "Uploading Desert Canyon 02.jpg (1 of 6)", ikke kildefilen (.tif). Det er webversionen på ca. 3000 px, der uploades; TIFF og printfiler forlader aldrig Mac'en.
- **Ét værk pr. navn.** Godkendes filer med samme navn og forskellig endelse (fx `Allura 02.png` fra AI og `Allura 02.psd` fra Photoshop), bliver de ét værk: den ældste i `Original`, de andre i `Edits` som redigeringer (navnet uændret). Masteren laves af den, man vælger (PSD'en), og værket går videre til Crop.
- **Oprydning én gang:** værkmapper med flere filer med samme navn i `Original` (Allura 01, 02 og 03): den ældste bliver, de andre flyttes til `Edits`, og det hele hæftes på ét godkendt værk med sin master. I dag blev PNG'en et ubedømt billede med masteren hæftet på (står i Sort), og PSD'en et godkendt billede uden master (hænger i Edit).
- **Crop: slå et format fra og til.** Klik på det valgte format slår det fra (gråt og overstreget, foreslås ikke igen); klik på et slået-fra format slår det til igen. Er alle formater beskåret eller slået fra, står der ingen ramme klar. Huskes pr. værk.

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
