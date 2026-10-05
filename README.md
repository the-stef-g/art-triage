# art-triage

art-triage is a macOS app for sorting and organising image files. It does not edit your images itself. Instead it sends files to your own editor apps (Luminar Neo, Topaz Photo AI, Gigapixel and others) and notices when you save. The app keeps track of an ordinary folder in Finder: your files stay where they are, and all catalogue data lives in a hidden `.art-triage` subfolder in the same place.

Built for Intel Mac (iMac 2019) on macOS Sequoia. Runs on newer versions too.

The app was called Billedflow until version 0.2.8. Libraries created back then keep their `.billedflow` folder and are picked up automatically, so no ratings are lost in the rename.

## Get the app

The app is built automatically by GitHub Actions on every push.

1. Open the repository on GitHub and click the **Actions** tab.
2. Pick the most recent green run of the **Build art-triage** workflow.
3. Under **Artifacts**, download **art-triage-mac-x64**.
4. Unzip it and drag **art-triage.app** to Applications.

## First launch on macOS Sequoia

The app is not signed with an Apple developer certificate, so macOS refuses the first time.

1. Double-click art-triage. macOS shows a warning. Click **Close**.
2. Open **System Settings > Privacy & Security**.
3. Scroll down to the message about art-triage and click **Open Anyway**.
4. Confirm. You only have to do this once.

## Using the app

**Library.** Click "Choose image folder" and point at the folder your images live in. art-triage scans the folder and every subfolder and builds previews of JPEG, TIFF, PNG, RAW (CR2, CR3, NEF, ARW, DNG and more), PSD, HEIC, SVG and AI files. You can reopen the folder at any time from the welcome screen.

**New files and external drives.** If your library sits on an external drive, macOS rarely tells the app that new files have arrived. That is why art-triage goes through the folder itself at regular intervals, and you can always click "Scan again" in the toolbar to do it right now. If you unplug the drive while the app is running, the status bar says the drive is not connected and the catalogue is left untouched: ratings, series and virtual copies wait for you until the drive is back.

**Rating.** Every image is approved, a candidate, discarded or unrated. The three decided states are a traffic light: green ✓ approved, yellow ? candidate, red ✕ discarded. The badge in the corner of the image is the whole marking; there is no coloured frame around the picture, because a badge is enough to catch the eye and a frame under every image was noise. Discarded images are hidden by default; the Discarded chip in the toolbar shows them.

**Workflow stage.** Separately from the rating, an image sits at one stage: being edited, finished, or neither. It is one at a time, not two switches. An image cannot be out with an editor and finished at the same time, so setting one clears the other. Saving from an editor puts the image back on "being edited", because a new version means the work is not over.

**The action buttons are in the toolbar**, between the sort order and New folder, each with its key on it: **A** approve, **C** candidate, **X** discard, **U** unrated, **E** being edited, **F** finished, **V** virtual copy. Click them or press the key, it is the same thing. They used to be a list in the Inspector, which showed only when nothing was selected, so they were out of sight exactly when there was something to use them on. **Space** (large preview) and **Cmd+Z** (undo) have no button; they sit in the fingers already. Also: **Cmd+A** selects all, **Shift+Cmd+Z** redoes. Pressing **E** or **F** on an image already at that stage clears it.

**Selection and the active image are two different things**, as in Lightroom. Several images can be selected while one of them is the active image: the one you are standing on, the one the Inspector shows, and the one the arrows move. The active image has a full blue border and a lighter background; the rest of the selection has a dimmed border.

**Rating and workflow stage apply to the active image only**, even with several selected. They are a judgement about one picture, made while you look at it, so a single keystroke should never change twenty images you have not looked at. What applies to the whole selection is the batch work: dragging to a folder, setting a series, and removing a keyword. Those sit in their own block at the top of the Inspector when more than one image is selected.

**Selecting several.** Shift-click picks a range, cmd-click adds or removes one, and **Shift+arrow** extends the selection from the keyboard. **Escape** leaves multi-select and keeps the active image, so the arrows carry on from there; a second Escape clears the selection. While the large preview is open, Escape closes that instead and leaves the selection alone.

**The arrows never break a selection.** With several images selected, they move the active image around inside the selection and wrap there. With one or none selected, they move through the whole grid and take the selection along, wrapping at the ends: right arrow on the last image lands on the first. Shift+arrow stops at the ends rather than wrapping, since wrapping while extending would suddenly select the whole library.

Tab does not move focus around the interface. The work is done with the mouse and these letters, and a wandering focus made it unclear what the next key would hit. Tab still works inside text fields.

**The filter chips are views, one at a time.** Approved, Candidates, Being edited, Finished and Discarded are five ways of looking at the library, and clicking one turns off the others. Clicking the active one goes back to showing everything.

**The large preview stays inside the middle column.** Space fills the grid area, not the window, so the sidebar and the Inspector stay where they are and you can see series, keywords and rating while looking at the picture full size. Space again or Escape closes it.

**Candidate.** Use candidate when the subject is good but something technical is in the way: softness, wrong colours and the like. It is not a verdict but a decision on hold until the image has been through the editor. Candidate is the yellow light in the middle: a question mark, not a verdict. The Candidates chip in the toolbar is the work list of what is waiting for a round in the editor. They show up as ordinary images in the grid, unlike discarded ones. Once you have fixed the image you rate it again: approved or discarded. Candidates are never sent for paid analysis, precisely because they are not settled yet.

**Virtual copies.** "New virtual copy" creates an extra version of the same subject, for instance for a different crop. The copy takes up no space on disk until you send it off for editing. At that moment art-triage makes a physical copy next to the original and opens it in your editor.

**Edit in.** Pick an app in the Inspector and click Open. art-triage finds Luminar Neo, Topaz Photo AI, Gigapixel, Photoshop, Affinity Photo and Pixelmator Pro in Applications on its own, and you can always choose a different app. When you save in the editor, art-triage notices the change, marks the version as being edited and refreshes the preview. If the editor saves a new file next to the original (for example `IMG_1234-gigapixel.tif`), it is stacked automatically as a version of the same image.

**Folders.** The folder tree on the left shows the whole library. "New folder" creates a folder, and you can drag images from the grid onto a folder to move the files on disk. "Clean up" moves every file whose versions are all discarded into the `_kasseret` folder.

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

**Locked until the format is checked.** Before the first product is sent, use Check shop format. It fetches product 20 (Desert Canyon 04) from the shop and saves it as `reference-product-20.json` next to the catalogue, so the ACPT field format, including the hidden helper fields, is copied from the real thing and not guessed.

## The local AI model

The semantic search runs 100% locally on your Mac using Google's multilingual SigLIP model. The first time the app starts it downloads the model (about 250 MB) from Hugging Face and stores it locally. After that, analysis and search work without internet. The status bar at the bottom shows progress for both the download and the indexing. A large collection takes a while the first time; search works along the way on the images that have already been analysed.

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

Catalogue data per library lives in `.art-triage/katalog.sqlite`, previews in `.art-triage/cache/`. Delete the `.art-triage` folder and the catalogue is rebuilt on the next open, but ratings, series and virtual copies are lost.

Code comments, internal identifiers and the database values (`godkendt`, `kasseret`, `kandidat`, `ubedomt`) are still in Danish on purpose. Translating the stored rating values would mean migrating every existing catalogue for no gain the user can see.

## Checklist for the first test on your iMac

1. Open the app and choose a folder with a mix of RAW, JPEG and PSD.
2. Check that previews appear for all of it, including RAW and PSD.
3. Approve a couple of images with G and discard one with X. Quit the app, open it again and see that it is remembered.
4. Make a virtual copy with V, select the copy and click Open in Gigapixel. Check that a new physical copy sits next to the original.
5. Save from the editor and see that the version is marked as being edited, and that the preview updates.
6. Wait until the status bar says the analysis is done, then search for something you know is in the images, for example "yellow flowers".
7. Drag an image to another folder in the sidebar and check in Finder that the file has moved.

## Checklist for works and the shop

Without keys, steps 1 to 9 work. Steps 10 to 14 need the two shop keys.

1. Open an image, scroll to the Work panel and check that the title field shows the file name as a placeholder and the year shows the capture year of the original.
2. Type a year, click away, select another image and come back. The year is still there. Clear it and the capture year returns.
3. Choose a category. For Paintings or Sculptures, Dimensions and Price appear; for the others they do not.
4. Make two virtual copies. Under Crops give one the format 2:3 and the other 1:1. Give the second one 2:3 as well: the first one loses it.
5. Type a section colour that is not a colour. You get an error and the field goes back to what was saved.
6. Click Write texts on an image that is not approved and finished: the button is disabled and says why.
7. Approve and finish the image, add notes, click Write texts. The three texts appear, the cost shows in the status bar, and the word and character counts are right.
8. Edit the description, then click Write texts again. The app asks before it replaces your text. Say no and your text is kept.
9. Look for dashes, "stunning", "unique" and mentions of AI or Photoshop in the texts. Any that slipped through show as a warning under the button.
10. Add the WooCommerce key under Help. Send to shop is still locked; the button says Check shop format.
11. Click Check shop format. A message names the file it wrote. Send me that file.
12. Add the WordPress application password under Help, then click Send to shop on a finished work. In WooCommerce you find a draft product with the right title, texts, image and category.
13. Change a text in the app and send again. The same product is updated, with no second one next to it. Change a text in WooCommerce and send again: the app's text wins.
14. Click Publish and check the product goes live.

