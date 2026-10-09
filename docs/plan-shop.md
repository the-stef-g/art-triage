# Plan: værkets tekster og shop-produkt i Stef G Art

Version 1.0 (5. oktober 2026). Skrevet til Claude Code i repoet the-stef-g/art-triage. Byg den i en ny session.

## Hvorfor

Stef vil samle alt, der hører til et værk, ét sted. Stef G Art bliver stedet, hvor et værk gøres færdigt: billede, beskæringer, data, tekster og alt-tekst. Derfra sendes det til WooCommerce på shop.stefg.art, som sitet stefg.art læser fra ved hvert build.

Teksterne rettes kun i Stef G Art. Woo er en kopi. Retter Stef noget i Woo, bliver det overskrevet næste gang værket sendes. Det skal stå tydeligt i appen.

## Beslutninger (5. oktober 2026)

- Stef G Art opretter og opdaterer produktet i Woo selv.
- Stef G Art beder Claude om udkast til beskrivelse, kort tekst og alt-tekst. Stef retter dem i appen.
- Datamodellen på shoppen er fast og beskrevet i datamodel.md v3.0 i stefg.art-mappen. Stef G Art tilpasser sig den, ikke omvendt.

## Hvad et værk er i Stef G Art

Et værk er et billede (`images`) med status godkendt og færdig. Beskæringerne til print er versioner eller virtuelle kopier af samme billede, hver markeret med sit format (1:1, 2:3, 3:2, 1:2, 2:1). Serien er Stef G Arts egen serie, som svarer til termen i taksonomien `series` på shoppen.

## Felter pr. værk (nyt panel i Inspector)

| Felt | Kilde og regel |
| --- | --- |
| Titel | Filnavnet som udgangspunkt (filnavnet er altid titlen). Oversættes aldrig |
| År | Optagelsesdatoen i originalfilen (EXIF), ikke filens dato. Kan rettes |
| Kategori | Graphic Design, Photography, Paintings eller Sculptures |
| Teknik | Fri tekst, fx "Digital art" |
| Serie | Stef G Arts serie |
| Skabelon | `spread` eller `poster` |
| Sektionsfarve | Valgfri farve. Tom = seriens farve |
| Katalognummer | Valgfrit. Tom = tallet sidst i titlen |
| Video | Valgfri fil, til skulpturer |
| Print | Til/fra: værket sælges som print |
| Beskæringer | Hvilken version der er 1:1, 2:3, 3:2, 1:2 og 2:1 |
| Mål og pris | Kun unikke værker (skulpturer, malerier): mål og én pris |
| Noter | Stefs egne stikord om værket: hvad, hvorfor, hvordan. Sendes med til Claude |
| Beskrivelse | Udkast fra Claude, rettet af Stef |
| Kort tekst | Udkast fra Claude, rettet af Stef |
| Alt-tekst | Udkast fra Claude, rettet af Stef |

Gem alt i kataloget, så det overlever genstart og genscanning.

## Tekster fra Claude

En knap "Write texts" sender et billede på ca. 1024 px, titel, kategori, teknik, serie og Stefs noter, og får tre tekster tilbage på britisk engelsk. Brug samme API-nøgle og model-vælger som nøgleordene, og vis prisen i statuslinjen som i dag. Overskriv aldrig tekst, Stef har rettet, uden at spørge.

Regler til Claude, som de skal stå i instruktionen:

- **Beskrivelse:** 80–150 ord. Åbner med oplevelsen, ikke "This artwork…". Motiv, farver og komposition, med Stefs noter flettet ind. Slutter med én rolig sætning om, hvor værket hører hjemme. Er værket en del af en serie, nævnes det.
- **Kort tekst:** én sætning til kort og deling.
- **Alt-tekst:** én sætning, højst ca. 150 tegn. Hvad billedet viser, ikke hvad det betyder.
- Ingen superlativer og ingen klichéer ("stunning", "unique", "one-of-a-kind", "perfect gift"). Ingen tankestreger (em-dash). Ingen salgstricks.
- Nævn aldrig AI, Photoshop eller andre værktøjer. Det er Stefs beslutning: værktøjerne er kun værktøjer.
- Beskriv kun det, der ses. Skriv ikke "drawn", "painted" eller lignende om en teknik, der ikke er sådan. Vælg farveord, der ikke kan læses som materialer (ikke "rust" om en ørken).
- Titler og serienavne oversættes aldrig.

## Send til shop

En knap "Send to shop" opretter produktet første gang og opdaterer det bagefter. Gem Woo-produktets id i kataloget, så der aldrig laves dubletter.

1. **Billeder:** upload hovedbilledet og hver beskæring til WordPress' mediebibliotek (`/wp-json/wp/v2/media`) som JPEG i høj kvalitet, ca. 3000 px på den lange led. Aldrig printmasteren. Sæt alt-teksten på mediet. Upload kun igen, hvis filen er ændret siden sidst.
2. **Produktet** via `/wp-json/wc/v3/products`: navn, beskrivelse, kort beskrivelse, hovedbillede, kategori, attributterne Year og Technique (og Dimensions ved unikke værker), seriens term og ACPT-felterne i `meta_data` med nøglerne `work_template`, `work_section_colour`, `work_catalogue_number`, `work_video`, `work_prints` og `work_crop_1x1` til `work_crop_2x1`. Hent først produkt 20 (Desert Canyon 04) og kopier præcis det format, ACPT bruger i dag, også de skjulte hjælpefelter som `_attachment_id`.
3. **Status:** nye produkter oprettes som kladde. Stef udgiver selv, eller med en knap "Publish" i appen.
4. **Unikke værker:** simpelt produkt med pris, lagerstyring og 1 stk. på lager, momsklasse Reduced rate for skulpturer.
5. Stef G Art rører kun de felter, den selv ejer. Lager, ordrer og printvarianter røres ikke i denne fase.

**Nøgler.** Der skal bruges to nye nøgler, gemt som Claude-nøglen i dag: aldrig vist igen, aldrig i loggen, aldrig sendt til brugerfladen.

- En WooCommerce REST-nøgle med Read/Write (en ny, ikke byggets læsenøgle).
- Et WordPress Application Password til medie-upload (Users → Profile → Application Passwords).

Stop og forklar Stef trin for trin, hvordan han laver dem, når det bliver aktuelt.

## Senere faser (ikke nu)

- **Printvarianter fra appen:** i dag laver Claude i Cowork en CSV pr. værk ud fra prisliste.md. Senere kan Stef G Art oprette varianterne selv ud fra en prisliste i appens indstillinger og de beskæringer, værket har.
- **Byg sitet efter udgivelse:** Stef G Art kan starte GitHub-workflowet i the-stef-g/stefs.cloud, så værket kommer ud med det samme. Kræver et GitHub-token, der kun må starte Actions i det ene repo.

## Rapport

Kort, på dansk: hvad der er bygget, hvad der mangler, og hvad Stef skal teste. Lav en testtjekliste i README som de tidligere.
