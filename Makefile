.PHONY: all build serve test hooks clean

all: build

# Bouw de WebAssembly binary en update versie
build:
	python3 build.py

# Start een lokale ontwikkelserver
serve: build
	@echo "🌍 vroonphoto draait op: http://localhost:8080"
	python3 -m http.server 8080

# Voer lokale tests uit (WASM validatie)
test: build
	@echo "🧪 WebAssembly verificatie..."
	python3 build.py

# Activeer automatische Git Push hooks
hooks:
	./setup-hooks.sh

clean:
	rm -f /tmp/vroonphoto*
