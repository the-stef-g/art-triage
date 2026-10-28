# Stef G Art

Stef G Art is a macOS app for sorting and organising image files. It does not edit your images itself. Instead it sends files to your own editor apps (Luminar Neo, Topaz Photo AI, Gigapixel and others) and notices when you save. The app keeps track of an ordinary folder in Finder: your files stay where they are, and all catalogue data lives in a hidden `.art-triage` subfolder in the same place.

Built for Intel Mac (iMac 2019) on macOS Sequoia. Runs on newer versions too.

The app was called Art Triage until version 0.10.0, and Billedflow until 0.2.8. On the first start of Stef G Art your settings, keys and the downloaded model are copied over from the old Art Triage folder in `~/Library/Application Support`, which is left untouched. The repository and the hidden `.art-triage` data folder keep their names.

Libraries created in the Billedflow days keep their `.billedflow` folder and are picked up automatically, so no ratings are lost in the rename.

## Get the app

The app is built automatically by GitHub Actions on every push and published as a GitHub Release, one per version.

1. Open the repository on GitHub and click **Releases** in the right-hand column.
2. The newest version on main is marked **Latest**. A build from a work branch is a **Pre-release**, for trying out before it is merged.
3. Download **Stef-G-Art-<version>-mac-x64.zip**.
4. Unzip it and drag **Stef G Art.app** to Applications.

Releases do not count against the storage quota for Actions artifacts, which old builds used to fill up. When a version is merged into main without code changes since its branch build, main does not build the Mac app again: it turns the branch's pre-release into the latest release, which takes seconds instead of a wait for a Mac at GitHub.

## First launch on macOS Sequoia

The app is not signed with an Apple developer certificate, so macOS refuses the first time.

1. Double-click art-triage. macOS shows a warning. Click **Close**.
2. Open **System Settings > Privacy & Security**.
3. Scroll down to the message about art-triage and click **Open Anyway**.
4. Confirm. You only have to do this once.

## Using the app

**Library.** Click "Choose image folder" and point at the folder your images live in. art-triage scans the folder and every subfolder and builds previews of JPEG, TIFF, PNG, RAW (CR2, CR3, NEF, ARW, DNG and more), PSD, HEIC, SVG and AI files. You can reopen the folder at any time from the welcome screen.

**New files and external drives.** If your library sits on an external drive, macOS rarely tells the app that new files have arrived. That is why art-triage goes through the folder itself at regular intervals, and you can always click "Scan again" in the toolbar to do it right now. If you unplug the drive while the app is running, the status bar says the drive is not connected and the catalogue is left untouched: ratings, series and virtual copies wait for you until the drive is back.

**Five phases.** The work goes in five phases, shown as tabs at the top: **1 Sort**, **2 Edit**, **3 Product**, **4 Crops** and **5 Print**. You are in one at a time, and each phase shows only its own images and only the tools it needs, in the toolbar, the sidebar and the right-hand column. **Cmd+1** to **Cmd+5** switch phase, and the app opens in the phase you left. The number on a tab is how many are waiting there. A phase is not a status you set: it follows from where the files are.

- **1 Sort**: everything not Approved yet (Import and Candidate). Rate with A, C, X and U. The sidebar has the folders. At the bottom, a **filmstrip** shows every image in Import, subfolders included, in the order they were shot (from the camera's capture time, or the file date if there is none), so a burst can be seen as it was taken. Candidates stay in it after they move to `Candidate`, and discarded images are in it when Discarded is shown. It stays visible under the large preview (Space). Clicking an image from another folder shows it in the grid. A library without an Import folder shows the images in the active image's own folder.
- **2 Edit**: Approved works without a master: the original and the edits. The sidebar has the work folders, so a click shows one work's files. Once a work has a master, it and its edits leave Edit. Send a copy to *Luminar Neo*, *Topaz Photo AI* or *Photoshop*: the copy goes in the work's `Edits` folder with the program's ending (`Desert-neo.cr2`, `Desert-tp.tif`, `Desert-ps.psd`) and opens in the program; save your result in `Edits` too. Sending a copy of an edit adds the next ending (`Desert-neo-tp.tif`). **Make master** is the last step: the selected file is copied to `Master`, named after the work, and the work moves on to Product. The name drops the endings editors and you add: if the edit's name begins with the work's name, the master is simply called that (`IMG_1234-Denoise-paint.tif` becomes `IMG_1234.tif`); otherwise known endings such as -neo, -tp, -ps, -denoise, -sharpen, -paint, -sketch, -pano and -edit are removed from the end, in upper or lower case and with or without the hyphen (`Desert Canyon Sketch_PS.tif` becomes `Desert Canyon.tif`). TIFF, JPEG and PNG are copied as they are; a PSD or another format is turned into a flat TIFF with `sips` on macOS, keeping bit depth and colour profile. A RAW file is not an edit and cannot be the master. **Discard work** (X) sends the original to `Discarded` and the files in `Edits` to the Trash. A work that has a master cannot be discarded.
- **3 Product**: one tile per work with a master. Series, the product texts and the shop, and keywords. When a new file lands in a work's `Master` (with Make master or in Finder), the template is set from the master's shape (landscape is *spread*, portrait and square are *poster*), and with a Claude API key Claude writes the description, short text and alt text, picks a section colour that sets the subject off (unless you chose one), and the master gets its keywords. Only files in `Master` get keywords; originals and edits never do. Whether a work is offered as prints is not a choice: every work is, except Paintings and Sculptures, which are sold as the original. Works whose title ends in a number (`Desert Canyon 01`, `Desert Canyon 02`) are put in the series named by the rest of the title (`Desert Canyon`) after each scan, if they have no series yet; a series you chose yourself is never changed, and camera names like `IMG_1234` never make a series. A master that was there before this, and has no texts yet, gets the same the first time you look at it in Product; opening a library never sends a pile of works to Claude. Masters without keywords get them when the library opens. A Master file does not show the Approved and Finished marks, since every master is both.
- **4 Crops**: the masters and their crops, each crop a file of its own in `Master`.
- **5 Print**: the crops in `Master` and their enlargements in `Edits`. First the enlargement: select a crop, and *Enlarge in Gigapixel* copies it to the work's `Edits` with `-giga` in its name (`Desert 2-3-giga.tif`) and opens it in Topaz Gigapixel AI; save the enlargement over it, or next to it with a name that starts the same way (`Desert 2-3-giga-gigapixel-4x.tif`). A work only sold in its own shape gets a crop in that format, so there is always a crop to enlarge. The `-giga` files are shown next to the crops. Select one and *Make print file* writes a print file for Prodigi to the work's `Print files` folder from exactly that file (the crop itself has no print button; if the `-giga` file is no larger than the crop, the app says it is not enlarged yet): a PNG named after the crop with its format, always (`Desert 2-3.png`), exactly in that format (a file a pixel or two off after the enlargement is trimmed in the middle; one more than 1% off is refused), in full resolution, 8 bit, converted to sRGB from the colour profile in the file and marked 300 DPI. With several `-giga` files selected, it makes one for each. Making it again replaces the old one, and the master is never touched. A tile with a print file has a *Print* label. Prodigi asks for RGB files and says its own ICC profiles are for proofing only and must not be embedded, so they are not used here. The canvas edge is chosen on Prodigi's site.

**Rating.** Every image is approved, a candidate, discarded or unrated. The three decided states are a traffic light: green ✓ approved, yellow ? candidate, red ✕ discarded. The badge in the corner of the image is the whole marking; there is no coloured frame around the picture, because a badge is enough to catch the eye and a frame under every image was noise. Discarded images are hidden by default; the Discarded chip in the toolbar shows them.

**Edits.** Only Approved images have Edits and versions; an image that is not Approved has neither, and no rating means nothing here. The Edits status is the name of the program an image was edited in, such as *Luminar Neo*, *Topaz Photo AI* or *Photoshop*, which are always there to pick. The names come from the editors the app knows (the ones it finds in Applications and any you add with "Other app"). The app never makes up a status of its own. A file whose name ends in `-neo`, `-tp` or `-ps` in `Edits` gets that program as status from the name, and you can also set or clear the status by hand with the program buttons. *Finished* is separate: a file in `Master` sets it.

**The action buttons are in the toolbar**, between the sort order and New folder, each with its key on it. In Sort: **A** approve, **C** candidate, **X** discard, **U** unrated. In Edit: **X** discard work (it asks first). Click them or press the key, it is the same thing. They used to be a list in the Inspector, which showed only when nothing was selected, so they were out of sight exactly when there was something to use them on. **Space** (large preview) and **Cmd+Z** (undo) have no button; they sit in the fingers already. Also: **Cmd+A** selects all, **Shift+Cmd+Z** redoes.

**Selection and the active image are two different things**, as in Lightroom. Several images can be selected while one of them is the active image: the one you are standing on, the one the Inspector shows, and the one the arrows move. The active image has a full blue border and a lighter background; the rest of the selection has a dimmed border.

**Rating and workflow stage apply to the active image only**, even with several selected. They are a judgement about one picture, made while you look at it, so a single keystroke should never change twenty images you have not looked at. What applies to the whole selection is the batch work: dragging to a folder, setting a series, and removing a keyword. Those sit in their own block at the top of the Inspector when more than one image is selected.

**Selecting several.** Shift-click picks a range, cmd-click adds or removes one, and **Shift+arrow** extends the selection from the keyboard. **Escape** leaves multi-select and keeps the active image, so the arrows carry on from there; a second Escape clears the selection. While the large preview is open, Escape closes that instead and leaves the selection alone.

**The arrows never break a selection.** With several images selected, they move the active image around inside the selection and wrap there. With one or none selected, they move through the whole grid and take the selection along, wrapping at the ends: right arrow on the last image lands on the first. Shift+arrow stops at the ends rather than wrapping, since wrapping while extending would suddenly select the whole library.

Tab does not move focus around the interface. The work is done with the mouse and these letters, and a wandering focus made it unclear what the next key would hit. Tab still works inside text fields.

**The filter chips are views, one at a time.** In Sort, Candidates and Discarded are two ways of looking at the images, and clicking one turns off the other. Clicking the active one goes back to showing everything. Approved, Edits and Finished are phases now, not chips.

**The large preview stays inside the middle column.** Space fills the grid area, not the window, so the sidebar and the Inspector stay where they are and you can see series, keywords and rating while looking at the picture full size. Space again or Escape closes it.

**Candidate.** Use candidate when the subject is good but something technical is in the way: softness, wrong colours and the like. It is not a verdict but a decision on hold until the image has been through the editor. Candidate is the yellow light in the middle: a question mark, not a verdict. The Candidates chip in the toolbar is the work list of what is waiting for a round in the editor. They show up as ordinary images in the grid, unlike discarded ones. Once you have fixed the image you rate it again: approved or discarded. Candidates are never sent for paid analysis, precisely because they are not settled yet.

**Virtual copies.** "New virtual copy" creates an extra version of the same subject, for instance for a different crop. The copy takes up no space on disk until you send it off for editing. At that moment art-triage makes a physical copy next to the original and opens it in your editor.

**Edit in.** Pick an app in the Inspector and click Open. art-triage finds Luminar Neo, Topaz Photo AI, Gigapixel, Photoshop, Affinity Photo and Pixelmator Pro in Applications on its own, and you can always choose a different app. When you save in the editor, art-triage notices the change, refreshes the preview and, for an Approved image, gives it the program's name as Edits status. If the editor saves a new file next to the original (for example `IMG_1234-gigapixel.tif`), it is stacked automatically as a version of the same image.

**Folders follow the rating.** The rating decides where a file lives, inside the library folder:

```
Import/                 not rated yet
Candidate/              Candidate
Discarded/              Discarded
Approved/<file name>/   one work folder per approved image
    Original/          the original file, moved here when you approve it
    Edits/              every edited version (there can be several)
    Master/            the finished master file
    Print files/        production files with colour profiles for each print medium
```

Rating a file Candidate moves it into `Candidate`, and the sub-folder it came from is kept. Discarded works differently, to keep the archive easy to read: the file goes to `Discarded` in the library root, into a single folder named after the folder it came from (for an approved work, the name of the work). `Ahl Strand/Strand 2/x.cr2` ends up in `Discarded/Strand 2/`. Clear moves it back to Import, but only if it was in one of these folders; an unrated file that lives somewhere else stays where it is. Approving creates the work folder with all four folders and moves the original into `Original`. Only the original is moved. Undo moves it back.

**The work folders are called `Original` and `Master`.** Until 0.16 they were `Originals` and `Masters`; the app renames them the first time it opens the library and keeps ratings, series and texts with the files.

**Pick the Stef G Art folder, not Import.** Choose the folder that holds `Import`, `Approved`, `Candidate` and `Discarded`. When it has a folder named Import (a name with a space in front, ` Import`, works too and sorts first), the app reads only that folder and the three rated folders, and leaves everything else in the folder alone, such as `SoMe`. Unrated files live in Import, so a file you clear goes back there. A folder without an Import is read in full, as before. If you rename or move the folder, it disappears from the recent list; choose it again.

**Crops.** A crop is a label on a file in `Master`, like *Master*, and it is also in the file name: `Desert Canyon 01 2-3.tif` is the 2:3 crop. The file name is the truth. Add ` 2-3` (a space and 1-1, 2-3, 3-2, 1-2 or 2-1) to a name in Finder and the app gives the file the right label after the next scan; remove it and the label goes. The *Crops* section in the right-hand column, between Edits and Work folder, works like Rating: click 1:1, 2:3, 3:2, 1:2 or 2:1 to give the selected master that crop, which renames the file, and click it again or *Clear* to remove it. The buttons are greyed out for files that are not in `Master`. Crops also decide which files the shop gets: the first file with each format is sent as that crop.

**Making a crop in the app.** Click *Crop master …* under Crops. It crops the work's file in `Master`, and is greyed out until there is one. Choose a format (1:1, 2:3, 3:2, 1:2 or 2:1), move and resize the frame, and click *Save crop*. The crop is exact to the pixel: a 2:3 crop is always width × 3 = height × 2. There is no free crop, since crops are for print. The crop is saved as a **new file in Master**, named after the master and the format; the master itself is never changed. Only finished works can be cropped, meaning only files in `Master`. On macOS the crop is made with `sips`, which keeps the bit depth and the colour profile (16 bit TIFF stays 16 bit). If `sips` cannot do it, the app falls back to a built-in tool that writes 8 bit TIFF, and tells you so. The Versions section is gone: versions are the files in `Edits` and `Master`.

**Edits follow the work folder.** Any file saved in `Edits` or `Master` is added as a version of the original, whatever it is called, but only for Approved images. A file in `Edits` marks the image, and its original, as having Edits. If the app knows which program the image was last opened in, that program's name is the status (Luminar Neo, Topaz Photo AI ...); if not, the badge just says *Edits*, and you can click a program under Edits in the right-hand column to note which one. With several images selected, it is set on all the selected Approved images at once. The app never makes up a name. A file in `Master` is called *Master* and marks the work as *Finished*. Nothing here applies to images that are not Approved, and new files are no longer stacked as versions of an image that is not Approved. The *Show in Finder* button under Work folder opens the work's folder, which holds `Original`, `Edits`, `Master` and `Print files`. The `Print files` folder is not scanned.

Empty folders in Import are deleted after a scan, also when you moved the files out in Finder, once they have been untouched for ten minutes (so a folder you just made with New folder survives). An Import folder that becomes empty when the app moves its last file out is deleted straight away (a `.DS_Store` does not count), together with any parent folders that become empty, but never Import itself. "Clean up" also removes empty folders that were already there. Nothing is moved until you change a rating, so existing files stay where they are. "Clean up" moves every file whose versions are all discarded into `Discarded`, by the same rule.

**Series.** Select one or more images and pick "New series" or an existing series in the Inspector. Click a series in the sidebar to see only its images. Hover a series in the sidebar and two buttons appear: the pencil renames it, the bin deletes it. Deleting a series does not touch the images, they only lose their link to it.

**The sidebar is navigation.** Folders, series and keywords are three views, and there is one at a time. Click somewhere new and you go straight there, without having to click your way out of the previous one first.

**Every folder shows how far it has come**, in the same traffic-light colours: green approved, yellow candidates, red discarded, grey unrated. The colours keep the numbers apart, so they are simply spaced rather than divided by rules. Zeroes are left out so the row does not fill with numbers that say nothing. The counts include subfolders and count versions rather than files, so a number matches exactly what you see when you click the folder.

**The slider in the status bar sets how many images stand across the grid**, from 3 to 10. The tiles fill the whole width between the two columns, and the image area grows with them, so there is never a strip of bare background along the right edge. The setting is remembered between sessions.

**Search.** Type for example "yellow flowers" in the search field and art-triage finds the images from the picture content itself. It needs no keywords: the app analyses every image in the background. Only images that clearly match are shown; a search with no real matches honestly returns nothing. The number next to a keyword in the sidebar matches how many images a click will show.

**Keywords.** Keywords come from Claude. The app used to guess them itself by scoring each image against a Danish word list, but that comparison was the wrong way round: words were held up against each other image by image, so a phrasing that generally scored high won on everything. In practice 'kirke' ended up on 1170 out of 1200 images. That mechanism is gone, and the old guesses are cleared automatically the first time you open the library. Your own words stay.

You can add your own keywords to an image in the Inspector, and they appear as clickable chips in the sidebar. The chips are listed alphabetically so a word is easy to find. If the list ever has to be cut, it drops the rarest words rather than the end of the alphabet, which would make everything from S onwards vanish without warning.

**Cleaning up a wrong keyword.** Click the keyword in the sidebar and the grid shows every image carrying it. Select the ones it is wrong for, or press Cmd+A for all of them, then click the cross on the chip. The word is removed from exactly those images and from nowhere else. It is not blacklisted: the same word is free to come back on other images, and on these too if it fits later. Earlier every deletion was also stored as a permanent rejection, which made a tidy-up irreversible without saying so anywhere.

## Keywords from Claude

**Only approved images are sent.** Candidates, discarded and unrated images never leave the machine. A candidate has not been decided yet, and there is no reason to pay for an image that may end up discarded. The rule lives in the catalogue query that builds the queue, so there is no way round it from the interface.

**Getting started.** Create an API key at `console.anthropic.com` — that is a separate pay-as-you-go account from a Claude Pro subscription, which does not cover programmatic API use. Add money under Billing and set a spending limit while you are there. Then paste the key into Help > Claude API key. The key is stored in the app's settings and is never shown again, never written to the log and never sent to the interface.

**Running it.** The Keywords section in the sidebar says how many approved images are waiting. Click Analyse and it works through them one at a time while you carry on. Progress and the running dollar amount show in the status bar, so you can see what it costs while it happens rather than on the bill. Stop halts it; nothing already done is lost, and the rest is still queued next time.

**Model.** Haiku 4.5 is the default and the cheapest. Sonnet 5 and Opus 5 write more precise keywords and cost roughly three and five times as much. The picker sits next to the Analyse button. "Analyse everything again" clears the receipts so the whole approved set runs once more, which is what you want after changing model. Old words stay until they are overwritten.

**What is written.** Claude's words go in as automatic keywords (`manual=0`), so they can be cleared as a group without touching anything you typed yourself. Your own words always sort first in the Inspector.

**Single words, and few of them.** Keywords are single words: not "blue paint" but "blue" and "paint", not "brick wall" but "brick" and "wall". A single word can be reused across thousands of images; a phrase cannot, and a catalogue of white paint, black paint and blue paint fills up with words that each point at a handful of pictures. Five to eight words per image, in this order: what the thing is, what it is made of, and the dominant colours. No mood, no atmosphere, no light quality — nobody searches for "dramatic light". If Claude answers with a phrase anyway, it is split into its words on the way in.

**Words are reused.** Every run sends the catalogue's existing keywords along and asks Claude to use one of them when it fits, rather than a new word for the same thing. Without that it is "wall" on one image and "walls" on the next, and a click on the word no longer gathers them. Your own words come first in that list: they are the authority on what things are called here.

The fixed instruction and the word list are cached, so they are only paid for in full on the first image of a run. The list is fetched once per run and held constant, because changing it mid-run would break the cache and make every image cost full price. The image itself goes as a 512-pixel thumbnail, the same one the search index already made, not the full RAW.

## Works and the shop

The Work panel in the Inspector holds everything that belongs to one artwork: title, year, category, technique, series, template, section colour, catalogue number, video, print on/off, crops, dimensions and price (unique works only), your own notes and three texts. It is all saved in the catalogue, so it survives a restart and a rescan. The field list and the rules behind it are in `docs/plan-shop.md`.

**Texts are edited here only.** The shop at shop.stefg.art is a copy. Anything changed in WooCommerce is overwritten the next time the work is sent, and the panel says so.

**Defaults.** The title is the file name until you change it, and the year comes from the capture date in the original file (EXIF), not the file's own date. The catalogue number is the number at the end of the title until you type one. A file with no EXIF date leaves the year empty rather than guessing.

**Crops.** A crop is a version (a virtual copy) marked with its format: 1:1, 2:3, 3:2, 1:2 or 2:1. One version has at most one format, and one format points at one version.

**Write texts.** The button sends a 1024-pixel preview, the title, category, technique, series and your notes to Claude and gets a description, a short text and an alt text back in British English. It uses the same API key and model picker as the keywords, and the price shows in the status bar. Only approved, finished works can be written. If you have edited a text, the app asks before it replaces it. The rules Claude is given are in `electron/lib/workTexts.mjs`; a draft that breaks one (a cliché, a dash, the wrong length) is saved anyway but gets a warning under the button.

**Send to shop.** The button uploads the main image and every crop to the WordPress media library (JPEG, about 3000 px, never the print master, alt text set on each) and creates the product the first time and updates it after that. The WooCommerce product id is stored, so a work is never created twice. A file is only uploaded again when it has changed since last time. New products are drafts; Publish is a separate button. Stock, orders and print variants are never touched.

**Keys.** Two, stored like the Claude key: never shown again, never in the log, never sent to the interface.
- Help > WooCommerce key: a REST key with Read/Write permission, entered as `ck_… cs_…`.
- Help > WordPress application password: entered as `username:application password` (Users > Profile > Application Passwords).

**The field format.** The ACPT fields are written exactly as product 20 (Desert Canyon 04) has them: the value, `*_attachment_id` for images and video, the field's definition UUID in `*_id` and the field type in `*_type`. The reference is `docs/reference-product-20.json`, and a test checks that what Stef G Art writes is identical to it. Colour and catalogue number are only sent when you have filled them in: empty means the series colour and the number at the end of the title, which the site works out. Print on/off is sent as `1` or empty.

**The shop format is checked by itself.** When a library opens, and when the WooCommerce key is saved, the app fetches product 20 (Desert Canyon 04) and compares its fields with what Stef G Art writes. If they match, you hear nothing. If the fields have changed in WooCommerce, the status bar says so, the differences are listed under Shop, and Send to shop stays locked until a later check passes. If the shop cannot be reached, the last result stands.

**Product type and attributes.** A unique work (Paintings, Sculptures) is a simple product with stock 1. Every other work is a variable product, like product 20, and gets its print variants from the CSV later. Stef G Art only writes the attributes Year, Technique and Dimensions. When a product is updated, the print attributes (Format, Material, Frame, Size) are sent back unchanged, so the variants are not lost. Tax class is Reduced rate for sculptures and standard for everything else.

**Series.** The series is set on the product through `/wp-json/wp/v2/product/{id}` with `series`. If the shop has no term with that name, Stef G Art creates it with its three fields: intro, template (walkthrough or wall) and colour. They are edited in the Work panel under Shop. A new term always gets a template (walkthrough if you have not chosen one). A term that already exists only gets the fields you have filled in, and only if they differ. A work without a series leaves the product's series alone.

## The local AI model

The semantic search runs 100% locally on your Mac using Google's multilingual SigLIP model. The first time the app starts it downloads the model (about 250 MB) from Hugging Face and stores it locally. After that, analysis and search work without internet. The status bar at the bottom shows progress for both the download and the indexing. A large collection takes a while the first time; search works along the way on the images that have already been analysed.

**Start-up.** The image model and the search model load at the same time, each in its own hidden window. Indexing starts as soon as the image model is ready, which is about half a minute, and does not wait for the search model. On an older Intel Mac the search model takes up to five minutes to start, and search is only available when it is done; until then the status bar says `Preparing search model`. The log now has a line for every step with the time since the window started (`[ai text] tokenizeren er indlaest (efter 4.1 s)`), so it can be seen whether the time goes on fetching the files or on creating the session.

**Why it took five minutes.** The model files are served to the AI window by the main process. Without a `Content-Length` header, transformers.js reads a response with a buffer that is replaced by a new, larger one and copied in full for every chunk that arrives. That work grows with the square of the file size: the image model (about 90 MB) took 33 seconds and the search model (about 290 MB) five minutes, at every start. The log showed it as `Unable to determine content-length from response headers` for every file. The files are now served with `Content-Length`, and the previews smoke test checks that the header reaches the AI window. Measured in Electron with the same protocol handler: 50 MB took 18.7 s without the header and 1.2 s with it, 100 MB took 69.9 s and 1.2 s. Turning off graph optimisation for the search model was tried and made no difference (302 s and 324 s against 305 s), so that experiment is gone again.

If the AI misbehaves, there is a log file with all the details under Help > Show AI log. Send the contents and the fault can be pinned down precisely.

### If the model cannot be downloaded

All model downloads go through the app's own downloader, which tries huggingface.co first and then the public mirror hf-mirror.com, logs every response in the AI log and stores the files in a local cache so nothing is fetched twice. The text model is tried from several alternative repositories automatically if the primary one has disappeared. If you still hit Hugging Face's limits for anonymous downloads, create a free account on huggingface.co, go to Settings > Access Tokens, make a Read token, and paste it under Help > Hugging Face token. The token is stored only on your Mac and is only ever sent to huggingface.co, never to the mirror.

## Development

The source lives in this repository and is an Electron project with Vite and React.

    npm install        # install dependencies
    npm run dev        # dev server + Electron
    npm test           # unit tests (vitest)
    npm run build      # build the renderer into dist/
    npm run smoke      # UI smoke test of the built app
    npm run dist:mac   # builds art-triage-mac-x64.zip (requires macOS)

Previews of RAW files (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2 and the rest) come from the JPEG the camera embedded in the file, in the RAW file's own orientation. That needs no other program and is the fastest way. Only if the file has no usable embedded JPEG is the preview made by sips, then Quick Look, then sharp. Other images go sips, Quick Look, sharp. If a step fails, the real reason goes in the log (Help > Show AI log) as `preview sips (file.tif): …`, even when a later step saves the day. Write texts and Send to shop fall back to a preview already in the cache if a fresh one cannot be made. sharp is a regular dependency, unpacked from the asar (`asarUnpack`), and the build checks that the Intel binary is in the app. At startup the log says `sharp loaded` or `sharp could NOT be loaded` with the reason.

If a preview cannot be made, the tile shows the file type, the status bar says `N previews failed` with a Retry button, and Help > Retry failed previews does the same. The reason for each failure is in the log. sips and Quick Look are started at most three at a time, and a start that fails with `EBADF`, `EMFILE` or `EAGAIN` is tried again; the log line then also says how many files the app had open.

**Speed.** `npm run bench` builds a synthetic library of 15,000 images and times what the main process does per change (add `--sqljs` to time the fallback engine); `node scripts/bench-ui.mjs` times the user interface against a stub. Measured at 15,000 images, before and after: the keyword list 70 s to 0.06 s and the keyword queue 19 s to 4 ms (an `EXISTS` on `COALESCE(...)` that could use no index and read every version for every file), a first scan 10.9 s to 0.6 s (a `LIKE` over all files for every new file), and the indexing loop, which fetched the whole waiting list for every single image, from seconds per 200 files to milliseconds. A rescan no longer holds the main process: the folders, sizes and hashes are read asynchronously. The folder watcher is `fs.watch` with `recursive` (FSEvents on macOS, one watch for the whole tree) instead of chokidar, which opened one file handle per file. The log says which database engine is in use when a library is opened.

Catalogue data per library lives in `.art-triage/katalog.sqlite`, previews in `.art-triage/cache/`. Delete the `.art-triage` folder and the catalogue is rebuilt on the next open, but ratings, series and virtual copies are lost.

Code comments, internal identifiers and the database values (`godkendt`, `kasseret`, `kandidat`, `ubedomt`) are still in Danish on purpose. Translating the stored rating values would mean migrating every existing catalogue for no gain the user can see.

## Checklist for the first test on your iMac

1. Open the app and choose a folder with a mix of RAW, JPEG and PSD.
2. Check that previews appear for all of it, including RAW and PSD.
3. Approve a couple of images with G and discard one with X. Quit the app, open it again and see that it is remembered.
4. Make a virtual copy with V, select the copy and click Open in Gigapixel. Check that a new physical copy sits next to the original.
5. Open an Approved image in an editor, save the result in its `Edits` folder, and see that the version gets the program's name as status, and that the preview updates.
6. Wait until the status bar says the analysis is done, then search for something you know is in the images, for example "yellow flowers".
7. Drag an image to another folder in the sidebar and check in Finder that the file has moved.

## Checklist for works and the shop

Without keys, steps 1 to 9 work. Steps 10 to 16 need the two shop keys.

1. Open an image, scroll to the Work panel and check that the title field shows the file name as a placeholder and the year shows the capture year of the original.
2. Type a year, click away, select another image and come back. The year is still there. Clear it and the capture year returns.
3. Choose a category. For Paintings or Sculptures, Dimensions and Price appear; for the others they do not.
4. Make two virtual copies. Under Crops give one the format 2:3 and the other 1:1. Give the second one 2:3 as well: the first one loses it.
5. Type a section colour that is not a colour. You get an error and the field goes back to what was saved.
6. Click Write texts on an image that is not approved and finished: the button is disabled and says why.
7. Approve and finish the image, add notes, click Write texts. The three texts appear, the cost shows in the status bar, and the word and character counts are right.
8. Edit the description, then click Write texts again. The app asks before it replaces your text. Say no and your text is kept.
9. Look for dashes, "stunning", "unique" and mentions of AI or Photoshop in the texts. Any that slipped through show as a warning under the button.
10. Add the WooCommerce key under Help. The format check runs by itself; the status bar only says something if the format differs.
11. Add the WordPress application password under Help. Put the image in a series, fill in intro, template and colour, and click Send to shop. In WooCommerce there is a draft product with the right title, texts, image, category, attributes and the series, and the series term has its three fields.
12. Open the draft in WooCommerce and check that the fields under Work show the values (template, crops with their images, print on/off) and not empty boxes.
13. Change a text in the app and send again. The same product is updated, with no second one next to it. Change a text in WooCommerce and send again: the app's text wins.
14. Send a work that is already a product with print variants (Desert Canyon 04 is a good one to try on a copy): Format, Material, Frame and Size are still there afterwards, and so are the variants.
15. Send a work in a series that already exists in the shop. No second series is created, and fields you left empty in the app are left alone in the shop.
16. Click Publish and check the product goes live.
