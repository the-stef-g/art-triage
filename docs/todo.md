# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Værkets navn kan ændres i alle faser.** I dag står navnefeltet kun i Edit og Product; i Crop og Print er der ingen højre kolonne, så et værk der er gået videre med Master, kan ikke omdøbes der. Nyt: navnet står som et felt øverst i Crop og Print også (ved filens navn), med samme dialog som i Edit og Product (*Rename files* eller *Only the title*). I Shop kan titlen også rettes; den sendes med næste Update shop.
- **Omdøbes værkets mappe i Finder, følger titlen med.** I dag gemmer appen titlen, så den gamle bliver hængende. Nyt: ved scanningen ser appen, at værkets filer nu ligger i en mappe med et nyt navn, og titlen bliver mappens navn, hvis titlen var det gamle navn (har Stef skrevet en anden titel i appen, røres den ikke). Det samme gælder, når originalens fil omdøbes i Finder. Teksterne skrives ikke om af sig selv; Stef kan bruge Write texts.
- **Fortryd (⌘Z) for værkets trin.** I dag kan ⌘Z kun fortryde bedømmelser, serier, omdøbte versioner og flyttede filer. Nyt: ⌘Z fortryder også de seneste trin i Edit og de andre faser, i omvendt rækkefølge:
  - **Master:** masterfilen i `Masters` går i papirkurven, og værket er tilbage i Edit.
  - **Original / Edit:** filerne bytter plads tilbage.
  - **Omdøb værk:** mappen, filerne og titlen får det gamle navn igen.
  - **Save crop:** beskæringen går i papirkurven.
  Fortryd virker for det, der er gjort, mens appen har været åben. Kassér værk og det, der er sendt til shoppen, kan ikke fortrydes med ⌘Z (filer i papirkurven kan lægges tilbage fra Finder). Edit-menuen viser, hvad Undo vil fortryde, fx *Undo Master*.

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
