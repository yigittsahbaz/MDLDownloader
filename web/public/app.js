// MDLDownloader Client-Side Logic (Clean TikWM-style UI, Zero AI Slop)

const PAGE_SIZE = 36;

const state = {
    profile: null,
    allClips: [],
    filteredClips: [],
    selectedIds: new Set(),
    preselectedGames: null,
    currentPage: 1,
    lastAnchorId: null,
    cancelRequested: false,
    abortController: null,
    currentZipJobId: null,
    zipEventSource: null,
    isDownloading: false,
    failedClips: []
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
const dateFilter = document.getElementById('dateFilter');
const customDateWrap = document.getElementById('customDateWrap');
const dateFromInput = document.getElementById('dateFrom');
const dateToInput = document.getElementById('dateTo');
const sortFilter = document.getElementById('sortFilter');
const estSizeBadge = document.getElementById('estSizeBadge');
const largeLibraryNotice = document.getElementById('largeLibraryNotice');
const largeNoticeCount = document.getElementById('largeNoticeCount');
const retryFailedBtn = document.getElementById('retryFailedBtn');
const failedCountEl = document.getElementById('failedCount');
const titleSearch = document.getElementById('titleSearch');
const clipsGrid = document.getElementById('clipsGrid');
const paginationTop = document.getElementById('paginationTop');
const pageInfoTop = document.getElementById('pageInfoTop');
const pageButtonsTop = document.getElementById('pageButtonsTop');
const paginationBottom = document.getElementById('paginationBottom');
const pageInfoBottom = document.getElementById('pageInfoBottom');
const pageButtonsBottom = document.getElementById('pageButtonsBottom');

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

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isSafeHttpsUrl(url) {
    return typeof url === 'string' && /^https:\/\//i.test(url.trim());
}

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
        if (isSafeHttpsUrl(profile.thumbnail)) {
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
            const totalHint = profile.submissions && profile.submissions >= all.length ? ` / ~${profile.submissions}` : '';
            statusSub.textContent = `Loaded ${all.length}${totalHint} clips...`;
            if (batch.length < limit) break;
            offset += limit;
        }

        all.forEach((c, i) => {
            c.index = i + 1;
            c.filename = `${String(i + 1).padStart(4, '0')}_${sanitizeFilename(c.title)}_${c.contentId}.mp4`;
        });

        state.allClips = all;
        state.currentPage = 1;
        state.lastAnchorId = null;
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
        applyFiltersAndRender(true);
        controlsSection.classList.add('visible');
    } catch (err) {
        statusTitle.textContent = 'Error';
        statusSub.textContent = err.message;
    } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = 'Fetch Clips';
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

    if (dateFilter) {
        const yearCounts = new Map();
        for (const c of state.allClips) {
            const d = new Date(Number(c.created));
            if (!isNaN(d.getTime())) {
                const y = d.getFullYear();
                yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
            }
        }
        const years = Array.from(yearCounts.keys()).sort((a, b) => b - a);
        dateFilter.innerHTML = `
            <option value="ALL">All Dates (${state.allClips.length})</option>
            <option value="30D">Last 30 Days</option>
            <option value="90D">Last 3 Months</option>
            <option value="180D">Last 6 Months</option>
        `;
        for (const y of years) {
            const opt = document.createElement('option');
            opt.value = `YEAR:${y}`;
            opt.textContent = `Year ${y} (${yearCounts.get(y)})`;
            dateFilter.appendChild(opt);
        }
        const customOpt = document.createElement('option');
        customOpt.value = 'CUSTOM';
        customOpt.textContent = 'Custom Range...';
        dateFilter.appendChild(customOpt);
        if (customDateWrap) customDateWrap.style.display = 'none';
    }
}

function applyFiltersAndRender(resetPage = true) {
    const gVal = gameFilter.value;
    const qVal = titleSearch.value.trim().toLowerCase();
    const dVal = dateFilter ? dateFilter.value : 'ALL';

    if (customDateWrap) {
        customDateWrap.style.display = dVal === 'CUSTOM' ? 'inline-flex' : 'none';
    }

    let minTs = null;
    let maxTs = null;
    let targetYear = null;
    const now = Date.now();
    if (dVal === '30D') minTs = now - 30 * 86400000;
    else if (dVal === '90D') minTs = now - 90 * 86400000;
    else if (dVal === '180D') minTs = now - 180 * 86400000;
    else if (dVal.startsWith('YEAR:')) targetYear = Number(dVal.slice(5));
    else if (dVal === 'CUSTOM') {
        if (dateFromInput && dateFromInput.value) {
            minTs = new Date(`${dateFromInput.value}T00:00:00`).getTime();
        }
        if (dateToInput && dateToInput.value) {
            maxTs = new Date(`${dateToInput.value}T23:59:59.999`).getTime();
        }
    }

    state.filteredClips = state.allClips.filter(c => {
        if (gVal !== 'ALL' && c.categoryName !== gVal) return false;
        if (qVal && !c.title.toLowerCase().includes(qVal)) return false;
        const ts = Number(c.created);
        if (minTs !== null && (!ts || ts < minTs)) return false;
        if (maxTs !== null && (!ts || ts > maxTs)) return false;
        if (targetYear !== null) {
            const d = new Date(ts);
            if (isNaN(d.getTime()) || d.getFullYear() !== targetYear) return false;
        }
        return true;
    });

    // Sorting
    const sortVal = sortFilter ? sortFilter.value : 'newest';
    state.filteredClips.sort((a, b) => {
        if (sortVal === 'oldest') return (a.created || 0) - (b.created || 0);
        if (sortVal === 'views') return (b.views || 0) - (a.views || 0);
        if (sortVal === 'duration') return (b.duration || 0) - (a.duration || 0);
        return (b.created || 0) - (a.created || 0); // newest first (default)
    });

    if (resetPage) {
        state.currentPage = 1;
        state.lastAnchorId = null;
    }

    renderGrid();
    updateCounts();
}

gameFilter.addEventListener('change', () => applyFiltersAndRender(true));
if (dateFilter) dateFilter.addEventListener('change', () => applyFiltersAndRender(true));
if (dateFromInput) dateFromInput.addEventListener('change', () => applyFiltersAndRender(true));
if (dateToInput) dateToInput.addEventListener('change', () => applyFiltersAndRender(true));
if (sortFilter) sortFilter.addEventListener('change', () => applyFiltersAndRender(true));
titleSearch.addEventListener('input', () => applyFiltersAndRender(true));

selectAllCheckbox.addEventListener('change', () => {
    const check = selectAllCheckbox.checked;
    for (const c of state.filteredClips) {
        if (c.videoUrl && !c.isProtected) {
            if (check) state.selectedIds.add(c.contentId);
            else state.selectedIds.delete(c.contentId);
        }
    }
    syncVisibleCardsSelection();
    updateCounts();
});

function updateCounts() {
    selectedCountEl.textContent = state.selectedIds.size;
    const downloadableFiltered = state.filteredClips.filter(c => c.videoUrl && !c.isProtected);
    selectAllCheckbox.checked = downloadableFiltered.length > 0 && downloadableFiltered.every(c => state.selectedIds.has(c.contentId));

    // Calculate estimated total download size using resolution & duration
    let estBytes = 0;
    for (const c of state.allClips) {
        if (state.selectedIds.has(c.contentId)) {
            const sec = Number(c.duration) || 25;
            const h = Number(c.height) || 1080;
            const bytesPerSec = h >= 1440 ? (750 * 1024) : (h >= 1080 ? (520 * 1024) : (350 * 1024));
            const minBytes = h >= 1080 ? (14 * 1024 * 1024) : (10 * 1024 * 1024);
            estBytes += Math.max(sec * bytesPerSec, minBytes);
        }
    }
    if (estSizeBadge) {
        if (estBytes >= 1024 * 1024 * 1024) {
            estSizeBadge.textContent = `est. ~${(estBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        } else {
            estSizeBadge.textContent = `est. ~${Math.round(estBytes / (1024 * 1024))} MB`;
        }
    }

    // Show large library notice if 100+ clips or >= 1.5 GB estimated size selected
    if (largeLibraryNotice && largeNoticeCount) {
        const largeThresholdBytes = 1.5 * 1024 * 1024 * 1024;
        if (state.selectedIds.size >= 100 || estBytes >= largeThresholdBytes) {
            const gbText = (estBytes / (1024 * 1024 * 1024)).toFixed(1);
            largeLibraryNotice.style.display = 'block';
            largeNoticeCount.textContent = `${state.selectedIds.size} clips / ~${gbText} GB`;
        } else {
            largeLibraryNotice.style.display = 'none';
        }
    }
}

function syncVisibleCardsSelection() {
    const cards = clipsGrid.querySelectorAll('.clip-card');
    for (const card of cards) {
        const cb = card.querySelector('.clip-check');
        if (!cb) continue;
        const cid = cb.getAttribute('data-id');
        const checked = state.selectedIds.has(cid);
        cb.checked = checked;
        card.classList.toggle('selected', checked);
    }
}

function applyClipSelection(clip, targetChecked, isShiftKey) {
    if (isShiftKey && state.lastAnchorId && state.lastAnchorId !== clip.contentId) {
        const anchorIdx = state.filteredClips.findIndex(c => c.contentId === state.lastAnchorId);
        const curIdx = state.filteredClips.findIndex(c => c.contentId === clip.contentId);
        if (anchorIdx !== -1 && curIdx !== -1) {
            const start = Math.min(anchorIdx, curIdx);
            const end = Math.max(anchorIdx, curIdx);
            for (let i = start; i <= end; i++) {
                const c = state.filteredClips[i];
                if (c.videoUrl && !c.isProtected) {
                    if (targetChecked) state.selectedIds.add(c.contentId);
                    else state.selectedIds.delete(c.contentId);
                }
            }
            syncVisibleCardsSelection();
            updateCounts();
            return;
        }
    }

    if (targetChecked) state.selectedIds.add(clip.contentId);
    else state.selectedIds.delete(clip.contentId);
    state.lastAnchorId = clip.contentId;
    syncVisibleCardsSelection();
    updateCounts();
}

function getPageNumbers(current, total) {
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages = [1];
    if (current > 3) pages.push('...');
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let p = start; p <= end; p++) pages.push(p);
    if (current < total - 2) pages.push('...');
    pages.push(total);
    return pages;
}

function renderPagination(totalItems, totalPages, startIdx, endIdx) {
    const bars = [
        { wrap: paginationTop, info: pageInfoTop, btns: pageButtonsTop, scrollOnChange: false },
        { wrap: paginationBottom, info: pageInfoBottom, btns: pageButtonsBottom, scrollOnChange: true }
    ];

    for (const bar of bars) {
        if (!bar.wrap || !bar.info || !bar.btns) continue;
        if (totalItems === 0) {
            bar.wrap.style.display = 'none';
            continue;
        }
        // Always show top bar for range info + Shift+Click tip; show bottom bar only when multiple pages exist
        if (bar.scrollOnChange && totalPages <= 1) {
            bar.wrap.style.display = 'none';
            continue;
        }

        bar.wrap.style.display = 'flex';
        bar.info.textContent = `Showing ${startIdx + 1}–${endIdx} of ${totalItems} · Tip: Hold Shift + Click to select a range`;
        bar.btns.innerHTML = '';

        if (totalPages <= 1) continue;

        const addBtn = (label, page, disabled = false, active = false) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `page-btn${active ? ' active' : ''}`;
            b.textContent = label;
            b.disabled = disabled;
            if (!disabled && !active) {
                b.addEventListener('click', () => {
                    state.currentPage = page;
                    renderGrid();
                    if (bar.scrollOnChange) {
                        controlsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                });
            }
            bar.btns.appendChild(b);
        };

        addBtn('‹ Prev', state.currentPage - 1, state.currentPage <= 1);
        for (const item of getPageNumbers(state.currentPage, totalPages)) {
            if (item === '...') {
                const span = document.createElement('span');
                span.className = 'page-dots';
                span.textContent = '…';
                bar.btns.appendChild(span);
            } else {
                addBtn(String(item), item, false, item === state.currentPage);
            }
        }
        addBtn('Next ›', state.currentPage + 1, state.currentPage >= totalPages);
    }
}

function renderGrid() {
    clipsGrid.innerHTML = '';
    const total = state.filteredClips.length;
    if (total === 0) {
        renderPagination(0, 1, 0, 0);
        clipsGrid.innerHTML = '<div style="grid-column: 1/-1; padding: 24px; text-align: center; color: #8a8f98; font-size: 13px;">No clips found matching your filter.</div>';
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);
    const startIdx = (state.currentPage - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, total);
    const pageClips = state.filteredClips.slice(startIdx, endIdx);

    renderPagination(total, totalPages, startIdx, endIdx);

    const frag = document.createDocumentFragment();
    for (const clip of pageClips) {
        const isLocked = Boolean(clip.isProtected || !clip.videoUrl);
        const isSelected = !isLocked && state.selectedIds.has(clip.contentId);
        const card = document.createElement('div');
        card.className = `clip-card ${isSelected ? 'selected' : ''}${isLocked ? ' locked' : ''}`;

        const proxyHref = `/api/proxy-video?url=${encodeURIComponent(clip.videoUrl || '')}&filename=${encodeURIComponent(clip.filename)}`;
        const safeThumb = isSafeHttpsUrl(clip.thumbnail) ? escapeHtml(clip.thumbnail) : '';
        const safeTitle = escapeHtml(clip.title);
        const safeCategory = escapeHtml(clip.categoryName);
        const safeContentId = escapeHtml(clip.contentId);
        const safeFilename = escapeHtml(clip.filename);

        card.innerHTML = `
            <div>
                <div class="thumb-wrap">
                    ${safeThumb ? `<img src="${safeThumb}" loading="lazy" alt="" />` : ''}
                    ${isLocked ? `<div class="lock-overlay"><span class="lock-pill">🔒 Session Key Required</span></div>` : ''}
                    <label class="thumb-top-left" style="cursor: ${isLocked ? 'not-allowed' : 'pointer'};">
                        <input type="checkbox" class="clip-check" data-id="${safeContentId}" ${isSelected ? 'checked' : ''} ${isLocked ? 'disabled' : ''} />
                        <span>#${String(clip.index).padStart(state.allClips.length >= 1000 ? 4 : 3, '0')}</span>
                    </label>
                    <span class="thumb-duration">${escapeHtml(formatDuration(clip.duration))}</span>
                </div>
                <div class="clip-body">
                    <div class="clip-title" title="${safeTitle}">${safeTitle}</div>
                    <div class="clip-meta">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;">${safeCategory}</span>
                        <span>${escapeHtml(formatDate(clip.created))}</span>
                    </div>
                </div>
            </div>
            <div class="clip-footer">
                <span style="color:#6b7280;font-family:Consolas,monospace;">${safeContentId}</span>
                ${!isLocked
                    ? `<a href="${escapeHtml(proxyHref)}" download="${safeFilename}" class="dl-link">Download MP4</a>`
                    : `<span style="color:#f87171;font-weight:600;">🔒 Cookie Required</span>`
                }
            </div>
        `;

        const promptSessionKey = () => {
            if (authPanel && !authPanel.classList.contains('open')) {
                authPanel.classList.add('open');
                if (authArrow) authArrow.textContent = '▾';
            }
            if (authKeyInput) {
                authKeyInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                authKeyInput.focus();
            }
        };

        const labelWrap = card.querySelector('label.thumb-top-left');
        if (labelWrap) {
            labelWrap.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isLocked) {
                    promptSessionKey();
                    return;
                }
                const nextChecked = !state.selectedIds.has(clip.contentId);
                applyClipSelection(clip, nextChecked, e.shiftKey);
            });
        }

        // Toggle selection by clicking ANYWHERE on the card (except on "Download MP4" link), supports Shift + Click range
        card.addEventListener('click', (e) => {
            if (e.target.closest('a') || e.target.closest('label.thumb-top-left')) return;
            if (isLocked) {
                promptSessionKey();
                return;
            }
            const nextChecked = !state.selectedIds.has(clip.contentId);
            applyClipSelection(clip, nextChecked, e.shiftKey);
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
                        // Stream directly from Medal CDN without consuming server proxy bandwidth
                        previewVideo.src = clip.videoUrl;
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

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 MB';
    if (bytes >= 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function setDownloadingState(active) {
    state.isDownloading = active;
    if (downloadZipBtn) downloadZipBtn.disabled = active;
    if (downloadFolderBtn) downloadFolderBtn.disabled = active;
}

cancelDownloadBtn.addEventListener('click', () => {
    state.cancelRequested = true;
    if (state.abortController) {
        state.abortController.abort();
    }
    if (state.currentZipJobId) {
        fetch(`/api/download-cancel?id=${encodeURIComponent(state.currentZipJobId)}`, { method: 'POST' }).catch(() => {});
    }
    setDownloadingState(false);
    progressText.textContent = 'Cancelling...';
});

function getSelectedClips() {
    return state.allClips.filter(c => state.selectedIds.has(c.contentId) && c.videoUrl && !c.isProtected);
}

// Download all selected clips in a SINGLE MyClips_<user>.zip straight to the browser's Downloads bar with live SSE progress
downloadZipBtn.addEventListener('click', () => {
    if (state.isDownloading) return;
    const selected = getSelectedClips();
    if (selected.length === 0) {
        return alert('No unlocked clips available to download. If clips say "Session Key Required", add your session cookie/key above and click Download again.');
    }

    const baseName = `MyClips_${state.profile?.userName || 'Archive'}`;
    const shouldGroup = groupByGameCheckbox ? groupByGameCheckbox.checked : true;
    const jobId = (window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID()
        : `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (state.zipEventSource) {
        try { state.zipEventSource.close(); } catch {}
    }

    setDownloadingState(true);
    state.failedClips = [];
    state.currentZipJobId = jobId;
    if (retryFailedBtn) retryFailedBtn.style.display = 'none';
    downloadProgressPanel.classList.add('visible');
    progressBar.style.width = '0%';
    progressText.textContent = 'Preparing download...';
    progressStats.textContent = `0 / ${selected.length}`;

    const es = new EventSource(`/api/download-progress?id=${encodeURIComponent(jobId)}`);
    state.zipEventSource = es;

    es.onmessage = (ev) => {
        try {
            const data = JSON.parse(ev.data);
            if (data.type === 'progress') {
                const pct = data.total > 0 ? Math.round((data.done / data.total) * 100) : 0;
                progressBar.style.width = `${pct}%`;
                progressText.textContent = `Downloading: ${data.title}...`;
                progressStats.textContent = `${data.done} / ${data.total} (${formatBytes(data.bytes)})`;
            } else if (data.type === 'done') {
                progressBar.style.width = '100%';
                progressStats.textContent = `${data.total} / ${data.total} (${formatBytes(data.bytes)})`;
                setDownloadingState(false);
                if (Array.isArray(data.failedIds) && data.failedIds.length > 0) {
                    const failSet = new Set(data.failedIds);
                    state.failedClips = state.allClips.filter(c => failSet.has(c.contentId));
                    if (retryFailedBtn && failedCountEl && state.failedClips.length > 0) {
                        failedCountEl.textContent = state.failedClips.length;
                        retryFailedBtn.style.display = 'inline-block';
                    }
                }
                const failNote = data.failed > 0 ? ` (${data.failed} skipped — click Retry Failed)` : '';
                progressText.textContent = `Completed! ${data.zipFilename} (${data.added} clips) downloaded.${failNote}`;
                state.currentZipJobId = null;
                es.close();
            } else if (data.type === 'cancelled') {
                setDownloadingState(false);
                progressText.textContent = 'Download cancelled.';
                state.currentZipJobId = null;
                es.close();
            } else if (data.type === 'error') {
                setDownloadingState(false);
                progressText.textContent = `Error: ${data.message || 'Stream interrupted'}`;
                state.currentZipJobId = null;
                es.close();
            }
        } catch {}
    };

    es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
            setDownloadingState(false);
            state.currentZipJobId = null;
        }
    };

    const payload = {
        jobId,
        zipName: baseName,
        groupByGame: shouldGroup,
        clips: selected.map(c => ({
            contentId: c.contentId,
            url: c.videoUrl,
            filename: c.filename,
            title: c.title,
            categoryName: c.categoryName || 'General',
            created: c.created || Date.now()
        }))
    };

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/download-zip';
    form.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify(payload);

    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
});

// Save Directly to Local Folder with Resume / Skip existing
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

    setDownloadingState(true);
    state.cancelRequested = false;
    state.failedClips = [];
    if (retryFailedBtn) retryFailedBtn.style.display = 'none';
    downloadProgressPanel.classList.add('visible');
    progressBar.style.width = '0%';

    try {
        const myClipsHandle = await rootDirHandle.getDirectoryHandle('MyClips', { create: true });
        let completed = 0;
        let savedCount = 0;
        let skippedCount = 0;
        const failed = [];
        const concurrency = 4;
        let idx = 0;

        async function worker() {
            while (idx < selected.length && !state.cancelRequested) {
                const current = selected[idx++];
                progressText.textContent = `Saving: MyClips/${current.filename}...`;
                progressStats.textContent = `${completed} / ${selected.length}`;
                let success = false;
                try {
                    const shouldGroup = groupByGameCheckbox ? groupByGameCheckbox.checked : true;
                    let targetDir = myClipsHandle;
                    if (shouldGroup) {
                        const gameFolder = sanitizeFilename(current.categoryName || 'General');
                        targetDir = await myClipsHandle.getDirectoryHandle(gameFolder, { create: true });
                    }

                    // Resume check: If file already exists and has data, skip re-downloading!
                    try {
                        const existingHandle = await targetDir.getFileHandle(current.filename);
                        const existingFile = await existingHandle.getFile();
                        if (existingFile && existingFile.size > 1000) {
                            skippedCount++;
                            success = true;
                            completed++;
                            const pct = Math.round((completed / selected.length) * 100);
                            progressBar.style.width = `${pct}%`;
                            progressStats.textContent = `${completed} / ${selected.length}`;
                            continue;
                        }
                    } catch (e) {
                        // File doesn't exist yet, proceed with download
                    }

                    const fileHandle = await targetDir.getFileHandle(current.filename, { create: true });
                    const proxyUrl = `/api/proxy-video?url=${encodeURIComponent(current.videoUrl)}&filename=${encodeURIComponent(current.filename)}`;
                    const resp = await fetch(proxyUrl);
                    if (resp.ok && resp.body) {
                        const writable = await fileHandle.createWritable();
                        await resp.body.pipeTo(writable);
                        savedCount++;
                        success = true;
                    }
                } catch (e) {
                    console.warn('Failed saving clip:', current.filename, e);
                }
                if (!success && !state.cancelRequested) {
                    failed.push(current);
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
        } else if (failed.length > 0) {
            state.failedClips = failed;
            if (retryFailedBtn) {
                retryFailedBtn.style.display = 'inline-block';
                failedCountEl.textContent = failed.length;
            }
            progressText.textContent = `Completed! Saved ${savedCount} clips (${skippedCount} already existed, ${failed.length} failed — click Retry Failed).`;
        } else {
            progressText.textContent = `Completed! Saved ${savedCount} clips to MyClips folder (${skippedCount} skipped as already downloaded).`;
        }
    } catch (err) {
        progressText.textContent = `Error: ${err.message}`;
    } finally {
        setDownloadingState(false);
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

// Retry Failed Downloads
if (retryFailedBtn) {
    retryFailedBtn.addEventListener('click', () => {
        if (!state.failedClips || state.failedClips.length === 0) return;
        state.selectedIds = new Set(state.failedClips.map(c => c.contentId));
        renderGrid();
        updateCounts();
        downloadZipBtn.click();
    });
}
