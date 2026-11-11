import { downloadZip } from './client-zip.js';
import {
    sanitize,
    formatBytes,
    getCookieSession,
    ensureAuthHeader,
    fetchUserProfileById,
    resolveUsernameOrUrl,
    scanClipsForUser
} from './shared.js';

let sessionAuth = null;
let activeTargetUser = { userId: '', userName: 'Archive' };
let allClips = [];
let gameCounts = {};
let selectedGames = new Set();
let failedClips = [];
let isDownloading = false;
let cancelRequested = false;
let abortController = null;

const sessionStatus = document.getElementById('sessionStatus');
const actionSessionBtn = document.getElementById('actionSessionBtn');
const manualSearchForm = document.getElementById('manualSearchForm');
const manualProfileInput = document.getElementById('manualProfileInput');
const manualScanBtn = document.getElementById('manualScanBtn');

const gamesPanel = document.getElementById('gamesPanel');
const toggleAllGames = document.getElementById('toggleAllGames');
const targetUserLabel = document.getElementById('targetUserLabel');
const selectedSummary = document.getElementById('selectedSummary');
const gamesGrid = document.getElementById('gamesGrid');
const subfoldersCheck = document.getElementById('subfoldersCheck');

const downloadZipBtn = document.getElementById('downloadZipBtn');
const downloadFolderBtn = document.getElementById('downloadFolderBtn');
const retryFailedBtn = document.getElementById('retryFailedBtn');
const failedCountEl = document.getElementById('failedCount');

const progressPanel = document.getElementById('progressPanel');
const progressLabel = document.getElementById('progressLabel');
const progressCount = document.getElementById('progressCount');
const progressFill = document.getElementById('progressFill');
const cancelBtn = document.getElementById('cancelBtn');
const statusNote = document.getElementById('statusNote');

async function initFullPage() {
    sessionAuth = await getCookieSession();
    if (sessionAuth && sessionAuth.registeredUser) {
        actionSessionBtn.className = 'btn btn-gold';
        actionSessionBtn.textContent = 'My Clips';
        sessionStatus.classList.add('logged');
        sessionStatus.textContent = `Logged in as ID ${sessionAuth.userId}`;
        const { header } = await ensureAuthHeader(sessionAuth);
        const profile = await fetchUserProfileById(sessionAuth.userId, header);
        sessionAuth.userName = profile.userName;
        sessionStatus.textContent = `Logged in as @${profile.userName}`;
    } else {
        sessionStatus.classList.remove('logged');
        sessionStatus.textContent = 'Not logged in on medal.tv';
        actionSessionBtn.className = 'btn btn-dark';
        actionSessionBtn.textContent = 'Log In on Medal.tv';
    }

    // Load pending job transferred from extension popup (zero re-scan needed)
    try {
        const stored = await chrome.storage.local.get('mdlPendingJob');
        const job = stored?.mdlPendingJob;
        if (job && Array.isArray(job.clips) && job.clips.length > 0 && Date.now() - job.createdAt < 1000 * 60 * 60) {
            activeTargetUser = job.targetUser || activeTargetUser;
            allClips = job.clips;
            gameCounts = job.gameCounts || {};
            selectedGames = new Set(job.selectedGames || Object.keys(gameCounts));
            subfoldersCheck.checked = job.useSubfolders !== false;
            targetUserLabel.textContent = `@${activeTargetUser.userName} (${allClips.length} Clips)`;
            renderGamesGrid();
            gamesPanel.style.display = 'block';
            statusNote.innerHTML = `Loaded <strong>${allClips.length} clips</strong> for <strong>@${activeTargetUser.userName}</strong>. Choose <strong>Download Single MyClips.zip</strong> below when ready.`;
        }
    } catch {}
}

async function runScan(userId, fallbackName, isOwnAccount) {
    if (isDownloading) return;
    manualScanBtn.disabled = true;
    actionSessionBtn.disabled = true;
    gamesPanel.style.display = 'none';
    statusNote.textContent = `Scanning clips for @${fallbackName}...`;

    try {
        const res = await scanClipsForUser({
            userId,
            fallbackName,
            isOwnAccount,
            sessionAuth,
            onProgress: (count) => {
                statusNote.textContent = `Scanning clips... (${count} unlocked found)`;
            }
        });

        activeTargetUser = res.targetUser;
        allClips = res.clips;
        gameCounts = res.gameCounts;
        selectedGames = new Set(Object.keys(gameCounts));
        targetUserLabel.textContent = `@${activeTargetUser.userName} (${allClips.length} Clips)`;
        renderGamesGrid();
        gamesPanel.style.display = 'block';

        if (allClips.length === 0 && res.protectedCount > 0) {
            statusNote.innerHTML = `Found <strong>${res.protectedCount} clips</strong> on @${activeTargetUser.userName}, but they require logging in on Medal.tv.`;
        } else if (res.protectedCount > 0) {
            statusNote.innerHTML = `Loaded <strong>${allClips.length} unlocked clips</strong> for @${activeTargetUser.userName} (${res.protectedCount} guest-protected skipped).`;
        } else {
            statusNote.innerHTML = `Ready! Found <strong>${allClips.length} clips</strong> across ${Object.keys(gameCounts).length} games for @${activeTargetUser.userName}.`;
        }
    } catch (err) {
        statusNote.textContent = `Error: ${err.message}`;
    } finally {
        manualScanBtn.disabled = false;
        actionSessionBtn.disabled = false;
    }
}

actionSessionBtn.addEventListener('click', () => {
    if (sessionAuth && sessionAuth.registeredUser) {
        const label = sessionAuth.userName || sessionAuth.userId;
        manualProfileInput.value = label;
        runScan(sessionAuth.userId, label, true);
    } else {
        chrome.tabs.create({ url: 'https://medal.tv/login' });
    }
});

manualSearchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = manualProfileInput.value.trim();
    if (!q || isDownloading) return;
    try {
        manualScanBtn.disabled = true;
        statusNote.textContent = `Resolving "${q}"...`;
        const resolved = await resolveUsernameOrUrl(q, sessionAuth);
        const isSelf = Boolean(sessionAuth?.registeredUser && String(sessionAuth.userId) === String(resolved.userId));
        await runScan(resolved.userId, resolved.userName, isSelf);
    } catch (err) {
        statusNote.textContent = `Error: ${err.message}`;
        manualScanBtn.disabled = false;
    }
});

function getSelectedClips() {
    return allClips.filter(c => selectedGames.has(c.game) && c.videoUrl);
}

function estimateClipBytes(clips) {
    let total = 0;
    for (const c of clips) {
        const sec = Number(c.duration) || 25;
        const h = Number(c.height) || 1080;
        const bps = h >= 1440 ? (750 * 1024) : (h >= 1080 ? (520 * 1024) : (350 * 1024));
        const minB = h >= 1080 ? (14 * 1024 * 1024) : (10 * 1024 * 1024);
        total += Math.max(sec * bps, minB);
    }
    return total;
}

function renderGamesGrid() {
    gamesGrid.innerHTML = '';
    const sorted = Object.entries(gameCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
        gamesGrid.innerHTML = '<div style="grid-column:1/-1; padding:14px; color:#9ca3af; text-align:center;">No unlocked clips found.</div>';
        updateSummary();
        return;
    }
    for (const [gameName, count] of sorted) {
        const label = document.createElement('label');
        label.className = 'game-item';
        label.innerHTML = `
            <div class="game-left">
                <input type="checkbox" class="game-check" ${selectedGames.has(gameName) ? 'checked' : ''} />
                <span class="game-name" title="${gameName.replace(/"/g, '&quot;')}">${gameName}</span>
            </div>
            <span class="game-count">${count}</span>
        `;
        label.querySelector('.game-check').addEventListener('change', (e) => {
            if (e.target.checked) selectedGames.add(gameName);
            else selectedGames.delete(gameName);
            updateSummary();
        });
        gamesGrid.appendChild(label);
    }
    updateSummary();
}

toggleAllGames.addEventListener('change', () => {
    selectedGames = toggleAllGames.checked ? new Set(Object.keys(gameCounts)) : new Set();
    renderGamesGrid();
});

function updateSummary() {
    const selected = getSelectedClips();
    const estBytes = estimateClipBytes(selected);
    selectedSummary.textContent = `${selected.length} clips selected • est. ~${formatBytes(estBytes)}`;
    toggleAllGames.checked = selectedGames.size > 0 && selectedGames.size === Object.keys(gameCounts).length;
    downloadZipBtn.disabled = selected.length === 0 || isDownloading;
    downloadFolderBtn.disabled = selected.length === 0 || isDownloading;
    downloadZipBtn.textContent = `Download Single MyClips_${sanitize(activeTargetUser.userName)}.zip (${selected.length})`;
}

async function fetchDirectClipBuffer(clip, signal) {
    for (let attempt = 0; attempt < 2; attempt++) {
        if (signal && signal.aborted) return null;
        try {
            const resp = await fetch(clip.videoUrl, { signal });
            if (!resp.ok) {
                if (resp.status >= 500 && attempt === 0) {
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }
                return null;
            }
            const buf = await resp.arrayBuffer();
            if (buf && buf.byteLength > 1000) return buf;
            return null;
        } catch (err) {
            if (err && err.name === 'AbortError') return null;
            if (attempt === 0) await new Promise(r => setTimeout(r, 500));
        }
    }
    return null;
}

function buildEntryPath(clip, useSubfolders) {
    return useSubfolders ? `MyClips/${sanitize(clip.game)}/${clip.filename}` : `MyClips/${clip.filename}`;
}

cancelBtn.addEventListener('click', () => {
    cancelRequested = true;
    if (abortController) abortController.abort();
    progressLabel.textContent = 'Cancelling...';
});

async function startSingleZipDownload(clipsToDownload) {
    if (isDownloading || clipsToDownload.length === 0) return;

    const useSubfolders = subfoldersCheck.checked;
    const zipFilename = `MyClips_${sanitize(activeTargetUser.userName)}.zip`;

    // Prefer File System Access API streaming so even 2,000 clips (60GB+) stream into ONE ZIP with near-zero RAM
    let fileHandle = null;
    if ('showSaveFilePicker' in window) {
        try {
            fileHandle = await window.showSaveFilePicker({
                suggestedName: zipFilename,
                types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }]
            });
        } catch (err) {
            if (err && err.name === 'AbortError') return; // User closed Save As dialog
            fileHandle = null; // Fallback if disabled (e.g., Brave default)
        }
    }

    isDownloading = true;
    cancelRequested = false;
    abortController = new AbortController();
    failedClips = [];
    retryFailedBtn.style.display = 'none';
    downloadZipBtn.disabled = true;
    downloadFolderBtn.disabled = true;
    progressPanel.classList.add('visible');
    progressFill.style.width = '0%';
    progressCount.textContent = `0 / ${clipsToDownload.length}`;

    let completed = 0;
    let addedFiles = 0;
    let totalBytes = 0;
    const failed = [];

    try {
        if (fileHandle) {
            // STREAMING SINGLE ZIP DIRECTLY TO DISK
            const writable = await fileHandle.createWritable();
            const LOOKAHEAD = 3;
            const prefetched = new Map();
            let nextToFetch = 0;

            function scheduleMore() {
                while (nextToFetch < clipsToDownload.length && prefetched.size < LOOKAHEAD && !cancelRequested) {
                    const i = nextToFetch++;
                    prefetched.set(i, fetchDirectClipBuffer(clipsToDownload[i], abortController.signal));
                }
            }

            async function* streamingEntries() {
                scheduleMore();
                for (let i = 0; i < clipsToDownload.length; i++) {
                    if (cancelRequested) break;
                    const clip = clipsToDownload[i];
                    progressLabel.textContent = `Streaming to disk: ${clip.title}...`;
                    const buf = await prefetched.get(i);
                    prefetched.delete(i);
                    scheduleMore();
                    if (cancelRequested) break;

                    if (buf) {
                        addedFiles++;
                        totalBytes += buf.byteLength;
                        yield {
                            name: buildEntryPath(clip, useSubfolders),
                            lastModified: new Date(Number(clip.created) || Date.now()),
                            input: buf
                        };
                    } else {
                        failed.push(clip);
                    }

                    completed++;
                    const pct = Math.round((completed / clipsToDownload.length) * 100);
                    progressFill.style.width = `${pct}%`;
                    progressCount.textContent = `${completed} / ${clipsToDownload.length} (${formatBytes(totalBytes)})`;
                }
            }

            const zipResp = downloadZip(streamingEntries());
            await zipResp.body.pipeTo(writable, { signal: abortController.signal }).catch(async (err) => {
                try { await writable.abort(); } catch {}
                if (err?.name !== 'AbortError') throw err;
            });

            if (cancelRequested) {
                progressLabel.textContent = 'Download cancelled.';
                return;
            }
            if (addedFiles === 0) {
                progressLabel.textContent = 'Could not fetch video streams. Please re-scan the profile and try again.';
                return;
            }
        } else {
            // SINGLE IN-MEMORY ZIP FALLBACK (No splitting! Works when showSaveFilePicker is disabled, e.g., Brave default)
            const entries = [];
            let idx = 0;
            const concurrency = 4;

            async function worker() {
                while (idx < clipsToDownload.length && !cancelRequested) {
                    const clip = clipsToDownload[idx++];
                    progressLabel.textContent = `Fetching: ${clip.title}...`;
                    const buf = await fetchDirectClipBuffer(clip, abortController.signal);
                    if (buf) {
                        entries.push({
                            name: buildEntryPath(clip, useSubfolders),
                            lastModified: new Date(Number(clip.created) || Date.now()),
                            input: buf
                        });
                        addedFiles++;
                        totalBytes += buf.byteLength;
                    } else if (!cancelRequested) {
                        failed.push(clip);
                    }
                    completed++;
                    const pct = Math.round((completed / clipsToDownload.length) * 100);
                    progressFill.style.width = `${pct}%`;
                    progressCount.textContent = `${completed} / ${clipsToDownload.length} (${formatBytes(totalBytes)})`;
                }
            }

            await Promise.all(Array.from({ length: Math.min(concurrency, clipsToDownload.length) }, () => worker()));

            if (cancelRequested) {
                progressLabel.textContent = 'Download cancelled.';
                return;
            }
            if (addedFiles === 0) {
                progressLabel.textContent = 'Could not fetch video streams. Please re-scan the profile and try again.';
                return;
            }

            progressLabel.textContent = `Packaging single ${zipFilename} (${addedFiles} clips, ${formatBytes(totalBytes)})...`;
            const blob = await downloadZip(entries).blob();
            const blobUrl = URL.createObjectURL(blob);
            await chrome.downloads.download({
                url: blobUrl,
                filename: zipFilename,
                conflictAction: 'uniquify'
            });
            setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
        }

        if (failed.length > 0) {
            failedClips = failed;
            failedCountEl.textContent = failed.length;
            retryFailedBtn.style.display = 'inline-block';
            progressLabel.textContent = `Completed! Saved ${addedFiles} clips (${formatBytes(totalBytes)}) into ${zipFilename} (${failed.length} failed — click Retry Failed).`;
        } else {
            progressLabel.textContent = `Completed! Saved ${addedFiles} clips (${formatBytes(totalBytes)}) into ${zipFilename}.`;
        }
    } catch (err) {
        if (err && err.name === 'AbortError') {
            progressLabel.textContent = 'Download cancelled.';
        } else {
            progressLabel.textContent = `Error: ${err.message}. Tip: For huge 2GB+ archives on Brave, use Save to Local Folder or our Web Downloader.`;
        }
    } finally {
        isDownloading = false;
        abortController = null;
        updateSummary();
    }
}

downloadZipBtn.addEventListener('click', () => {
    startSingleZipDownload(getSelectedClips());
});

retryFailedBtn.addEventListener('click', () => {
    if (failedClips.length > 0 && !isDownloading) {
        startSingleZipDownload([...failedClips]);
    }
});

// Direct Local Folder download (ideal if user wants uncompressed folders with resume support)
downloadFolderBtn.addEventListener('click', async () => {
    if (isDownloading) return;
    const selected = getSelectedClips();
    if (selected.length === 0) return;

    if (!('showDirectoryPicker' in window)) {
        return alert('Your browser blocks direct folder selection (e.g., Brave default settings). Please use "Download Single MyClips.zip" instead.');
    }

    let rootHandle;
    try {
        rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch {
        return;
    }

    isDownloading = true;
    cancelRequested = false;
    abortController = new AbortController();
    failedClips = [];
    retryFailedBtn.style.display = 'none';
    downloadZipBtn.disabled = true;
    downloadFolderBtn.disabled = true;
    progressPanel.classList.add('visible');
    progressFill.style.width = '0%';
    progressCount.textContent = `0 / ${selected.length}`;

    const useSubfolders = subfoldersCheck.checked;
    let completed = 0;
    let saved = 0;
    let skipped = 0;
    const failed = [];

    try {
        const myClipsHandle = await rootHandle.getDirectoryHandle('MyClips', { create: true });
        let idx = 0;
        const concurrency = 4;

        async function worker() {
            while (idx < selected.length && !cancelRequested) {
                const clip = selected[idx++];
                progressLabel.textContent = `Saving: ${clip.filename}...`;
                let ok = false;
                try {
                    let targetDir = myClipsHandle;
                    if (useSubfolders) {
                        targetDir = await myClipsHandle.getDirectoryHandle(sanitize(clip.game), { create: true });
                    }
                    try {
                        const ex = await targetDir.getFileHandle(clip.filename);
                        const f = await ex.getFile();
                        if (f && f.size > 1000) {
                            skipped++;
                            ok = true;
                            completed++;
                            progressFill.style.width = `${Math.round((completed / selected.length) * 100)}%`;
                            progressCount.textContent = `${completed} / ${selected.length}`;
                            continue;
                        }
                    } catch {}

                    const fh = await targetDir.getFileHandle(clip.filename, { create: true });
                    const resp = await fetch(clip.videoUrl, { signal: abortController.signal });
                    if (resp.ok && resp.body) {
                        const writable = await fh.createWritable();
                        await resp.body.pipeTo(writable);
                        saved++;
                        ok = true;
                    }
                } catch {}
                if (!ok && !cancelRequested) failed.push(clip);
                completed++;
                progressFill.style.width = `${Math.round((completed / selected.length) * 100)}%`;
                progressCount.textContent = `${completed} / ${selected.length}`;
            }
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, () => worker()));

        if (cancelRequested) {
            progressLabel.textContent = 'Cancelled.';
        } else if (failed.length > 0) {
            failedClips = failed;
            failedCountEl.textContent = failed.length;
            retryFailedBtn.style.display = 'inline-block';
            progressLabel.textContent = `Completed! Saved ${saved} clips (${skipped} skipped, ${failed.length} failed — click Retry Failed).`;
        } else {
            progressLabel.textContent = `Completed! Saved ${saved} clips to MyClips folder (${skipped} skipped as existing).`;
        }
    } catch (err) {
        progressLabel.textContent = `Error: ${err.message}`;
    } finally {
        isDownloading = false;
        abortController = null;
        updateSummary();
    }
});

initFullPage();
