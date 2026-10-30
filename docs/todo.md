# To-do

Det der venter. Stef siger "byg", før noget herfra bliver lavet.

## Venter på "byg"

- **Printvarianter ud fra prislisten** (`docs/prisliste.json`, version 3.0, bygget ind i appen; ændres priserne, retter Claude dem i en ny version). Send to shop opretter og opdaterer varianterne for de formater, værket har beskæringer i: materiale (Fine art paper, Canvas), ramme (None, Black, White) og størrelse, med prisen fra listen. 3:2 og 2:1 bruger 2:3 og 1:2 vendt (bredde først: "45 × 30 cm"). Variant-SKU som `DC04-2X3-CANVAS-NO-40X60` og Prodigis varenummer i `prodigi_sku`. Ingen lagerstyring, altid på lager, så kladden ikke står som Out of stock. Varianter for en beskæring der ikke findes mere, eller som ikke er i prislisten (fx Framed paper på produkt 20), fjernes; produktet opdateres, så id, permalink og anmeldelser bliver. 120 × 120 canvas og canvas med ramme får `hide_in_countries: US,JP` på varianten, så Astro kan skjule dem.
- **Update all prints.** En knap der opdaterer varianter og priser på alle printprodukter i shoppen på én gang, uden at røre tekster og billeder.
- **Print: pixeltallet til Gigapixel ud fra prislisten.** Det største print i hvert format (1:1 120 cm, 2:3 150 cm, 1:2 120 cm) i stedet for at skrive det ind.

## Venter på en afklaring

- **Betaling og fortrydelsesret for print.** Spørg Forbrugerombudsmanden, e-mærket eller Dansk Erhverv. Svaret afgør Charge Type i Stripe og evt. et flueben om forudbetaling i kassen.
