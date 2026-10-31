# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Fejl: en beskæring kan blive gemt i forkert format.** *Mur 2 1-1.tif* (31. oktober, 0.38.0) er 2:3. Efter sips måles den nye fil; har den ikke præcis de beregnede pixelmål, slettes den, og beskæringen laves med sharp i stedet (TIFF i 8 bit, og det siges). Test med en sips, der ikke beskærer.
- **Crop: stakke som i Lightroom.** En master og dens beskæringer er en stak i filmstriben, der kan åbnes og lukkes. Lukket ses kun masteren; åben står beskæringerne lige efter den. Stakken kan ses som en ramme om master og beskæringer, og en lille pil på masteren eller tasten **S** åbner og lukker den (S som i Lightroom; S er ikke brugt i appen, og den virker ikke i tekstfelter). S på en beskæring lukker dens stak og går til masteren. Om stakken er åben, huskes pr. værk.
- **Crop: formaterne på masteren i stedet for tallet.** Mærket med antal beskæringer erstattes af de beskæringer, der er lavet (fx *1:1 2:3 3:2*), hver rød hvis den er ældre end masteren.
- **Crop: minus-cirklerne præcist på hjørnet.** Cirklens midte skal ligge præcis på knappens øverste højre hjørne, både vandret og lodret, og minustegnet skal stå i midten af cirklen.
- **Print: bredden til Gigapixel på udklipsholderen.** *Enlarge in Gigapixel* lægger selv tallet (kun tallet, fx `14173`) på udklipsholderen, så det kan sættes direkte ind i Gigapixel med Cmd+V. Tallet kan også klikkes for at kopiere det, og der står kort *Copied*. Med flere beskæringer valgt kopieres tallet for den aktive.

## Venter på en afklaring

Intet lige nu. Fortrydelsesret og betaling er afgjort 30. oktober 2026: prints har 14 dages fortrydelsesret, og beløbet reserveres ved bestilling og trækkes ved afsendelse. Hele beslutningen står i sitets repo, `docs/fortrydelsesret-og-betaling.md` i `the-stef-g/stefs.cloud`.

## Til shoppen (WordPress på shop.stefg.art)

Det her ligger i WooCommerce, ikke i appen eller i sitets kode.

- **Testordre i Stripes testtilstand** med kort og MobilePay: betalingen står som Uncaptured og trækkes ved Completed.
- **Bruges der statistik- eller reklame-cookies** (fx Google Analytics), skal privatlivspolitikken rettes, og der skal et samtykkebanner til. Privatlivspolitikken nævner nyhedsbrevet (MailerPress Pro), så tilmeldingen skal bede om samtykke og hvert nyhedsbrev have et afmeldingslink.
- **Skjul de store canvas uden for Europa i shoppen.** Varianterne har metafeltet `ship_only_to` med de lande, de må sælges til, men WooCommerce læser det ikke selv. Kunden vælger varianten på shop.stefg.art, så det skal gøres der, fx med et lille plugin eller et snippet, der fjerner varianten for andre lande.
- **Købsknappens tekst:** *Place order* skal hedde *Buy now* eller "Order with obligation to pay" (forbrugeraftaleloven § 12). Den kan ikke sættes fra appen; i kasseblokken rettes den direkte på knappen, i den klassiske kasse med et snippet.
- **Tjek kassen efter Update shop texts:** teksten over købsknappen er WooCommerce' "checkout privacy policy text", som den klassiske kasse viser. Bruger shoppen kasseblokken, skal teksten måske sættes ind i blokken i stedet.

## Til sitet (Astro)

Sitet stefg.art ligger i repoet `the-stef-g/stefs.cloud` (navnet kunne ikke ændres).

- **Siden med priser (`/prices/`)** findes ikke endnu. Når den laves, skal den kun vise varianter efter `kunTilLande` (fra `ship_only_to`) for de lande, de sælges til, og bruge materialerne som i prislisten: *Fine art paper* og *Canvas*, og canvas med ramme er *Canvas* med Frame *Black* eller *White*.
