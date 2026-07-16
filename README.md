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

**Bedømmelse og status.** Hvert billede kan være godkendt, kasseret eller ubedømt, og har derudover flagene redigeret og færdig. Kasserede billeder skjules som standard og kan vises igen med "Vis kasserede". Genveje: **G** godkend, **X** kassér, **U** nulstil, **R** redigeret til/fra, **F** færdig til/fra, **V** ny virtuel kopi, **mellemrum** stort preview, **piletaster** flytter markeringen, **Cmd+Z** fortryder seneste handling (bedømmelse, flag, serie, omdøbning, virtuel kopi og flytning), **Skift+Cmd+Z** gentager.

**Virtuelle kopier.** "Ny virtuel kopi" opretter en ekstra version af samme motiv, fx til en anden beskæring. Kopien fylder ingenting på disken, før du sender den til redigering. I det øjeblik laver Billedflow en fysisk kopi ved siden af originalen og åbner den i din editor.

**Redigér i.** Vælg app i Inspektøren og klik Åbn. Billedflow finder selv Luminar Neo, Topaz Photo AI, Gigapixel, Photoshop, Affinity Photo og Pixelmator Pro i Programmer, og du kan altid vælge en anden app. Når du gemmer i editoren, opdager Billedflow ændringen, markerer versionen som redigeret og opdaterer previewet. Gemmer editoren en ny fil ved siden af originalen (fx `IMG_1234-gigapixel.tif`), stables den automatisk som en version af samme billede.

**Mapper.** Mappetræet til venstre viser hele biblioteket. "Ny mappe" opretter en mappe, og du kan trække billeder fra gridden til en mappe for at flytte filerne på disken. "Ryd op" flytter alle filer, hvor samtlige versioner er kasseret, til mappen `_kasseret`.

**Serier.** Markér et eller flere billeder og vælg "Ny serie" eller en eksisterende serie i Inspektøren. Klik på en serie i sidepanelet for kun at se dens billeder.

**Søgning.** Skriv fx "gule blomster" i søgefeltet, så finder Billedflow billederne ud fra selve billedindholdet. Det kræver ingen manuelle søgeord: appen analyserer selv alle billeder i baggrunden og tildeler samtidig danske nøgleord, som vises som klikbare chips i sidepanelet.

## AI-modellen

Billedanalysen kører 100 procent lokalt på din Mac. Første gang appen starter, henter den en CLIP-model (cirka 300 MB) fra Hugging Face og gemmer den lokalt. Derefter virker analyse og søgning uden internet. Statuslinjen nederst viser fremdrift for både download og indeksering. En stor samling tager noget tid første gang; søgningen virker undervejs på de billeder, der allerede er analyseret.

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
