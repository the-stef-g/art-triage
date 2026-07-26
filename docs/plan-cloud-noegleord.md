# Plan: cloud-nøgleord på godkendte, engelsk app, kandidat-status

Denne plan samler beslutningerne fra planlægningsrunden, så en frisk session kan
bygge den uden at grave i den lange tråd. Byg den i en ny session for at spare
tokens.

Appen ligger nu i sit eget repo, the-stef-g/art-triage, med hele historikken
fra tiden som undermappe i stefs.company. Sitet og appen deler ikke længere
repo. Appen hedder stadig Billedflow i koden og i README; omdøbningen til
art-triage hører sammen med skiftet til engelsk og tages i punkt 5 nedenfor.

## Beslutninger

Nøgleord skal fremover komme fra Claude via API, ikke fra den lokale zero-shot
model. Den lokale SigLIP-model bliver siddende, men kun til den gratis semantiske
søgning, hvor den er god nok. De dårlige auto-nøgleord fjernes.

Status: den sidste sætning er udført forud for punkt 3, fordi ordene var
ubrugelige i praksis. Ordliste-scoringen er taget ud af indekseringen, de gamle
gæt ryddes ved første biblioteksåbning, og electron/lib/vocab.mjs er slettet
(kan hentes fra git-historikken). Årsagen til de skæve ord er værd at kende,
så den ikke gentages: scoringen sammenlignede ordene indbyrdes på hvert enkelt
billede og spurgte, om noget skilte sig ud. Men ordene er ikke indbyrdes
kalibrerede, så en formulering der generelt ligger tæt på "et fotografi" vinder
på hvert eneste billede. Kalibreringen skulle have været den anden vej: hvert
ord målt mod sig selv på tværs af samlingen. Hos Stef landede 'kirke' på 1170
af 1200 billeder.

Med i samme ombæring røg propageringen af Stefs egne ord til visuelt lignende
billeder, da den kørte oven på samme tildeling. De ord han selv har skrevet ind
står urørt; det er kun forslagene til andre billeder der er væk. Skal den
funktion tilbage, hører den hjemme oven på Claudes nøgleord.

catalog.saveKeywords(fileId, entries) står tilbage ubrugt med vilje. Det er
sømmen hvor Claudes ord skal skrives ind, med manual=0 så de kan ryddes samlet
igen uden at røre Stefs egne.

Appen skal være på engelsk. UI-tekster og de AI-genererede nøgleord skifter til
engelsk. Sitet stefs.company forbliver dansk; det er en anden sammenhæng og røres
ikke.

Analysen kører kun på godkendte billeder. Kasserede, ubedømte og kandidater
sendes aldrig afsted. Den flytter om bag kulissen, så den følger bedømmelsen.

## Kandidat-status

Der kommer en fjerde bedømmelse ud over godkendt, kasseret og ubedømt: kandidat.
Den bruges når motivet er godt, men der er tekniske problemer (uskarphed,
forkerte farver og lignende), så billedet skal redigeres før det kan afgøres.
Kandidat får sin egen genvej og sin egen farve i grid'et.

Kandidater skal kunne ses for sig selv. Der kommer et fast punkt i sidepanelet,
ved siden af serier og nøgleord, som viser præcis de billeder der står som
kandidat. Det er arbejdslisten over det, der venter på en tur i editoren, og den
skal kunne åbnes uden at skulle stille på filtre først.

Kandidater analyseres ikke. En kandidat er endnu ikke afgjort, og der skal ikke
bruges penge på et billede der måske ender som kasseret. Når kandidaten er rettet
i editoren, forsvinder den ikke af sig selv fra listen: den skal bedømmes igen.
Godkendes den, ryger den i kø til analyse på helt normal vis. Kasseres den, sker
der ingenting.

## Det nye flow

1. Vælg mappe. Previews laves med det samme, ingen AI endnu.
2. Cull. Godkend, kandidat eller kasser. Det koster ingenting og er dit øje.
3. Kun godkendte ryger i kø til Claude. Kandidater, kasserede og ubedømte
   sendes aldrig.
4. Claude svarer med engelske nøgleord, der lægger sig som chips du kan rette.
   Den lokale søgning kører videre gratis oveni.
5. Kandidater venter i deres egen liste, til de er redigeret og bedømt igen.
   Bliver de godkendt, går de ind i punkt 3 som alle andre godkendte.

Hanen er din. Analysen starter når du siger et billede er godkendt, ikke fra
første sekund. Kørsel i portioner (fx en serie ad gangen) skal være muligt.

## Flaget "redigeret" skal hedde "redigeres"

Flaget hedder i dag redigeret, som om arbejdet er overstået. Det passer ikke til
den måde det bruges på: flaget sættes når billedet er sendt afsted til en editor,
altså mens det er under behandling. Det skal derfor hedde redigeres, og being
edited i den engelske udgave. Flaget færdig bliver som det er og markerer det
overståede.

Omdøbningen rører katalog, fortryd, grid, inspektør, styles, tests og README.
Ordet står både som feltnavn i kataloget og som synlig tekst, så feltnavn,
CSS-klasse og visningstekst skal følges ad. Tages sammen med det engelske skifte,
så teksten kun laves om én gang.

## Pris og betaling

Claude API faktureres via en API-nøgle fra console.anthropic.com, pay-as-you-go,
og er helt adskilt fra et Pro-abonnement. Pro dækker chat på claude.ai og Claude
Code, ikke programmatisk API-brug fra en app. Der kan sættes et forbrugsloft i
konsollen.

Model: Claude Haiku (billigst med billedforståelse). Vi sender et lille thumbnail
på 512 til 768 pixels, ikke det fulde RAW. Den faste instruktion caches, så den
næsten intet koster efter første billede. Batch-kørsel giver halv pris mod svar
inden for et døgn.

Pris pr. billede lander på under 1 øre, omkring en halv øre med Batch. Kun
godkendte analyseres, så selv en tredjedel af 15.000 billeder er 20 til 30 kroner
én gang. Selv hele bunken på 15.000 ville være omkring 100 kroner, eller cirka 50
med Batch.

At kandidater holdes udenfor trækker beløbet yderligere ned, og det er den
egentlige grund til reglen: der betales først, når et billede er afgjort. En
kandidat der ender som kasseret, har så ikke kostet noget.

Status: udført på nær Batch. Modellen kan vælges i appen, ikke låst til Haiku:
det var dårlig ordkvalitet der væltede den forrige mekanisme, så valget mellem
pris og kvalitet hører hjemme hos Stef og ikke i koden. Haiku 4.5 står som
standard, Sonnet 5 og Opus 5 kan vælges ved siden af knappen. Forbruget vises
løbende i statuslinjen mens en kørsel står på, så beløbet kan ses mens det
bruges og ikke først på regningen.

Batch er bevidst udeladt i denne omgang. Besparelsen på Stefs 1200 godkendte
billeder er omkring 8 kroner, og prisen er en kø der skal overleve at appen
lukkes, med et batch-id gemt på disken, statuspolling og delvise svar der skal
samles op bagefter. Det kan bygges, hvis der senere skal 15.000 billeder
igennem; ved den størrelse er besparelsen omkring 50 kroner og besværet værd.

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
ingen fil-system-hændelser på macOS. Fix: en periodisk genskanning plus en synlig
"Skan igen"-knap, så nye filer altid bliver fanget.

Spørgsmålet om hvor billederne ligger er nu afklaret, og svaret bekræfter
diagnosen. Billedfilerne ligger på eksterne diske, og de billeder der arbejdes på
ligger på en 1 TB SSD. Et bibliotek på eksternt drev er præcis det tilfælde, hvor
chokidar tier på macOS, så det er ikke et tilfældigt uheld men den normale
tilstand her. Genskanningen er derfor ikke et sikkerhedsnet men den bærende
mekanisme, og fixet rykker op som det første der bygges.

To ting følger af det. Genskanningen skal kunne klare, at et drev ikke er
tilsluttet: et bibliotek på en frakoblet disk skal give en rolig besked om at
drevet mangler, ikke tolkes som at alle filerne er slettet. Og intervallet skal
kunne tåle langsomme eksterne drev, så en skanning ikke sætter sig oven i den
forrige.
Om SSD'en sidder internt eller er tilsluttet udefra er værd at få bekræftet, men
det ændrer ikke fixet, da biblioteket rækker ud over eksterne diske under alle
omstændigheder.

## Versionsnummer

Nulstil til patch-stil, cirka 0.2.8, som Stef ønsker, og brug patch-spring for
fixes fremover.

Status: udført. Nummeret stod på 0.7.1 gennem fem runder uden at blive rørt,
hvilket Stef med rette kaldte noget rod, og det er nu sat til 0.2.8 sammen med
navneskiftet. Reglen herfra: hver ændring der kan ses i appen, hæver patch-tallet
i package.json i samme commit. Nummeret står i statuslinjen, så det er til at
kontrollere, at man har den udgave man tror.

## Rækkefølge når der bygges

1. Status- og watcher-fix. Rykket op som det første, fordi biblioteket ligger på
   eksterne diske og genskanningen derfor bærer importen.
2. Kandidat-status i katalog, genvej, farve og filtre, plus kandidatlisten i
   sidepanelet.
3. Cloud-nøgleord: API-nøgle-opsætning, Haiku-kald på thumbnail, kø kun på
   godkendte, batch-mulighed. Udført på nær batch, se afsnittet om pris.
4. Engelsk UI og engelske nøgleord. UI-delen er udført; nøgleordene hører til
   punkt 3, da de først findes når Claude laver dem.
5. Omdøbninger samlet: udført. Flaget hedder nu redigeres (being edited), og
   appen hedder art-triage i package.json, artifact-navn, byggeopskrift, menuer
   og README.
6. README og tests opdateres, version til ~0.2.8: udført.

Alle punkter er nu bygget. Kun Batch-kørslen står tilbage som et bevidst fravalg,
beskrevet under pris og betaling.

## Hvor grænsen mellem godkendt og resten håndhæves

Reglen om at kun godkendte billeder sendes afsted står ét sted: forespørgslen
catalog.filesNeedingKeywords. Den er skrevet sådan med vilje. Havde udvælgelsen
ligget i UI'et eller i køren, ville et nyt filter eller en ny knap kunne komme
til at sende kandidater med uden at nogen opdagede det. Nu skal selve
forespørgslen laves om, og syv tests falder, hvis den bliver løsnet.

En fil kan være den effektive fil for flere versioner. Er bare én af dem
godkendt, hører filen med: det er motivet der beskrives, og versionerne deler
motiv.

Tabellen keyword_runs er kvitteringen for at en fil har været afsted. Uden den
kunne en fil der ikke gav nogen ord ikke skelnes fra en der aldrig er sendt, og
den ville blive betalt for igen ved hver eneste kørsel.

## Hvad der bevidst ikke blev oversat

Databasens værdier for bedømmelse (godkendt, kandidat, kasseret, ubedomt) står
stadig på dansk, og det samme gør CSS-klasser, feltnavne og kodekommentarer. De
er ikke synlige for brugeren, og at oversætte de gemte bedømmelser ville kræve en
migrering af hvert eneste eksisterende katalog uden at nogen kunne se forskel.

Mappen `_kasseret` på disken beholder også sit navn. Den indeholder rigtige
billedfiler, og et navneskifte ville enten efterlade Stefs kasserede billeder i
en mappe appen ikke længere kigger i, eller sprede dem over to mapper.

Katalogmappen hedder `.art-triage` i nye biblioteker. Findes en `.billedflow` fra
tidligere, bruges den videre i stedet. Der flyttes ingen data: at omdøbe en mappe
med bedømmelser på tusindvis af billeder er en unødig risiko, og fejler det
midtvejs, er arbejdet tabt.
