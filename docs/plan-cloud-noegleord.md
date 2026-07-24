# Plan: cloud-nøgleord på keepers, engelsk app, kandidat-status

Denne plan samler beslutningerne fra planlægningsrunden, så en frisk session kan
bygge den uden at grave i den lange tråd. Byg den i en ny session for at spare
tokens.

## Beslutninger

Nøgleord skal fremover komme fra Claude via API, ikke fra den lokale zero-shot
model. Den lokale SigLIP-model bliver siddende, men kun til den gratis semantiske
søgning, hvor den er god nok. De dårlige auto-nøgleord fjernes.

Appen skal være på engelsk. UI-tekster og de AI-genererede nøgleord skifter til
engelsk. Sitet stefs.company forbliver dansk; det er en anden sammenhæng og røres
ikke.

Analysen må aldrig køre på kasserede billeder. Den flytter om bag kulingen og
kører kun på keepers.

## Kandidat-status

Der kommer en fjerde bedømmelse ud over godkendt, kasseret og ubedømt: kandidat.
Den bruges når motivet er godt, men der er tekniske problemer (uskarphed,
forkerte farver og lignende), så billedet skal redigeres før det kan afgøres.
Kandidat får sin egen genvej og sin egen farve i grid'et. AI-køen kører på både
godkendte og kandidater, aldrig på kasserede eller ubedømte. Retter Stef en
kandidat i editoren, bliver den redigerede version analyseret igen automatisk,
ligesom i dag.

## Det nye flow

1. Vælg mappe. Previews laves med det samme, ingen AI endnu.
2. Cull. Godkend, kandidat eller kasser. Det koster ingenting og er dit øje.
3. Godkendte og kandidater ryger i kø til Claude. Kasserede sendes aldrig.
4. Claude svarer med engelske nøgleord, der lægger sig som chips du kan rette.
   Den lokale søgning kører videre gratis oveni.

Hanen er din. Analysen starter når du siger et billede er værd at beholde, ikke
fra første sekund. Kørsel i portioner (fx en serie ad gangen) skal være muligt.

## Pris og betaling

Claude API faktureres via en API-nøgle fra console.anthropic.com, pay-as-you-go,
og er helt adskilt fra et Pro-abonnement. Pro dækker chat på claude.ai og Claude
Code, ikke programmatisk API-brug fra en app. Der kan sættes et forbrugsloft i
konsollen.

Model: Claude Haiku (billigst med billedforståelse). Vi sender et lille thumbnail
på 512 til 768 pixels, ikke det fulde RAW. Den faste instruktion caches, så den
næsten intet koster efter første billede. Batch-kørsel giver halv pris mod svar
inden for et døgn.

Pris pr. billede lander på under 1 øre, omkring en halv øre med Batch. Kun keepers
analyseres, så selv en tredjedel af 15.000 billeder er 20 til 30 kroner én gang.
Selv hele bunken på 15.000 ville være omkring 100 kroner, eller cirka 50 med
Batch.

## Status- og import-fejlen (skal med i samme runde)

To ting, fundet i koden:

Statuslinjen sidder tit på "Henter billedmodel 100%". Efter download skal
modellen stadig pakkes ud i WASM og køre en første inferens, og de faser sender
ingen fremdrift. På en ældre Intel-iMac tager de lang tid, så linjen ser frossen
ud selvom den arbejder. Fix: send tydelig status før hver af faserne (klargør
billedmodel, klargør sprogmodel, starter modellen), så der altid er bevægelse.

Nye billeder blev ikke analyseret ved import, kun efter genstart. Genstart kører
en fuld genskanning i openLibrary, derfor virkede det der. Live-importen bygger på
en mappe-overvåger (chokidar), og på eksterne eller netværksdrev får den ofte
ingen fil-system-hændelser på macOS. Fix: en periodisk sikkerheds-genskanning som
sikkerhedsnet plus en synlig "Skan igen"-knap, så nye filer altid bliver fanget.
Afklar hvor Stefs billeder ligger (intern disk eller eksternt drev), så det rette
fix prioriteres.

## Versionsnummer

Nulstil til patch-stil, cirka 0.2.8, som Stef ønsker, og brug patch-spring for
fixes fremover.

## Rækkefølge når der bygges

1. Status- og watcher-fix (lille, hjælper med det samme).
2. Kandidat-status i katalog, genvej, farve og filtre.
3. Cloud-nøgleord: API-nøgle-opsætning, Haiku-kald på thumbnail, kø kun på
   keepers, batch-mulighed.
4. Engelsk UI og engelske nøgleord.
5. README og tests opdateres, version til ~0.2.8.
