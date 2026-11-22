# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Crop: lærredets kant skal kunne ses.** Den stiplede linje (50 % grå, halvt gennemsigtig) og teksten forsvinder i billedet. Nyt: linjen tegnes som en tynd hvid stiplet linje med en mørk kant ved siden af, så den ses på både lyse og mørke billeder, og området uden for den (det der havner på siderne) får en let mørk tone. Teksten *Canvas edge: 30 × 30 cm* står i en lille mørk boks med hvid skrift. Stadig kun i Crop, ikke i den gemte fil.

- **Product: forslag når et keyword skrives.** Når Stef skriver i feltet til et nyt keyword, viser en lille liste under feltet de keywords, der allerede er brugt i biblioteket og begynder med (eller indeholder) det skrevne, de mest brugte først og højst 8. Pil ned/op vælger, Enter eller Tab tilføjer det valgte, og Escape lukker listen. Et nyt ord, der ikke er brugt før, kan stadig skrives og tilføjes med Enter. Ord, værket allerede har, vises ikke i listen.

- **Product: Series colour vises som Section colour.** I dag er Series colour kun et tekstfelt med koden. Nyt: den får det samme farvefelt som Section colour, en farveprøve man kan se og klikke på for at vælge farven, ved siden af koden. Feltet er stribet, når serien ingen farve har. En valgt farve gemmes på serien og sendes med næste Update shop som i dag.

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
