#!/bin/sh
# ==============================================================================
# vroonphoto - Setup Git Hooks
# ==============================================================================
# Voer dit eenmalig uit na het clonen van het project om automatische push
# te activeren bij elke commit.
# ==============================================================================

echo "⚙️  Bezig met configureren van vroonphoto Git hooks..."

# Zorg dat scripts uitvoerbaar zijn
chmod +x .githooks/post-commit 2>/dev/null || true

# Stel git hooks directory in op .githooks
git config core.hooksPath .githooks

# Kopieer ook direct naar .git/hooks als fallback
if [ -d ".git/hooks" ]; then
    cp .githooks/post-commit .git/hooks/post-commit
    chmod +x .git/hooks/post-commit
fi

echo "✅ Git hooks geconfigureerd! Elke 'git commit' zal automatisch 'git push' uitvoeren."
