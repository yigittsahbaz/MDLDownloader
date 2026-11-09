// MDLDownloader Chrome Extension v1.3
// Supports BOTH:
// 1. Logged-in account auto-detection (detects Guest cookie vs Registered account properly!)
// 2. Manual Username / Profile URL lookup at any time (even when logged out).

let sessionAuth = null; // { userId, key, registeredUser, userName }
let activeTargetUser = { userId: '', userName: 'Archive' };
let allClips = [];
let gameCounts = {};
let selectedGames = new Set();
let isDownloading = false;
let cancelRequested = false;

const sessionStatus = document.getElementById('sessionStatus');
const actionSessionBtn = document.getElementById('actionSessionBtn');
const loadMyAccountLink = document.getElementById('loadMyAccountLink');
const manualSearchForm = document.getElementById('manualSearchForm');
const manualProfileInput = document.getElementById('manualProfileInput');
const manualScanBtn = document.getElementById('manualScanBtn');

const gamesSection = document.getElementById('gamesSection');
const targetUserLabel = document.getElementById('targetUserLabel');
const gamesList = document.getElementById('gamesList');
const toggleAllGames = document.getElementById('toggleAllGames');
const selectedClipsSummary = document.getElementById('selectedClipsSummary');
const subfoldersCheck = document.getElementById('subfoldersCheck');

const progressWrap = document.getElementById('progressWrap');
const progressLabel = document.getElementById('progressLabel');
const progressCount = document.getElementById('progressCount');
const progressFill = document.getElementById('progressFill');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const cancelBtn = document.getElementById('cancelBtn');
const progressStatus = document.getElementById('progressStatus');

function sanitize(name) {
    return (name || 'Untitled').replace(/[\\/*?:"<>|]/g, '_').trim().slice(0, 75) || 'Untitled';
}

function getBestVideoUrl(clip) {
    for (const field of ['rawFileUrl', 'contentUrl', 'contentUrl1080p', 'contentUrl720p', 'contentUrl480p', 'contentUrl360p', 'socialMediaVideo']) {
        const val = clip[field];
        if (val && !val.includes('privacy-protected-guest') && !val.endsWith('&missing')) {
            return val;
        }
    }
    return null;
}

async function ensureGuestOrSessionAuth() {
    if (sessionAuth && sessionAuth.userId && sessionAuth.key) {
        return `${sessionAuth.userId},${sessionAuth.key}`;
    }
    // Create a temporary guest token if no cookie exists at all
    const res = await fetch('https://medal.tv/api/users', {
        method: 'POST',
        headers: {
            'Medal-User-Agent': 'Medal-Nextjs/1.0 (simplified_signup)',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            userName: 'guest',
            email: 'guest',
            password: crypto.randomUUID()
        })
    });
    const data = await res.json();
    const uid = data.auth?.userId || data.user?.userId;
    const key = data.auth?.key;
    sessionAuth = { userId: String(uid), key: String(key), registeredUser: false };
    return `${uid},${key}`;
}

async function resolveUsernameOrUrl(input) {
    let clean = input.trim();
    const urlMatch = clean.match(/medal\.tv\/(?:[a-zA-Z-]+\/)?u\/([^/?#]+)/i);
    if (urlMatch) {
        clean = decodeURIComponent(urlMatch[1]);
    }
    if (/^\d+$/.test(clean)) {
        return { userId: clean, userName: clean };
    }

    const authHeader = await ensureGuestOrSessionAuth();
    try {
        const res = await fetch(`https://medal.tv/api/users?username=${encodeURIComponent(clean)}`, {
            headers: {
                'Medal-User-Agent': 'Medal-Nextjs/1.0 (simplified_signup)',
                'X-Authentication': authHeader,
                'Accept': 'application/json'
            }
        });
        if (res.ok) {
            const arr = await res.json();
            if (Array.isArray(arr) && arr.length > 0 && arr[0].userId) {
                return { userId: String(arr[0].userId), userName: arr[0].userName || clean };
            }
        }
    } catch (e) {}

    // Fallback: HTML scrape
    const htmlRes = await fetch(`https://medal.tv/u/${encodeURIComponent(clean)}`);
    const text = await htmlRes.text();
    const uidMatch = text.match(/\\"userId\\":\\"?(\d+)\\"?/) || text.match(/"userId":"?(\d+)"?/);
    if (uidMatch) {
        return { userId: uidMatch[1], userName: clean };
    }
    throw new Error(`User "${clean}" not found.`);
}

async function scanTargetUser(userId, fallbackName, isOwnAccount = false) {
    try {
        manualScanBtn.disabled = true;
        manualScanBtn.textContent = '...';
        progressStatus.textContent = `Scanning clips for ${fallbackName}...`;
        gamesSection.classList.remove('visible');
        downloadZipBtn.disabled = true;

        const authHeader = await ensureGuestOrSessionAuth();
        allClips = [];
        let protectedCount = 0;
        const seen = new Set();

        const privModes = isOwnAccount ? ['', '&privacy=0'] : ['&privacy=0'];

        for (const priv of privModes) {
            let offset = 0;
            while (true) {
                const url = `https://medal.tv/api/content?userId=${encodeURIComponent(userId)}${priv}&limit=50&offset=${offset}&sortDirection=DESC`;
                const res = await fetch(url, {
                    headers: {
                        'Medal-User-Agent': 'Medal-Nextjs/1.0 (simplified_signup)',
                        'X-Authentication': authHeader,
                        'Accept': 'application/json'
                    }
                });
                if (!res.ok) break;
                const batch = await res.json();
                if (!Array.isArray(batch) || batch.length === 0) break;

                for (const c of batch) {
                    if (c.contentId && !seen.has(c.contentId)) {
                        seen.add(c.contentId);
                        const bestUrl = getBestVideoUrl(c);
                        if (bestUrl) {
                            allClips.push(c);
                        } else if ((c.contentUrl || '').includes('privacy-protected-guest')) {
                            protectedCount++;
                        }
                    }
                }
                progressStatus.textContent = `Loading clips... (${allClips.length} unlocked found)`;
                if (batch.length < 50) break;
                offset += 50;
            }
        }

        const resolvedName = allClips[0]?.poster?.userName || fallbackName || String(userId);
        activeTargetUser = { userId: String(userId), userName: resolvedName };

        allClips.forEach((c, idx) => {
            c._index = idx + 1;
            c._game = c.category?.categoryName || 'Gaming';
            c._videoUrl = getBestVideoUrl(c);
            c._filename = `${String(idx + 1).padStart(3, '0')}_${sanitize(c.contentTitle)}_${c.contentId}.mp4`;
        });

        gameCounts = {};
        for (const c of allClips) {
            gameCounts[c._game] = (gameCounts[c._game] || 0) + 1;
        }

        selectedGames = new Set(Object.keys(gameCounts));
        targetUserLabel.textContent = `@${resolvedName} (${allClips.length} Videos)`;
        renderGamesList();
        gamesSection.classList.add('visible');

        if (allClips.length === 0 && protectedCount > 0) {
            progressStatus.innerHTML = `⚠️ Found <strong>${protectedCount} clips</strong> on @${resolvedName}, but they require logging in on Medal.tv. Click <strong>Log In on Medal.tv</strong> above to unlock them!`;
        } else if (protectedCount > 0) {
            progressStatus.innerHTML = `Loaded <strong>${allClips.length} unlocked clips</strong> for @${resolvedName}. (${protectedCount} clips are guest-protected; log in on Medal.tv to unlock all).`;
        } else {
            progressStatus.textContent = `Ready! Found ${allClips.length} clips across ${Object.keys(gameCounts).length} games for @${resolvedName}.`;
        }
    } catch (e) {
        progressStatus.textContent = `Error: ${e.message}`;
    } finally {
        manualScanBtn.disabled = false;
        manualScanBtn.textContent = 'Scan';
    }
}

async function initExtension() {
    try {
        const cookie = await chrome.cookies.get({ url: 'https://medal.tv', name: 'medal-auth' });
        if (cookie && cookie.value) {
            const decoded = JSON.parse(atob(decodeURIComponent(cookie.value)));
            const userId = decoded.userId || decoded.id || decoded.auth?.userId;
            const key = decoded.key || decoded.auth?.key;
            const isRegistered = Boolean(decoded.registeredUser);

            if (userId && key) {
                sessionAuth = { userId: String(userId), key: String(key), registeredUser: isRegistered };

                // Verify if this is a real logged-in user (not a 0-clip auto-created guest session)
                if (isRegistered) {
                    sessionStatus.textContent = `Logged in (ID: ${userId}) — Full Access Unlocked`;
                    actionSessionBtn.textContent = 'My Clips';
                    loadMyAccountLink.style.display = 'inline';
                    await scanTargetUser(String(userId), String(userId), true);
                    return;
                }
            }
        }

        // Not logged into a real account (Guest cookie or no cookie)
        sessionStatus.textContent = 'Not Logged In — Log in to access all your private & protected videos.';
        actionSessionBtn.textContent = 'Log In on Medal.tv';
    } catch (e) {
        sessionStatus.textContent = 'Not Logged In — Enter a username below or log in on Medal.tv.';
    }
}

actionSessionBtn.addEventListener('click', () => {
    if (sessionAuth && sessionAuth.registeredUser) {
        manualProfileInput.value = activeTargetUser.userName || sessionAuth.userId;
        scanTargetUser(sessionAuth.userId, sessionAuth.userId, true);
    } else {
        chrome.tabs.create({ url: 'https://medal.tv/login' });
    }
});

loadMyAccountLink.addEventListener('click', () => {
    if (sessionAuth && sessionAuth.registeredUser) {
        manualProfileInput.value = '';
        scanTargetUser(sessionAuth.userId, sessionAuth.userId, true);
    }
});

manualSearchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = manualProfileInput.value.trim();
    if (!q) return;
    try {
        manualScanBtn.disabled = true;
        manualScanBtn.textContent = '...';
        progressStatus.textContent = `Resolving "${q}"...`;
        const resolved = await resolveUsernameOrUrl(q);
        const isSelf = Boolean(sessionAuth?.registeredUser && String(sessionAuth.userId) === String(resolved.userId));
        await scanTargetUser(resolved.userId, resolved.userName, isSelf);
    } catch (err) {
        progressStatus.textContent = `Error: ${err.message}`;
        manualScanBtn.disabled = false;
        manualScanBtn.textContent = 'Scan';
    }
});

function renderGamesList() {
    gamesList.innerHTML = '';
    const sortedGames = Object.entries(gameCounts).sort((a, b) => b[1] - a[1]);

    if (sortedGames.length === 0) {
        gamesList.innerHTML = '<div style="padding:10px; color:#9ca3af; text-align:center;">No unlocked clips found for this profile.</div>';
        updateSummary();
        return;
    }

    for (const [gameName, count] of sortedGames) {
        const label = document.createElement('label');
        label.className = 'game-row';
        const isChecked = selectedGames.has(gameName);

        label.innerHTML = `
            <div class="game-left">
                <input type="checkbox" class="game-check" ${isChecked ? 'checked' : ''} />
                <span class="game-name" title="${gameName.replace(/"/g, '&quot;')}">${gameName}</span>
            </div>
            <span class="game-count">${count} video${count > 1 ? 's' : ''}</span>
        `;

        const cb = label.querySelector('.game-check');
        cb.addEventListener('change', (e) => {
            if (e.target.checked) selectedGames.add(gameName);
            else selectedGames.delete(gameName);
            updateSummary();
        });

        gamesList.appendChild(label);
    }
    updateSummary();
}

toggleAllGames.addEventListener('change', () => {
    if (toggleAllGames.checked) {
        selectedGames = new Set(Object.keys(gameCounts));
    } else {
        selectedGames.clear();
    }
    renderGamesList();
});

function updateSummary() {
    let totalSelected = 0;
    for (const [g, count] of Object.entries(gameCounts)) {
        if (selectedGames.has(g)) totalSelected += count;
    }
    selectedClipsSummary.textContent = `${totalSelected} video${totalSelected !== 1 ? 's' : ''} selected`;
    toggleAllGames.checked = selectedGames.size > 0 && selectedGames.size === Object.keys(gameCounts).length;
    downloadZipBtn.disabled = totalSelected === 0 || isDownloading;
    downloadZipBtn.textContent = `Download Selected (${totalSelected}) as MyClips.zip`;
}

cancelBtn.addEventListener('click', () => {
    cancelRequested = true;
    progressLabel.textContent = 'Cancelling...';
});

downloadZipBtn.addEventListener('click', async () => {
    if (isDownloading) return;
    const clipsToDownload = allClips.filter(c => selectedGames.has(c._game) && c._videoUrl);
    if (clipsToDownload.length === 0) return;

    isDownloading = true;
    cancelRequested = false;
    downloadZipBtn.disabled = true;
    cancelBtn.style.display = 'block';
    progressWrap.classList.add('visible');
    progressFill.style.width = '0%';

    const zip = new JSZip();
    const rootFolder = zip.folder('MyClips');
    const useSubfolders = subfoldersCheck.checked;

    let completed = 0;
    let addedFiles = 0;
    let idx = 0;
    const concurrency = 4;

    try {
        async function worker() {
            while (idx < clipsToDownload.length && !cancelRequested) {
                const current = clipsToDownload[idx++];
                progressLabel.textContent = `Fetching: ${current.contentTitle || 'Clip'}...`;
                progressCount.textContent = `${completed} / ${clipsToDownload.length}`;
                try {
                    const resp = await fetch(current._videoUrl);
                    if (resp.ok) {
                        const buf = await resp.arrayBuffer();
                        if (buf.byteLength > 1000) {
                            if (useSubfolders) {
                                rootFolder.folder(sanitize(current._game)).file(current._filename, buf, { binary: true, compression: 'STORE' });
                            } else {
                                rootFolder.file(current._filename, buf, { binary: true, compression: 'STORE' });
                            }
                            addedFiles++;
                        }
                    }
                } catch (err) {
                    console.warn('Skipped clip:', current._filename, err);
                }
                completed++;
                const pct = Math.round((completed / clipsToDownload.length) * 100);
                progressFill.style.width = `${pct}%`;
                progressCount.textContent = `${completed} / ${clipsToDownload.length}`;
            }
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, clipsToDownload.length) }, () => worker()));

        if (cancelRequested) {
            progressLabel.textContent = 'Download cancelled.';
            return;
        }

        progressLabel.textContent = `Packing ${addedFiles} clips into MyClips.zip...`;
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
            progressLabel.textContent = `Building MyClips.zip (${Math.round(meta.percent)}%)...`;
        });

        const blobUrl = URL.createObjectURL(zipBlob);
        const zipFilename = `MyClips_${sanitize(activeTargetUser.userName)}.zip`;

        await chrome.downloads.download({
            url: blobUrl,
            filename: zipFilename,
            conflictAction: 'uniquify'
        });

        setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
        progressLabel.textContent = `✅ Done! Saved ${zipFilename} (${addedFiles} videos).`;
        progressStatus.textContent = `Successfully packaged ${addedFiles} clips into a single ${zipFilename} file in your Downloads folder!`;
    } catch (e) {
        progressLabel.textContent = `Error: ${e.message}`;
    } finally {
        isDownloading = false;
        cancelBtn.style.display = 'none';
        updateSummary();
    }
});

initExtension();
