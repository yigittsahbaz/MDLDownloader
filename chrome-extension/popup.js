import {
    escapeHtml,
    getCookieSession,
    ensureAuthHeader,
    fetchUserProfileById,
    resolveUsernameOrUrl,
    scanClipsForUser
} from './shared.js';

let sessionAuth = null; // { userId, key, registeredUser, userName }
let activeTargetUser = { userId: '', userName: 'Archive' };
let allClips = [];
let gameCounts = {};
let selectedGames = new Set();
let isScanning = false;

const openFullTabBtn = document.getElementById('openFullTabBtn');
const sessionStatus = document.getElementById('sessionStatus');
const actionSessionBtn = document.getElementById('actionSessionBtn');
const manualSearchForm = document.getElementById('manualSearchForm');
const manualProfileInput = document.getElementById('manualProfileInput');
const manualScanBtn = document.getElementById('manualScanBtn');

const gamesSection = document.getElementById('gamesSection');
const targetUserLabel = document.getElementById('targetUserLabel');
const gamesList = document.getElementById('gamesList');
const toggleAllGames = document.getElementById('toggleAllGames');
const selectedClipsSummary = document.getElementById('selectedClipsSummary');
const subfoldersCheck = document.getElementById('subfoldersCheck');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const progressStatus = document.getElementById('progressStatus');

async function initPopup() {
    sessionAuth = await getCookieSession();
    if (sessionAuth && sessionAuth.registeredUser) {
        actionSessionBtn.classList.remove('secondary');
        actionSessionBtn.textContent = 'My Clips';
        sessionStatus.classList.add('logged');
        sessionStatus.textContent = `Logged in as ID ${sessionAuth.userId}`;

        // Lightweight single call to display the actual @username immediately (without scanning all clips yet!)
        const { header } = await ensureAuthHeader(sessionAuth);
        const profile = await fetchUserProfileById(sessionAuth.userId, header);
        sessionAuth.userName = profile.userName;
        sessionAuth.submissions = profile.submissions || 0;
        sessionStatus.textContent = `Logged in as @${profile.userName}`;
    } else {
        sessionStatus.classList.remove('logged');
        sessionStatus.textContent = 'Not logged in on medal.tv';
        actionSessionBtn.classList.add('secondary');
        actionSessionBtn.textContent = 'Log In on Medal.tv';
    }
}

async function runScan(userId, fallbackName, isOwnAccount, expectedTotal = 0) {
    if (isScanning) return;
    isScanning = true;
    manualScanBtn.disabled = true;
    if (sessionAuth?.registeredUser) actionSessionBtn.disabled = true;
    gamesSection.classList.remove('visible');
    downloadZipBtn.disabled = true;
    progressStatus.textContent = `Scanning clips for @${fallbackName}...`;

    try {
        const res = await scanClipsForUser({
            userId,
            fallbackName,
            isOwnAccount,
            sessionAuth,
            expectedTotal,
            onProgress: (count, _protectedCount, totalHint) => {
                const totalStr = totalHint > 0 ? ` / ~${totalHint}` : '';
                progressStatus.textContent = `Scanning clips... (${count}${totalStr} unlocked found)`;
            }
        });

        activeTargetUser = res.targetUser;
        allClips = res.clips;
        gameCounts = res.gameCounts;
        selectedGames = new Set(Object.keys(gameCounts));

        targetUserLabel.textContent = `@${activeTargetUser.userName} (${allClips.length} Clips)`;
        renderGamesList();
        gamesSection.classList.add('visible');

        if (allClips.length === 0 && res.protectedCount > 0) {
            progressStatus.innerHTML = `Found <strong>${Number(res.protectedCount)} clips</strong> on @${escapeHtml(activeTargetUser.userName)}, but they require logging in on Medal.tv.`;
        } else if (res.protectedCount > 0) {
            progressStatus.innerHTML = `Loaded <strong>${allClips.length} clips</strong> (${Number(res.protectedCount)} guest-protected skipped). Select games &amp; click below.`;
        } else {
            progressStatus.textContent = `Ready! Found ${allClips.length} clips across ${Object.keys(gameCounts).length} games for @${activeTargetUser.userName}.`;
        }
    } catch (err) {
        progressStatus.textContent = `Error: ${err.message}`;
    } finally {
        isScanning = false;
        manualScanBtn.disabled = false;
        if (sessionAuth?.registeredUser) actionSessionBtn.disabled = false;
    }
}

actionSessionBtn.addEventListener('click', () => {
    if (sessionAuth && sessionAuth.registeredUser) {
        const label = sessionAuth.userName || sessionAuth.userId;
        manualProfileInput.value = label;
        runScan(sessionAuth.userId, label, true, sessionAuth.submissions || 0);
    } else {
        chrome.tabs.create({ url: 'https://medal.tv/login' });
    }
});

manualSearchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = manualProfileInput.value.trim();
    if (!q || isScanning) return;
    try {
        progressStatus.textContent = `Resolving "${q}"...`;
        manualScanBtn.disabled = true;
        const resolved = await resolveUsernameOrUrl(q, sessionAuth);
        const isSelf = Boolean(sessionAuth?.registeredUser && String(sessionAuth.userId) === String(resolved.userId));
        await runScan(resolved.userId, resolved.userName, isSelf, resolved.submissions || 0);
    } catch (err) {
        progressStatus.textContent = `Error: ${err.message}`;
        manualScanBtn.disabled = false;
    }
});

function renderGamesList() {
    gamesList.innerHTML = '';
    const sorted = Object.entries(gameCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
        gamesList.innerHTML = '<div style="padding:10px; color:#9ca3af; text-align:center;">No unlocked clips found for this profile.</div>';
        updateSummary();
        return;
    }
    for (const [gameName, count] of sorted) {
        const label = document.createElement('label');
        label.className = 'game-row';
        const safeGame = escapeHtml(gameName);
        label.innerHTML = `
            <div class="game-left">
                <input type="checkbox" class="game-check" ${selectedGames.has(gameName) ? 'checked' : ''} />
                <span class="game-name" title="${safeGame}">${safeGame}</span>
            </div>
            <span class="game-count">${Number(count)} video${count > 1 ? 's' : ''}</span>
        `;
        label.querySelector('.game-check').addEventListener('change', (e) => {
            if (e.target.checked) selectedGames.add(gameName);
            else selectedGames.delete(gameName);
            updateSummary();
        });
        gamesList.appendChild(label);
    }
    updateSummary();
}

toggleAllGames.addEventListener('change', () => {
    selectedGames = toggleAllGames.checked ? new Set(Object.keys(gameCounts)) : new Set();
    renderGamesList();
});

function updateSummary() {
    let totalSelected = 0;
    for (const [g, count] of Object.entries(gameCounts)) {
        if (selectedGames.has(g)) totalSelected += count;
    }
    selectedClipsSummary.textContent = `${totalSelected} video${totalSelected !== 1 ? 's' : ''} selected`;
    toggleAllGames.checked = selectedGames.size > 0 && selectedGames.size === Object.keys(gameCounts).length;
    downloadZipBtn.disabled = totalSelected === 0;
    downloadZipBtn.textContent = `Open Full Downloader (${totalSelected} Clips) ↗`;
}

async function openDownloaderTab(withData) {
    if (withData) {
        await chrome.storage.local.set({
            mdlPendingJob: {
                createdAt: Date.now(),
                targetUser: activeTargetUser,
                clips: allClips,
                gameCounts,
                selectedGames: Array.from(selectedGames),
                useSubfolders: subfoldersCheck.checked
            }
        });
    } else {
        await chrome.storage.local.remove('mdlPendingJob');
    }
    chrome.tabs.create({ url: chrome.runtime.getURL('downloader.html') });
}

openFullTabBtn.addEventListener('click', () => {
    openDownloaderTab(allClips.length > 0);
});

downloadZipBtn.addEventListener('click', () => {
    openDownloaderTab(true);
});

initPopup();
