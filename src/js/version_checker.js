/**
 * version_checker.js
 * Automatic update & version detection for vroonphoto
 * Checks version.json and Service Worker state upon loading in the browser.
 */

class VersionChecker {
    constructor() {
        this.currentVersion = '1.0.0';
        this.buildTime = null;
        this.bannerEl = null;
    }

    async init() {
        this.createUpdateBanner();
        await this.checkCurrentVersion();
        this.registerServiceWorker();

        // Check for updates upon window focus as well
        window.addEventListener('focus', () => {
            this.checkForUpdates();
        });

        // Periodic check every 10 minutes
        setInterval(() => {
            this.checkForUpdates();
        }, 10 * 60 * 1000);
    }

    createUpdateBanner() {
        let banner = document.getElementById('vroon-update-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'vroon-update-banner';
            banner.className = 'update-banner hidden';
            banner.innerHTML = `
                <div class="update-banner-content">
                    <span class="update-icon">🚀</span>
                    <span id="update-banner-text">Er is een nieuwe versie van vroonphoto beschikbaar!</span>
                    <button id="btn-update-now" class="btn-primary-small">Nu bijwerken</button>
                    <button id="btn-dismiss-update" class="btn-icon" title="Sluiten">✕</button>
                </div>
            `;
            document.body.prepend(banner);

            document.getElementById('btn-update-now').addEventListener('click', () => {
                this.applyUpdate();
            });

            document.getElementById('btn-dismiss-update').addEventListener('click', () => {
                banner.classList.add('hidden');
            });
        }
        this.bannerEl = banner;
    }

    async checkCurrentVersion() {
        try {
            const res = await fetch(`version.json?_t=${Date.now()}`, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                this.currentVersion = data.version;
                this.buildTime = data.buildTime;
                
                const storedVersion = localStorage.getItem('vroonphoto_cached_version');
                if (storedVersion && storedVersion !== data.version) {
                    this.notifyNewVersion(data.version);
                }
                localStorage.setItem('vroonphoto_cached_version', data.version);

                const badge = document.getElementById('app-version-badge');
                if (badge) {
                    badge.textContent = `v${data.version}`;
                    badge.title = `Gebouwd op: ${data.buildTime || 'Recent'}`;
                }
            }
        } catch (e) {
            console.log('Version metadata fetch note:', e.message);
        }
    }

    async checkForUpdates() {
        try {
            const res = await fetch(`version.json?_t=${Date.now()}`, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                const activeVersion = localStorage.getItem('vroonphoto_cached_version') || this.currentVersion;
                if (data.version !== activeVersion) {
                    this.notifyNewVersion(data.version);
                }
            }
        } catch (e) {
            // Offline or network error
        }
    }

    notifyNewVersion(newVersion) {
        if (!this.bannerEl) return;
        const text = document.getElementById('update-banner-text');
        if (text) {
            text.innerHTML = `<strong>Nieuwe versie beschikbaar (v${newVersion})!</strong> Snelle updates & nieuwe WASM verbeteringen.`;
        }
        this.bannerEl.classList.remove('hidden');
    }

    applyUpdate() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(regs => {
                for (let reg of regs) {
                    reg.update();
                    if (reg.waiting) {
                        reg.waiting.postMessage({ action: 'skipWaiting' });
                    }
                }
            });
        }
        localStorage.removeItem('vroonphoto_cached_version');
        window.location.reload(true);
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('sw.js').then(reg => {
                    console.log('✅ ServiceWorker geregistreerd voor offline support & updates');

                    reg.addEventListener('updatefound', () => {
                        const newWorker = reg.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                this.notifyNewVersion('Nieuwste');
                            }
                        });
                    });
                }).catch(err => {
                    console.log('ServiceWorker registratie overgeslagen (lokaal/file origin):', err.message);
                });
            });

            navigator.serviceWorker.addEventListener('controllerchange', () => {
                // Controller updated
            });
        }
    }
}

window.versionChecker = new VersionChecker();
