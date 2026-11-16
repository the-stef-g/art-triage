# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Korte tekster, der lader folk selv tolke.** Teksterne skal være korte, kun de nødvendige ord, og ikke fortælle læseren hvad de skal se, føle eller tænke. Beskriv kort hvad der er (motiv, og det man ellers kunne overse), ingen tolkning af betydning eller stemning, ingen "the fish seems to …", "suggests", "as if". Appen har hidtil ikke brugt om-mig.md (Google Drive); og den er ikke helt rigtig (Stef bruger både tankestreger og "lad os"), så den bruges ikke som den er. Med i instruktionen kommer kun: ingen trekantsstrukturer ("Not X. Not Y. But Z."), ingen superlativer, jordnær og uden corporate-speak. Ikke "50–80 ord" fra filen. Forbuddet mod tankestreger i appens instruktion og advarslen om dem fjernes: Claude må bruge tankestreger ligesom Stef. Gælder også seriens intro og den korte tekst.
- **Værktøjslinjen:** New folder fjernes (mapper laves i Finder). Scan again, Clean up og Switch library flyttes fra knapper i værktøjslinjen til menupunkter i Edit-menuen i Mac'ens menulinje (med deres genveje, hvis de har nogen).
- **Sorteringen ved søgefeltet:** dropdown-menuen (Name / Modified) står lige ved siden af søgefeltet i stedet for ude til højre.
- **Print: boblen med antallet på formatknapperne kan næsten ikke ses.** Mere kontrast: lysere baggrund og tydelig tekst, så tallet kan læses.
- **Shop queue under Send to shop:** køen er ikke et pop op-vindue, men sidder fast i shop-kolonnen lige under Send to shop (og knappen i bundlinjen forsvinder). Fremdriften (værk 2 af 4, MB, trin, tid) står der. Når køen er færdig, rydder den selv: de sendte værker forsvinder efter et øjeblik, uden at der skal klikkes Clear finished. Værker der blev sprunget over eller fejlede, bliver stående med årsagen, til de er sendt igen eller fjernet.
- **Bundlinjens venstre side ryddes:** slideren, versionsnummeret, biblioteksnavnet og tallene (billeder, approved osv.) forsvinder fra bundlinjen; resten af bundlinjen (beskeder, fejl, AI-status, Claude-forbrug osv.) bliver. Versionsnummeret flyttes op efter "Stef G Art" i topbjælken, i samme typografi som nu, med lidt mere luft til Sort-knappen.
- **Kassér i fase 1-5:** Discard work virker i Sort, Edit, Crop, Print og Product, også for et værk med en master. En dialog viser, hvad der sker, og så: originalen flyttes til Discarded, redigeringer, master, beskæringer og printfiler i papirkurven, de tomme mapper (værkmappen med Original, Edits, Masters og Print files) slettes, og er værket i shoppen (kladde), slettes produktet der også.

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
