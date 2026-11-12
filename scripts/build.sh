#!/usr/bin/env bash
# scripts/build.sh
# Rebuilds the WebAssembly binary and verifies project health

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "🔨 Bezig met bouwen van vroonphoto WebAssembly kernel..."
python3 scripts/build_wasm.py

echo "🔍 Testen van WebAssembly integriteit..."
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -e "
var buf = read('src/wasm/vroonphoto_core.wasm', 'binary');
var mod = new WebAssembly.Module(buf);
var inst = new WebAssembly.Instance(mod);
var exports = Object.keys(inst.exports);
print('✅ WASM Kernel gecompileerd en gevalideerd! Geëxporteerde functies: ' + exports.length);
"

echo "✨ Build succesvol afgerond!"

