# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Sort: filmstriben følger hovedvinduets rækkefølge.** Den viser i dag importen i den rækkefølge, billederne er taget, så den ikke passer med grid'et, når det er sorteret efter navn (*Fishy Fish.png* står før *Fishy Fish sketch+pencil.psd* i striben, men efter i grid'et). Striben skal sortere som grid'et, også når sorteringen skiftes.
- **En redigering med længere navn hører til værket.** *Fishy Fish.png* er originalen, og *Fishy Fish sketch+pencil.psd* er Photoshop-arbejdet, der skal være master, men det blev et værk for sig. Regel: en fil med en anden filtype, hvis navn er et værks navn plus et mellemrum og flere ord, er en redigering af det værk og lægges i dets `Edits`. Ord der kun er et tal (*Desert Canyon 04*), gør det ikke: det er et nyt værk i en serie. Værker, der allerede er delt sådan (Fishy Fish), flettes ved næste skanning, som Allura. Desuden en knap til begge veje: *Move to work …* lægger en fil i et andet værks `Edits`, og *Make it a work of its own* skiller den ud igen, hvis reglen gætter forkert.
- **Spørgsmålet om Apple Music.** macOS spurgte, om Stef G Art må få adgang til Apple Music og musikbiblioteket, da en mappe blev lagt i Import. Appen bruger ikke musik. Find ud af, hvad der udløser det (en fil eller mappe fra Musik-mappen, en video eller lyd i mappen, eller Quick Look), og få det væk, så appen aldrig spørger.

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
