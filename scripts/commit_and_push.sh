#!/usr/bin/env bash
# scripts/commit_and_push.sh
# Gemakkelijk committen, versie updaten en automatisch pushen naar GitHub

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"
cd "$DIR"

MSG="$1"
if [ -z "$MSG" ]; then
    echo "Voer een commit-bericht in:"
    read -r MSG
fi

if [ -z "$MSG" ]; then
    MSG="Update vroonphoto - $(date +'%Y-%m-%d %H:%M:%S')"
fi

echo "🔄 [1/4] Versie-tijdstempel updaten in version.json..."
python3 -c "
import json, datetime
with open('version.json', 'r') as f:
    data = json.load(f)
data['buildTime'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
with open('version.json', 'w') as f:
    json.dump(data, f, indent=2)
print('✅ version.json bijgewerkt met tijdstempel:', data['buildTime'])
"

echo "📦 [2/4] Wijzigingen indexeren..."
git add -A

echo "💾 [3/4] Wijzigingen committen..."
git commit -m "$MSG"

echo "🚀 [4/4] Automatisch pushen naar GitHub..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if git remote | grep -q 'origin'; then
    git push origin "$CURRENT_BRANCH"
    echo "🎉 Klaar! Wijzigingen zijn gepusht naar GitHub en GitHub Pages start automatisch de deployment!"
else
    echo "ℹ️ Geen GitHub remote 'origin' gevonden."
    echo "Koppel je GitHub repo met:"
    echo "  git remote add origin https://github.com/<jouw-gebruikersnaam>/vroonphoto.git"
    echo "  git push -u origin $CURRENT_BRANCH"
fi

