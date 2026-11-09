// MDLDownloader Client-Side Logic (Clean TikWM-style UI, Zero AI Slop)

const state = {
    profile: null,
    allClips: [],
    filteredClips: [],
    selectedIds: new Set(),
    preselectedGames: null,
    cancelRequested: false,
    isDownloading: false
};

const searchForm = document.getElementById('searchForm');
const profileInput = document.getElementById('profileInput');
const authKeyInput = document.getElementById('authKeyInput');
const toggleAuthBtn = document.getElementById('toggleAuthBtn');
const authPanel = document.getElementById('authPanel');
const authArrow = document.getElementById('authArrow');
const showKeyBtn = document.getElementById('showKeyBtn');
const copySnippetBtn = document.getElementById('copySnippetBtn');
const consoleSnippet = document.getElementById('consoleSnippet');
const scanBtn = document.getElementById('scanBtn');

const statusBox = document.getElementById('statusBox');
const profileAvatar = document.getElementById('profileAvatar');
const statusTitle = document.getElementById('statusTitle');
const statusSub = document.getElementById('statusSub');
const protectedWarning = document.getElementById('ProtectedWarning');

const controlsSection = document.getElementById('controlsSection');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const groupByGameCheckbox = document.getElementById('groupByGameCheckbox');
const selectedCountEl = document.getElementById('selectedCount');
const gameFilter = document.getElementById('gameFilter');
const titleSearch = document.getElementById('titleSearch');
const clipsGrid = document.getElementById('clipsGrid');

const downloadZipBtn = document.getElementById('downloadZipBtn');
const downloadFolderBtn = document.getElementById('downloadFolderBtn');
const exportLinksBtn = document.getElementById('exportLinksBtn');

const downloadProgressPanel = document.getElementById('downloadProgressPanel');
const progressText = document.getElementById('progressText');
const progressStats = document.getElementById('progressStats');
const progressBar = document.getElementById('progressBar');
const cancelDownloadBtn = document.getElementById('cancelDownloadBtn');

window.addEventListener('DOMContentLoaded', () => {
    if (window.location.hash.length > 1) {
        const params = new URLSearchParams(window.location.hash.substring(1));
        const u = params.get('username') || params.get('userId');
        const k = params.get('key');
        const g = params.get('games');
        if (u) profileInput.value = u;
        if (k) {
            authKeyInput.value = k;
            authPanel.classList.add('open');
            authArrow.textContent = '▾';
        }
        if (g) {
            state.preselectedGames = new Set(g.split('||').filter(Boolean));
        }
        history.replaceState(null, '', window.location.pathname);
        if (u) searchForm.requestSubmit();
    }
});

toggleAuthBtn.addEventListener('click', () => {
    const isOpen = authPanel.classList.toggle('open');
    authArrow.textContent = isOpen ? '▾' : '▸';
});

showKeyBtn.addEventListener('click', () => {
    authKeyInput.type = authKeyInput.type === 'password' ? 'text' : 'password';
    showKeyBtn.textContent = authKeyInput.type === 'password' ? 'Show' : 'Hide';
});

copySnippetBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(consoleSnippet.textContent.trim());
    copySnippetBtn.textContent = 'Copied';
    setTimeout(() => { copySnippetBtn.textContent = 'Copy'; }, 2000);
});

function sanitizeFilename(name) {
    const clean = (name || 'Untitled').replace(/[\\/*?:"<>|]/g, '_').trim();
    return clean.slice(0, 75) || 'Untitled';
}

function formatDuration(sec) {
    const s = Math.round(Number(sec) || 0);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, '0')}`;
}

function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
}

searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = profileInput.value.trim();
    const authKey = authKeyInput.value.trim();
    if (!query) return;

    scanBtn.disabled = true;
    scanBtn.textContent = 'Loading...';
    statusBox.classList.add('visible');
    protectedWarning.style.display = 'none';
    controlsSection.classList.remove('visible');
    profileAvatar.style.display = 'none';
    statusTitle.textContent = `Resolving "${query}"...`;
    statusSub.textContent = 'Connecting to Medal.tv API...';

    try {
        const res = await fetch(`/api/resolve?q=${encodeURIComponent(query)}`);
        const profile = await res.json();
        if (!res.ok || profile.error) {
            throw new Error(profile.error || 'Could not find user profile.');
        }

        state.profile = profile;
        if (profile.thumbnail) {
            profileAvatar.src = profile.thumbnail;
            profileAvatar.style.display = 'block';
        }
        statusTitle.textContent = `${profile.displayName} (@${profile.userName})`;
        statusSub.textContent = 'Fetching clips...';

        const all = [];
        const seen = new Set();
        let offset = 0;
        const limit = 50;

        while (true) {
            const cRes = await fetch(`/api/clips?userId=${encodeURIComponent(profile.userId)}&limit=${limit}&offset=${offset}`, {
                headers: authKey ? { 'X-Custom-Auth': authKey } : {}
            });
            const cData = await cRes.json();
            if (!cRes.ok || cData.error) {
                throw new Error(cData.error || 'Failed to load clips.');
            }
            const batch = cData.items || [];
            if (batch.length === 0) break;

            for (const item of batch) {
                if (item.contentId && !seen.has(item.contentId)) {
                    seen.add(item.contentId);
                    all.push(item);
                }
            }
            statusSub.textContent = `Loaded ${all.length} clips...`;
            if (batch.length < limit) break;
            offset += limit;
        }

        all.forEach((c, i) => {
            c.index = i + 1;
            c.filename = `${String(i + 1).padStart(3, '0')}_${sanitizeFilename(c.title)}_${c.contentId}.mp4`;
        });

        state.allClips = all;
        state.selectedIds = new Set(
            all.filter(c => {
                if (!c.videoUrl || c.isProtected) return false;
                if (state.preselectedGames && state.preselectedGames.size > 0) {
                    return state.preselectedGames.has(c.categoryName);
                }
                return true;
            }).map(c => c.contentId)
        );
        state.preselectedGames = null;

        const protectedCount = all.filter(c => c.isProtected).length;
        const downloadableCount = all.filter(c => c.videoUrl && !c.isProtected).length;

        statusSub.textContent = `Total: ${all.length} clips (${downloadableCount} unlocked and ready).`;
        if (protectedCount > 0) {
            protectedWarning.style.display = 'block';
            protectedWarning.textContent = `Note: ${protectedCount} clip(s) require a session key ("Require Login to Watch" is enabled on this profile).`;
        }

        populateFilters();
        applyFiltersAndRender();
        controlsSection.classList.add('visible');
    } catch (err) {
        statusTitle.textContent = 'Error';
        statusSub.textContent = err.message;
    } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = 'Download';
    }
});

function populateFilters() {
    const games = Array.from(new Set(state.allClips.map(c => c.categoryName))).sort();
    gameFilter.innerHTML = `<option value="ALL">All Games (${state.allClips.length})</option>`;
    for (const g of games) {
        const count = state.allClips.filter(c => c.categoryName === g).length;
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = `${g} (${count})`;
        gameFilter.appendChild(opt);
    }
}

function applyFiltersAndRender() {
    const gVal = gameFilter.value;
    const qVal = titleSearch.value.trim().toLowerCase();

    state.filteredClips = state.allClips.filter(c => {
        if (gVal !== 'ALL' && c.categoryName !== gVal) return false;
        if (qVal && !c.title.toLowerCase().includes(qVal)) return false;
        return true;
    });

    renderGrid();
    updateCounts();
}

gameFilter.addEventListener('change', applyFiltersAndRender);
titleSearch.addEventListener('input', applyFiltersAndRender);

selectAllCheckbox.addEventListener('change', () => {
    const check = selectAllCheckbox.checked;
    for (const c of state.filteredClips) {
        if (c.videoUrl && !c.isProtected) {
            if (check) state.selectedIds.add(c.contentId);
            else state.selectedIds.delete(c.contentId);
        }
    }
    renderGrid();
    updateCounts();
});

function updateCounts() {
    selectedCountEl.textContent = state.selectedIds.size;
    const downloadableFiltered = state.filteredClips.filter(c => c.videoUrl && !c.isProtected);
    selectAllCheckbox.checked = downloadableFiltered.length > 0 && downloadableFiltered.every(c => state.selectedIds.has(c.contentId));
}

function renderGrid() {
    clipsGrid.innerHTML = '';
    if (state.filteredClips.length === 0) {
        clipsGrid.innerHTML = '<div style="grid-column: 1/-1; padding: 24px; text-align: center; color: #8a8f98; font-size: 13px;">No clips found matching your filter.</div>';
        return;
    }

    const frag = document.createDocumentFragment();
    for (const clip of state.filteredClips) {
        const isSelected = state.selectedIds.has(clip.contentId);
        const card = document.createElement('div');
        card.className = `clip-card ${isSelected ? 'selected' : ''}`;

        const proxyHref = `/api/proxy-video?url=${encodeURIComponent(clip.videoUrl || '')}&filename=${encodeURIComponent(clip.filename)}`;

        card.innerHTML = `
            <div>
                <div class="thumb-wrap">
                    ${clip.thumbnail ? `<img src="${clip.thumbnail}" loading="lazy" alt="" />` : ''}
                    <label class="thumb-top-left" style="cursor: pointer;">
                        <input type="checkbox" class="clip-check" data-id="${clip.contentId}" ${isSelected ? 'checked' : ''} ${clip.isProtected || !clip.videoUrl ? 'disabled' : ''} />
                        <span>#${String(clip.index).padStart(3, '0')}</span>
                    </label>
                    <span class="thumb-duration">${formatDuration(clip.duration)}</span>
                </div>
                <div class="clip-body">
                    <div class="clip-title" title="${clip.title.replace(/"/g, '&quot;')}">${clip.title}</div>
                    <div class="clip-meta">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;">${clip.categoryName}</span>
                        <span>${formatDate(clip.created)}</span>
                    </div>
                </div>
            </div>
            <div class="clip-footer">
                <span style="color:#6b7280;font-family:Consolas,monospace;">${clip.contentId}</span>
                ${!clip.isProtected && clip.videoUrl
                    ? `<a href="${proxyHref}" download="${clip.filename}" class="dl-link">Download MP4</a>`
                    : `<span style="color:#ef4444;">Session Key Required</span>`
                }
            </div>
        `;

        const checkbox = card.querySelector('.clip-check');

        // Toggle selection by clicking ANYWHERE on the card (except on "Download MP4" link)
        card.addEventListener('click', (e) => {
            if (e.target.closest('a') || clip.isProtected || !clip.videoUrl) return;
            // If user clicked the checkbox itself, the checkbox change event handles state
            if (e.target === checkbox) return;
            const newChecked = !state.selectedIds.has(clip.contentId);
            if (newChecked) state.selectedIds.add(clip.contentId);
            else state.selectedIds.delete(clip.contentId);
            checkbox.checked = newChecked;
            card.classList.toggle('selected', newChecked);
            updateCounts();
        });

        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) state.selectedIds.add(clip.contentId);
            else state.selectedIds.delete(clip.contentId);
            card.classList.toggle('selected', e.target.checked);
            updateCounts();
        });

        // YouTube-style Hover Video Preview (Muted, lightweight loop)
        if (clip.videoUrl && !clip.isProtected) {
            let previewVideo = null;
            let hoverTimer = null;

            card.addEventListener('mouseenter', () => {
                hoverTimer = setTimeout(() => {
                    const thumbWrap = card.querySelector('.thumb-wrap');
                    if (!thumbWrap) return;
                    if (!previewVideo) {
                        previewVideo = document.createElement('video');
                        previewVideo.muted = true;
                        previewVideo.loop = true;
                        previewVideo.playsInline = true;
                        previewVideo.preload = 'metadata';
                        previewVideo.src = `/api/proxy-video?url=${encodeURIComponent(clip.videoUrl)}&filename=${encodeURIComponent(clip.filename)}`;
                        previewVideo.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:2;pointer-events:none;';
                        thumbWrap.appendChild(previewVideo);
                    }
                    previewVideo.style.display = 'block';
                    previewVideo.play().catch(() => {});
                }, 250); // Small 250ms delay to prevent accidental bandwidth spam while fast-scrolling
            });

            card.addEventListener('mouseleave', () => {
                if (hoverTimer) clearTimeout(hoverTimer);
                if (previewVideo) {
                    previewVideo.pause();
                    previewVideo.style.display = 'none';
                }
            });
        }

        frag.appendChild(card);
    }
    clipsGrid.appendChild(frag);
}

cancelDownloadBtn.addEventListener('click', () => {
    state.cancelRequested = true;
    progressText.textContent = 'Cancelling...';
});

function getSelectedClips() {
    return state.allClips.filter(c => state.selectedIds.has(c.contentId) && c.videoUrl && !c.isProtected);
}

// Download as MyClips.zip
downloadZipBtn.addEventListener('click', async () => {
    if (state.isDownloading) return;
    const selected = getSelectedClips();
    if (selected.length === 0) {
        return alert('No unlocked clips available to download. If clips say "Session Key Required", add a session key above and click Download again.');
    }

    state.isDownloading = true;
    state.cancelRequested = false;
    downloadProgressPanel.classList.add('visible');
    progressBar.style.width = '0%';

    const zip = new JSZip();
    const folder = zip.folder('MyClips');
    let completed = 0;
    let addedFiles = 0;

    try {
        const concurrency = 4;
        let idx = 0;

        async function worker() {
            while (idx < selected.length && !state.cancelRequested) {
                const current = selected[idx++];
                progressText.textContent = `Downloading: ${current.title}...`;
                progressStats.textContent = `${completed} / ${selected.length}`;
                try {
                    const proxyUrl = `/api/proxy-video?url=${encodeURIComponent(current.videoUrl)}&filename=${encodeURIComponent(current.filename)}`;
                    const resp = await fetch(proxyUrl);
                    if (resp.ok) {
                        const buf = await resp.arrayBuffer();
                        if (buf.byteLength > 1000) {
                            const shouldGroup = groupByGameCheckbox ? groupByGameCheckbox.checked : true;
                            if (shouldGroup) {
                                const gameFolder = sanitizeFilename(current.categoryName || 'General');
                                folder.folder(gameFolder).file(current.filename, buf, { binary: true, compression: 'STORE' });
                            } else {
                                folder.file(current.filename, buf, { binary: true, compression: 'STORE' });
                            }
                            addedFiles++;
                        }
                    }
                } catch (e) {
                    console.warn('Error fetching clip:', current.filename, e);
                }
                completed++;
                const pct = Math.round((completed / selected.length) * 100);
                progressBar.style.width = `${pct}%`;
                progressStats.textContent = `${completed} / ${selected.length}`;
            }
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, () => worker()));

        if (state.cancelRequested) {
            progressText.textContent = 'Download cancelled.';
            return;
        }

        if (addedFiles === 0) {
            progressText.textContent = 'Could not download video streams. Try adding a Session Key if clips are protected.';
            return;
        }

        progressText.textContent = `Building MyClips.zip (${addedFiles} videos)...`;
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
            progressText.textContent = `Packing MyClips.zip (${Math.round(meta.percent)}%)...`;
        });

        const downloadUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `MyClips_${state.profile?.userName || 'Archive'}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);

        progressText.textContent = `Completed! MyClips_${state.profile?.userName || 'Archive'}.zip (${addedFiles} clips) downloaded.`;
    } catch (err) {
        progressText.textContent = `Error: ${err.message}`;
    } finally {
        state.isDownloading = false;
    }
});

// Save Directly to Local Folder
downloadFolderBtn.addEventListener('click', async () => {
    if (state.isDownloading) return;
    const selected = getSelectedClips();
    if (selected.length === 0) {
        return alert('No unlocked clips selected.');
    }

    if (!('showDirectoryPicker' in window)) {
        return alert('Your browser does not support direct folder selection. Please use "Download MyClips.zip" instead.');
    }

    let rootDirHandle;
    try {
        rootDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
        return;
    }

    state.isDownloading = true;
    state.cancelRequested = false;
    downloadProgressPanel.classList.add('visible');
    progressBar.style.width = '0%';

    try {
        const myClipsHandle = await rootDirHandle.getDirectoryHandle('MyClips', { create: true });
        let completed = 0;
        const concurrency = 4;
        let idx = 0;

        async function worker() {
            while (idx < selected.length && !state.cancelRequested) {
                const current = selected[idx++];
                progressText.textContent = `Saving: MyClips/${current.filename}...`;
                progressStats.textContent = `${completed} / ${selected.length}`;
                try {
                    const shouldGroup = groupByGameCheckbox ? groupByGameCheckbox.checked : true;
                    let targetDir = myClipsHandle;
                    if (shouldGroup) {
                        const gameFolder = sanitizeFilename(current.categoryName || 'General');
                        targetDir = await myClipsHandle.getDirectoryHandle(gameFolder, { create: true });
                    }
                    const fileHandle = await targetDir.getFileHandle(current.filename, { create: true });
                    const proxyUrl = `/api/proxy-video?url=${encodeURIComponent(current.videoUrl)}&filename=${encodeURIComponent(current.filename)}`;
                    const resp = await fetch(proxyUrl);
                    if (resp.ok && resp.body) {
                        const writable = await fileHandle.createWritable();
                        await resp.body.pipeTo(writable);
                    }
                } catch (e) {
                    console.warn('Failed saving clip:', current.filename, e);
                }
                completed++;
                const pct = Math.round((completed / selected.length) * 100);
                progressBar.style.width = `${pct}%`;
                progressStats.textContent = `${completed} / ${selected.length}`;
            }
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, () => worker()));

        if (state.cancelRequested) {
            progressText.textContent = 'Cancelled.';
        } else {
            progressText.textContent = `Completed! Saved ${completed} clips to MyClips folder.`;
        }
    } catch (err) {
        progressText.textContent = `Error: ${err.message}`;
    } finally {
        state.isDownloading = false;
    }
});

// Export Links (.txt)
exportLinksBtn.addEventListener('click', () => {
    const selected = getSelectedClips();
    if (selected.length === 0) {
        return alert('No unlocked clips selected.');
    }
    const lines = selected.map(c => c.videoUrl).join('\n');
    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MyClips_Links_${state.profile?.userName || 'list'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
});
