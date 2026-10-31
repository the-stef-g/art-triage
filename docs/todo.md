# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Crop: linjen "Every format is cropped or turned off." fjernes.** Knapperne siger det selv.
- **Print: antallet på formatknapperne i en boble,** som tallene på fanerne Sort, Edit osv.
- **Send flere værker til shoppen på én gang.** Markér flere værker i Product eller Shop (Cmd-klik, Skift-klik), og knappen hedder *Send 4 to shop*. De sendes ét ad gangen i rækkefølge. Har shoppen allerede et produkt med samme navn, springes værket over og nævnes til sidst, så der aldrig laves en dublet uden at spørge.
- **Fremdriftslinje.** En bjælke for hele afsendelsen (værk 2 af 4) og én for værket, der sendes nu: hvert billede viser MB sendt af MB i alt, mens det uploades, og bagefter trinene (produktet, varianterne, serien). Der står tid brugt og cirka tid tilbage.
- **Køen til shoppen.** En liste over alt, der venter: værkerne i den rækkefølge, de sendes, med status ved hvert (venter, sendes nu, sendt kl. 16:12, sprunget over, fejl og hvorfor). Man kan lægge flere værker i køen, mens den kører, og fjerne et værk, der endnu ikke er sendt. Køen kan ses fra alle faser.

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
