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

**Rating and status.** Every image can be approved, a candidate, discarded or unrated, and carries the flags being edited and finished. Discarded images are hidden by default and can be shown again with "Show discarded". Shortcuts: **G** approve, **K** candidate, **X** discard, **U** clear rating, **R** being edited on/off, **F** finished on/off, **V** new virtual copy, **space** large preview, **arrow keys** move the selection, **Cmd+Z** undo the last action (rating, flag, series, rename, virtual copy and move), **Shift+Cmd+Z** redo.

**Candidate.** Use candidate when the subject is good but something technical is in the way: softness, wrong colours and the like. It is not a verdict but a decision on hold until the image has been through the editor. Candidates have their own purple colour in the grid and their own entry in the sidebar, where the list of what is waiting opens with one click. They show up as ordinary images in the grid, unlike discarded ones. Once you have fixed the image you rate it again: approved or discarded. Candidates are never sent for paid analysis, precisely because they are not settled yet.

**Virtual copies.** "New virtual copy" creates an extra version of the same subject, for instance for a different crop. The copy takes up no space on disk until you send it off for editing. At that moment art-triage makes a physical copy next to the original and opens it in your editor.

**Edit in.** Pick an app in the Inspector and click Open. art-triage finds Luminar Neo, Topaz Photo AI, Gigapixel, Photoshop, Affinity Photo and Pixelmator Pro in Applications on its own, and you can always choose a different app. When you save in the editor, art-triage notices the change, marks the version as being edited and refreshes the preview. If the editor saves a new file next to the original (for example `IMG_1234-gigapixel.tif`), it is stacked automatically as a version of the same image.

**Folders.** The folder tree on the left shows the whole library. "New folder" creates a folder, and you can drag images from the grid onto a folder to move the files on disk. "Clean up" moves every file whose versions are all discarded into the `_kasseret` folder.

**Series.** Select one or more images and pick "New series" or an existing series in the Inspector. Click a series in the sidebar to see only its images. Hover a series in the sidebar and two buttons appear: the pencil renames it, the bin deletes it. Deleting a series does not touch the images, they only lose their link to it.

**The sidebar is navigation.** Folders, the candidate list, series and keywords are four views, and there is one at a time. Click somewhere new and you go straight there, without having to click your way out of the previous one first.

**Search.** Type for example "yellow flowers" in the search field and art-triage finds the images from the picture content itself. It needs no keywords: the app analyses every image in the background. Only images that clearly match are shown; a search with no real matches honestly returns nothing. The number next to a keyword in the sidebar matches how many images a click will show.

**Keywords.** The app does not guess keywords. It used to, by scoring each image against a Danish word list, but that comparison was the wrong way round: words were held up against each other image by image, so a phrasing that generally scored high won on everything. In practice 'kirke' ended up on 1170 out of 1200 images. That mechanism is gone, and the old guesses are cleared automatically the first time you open the library. Your own words stay.

You can add your own keywords to an image in the Inspector, and they appear as clickable chips in the sidebar. Click a keyword and the grid shows every image with that word. Select the ones that do not belong (click, cmd-click or shift-click for several) and remove them from the keyword with the button in the Inspector. The cross on the chip in the sidebar removes the word from every image at once, including ones you typed yourself, and it cannot be undone.

Automatic keywords will come back when Claude makes them instead. That is point 3 in `docs/plan-cloud-noegleord.md`. Until then the semantic search works as before and for free, because it is built on the image analysis rather than on keywords.

## The AI model

Image analysis runs 100% locally on your Mac using Google's multilingual SigLIP model. The first time the app starts it downloads the model (about 250 MB) from Hugging Face and stores it locally. After that, analysis and search work without internet. The status bar at the bottom shows progress for both the download and the indexing. A large collection takes a while the first time; search works along the way on the images that have already been analysed.

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
