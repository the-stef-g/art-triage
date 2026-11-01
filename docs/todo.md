# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Product: hele beskrivelsen kan ses.** Feltet Description vokser med teksten, så hele teksten står fremme uden at rulle (som seriens intro).
- **Teksterne fra Claude skal lyde som Stef, ikke som AI.** I dag beder appen om 80 til 150 ord i beskrivelsen og en afsluttende sætning om "hvor værket hører hjemme", og så bliver det fyld. Nyt:
  - Ingen ordgrænse. Kun det der giver mening om netop det værk; er der ikke mere at sige, er teksten kort. Advarslen om "80 til 150 ord" fjernes.
  - I øjenhøjde med læseren: almindelige ord, korte sætninger, som man ville sige det til nogen foran billedet. Ingen kunstsnak ("anchoring", "echoing", "the eye", "invites"), ingen opremsning af farver for opremsningens skyld, ingen sætning om stemning eller hvor værket passer ind.
  - Ingen fast afslutning og ingen fast åbning.
  - Stefs egne noter vægtes højest; står der noget dér, bygger teksten på det.
  - Det samme for seriens intro (i dag 40 til 80 ord).
  - Gerne et par af Stefs egne tekster som eksempel på hans stemme, så Claude kan ramme tonen. Har Stef dem, lægges de ind som eksempler i instruktionen.
- **Søgeordene: færre og mere præcise.** Fishy Fish fik fish, animal, blue (godt) og pattern, orange, red, white (forkert). I dag beder appen om 4 til 8 ord og 1 til 3 farver, og "pattern" og "texture" står på listen over motiv-ord. Nyt:
  - Ingen mindsteantal: hellere tre rigtige ord end seks med fyld.
  - Farver kun for den farve, der fylder billedet (baggrunden og helheden, her blå), ikke farverne i motivets detaljer (fiskens orange hoved). Som regel én farve, højst to.
  - pattern betyder et gentaget mønster (det samme element igen og igen over billedet), og kun det. Mange detaljer i et motiv er ikke et pattern. texture og abstract tilsvarende kun, når billedet virkelig er en tekstur eller abstrakt. Definitionerne står i instruktionen til Claude.
  - Gælder nye søgeord; de eksisterende ord kan skrives igen med Reanalyse.
- **Product: Section colour viser farven.** Et lille felt med farven ved siden af koden (#1b3a4b), og et klik på det åbner en farvevælger.

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
