# 📸 <vroonphoto> — Cross-Platform WASM Fotobewerker

**vroonphoto** is een geavanceerd, hardware-versneld fotobewerkingsprogramma dat volledig in de browser draait via **WebAssembly (WASM)**. Het is ontworpen als een professioneel alternatief voor Adobe Lightroom, Topaz Labs en Adobe Firefly, met bijzondere aandacht voor **rood licht herstel**, **geavanceerde ruisonderdrukking**, **knallend zwart-wit** en **AI super-resolution vergroten**.

Alle berekeningen vinden 100% lokaal plaats op jouw apparaat via WebAssembly. Je foto's worden nooit naar een externe server verstuurd.

---

## 🌟 Belangrijkste Functies

### 1. 🔴 Rood Licht & Kleurdoorloop Herstel (Stage & Concert Fix)
*Specifiek ontworpen voor het beruchte probleem van overbelicht rood podiumlicht en felle LED-lampen.*
- **Detail Reconstructie:** Wanneer het rode sensorkanaal clipt ($R = 255$), bevatten het groene en blauwe kanaal vaak nog haarscherpe details. Ons WASM-algoritme synthetiseert ontbrekende textuur uit de groene/blauwe luminantie en herstelt verloren gelaatstrekken, microfoons en kledingplooien.
- **Bleed & Doorloop Reductie:** Trekt uitwaaierende rode halos langs randen terug naar de lichtbron.
- **Huidskleur Bescherming:** Herkent menselijke huidskleurverhoudingen en voorkomt dat gezichten een vlakke oranje of magenta waas worden.
- **Extreme Kleuren Gamut Compressie:** Comprimeert oversaturatie geleidelijk naar het natuurlijke sRGB-spectrum.

### 2. 🛡️ Geavanceerde Dual-Engine Ruisonderdrukking
- **Luminantie Ruisonderdrukking:** Hardware-versnelde bilaterale filtering die ruiskorrels gladstrijkt, maar randen, ogen en haren vlijmscherp houdt.
- **Chroma / Kleurruis Onderdrukking:** Elimineert paarse, rode en groene spikkels in de YCbCr-kleurruimte (typisch voor hoge ISO nachtopnames) zonder verlies van scherpte.
- **Detailbehoud:** Instelbare drempelwaarde om microtextuur intact te laten.

### 3. ⚡ Knallend Zwart-Wit Engine
*Voor zwart-wit bewerkingen die echt van het scherm knallen.*
- **6-Kanaals Filter Mixer:** Regel individueel de invloed van Rood, Oranje, Geel, Groen, Aqua en Blauw (zoals fysieke kleurfilters op analoge Leica/Hasselblad camera's).
- **Ansel Adams Zone System Contrast:** Trekt diepe, fluweelzwarte schaduwen naar beneden en laat speculaire hooglichten glinsteren zonder modderige grijstinten.
- **Micro-Contrast Punch (Clarity):** Benadrukt lokale structuren, wolken en texturen.
- **Analoge Filmkorrel:** Fysisch gemodelleerde zilverbromide korrel, natuurlijk geconcentreerd in de middentonen.
- **1-Klik Presets:** *Knallend Contrast*, *Ansel Adams*, *Film Noir*, *Straatfotografie*, *Vintage Silver*.

### 4. 🚀 Topaz Labs Super-Resolution (Foto's Vergroten)
- **2x en 4x Vergroten:** Vergroot afbeeldingen met edge-directed gradient interpolatie.
- **Randscherpte:** Voorkomt blokkerige pixels en kartelranden (anti-aliasing).
- **Unsharp Texture Boost:** Herstelt fijne details bij extreme resolutievergroting.

### 5. 🪄 Adobe Firefly Smart Retouch & Inpainting
- **Interactief Penseel:** Schilder direct over oneffenheden, vlekken, storende objecten of kabels.
- **Contextuele Textuursynthese:** WASM-patchdiffusie vult gemaskerde gebieden naadloos in met omringende structuren en korrel.

### 6. ☀️ Lightroom Basics & Curves
- **Belichting & Tint:** Belichting (EV), Contrast, Hooglichten, Schaduwen, Witte & Zwarte tinten.
- **Kleurbalans:** Kleurtemperatuur (Kelvin), Kleurtoon/Tint, Levendigheid (Vibrance) en Verzadiging.
- **Interactieve Tone Curve:** Vloeiende kubische spline curve met visuele controlepunten.
- **Realtime Histogram:** 4-kanaals weergave (R, G, B, Luminantie) met waarschuwingsindicatoren voor clipping in schaduwen en hooglichten.
- **Voor / Na Vergelijking:** Splitscreen vergelijker en snelle toggle via de `\` toets (Lightroom sneltoets).

### 7. 📁 Ondersteunde Invoerformaten
- **RAW & DNG:** `.dng`, `.cr2`, `.cr3` (Canon), `.nef` (Nikon), `.arw` (Sony), `.rw2` (Panasonic), `.raf` (Fuji), `.orf` (Olympus), `.pef` (Pentax).
- **Standaard:** `.tiff`, `.tif`, `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`, `.avif`.
- **Drag & Drop:** Sleep elk fotobestand direct in het venster.

---

## 🔄 Automatische Herkenning van Nieuwe Versies

De applicatie is voorzien van een slimme **Service Worker** (`sw.js`) en versiecontrole (`version.json`):
1. Bij het laden van de applicatie in de browser wordt `version.json` direct gecontroleerd (network-first).
2. Zodra er een nieuwe build of deployment is uitgevoerd, verschijnt er direct een prominente update-banner bovenaan het scherm:
   > 🚀 **Nieuwe versie van vroonphoto beschikbaar!** [Nu bijwerken]
3. Met één klik op de knop wordt de nieuwste WASM-versie geactiveerd via Service Worker cache-invalidation.

---

## 🚀 GitHub Pages Deployment

De repository bevat een kant-en-klaar GitHub Actions bestand: [`.github/workflows/deploy.yml`](file:///.github/workflows/deploy.yml).

### Hoe te activeren op GitHub:
1. Maak een nieuwe repository aan op GitHub genaamd `vroonphoto`.
2. Koppel de lokale repository en push de code:
   ```bash
   git remote add origin https://github.com/<jouw-gebruikersnaam>/vroonphoto.git
   git branch -M main
   git push -u origin main
   ```
3. Ga op GitHub naar **Settings** → **Pages**.
4. Kies onder **Build and deployment** bij **Source** voor:
   **GitHub Actions**.
5. Elke push naar `main` start nu automatisch de deployment naar:
   `https://<jouw-gebruikersnaam>.github.io/vroonphoto/`

---

## ⚡ Automatisch Pushen na Commit

De repository is direct geconfigureerd met een Git hook: [`.git/hooks/post-commit`](file:///.git/hooks/post-commit).

Zodra je een commit maakt met `git commit`, voert Git automatisch een push uit naar je huidige upstream branch:
```bash
git add .
git commit -m "Verbetering aan rood licht herstel"
# -> Git pusht nu direct automatisch naar GitHub!
```

Je kunt ook het meegeleverde script gebruiken dat ook direct het tijdstempel in `version.json` bijwerkt:
```bash
./scripts/commit_and_push.sh "Mijn update bericht"
```

---

## 💻 Lokaal Uitvoeren

Je kunt **vroonphoto** direct lokaal testen met Python's ingebouwde webserver:
```bash
cd /Users/petervroon/.gemini/antigravity/scratch/vroonphoto
python3 -m http.server 8080
```
Open vervolgens in je browser:
👉 **http://localhost:8080**

### WebAssembly Kernel Opnieuw Bouwen:
Wil je wijzigingen aanbrengen in de C-code van de WASM kernel?
```bash
./scripts/build.sh
```
Dit compileert `src/wasm/vroonphoto_core.c` via clang naar het geoptimaliseerde `src/wasm/vroonphoto_core.wasm` bestand.

---

## 📂 Projectstructuur

```
vroonphoto/
├── .github/
│   └── workflows/
│       └── deploy.yml            # Automatische GitHub Pages workflow
├── .git/
│   └── hooks/
│       └── post-commit           # Automatische push na commit hook
├── scripts/
│   ├── build_wasm.py             # WebAssembly compiler script
│   ├── build.sh                  # Complete build & validatie script
│   └── commit_and_push.sh        # Commit, versiebump & auto-push script
├── src/
│   ├── wasm/
│   │   ├── vroonphoto_core.c     # Native C algoritmes (Rood herstel, Denoise, B&W, Topaz)
│   │   └── vroonphoto_core.wasm  # Gecompileerde WebAssembly binary
│   ├── js/
│   │   ├── wasm_engine.js        # WASM geheugenbeheer & hardware acceleratie
│   │   ├── raw_decoder.js        # Universele RAW / DNG / TIFF / CR2 parser & demosaicer
│   │   ├── color_bleed_fix.js    # Rood licht & kleurendoorloop module
│   │   ├── denoise.js            # Bilaterale & chroma ruisonderdrukking
│   │   ├── punchy_bw.js          # Knallend Zwart-Wit engine met Zone System
│   │   ├── super_resolution.js   # Topaz AI 2x/4x Super-Resolution upscaler
│   │   ├── inpaint.js            # Adobe Firefly contextueel vlekken herstel
│   │   ├── tone_curve.js         # Lightroom tone curve spline editor
│   │   ├── histogram.js          # Realtime RGB + Luma histogram
│   │   ├── version_checker.js    # Automatische detectie van nieuwe versies
│   │   └── app.js                # Hoofdcontroller, sneltoetsen, presets & UI
│   └── css/
│       └── styles.css            # Dark mode Lightroom interface styling
├── index.html                    # Hoofdapplicatie
├── sw.js                         # Service Worker voor caching & versie-updates
├── version.json                  # Versie- en buildmetagegevens
├── manifest.webmanifest          # PWA manifest
└── README.md                     # Documentatie
```

---

Gemaakt met passie voor fotografie en maximale beeldkwaliteit.

