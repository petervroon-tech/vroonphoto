# 📸 <vroonphoto> — Cross-Platform WASM RAW & Fotobewerker (v1.1.0)

**vroonphoto** is een geavanceerd, hardware-versneld fotobewerkingsprogramma dat volledig in de browser draait via **WebAssembly (WASM)**. Het is ontworpen als een professioneel alternatief voor Adobe Lightroom, Topaz Labs en Adobe Firefly, met bijzondere aandacht voor **25-foto batch beheer**, **rood licht herstel**, **geavanceerde ruisonderdrukking**, **knallend zwart-wit**, **AI super-resolution vergroten** en **volledige touch-ondersteuning voor iPads en laptops**.

Alle berekeningen vinden 100% lokaal plaats op jouw apparaat via WebAssembly. Je foto's worden nooit naar een externe server verstuurd.

---

## 🌟 Belangrijkste Nieuwe Functies (v1.1.0)

### 🎞️ 1. Tot 25 Foto's Gelijktijdig Bewerken & Beheren
- **Filmstrip:** Onderin het scherm vind je een overzichtelijke filmstrip met thumbnails van alle geladen foto's (tot 25 foto's).
- **Onafhankelijke Instellingen:** Elke foto behoudt zijn eigen individuele bewerkingsinstellingen (belichting, contrast, rood licht herstel, zwart-wit, ruisonderdrukking, enzovoort).
- **🔲 Raster Overzicht (Grid View):** Met één klik op `🔲 Raster (25)` krijg je een schermvullend rasteroverzicht van al je 25 foto's met live bewerkingsbadges. Tik op een foto om direct naar het bewerkscherm van die foto te springen.
- **⚡ Synchroniseer naar Alle:** Heb je één concertfoto perfect gecorrigeerd voor overbelicht rood licht? Klik op **"⚡ Sync naar Alle"** om alle instellingen in één keer over te nemen op de overige foto's in de sessie!
- **Sneltoetsen & Knoppen:** Blader soepel door je foto's met de `◀` en `▶` pijltjesknoppen of het toetsenbord.

### 📁 2. Zelf Kiezen Waar je Foto's Opslaat op je Apparaat
Bij het opslaan via de knop **"💾 Opslaan & Exporteren"** kun je kiezen:
- **Alleen de huidige foto opslaan** óf **alle 25 bewerkte foto's tegelijk opslaan (Batch Export)**.
- **💻 Op Mac, Windows & Laptops (File System Access):**
  Klik op **"📁 Kies Map & Opslaan op Apparaat"** en de officiële verkenner/Finder opent direct. Je selecteert zelf elke gewenste doelmap (bijvoorbeeld `Documenten/Concert/Bewerkt/`, een USB-stick of externe SSD). Alle foto's worden direct in die map opgeslagen!
- **📱 Op iPad & iOS (Bewaar in Bestanden):**
  Op iPad en tablets activeert de app het officiële **"Bewaar in Bestanden"** deelvenster. Je kiest zelf of je de bewerkte foto's opslaat in **iCloud Drive** of lokaal in **"Op mijn iPad"**.

### 📱 3. Volledige iPad & Touchscreen Optimalisatie
- **Touch-Friendly Hit Targets:** Alle sliders, knoppen en presets zijn voorzien van vergrote aanraakvlakken (minimaal 44×44 pixels) speciaal afgestemd op vingertikken.
- **Vergrote Slider Knoppen:** Subtiele, vlot beweegbare sliderknoppen die comfortabel onder je vinger glijden.
- **Touch Gestures:** Vloeiend slepen met je vinger over het scherm voor de **Voor / Na vergelijking** en het interactieve **Firefly inpaint penseel**.
- **Landscape & Portrait:** Werkt automatisch zowel horizontaal als verticaal op alle iPad-formaten (10.2", 11" en 12.9" Pro) en laptops.

---

## 🎨 Professionele Kernalgoritmes

### 🔴 Rood Licht & Kleurdoorloop Herstel (Stage & Concert Fix)
- **Detail Reconstructie:** Wanneer het rode sensorkanaal clipt ($R = 255$), synthetiseert ons WASM-algoritme ontbrekende textuur uit de groene en blauwe kanalen om gelaatstrekken, microfoons en kleding terug te brengen.
- **Bleed & Doorloop Reductie:** Trekt uitwaaierende rode halos langs randen terug naar de lichtbron.
- **Huidskleur Bescherming:** Herkent menselijke huidskleurverhoudingen en voorkomt dat gezichten een vlakke oranje of magenta waas worden.

### 🛡️ Geavanceerde Dual-Engine Ruisonderdrukking
- **Luminantie Ruisonderdrukking:** Hardware-versnelde bilaterale filtering die ruiskorrels gladstrijkt, maar randen, ogen en haren scherp houdt.
- **Chroma / Kleurruis Onderdrukking:** Elimineert paarse, rode en groene spikkels in de YCbCr-kleurruimte (ideaal voor hoge ISO nachtopnames).

### ⚡ Knallend Zwart-Wit Engine
- **6-Kanaals Filter Mixer:** Individuele regeling voor Rood, Oranje, Geel, Groen, Aqua en Blauw.
- **Ansel Adams Zone System Contrast:** Diepe, fluweelzwarte schaduwen en heldere hooglichten zonder modderige middentonen.
- **Micro-Contrast Punch (Clarity):** Benadrukt lokale structuren, wolken en texturen.
- **Analoge Filmkorrel:** Fysisch gemodelleerde zilverbromide korrel, geconcentreerd in de middentonen.

### 🚀 Topaz Labs Super-Resolution (Foto's Vergroten)
- **2x en 4x AI-geïnspireerde Upscaling:** Edge-directed gradient interpolatie om foto's te vergroten zonder kartels of pixelatie, met instelbare randscherpte.

### 🪄 Adobe Firefly Smart Retouch & Inpainting
- **Interactief Penseel:** Schilder direct over oneffenheden, vlekken of storende objecten.
- **Contextuele Textuursynthese:** WASM-patchdiffusie vult gemaskerde gebieden naadloos in.

### 📁 Ondersteunde Invoerformaten
- **RAW & DNG:** `.dng`, `.cr2`, `.cr3` (Canon), `.nef` (Nikon), `.arw` (Sony), `.rw2` (Panasonic), `.raf` (Fuji), `.orf` (Olympus), `.pef` (Pentax).
- **Standaard:** `.tiff`, `.tif`, `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`, `.avif`.
- **Batch Drag & Drop:** Sleep tot 25 foto's tegelijk in het venster.

---

## 🔄 Automatische Herkenning van Nieuwe Versies

De applicatie is voorzien van een slimme update-engine:
1. Bij het laden van de applicatie wordt `version.json` direct gecontroleerd (`nocache`).
2. Zodra er een nieuwe versie is, verschijnt de update-banner:
   > 🚀 **Nieuwe versie v1.1.0 beschikbaar** • 25-Foto batch beheer, opslagmap kiezen & iPad touch [Nu bijwerken]
3. Het versielampje in de header knippert goud. Met één klik op **"Nu bijwerken"** of op `🔄` wordt de nieuwste versie direct geactiveerd.

---

## ⚡ Automatisch Pushen na Commit

De repository is direct geconfigureerd met:
- **Script:** [`setup-hooks.sh`](file:///Users/petervroon/.gemini/antigravity/scratch/vroonphoto/setup-hooks.sh) configureert Git via:
  ```bash
  git config core.hooksPath .githooks
  ```
- **Hook:** [`.githooks/post-commit`](file:///Users/petervroon/.gemini/antigravity/scratch/vroonphoto/.githooks/post-commit) pusht bij elke commit automatisch naar GitHub met duidelijke Nederlandse terminalmeldingen.

---

## 🚀 GitHub Pages Deployment

Het bestand [`.github/workflows/deploy.yml`](file:///Users/petervroon/.gemini/antigravity/scratch/vroonphoto/.github/workflows/deploy.yml) verzorgt de volledige automatische uitrol via GitHub Actions.

---

## 💻 Direct Lokaal Testen

```bash
cd /Users/petervroon/.gemini/antigravity/scratch/vroonphoto
make serve
```
Open **[http://localhost:8080](http://localhost:8080)** in je browser.

In het menu staat direct de optie:
**"📸 Laad 5 Voorbeeldfoto's (Batch Test)"**
waarmee je direct 5 verschillende foto's (Concert rood licht, Nachtruis, Landschap, Portret, Straat) kunt testen in de filmstrip en het rasteroverzicht!
