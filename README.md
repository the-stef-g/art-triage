# Billedflow

Billedflow er en macOS-app til at sortere og organisere billedfiler. Den redigerer ikke selv billederne. I stedet sender den filer til dine egne editor-apps (Luminar Neo, Topaz Photo AI, Gigapixel med flere) og opdager selv, når du har gemt. Appen holder styr på en helt almindelig mappe i Finder: dine filer bliver hvor de er, og alt katalog-data ligger i en skjult undermappe `.billedflow` i samme mappe.

Bygget til Intel Mac (iMac 2019) med macOS Sequoia. Kører også på nyere versioner.

## Hent appen

Appen bygges automatisk af GitHub Actions ved hvert push.

1. Åbn repoet på GitHub og klik på fanen **Actions**.
2. Vælg den nyeste grønne kørsel af workflowet **Billedflow**.
3. Under **Artifacts** henter du **Billedflow-mac-x64**.
4. Pak zip-filen ud og træk **Billedflow.app** til Programmer.

## Første åbning på macOS Sequoia

Appen er ikke signeret med et Apple-udviklercertifikat, så første gang siger macOS nej.

1. Dobbeltklik på Billedflow. macOS viser en advarsel. Klik **Luk**.
2. Åbn **Systemindstillinger > Anonymitet & sikkerhed**.
3. Rul ned til beskeden om Billedflow og klik **Åbn alligevel**.
4. Bekræft. Det skal kun gøres denne ene gang.

## Sådan bruger du appen

**Bibliotek.** Klik "Vælg billedmappe" og peg på den mappe dine billeder ligger i. Billedflow scanner mappen og alle undermapper og laver previews af JPEG, TIFF, PNG, RAW (CR2, CR3, NEF, ARW, DNG med flere), PSD, HEIC, SVG og AI-filer. Mappen kan når som helst åbnes igen fra velkomstskærmen.

**Nye filer og eksterne drev.** Ligger biblioteket på et eksternt drev, får appen sjældent besked fra macOS om, at der er kommet nye filer. Derfor gennemgår Billedflow selv mappen med jævne mellemrum, og du kan altid klikke "Skan igen" i værktøjslinjen for at få det gjort med det samme. Tager du drevet ud mens appen kører, skriver statuslinjen at drevet ikke er tilsluttet, og kataloget står urørt: bedømmelser, serier og virtuelle kopier venter, til drevet er tilbage.

**Bedømmelse og status.** Hvert billede kan være godkendt, kandidat, kasseret eller ubedømt, og har derudover flagene redigeret og færdig. Kasserede billeder skjules som standard og kan vises igen med "Vis kasserede". Genveje: **G** godkend, **K** kandidat, **X** kassér, **U** nulstil, **R** redigeret til/fra, **F** færdig til/fra, **V** ny virtuel kopi, **mellemrum** stort preview, **piletaster** flytter markeringen, **Cmd+Z** fortryder seneste handling (bedømmelse, flag, serie, omdøbning, virtuel kopi og flytning), **Skift+Cmd+Z** gentager.

**Kandidat.** Brug kandidat, når motivet er godt, men noget teknisk står i vejen: uskarphed, forkerte farver og lignende. Det er ikke en dom, men en beslutning der venter, til billedet har været en tur i editoren. Kandidater har deres egen lilla farve i grid'et og deres eget punkt i sidepanelet, hvor arbejdslisten over det der venter kan åbnes med ét klik. De vises som almindelige billeder i grid'et, i modsætning til kasserede. Når du har rettet billedet, bedømmer du det igen: godkendt eller kasseret. Kandidater sendes aldrig til betalt analyse, netop fordi de ikke er afgjort endnu.

**Virtuelle kopier.** "Ny virtuel kopi" opretter en ekstra version af samme motiv, fx til en anden beskæring. Kopien fylder ingenting på disken, før du sender den til redigering. I det øjeblik laver Billedflow en fysisk kopi ved siden af originalen og åbner den i din editor.

**Redigér i.** Vælg app i Inspektøren og klik Åbn. Billedflow finder selv Luminar Neo, Topaz Photo AI, Gigapixel, Photoshop, Affinity Photo og Pixelmator Pro i Programmer, og du kan altid vælge en anden app. Når du gemmer i editoren, opdager Billedflow ændringen, markerer versionen som redigeret og opdaterer previewet. Gemmer editoren en ny fil ved siden af originalen (fx `IMG_1234-gigapixel.tif`), stables den automatisk som en version af samme billede.

**Mapper.** Mappetræet til venstre viser hele biblioteket. "Ny mappe" opretter en mappe, og du kan trække billeder fra gridden til en mappe for at flytte filerne på disken. "Ryd op" flytter alle filer, hvor samtlige versioner er kasseret, til mappen `_kasseret`.

**Serier.** Markér et eller flere billeder og vælg "Ny serie" eller en eksisterende serie i Inspektøren. Klik på en serie i sidepanelet for kun at se dens billeder.

**Søgning.** Skriv fx "gule blomster" i søgefeltet, så finder Billedflow billederne ud fra selve billedindholdet. Det kræver ingen søgeord: appen analyserer selv alle billeder i baggrunden. Kun billeder, der tydeligt matcher, vises; en søgning uden reelle match giver ærligt nul resultater. Tallet ved et nøgleord i sidepanelet svarer til det antal billeder, et klik viser.

**Nøgleord.** Appen gætter ikke selv nøgleord. Det gjorde den før, ved at score hvert billede mod en dansk ordliste, men den sammenligning var vendt forkert: ord blev holdt op mod hinanden billede for billede, så en formulering der generelt lå højt vandt på alt. I praksis endte 'kirke' på 1170 ud af 1200 billeder. Den mekanik er taget ud, og de gamle gæt ryddes automatisk væk første gang du åbner biblioteket. Dine egne ord bliver stående.

Du kan selv skrive nøgleord på et billede i Inspektøren, og de vises som klikbare chips i sidepanelet. Klikker du et nøgleord, viser grid'et alle billeder med det ord. Marker dem der ikke hører til (klik, cmd-klik eller shift-klik for flere) og fjern dem fra nøgleordet med knappen i Inspektøren. Krydset på chippen i sidepanelet fjerner ordet fra alle billeder på én gang, også dem du selv har skrevet, og det kan ikke fortrydes.

Automatiske nøgleord kommer tilbage, når de laves af Claude i stedet. Det er punkt 3 i `docs/plan-cloud-noegleord.md`. Indtil da virker den semantiske søgning som før og gratis, for den bygger på billedanalysen og ikke på nøgleord.

## AI-modellen

Billedanalysen kører 100% lokalt på din Mac med Googles flersprogede SigLIP-model, som forstår dansk direkte. Første gang appen starter, henter den modellen (cirka 250 MB) fra Hugging Face og gemmer den lokalt. Derefter virker analyse og søgning uden internet. Statuslinjen nederst viser fremdrift for både download og indeksering. En stor samling tager noget tid første gang; søgningen virker undervejs på de billeder, der allerede er analyseret.

Driller AI'en, ligger der en logfil med alle detaljer bag Hjælp > Vis AI-log. Send indholdet, så kan fejlen findes præcist.

### Hvis modellen ikke kan hentes

Alle modeldownloads går gennem appens egen downloader, som prøver huggingface.co først og derefter det offentlige spejl hf-mirror.com, logger alle svar i AI-loggen og gemmer filerne i en lokal cache, så der aldrig hentes to gange. Sprogmodellen prøves fra flere alternative arkiver automatisk, hvis det primære er forsvundet. Rammer du alligevel Hugging Faces grænser for anonyme downloads, så opret en gratis konto på huggingface.co, gå til Settings > Access Tokens, lav en token af typen Read, og sæt den ind under Hjælp > Hugging Face-token. Tokenet gemmes kun lokalt på din Mac og sendes kun til huggingface.co, aldrig til spejlet.

## Udvikling

Kildekoden ligger i denne mappe og er et Electron-projekt med Vite og React.

    npm install        # installerer afhængigheder
    npm run dev        # udviklingsserver + Electron
    npm test           # enhedstests (vitest)
    npm run build      # bygger renderer til dist/
    npm run smoke      # UI-smoketest af den byggede app
    npm run dist:mac   # bygger Billedflow-mac-x64.zip (kræver macOS)

Katalogdata pr. bibliotek ligger i `.billedflow/katalog.sqlite`, previews i `.billedflow/cache/`. Slettes mappen `.billedflow`, genopbygges kataloget ved næste åbning, men bedømmelser, serier og virtuelle kopier går tabt.

## Tjekliste til første test på din iMac

1. Åbn appen og vælg en mappe med en blanding af RAW, JPEG og PSD.
2. Tjek at der kommer previews på det hele, også RAW og PSD.
3. Godkend et par billeder med G og kassér et med X. Luk appen, åbn igen og se at det huskes.
4. Lav en virtuel kopi med V, vælg kopien og klik Åbn i Gigapixel. Tjek at der ligger en ny fysisk kopi ved siden af originalen.
5. Gem fra editoren og se at versionen bliver markeret som redigeret, og at previewet opdateres.
6. Vent til statuslinjen siger at analysen er færdig, og søg så på noget du ved findes i billederne, fx "gule blomster".
7. Træk et billede til en anden mappe i sidepanelet og tjek i Finder at filen er flyttet.
