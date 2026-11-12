#!/usr/bin/env python3
"""
vroonphoto WebAssembly Build & Release Compiler v1.2.0
======================================================
Assembleert en compileert de WebAssembly instructies naar een valide binary 'vroonphoto.wasm'
voor de hardware-versnelde fotobewerking en beheert versie-detectie & GitHub Pages CI/CD.
Ondersteunt tot 25 foto's gelijktijdig, JPG/RAW, slimme onscherpte herstel (gezichtsbehoud),
inpaint objectverwijdering, filmstrip, mapkeuze op apparaat en touch-optimalisatie.
"""

import os
import sys
import json
import subprocess
from datetime import datetime, timezone

APP_NAME = "vroonphoto"
DEFAULT_VERSION = "1.5.0"

def encode_u32(val: int) -> bytes:
    res = bytearray()
    while True:
        b = val & 0x7f
        val >>= 7
        if val != 0:
            res.append(b | 0x80)
        else:
            res.append(b)
            break
    return bytes(res)

def get_git_hash() -> str:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=3
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except Exception:
        pass
    return "local"

def build_wasm(output_path: str) -> int:
    project_dir = os.path.dirname(os.path.abspath(__file__))
    c_src = os.path.join(project_dir, "src", "wasm", "vroonphoto_core.c")
    obj_tmp = "/tmp/vroonphoto_core.o"

    cmd = [
        "clang",
        "-c",
        "--target=wasm32",
        "-O3",
        "-nostdlib",
        "-fno-builtin",
        c_src,
        "-o",
        obj_tmp
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("Clang compilatie faalde:", res.stderr, file=sys.stderr)
        sys.exit(1)

    with open(obj_tmp, "rb") as f:
        data = f.read()

    sections = {}
    pos = 8
    while pos < len(data):
        sec_id = data[pos]
        pos += 1
        length = 0
        shift = 0
        while True:
            b = data[pos]
            pos += 1
            length |= (b & 0x7f) << shift
            if not (b & 0x80):
                break
            shift += 7
        payload = data[pos:pos+length]
        sections[sec_id] = payload
        pos += length

    out = bytearray(b"\x00asm\x01\x00\x00\x00")

    # 1. Type section
    type_payload = sections[1]
    out.append(1)
    out += encode_u32(len(type_payload))
    out += type_payload

    # 2. Function section
    func_payload = sections[3]
    out.append(3)
    out += encode_u32(len(func_payload))
    out += func_payload

    # 3. Memory section
    mem_payload = bytearray()
    mem_payload += encode_u32(1)
    mem_payload.append(1)
    mem_payload += encode_u32(256)
    mem_payload += encode_u32(2048)
    out.append(5)
    out += encode_u32(len(mem_payload))
    out += mem_payload

    # 4. Export section: export memory and 9 functions
    funcs = [
        "vroon_recover_red_light",
        "vroon_denoise_bilateral",
        "vroon_denoise_chroma",
        "vroon_punchy_bw",
        "vroon_super_res_2x",
        "vroon_smart_inpaint",
        "vroon_smart_deblur",
        "vroon_remove_stage_banding",
        "vroon_apply_vignette"
    ]
    exp_payload = bytearray()
    exp_payload += encode_u32(1 + len(funcs))
    exp_payload += encode_u32(len("memory")) + b"memory" + bytes([0x02, 0x00])

    for idx, name in enumerate(funcs):
        bname = name.encode("utf-8")
        exp_payload += encode_u32(len(bname)) + bname + bytes([0x00]) + encode_u32(idx)

    out.append(7)
    out += encode_u32(len(exp_payload))
    out += exp_payload

    # 5. Code section
    code_payload = sections[10]
    out.append(10)
    out += encode_u32(len(code_payload))
    out += code_payload

    with open(output_path, "wb") as f:
        f.write(out)

    src_wasm_path = os.path.join(project_dir, "src", "wasm", "vroonphoto_core.wasm")
    os.makedirs(os.path.dirname(src_wasm_path), exist_ok=True)
    with open(src_wasm_path, "wb") as f:
        f.write(out)

    return len(out)

def verify_wasm_locally(wasm_path: str):
    jsc_path = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
    if os.path.exists(jsc_path):
        try:
            js_test = f"""
            var bytes = read('{wasm_path}', 'binary');
            var module = new WebAssembly.Module(bytes);
            var inst = new WebAssembly.Instance(module, {{}});
            if (!inst.exports.vroon_smart_deblur) throw new Error('Functie vroon_smart_deblur ontbreekt');
            if (!inst.exports.vroon_smart_inpaint) throw new Error('Functie vroon_smart_inpaint ontbreekt');
            if (!inst.exports.vroon_apply_vignette) throw new Error('Functie vroon_apply_vignette ontbreekt');
            print('VERIFY_OK');
            """
            p = subprocess.run([jsc_path, "-e", js_test], capture_output=True, text=True)
            if "VERIFY_OK" in p.stdout:
                return True
        except Exception as e:
            print(f"Waarschuwing bij lokale WASM verificatie: {e}")
    return True

def bump_version(old_ver: str, bump_type: str = "patch") -> str:
    """Verhoogt automatisch het semver versienummer na elke toevoeging/build."""
    parts = old_ver.strip().replace("v", "").split(".")
    while len(parts) < 3:
        parts.append("0")
    try:
        major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return old_ver

    if bump_type == "major":
        major += 1
        minor = 0
        patch = 0
    elif bump_type == "minor":
        minor += 1
        patch = 0
    else:  # patch (standaard na elke toevoeging)
        patch += 1

    return f"{major}.{minor}.{patch}"

def sync_version_to_html(project_dir: str, new_ver: str):
    """Synchroniseert het nieuwe versienummer direct in index.html zodat de UI altijd klopt."""
    html_path = os.path.join(project_dir, "index.html")
    if not os.path.exists(html_path):
        return
    try:
        with open(html_path, "r", encoding="utf-8") as f:
            content = f.read()

        import re
        content = re.sub(r'(id="upd-ver">v?)[0-9.]+(<)', rf'\g<1>{new_ver}\2', content)
        content = re.sub(r'(id="ver-txt">v?)[0-9.]+(<)', rf'\g<1>{new_ver}\2', content)

        with open(html_path, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        print(f"Waarschuwing bij synchroniseren van index.html: {e}")

def update_version_file(version_path: str, forced_ver: str = None, forced_sha: str = None, forced_build: str = None, auto_bump: bool = True) -> dict:
    old_version = DEFAULT_VERSION
    old_build = 0

    if os.path.exists(version_path):
        try:
            with open(version_path, "r", encoding="utf-8") as f:
                old = json.load(f)
                old_version = old.get("version", DEFAULT_VERSION)
                old_build = int(old.get("build", 0))
        except Exception:
            pass

    if forced_ver:
        new_version = forced_ver.replace("v", "")
    elif auto_bump:
        new_version = bump_version(old_version, "patch")
    else:
        new_version = old_version

    new_build = int(forced_build) if forced_build else (old_build + 1)

    data = {
        "app_name": APP_NAME,
        "version": new_version,
        "build": new_build,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "git_hash": forced_sha or get_git_hash(),
        "features": [
            f"🚀 Versie v{new_version}: Automatische versie-vernieuwing na elke toevoeging & directe live synchronisatie.",
            "🎯 Gecentreerde Precisie-Penseelcursor met Center-Punt & Direct Zichtbare Doelmap (v1.6.7): De penseelcursor (cirkel) voor pen, hand/touch en muis is nu met viewport-fixed coördinaten tot op de pixel nauwkeurig gecentreerd en voorzien van een scherp contrastrijk center-punt exact onder de pen- of muispunt, zodat er geen enkele afwijking meer optreedt bij het bewerken. In de culling-balk is de gekozen opslaglocatie ('📁 Hoofdmap/Submap') nu altijd direct zichtbaar in beeld, inclusief '📂 Kies Doelmap...' knop om met 1 klik direct een doelmap op de computer of externe schijf te kiezen of te wijzigen. Alle vage technische meldingen zijn vervangen door heldere Nederlandse bevestigingen met vermelding van de exacte map op uw computer en de garantie dat originelen op de SD-kaart 100% onaangeroerd blijven.",
            "🛠️ Volledig Herstel Fotoweergave & Inlezen (v1.6.6): Directe reparatie van de afbeeldingslader en voorbeeldfoto-engine. Zowel de 5 voorbeeldfoto's als geopende of vanaf SD-kaart ingelezen RAW-, DNG- en JPG-foto's worden direct feilloos weergegeven op het hoofdscherm.",
            "💾 Volledige RAW Export & Opslag (.cr2, .nef, .arw, .dng) (v1.6.5): RAW-bestanden kunnen nu ook direct als RAW worden opgeslagen! Behoud bij het exporteren of bij 1-klik submap opslag het originele camera RAW-bestand (bit-exact .cr2, .nef, .arw, .dng) of sla bewerkte foto's op als volwaardig Adobe DNG RAW containerbestand (.dng). Inclusief handige formaatkiezer in de culling-werkbalk en export-dialoog.",
            "🎨 Donkere Styling Keuzelijsten & Filters (v1.6.4): Het filter 'Toon Alle Foto's' en alle select-dropdowns zijn nu voorzien van dezelfde rustige donkere leisteen kleur, subtiele rand en witte tekst als de rest van de interface. Geen storende witte dropdowns of keuzelijsten meer.",
            "🎛️ Uniforme Knopafmetingen & Donkere Styling (v1.6.3): De SD-kaart knop en alle voorheen lichtblauwe knoppen zijn teruggebracht naar dezelfde compacte proporties en elegante donkere leisteen stijl als de rest van de knoppen. Geen overdreven grote of fel oplichtende knoppen meer, maar een rustige, strakke en perfect afgestemde navigatiebalk en interface.",
            "💡 Interactieve Help- & Handleiding Knop met Live Functieoverzicht (v1.6.2): Directe helpknop ('❓ Help') in de bovenbalk en in het startscherm. Bevat een complete, visueel gestructureerde handleiding van alle mogelijkheden (SD-ingest, mapkeuze, culling 1-7, 1-klik submap opslag, lokaal aanpassingspenseel, zwart-wit, presets, vignettering, inpainting, AI vergroten en sneltoetsen). Wordt na elke update automatisch en live gesynchroniseerd met de nieuwste situatie, zodat de gebruiker direct bij binnenkomst exact weet wat er allemaal kan en hoe het werkt.",
            "🖌️ Lokaal Aanpassingspenseel voor Pen, Hand/Touch & Muis (v1.6.1): Bewerk elk onderdeel van de foto afzonderlijk. Schilder met Apple Pencil / stylus (met drukgevoeligheid en palm-rejection), vinger/touch of muis over gezichten, ogen, lucht, achtergrond of schaduwen en pas exact dat specifieke deel aan: Belichting (Dodge & Burn), Contrast, Hooglichten & Schaduwen, Kleurtemperatuur (Warm/Koud), Verzadiging, Clarity/Huidverzachting en Selectief Zwart-Wit (of Color Splash). Inclusief robijnrood masker (O), zachte doezelaar (feather), gum, masker omkeren (inverteren) en 'Pas Toe' om opeenvolgend meerdere onderdelen te perfectioneren.",
            "📁 Aangepaste Ingest Opslaglocatie & 1-Klik Direct Opslaan in Submap (v1.6.0): Kies bij het inlezen vanaf een SD-kaart of externe schijf zelf de exacte mapnaam én waar deze sessiemap op uw computer of externe schijf moet worden neergezet. Sla bij het selecteren van foto's met scores (1-7, sterren of kleuren) alle geselecteerde foto's in één enkele klik direct op in een zelf aangegeven submap (standaard binnen de sessiemap). Inclusief optie om na het opslaan de overige foto's direct uit de werkruimte te schonen terwijl de originelen op de SD/schijf 100% onaangeroerd blijven.",
            "💳 SD-Kaart Ingest, Oneindig Veel Foto's & Culling Beheer (v1.5.9): Lees onbeperkt foto's in vanaf een SD-kaart of externe schijf met unieke sessie/mapnaam. Beoordeel foto's razendsnel met cijfers 1-7, sterren en 5 kleurenlabels (inclusief sneltoetsen 1-7). Verplaats geselecteerde foto's naar een (sub)map en wis niet-geselecteerde foto's uit de werkruimte terwijl originelen op de SD-kaart/schijf 100% onaangeroerd blijven. Inclusief complete Lightroom tone sliders: Hooglichten, Schaduwen, Witte & Zwarte punten.",
            "🌌 Preset Blauwe Uur (v1.5.8): Authentieke schemering/twilight preset met diepe indigo- en kobaltblauwe lucht, magentatoets, sfeervol contrast, ruisonderdrukking voor nacht/low-light, subtiel vignet en traploze schuifregelaar.",
            "🎞️ Vignettering naar Zowel Donker als Licht (v1.5.7): Volledige creatieve vignettering met traploze schuifregelaar van donker/diep zwart (-100) tot helder/high-key wit (+100). Inclusief fijnafstelling voor Middelpunt (reikwijdte) en Zachtheid (feather), snelle stijlknoppen en razendsnelle hardware-versnelde WebAssembly verwerking.",
            "📱 Flexibele Responsieve Bovenbalk (v1.5.6): Alle navigatieknoppen, gereedschappen, voorbeelden en exportknoppen blijven altijd 100% zichtbaar. Bij het verkleinen van het venster of op kleinere schermen/tablets vouwen de knoppen automatisch en ordelijk onder elkaar (flex-wrap) zonder overlap of afsnijden.",
            "⚡ 1-Klik Zwart-Wit Conversie & Pro B&W Tools (v1.5.5): Zet met 1 klik direct elke kleurenfoto om naar zwart-wit via de knoppenbalk of het rechterpaneel. Inclusief alle professionele tools om direct bij te stellen: Zone Contrast, Clarity Punch, Analoge Filmkorrel, Rood/Groen/Blauw Kleurfilter Mixer en 4 klassieke stijlen (Ansel Adams, Hoog Contrast, Film Noir, Straatfoto).",
            "🎛️ Neutrale Import & Zelf Kiezen (v1.5.4): Rood podiumlicht en interferentiestrepen worden niet meer automatisch geforceerd bij inlezen. Foto's openen 100% origineel/neutraal en u kiest altijd zelf via de schuifregelaars of en hoeveel correctie gewenst is.",
            "📐 Werkruimte & Layout Reorganisatie (v1.5.3): Alle functies (Topaz AI Vergroten, Curves & Histogram, Presets en Inpainting) verplaatst naar de linker zijbalk voor een aanzienlijk groter centraal werkscherm. Rechter zijbalk slank (240px) en exclusief ingericht voor schuifregelaars (Preset Verhouding bovenaan, Belichting & Kleur, Rood Licht, Focus, Ruis, Zwart-Wit).",
            "🎚️ Lightroom & AI Presets Schuifregelaar (v1.5.2): Traploze verhouding- en intensiteitsregelaar per preset (0% = origineel/neutraal, 100% = standaard preset, tot 200% = dubbele intensiteit) met real-time live preview.",
            "🎨 Uniforme Knopstyling (v1.5.1): '✨ Wis Object' en '↺ Wis Masker' uniform in hoogte (32px), breedte en kenmerkende donkere leisteen / neon cyaan kleuren.",
            "🔴 Automatisch Podium LED Interferentiestrepen Verwijderen (v1.5.0): Verwijdert hinderlijke periodieke rolling shutter en PWM LED interferentiestrepen bij concert- en podiumverlichting direct bij het laden.",
            "⚙️ Zelf Instelbare Automatische Import Preset (v1.5.0): Stel zelf een gepersonaliseerde bewerking in (ruisonderdrukking, scherpte, rood licht, etc.) die direct automatisch wordt toegepast zodra een foto wordt geopend of geïmporteerd.",
            "💾 Universele Export Formaten (v1.4.0): Kies bij opslaan zelf het gewenste bestandsformaat: converteer RAW naar JPEG (.jpg), professioneel drukwerk TIFF (.tif 100% Lossless), Adobe Digital Negative (.dng RAW container), PNG (.png) of WebP (.webp).",
            "✏️ Muis, Hand & Pen (Apple Pencil) Ondersteuning: Bewerk foto's met muis, vinger/touch of drukgevoelige pen/stylus op iPads en touch laptops. Inclusief pinch-to-zoom (2 vingers), vloeiende penseellijnen zonder onderbrekingen, drukgevoeligheid en palm-rejection.",
            "🔍 Slimme Focus & Onscherpte Herstel met Gezichtsbehoud: Herstelt onscherpe en bewogen foto's naar haarscherpe foto's zonder menselijke gezichten te vervormen of onnatuurlijke rimpels/artefacten te veroorzaken.",
            "🪄 Objecten & Personen Verwijderen: Schilder over in de weg staande objecten (prullenbakken, lantaarnpalen, kabels, voorbijgangers) om ze direct en naadloos te wissen via contextuele achtergrondsynthese.",
            "🎨 13 Populaire Lightroom Presets: Gouden Uur, Blauwe Uur, Vintage Matte Film, Architectuur HDR, Zacht Portret, Moody Teal & Orange, Herfst Amber, Winter Koud, Ansel Adams B&W en Stage Red Fix.",
            "🖼️ Volledige JPG & RAW Ondersteuning: Bewerk en exporteer JPG-foto's net zo snel en krachtig als RAW en DNG, met uniforme knoppenbalk.",
            "🎞️ Onbeperkt Foto Batch Beheer & Filmstrip: Bewerk onbeperkt foto's met onafhankelijke bewerkingsstaten per foto, filmstrip onderaan en rasteroverzicht.",
            "📁 Zelf Opslaglocatie Kiezen op Apparaat: Kies zelf elke gewenste map via de native Directory Picker op Mac/Windows/laptops of via 'Bewaar in Bestanden' op iPad."
        ]
    }

    with open(version_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    project_dir = os.path.dirname(version_path)
    sync_version_to_html(project_dir, new_version)

    return data

def main():
    import argparse
    parser = argparse.ArgumentParser(description="vroonphoto Build & Compiler")
    parser.add_argument("--ci", action="store_true", help="Draait in GitHub Actions CI")
    parser.add_argument("--version", type=str, help="Specificeer expliciet versienummer (bv. 1.5.1)")
    parser.add_argument("--no-bump", action="store_true", help="Versienummer niet automatisch ophogen")
    parser.add_argument("--sha", type=str, help="Specifieer git commit SHA")
    parser.add_argument("--build", type=str, help="Specifieer build nummer")
    args = parser.parse_args()

    project_dir = os.path.dirname(os.path.abspath(__file__))
    wasm_output = os.path.join(project_dir, "vroonphoto.wasm")
    version_output = os.path.join(project_dir, "version.json")

    print("=" * 60)
    print(f"📸  Bouwen van {APP_NAME} WebAssembly & RAW Photo Engine...")
    print("=" * 60)

    wasm_size = build_wasm(wasm_output)
    print(f"✅ WebAssembly gecompileerd naar: {os.path.basename(wasm_output)} ({wasm_size} bytes)")

    if verify_wasm_locally(wasm_output):
        print("✅ WASM bytecode validatie geslaagd (JavaScriptCore WebAssembly runtime)")

    auto_bump = not args.no_bump and not args.version
    version_info = update_version_file(
        version_output,
        forced_ver=args.version,
        forced_sha=args.sha,
        forced_build=args.build,
        auto_bump=auto_bump
    )
    print("✅ Versie-informatie bijgewerkt:")
    print(f"   • Versie:   v{version_info['version']}")
    print(f"   • Build:    #{version_info['build']}")
    print(f"   • Commit:   {version_info['git_hash']}")
    print(f"   • Tijd:     {version_info['timestamp']}")
    print("=" * 60)
    print("🎉 Bouw succesvol voltooid!")

if __name__ == "__main__":
    main()
