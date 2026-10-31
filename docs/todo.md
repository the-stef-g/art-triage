# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Shop: filnavnet i fremdriften.** I stedet for "Uploading the 2:3 crop (2 of 5)" står filens navn, fx "Uploading Desert Canyon 01 2-3.tif (2 of 5)", så det kan ses hvilket værk det er, når flere sendes.
- **Product: venstre kolonne dobbelt så bred** (750 px i stedet for 375), med plads til flere billeder i bredden.
- **Fejl: upload-beskeden hører ikke til sit værk.** Fremdriften fra Send to shop vises under det værk, man står på, også når det er et andet værks upload, og den sidste besked ("Uploading … (2 of 5)") kan blive stående med snurren, når uploaden er færdig. Derfor så det ud, som om en upload var i gang, da Cmd+Q ikke spurgte. Beskederne knyttes til værket; hvert værk viser sin egen fremdrift og sit resultat ("Sent at 16:12" eller fejlen), også når man klikker tilbage til det.
- **Shop i loggen:** hver afsendelse logges (start, færdig, fejl), og ved lukning logges, om noget var i gang.
- **Ingen evige uploads:** en forespørgsel til shoppen uden svar i 5 minutter gives op og tæller som et mislykket forsøg (og prøves igen, hvor det er sikkert).
- **Product: billedet i højre kolonne er kvadratisk,** lige så højt som det er bredt, så stående værker vises større.
- **Product: Series intro vokser med teksten,** så hele introen kan ses uden at rulle (i dag kun 2 linjer).

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
