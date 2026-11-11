// Shared Medal.tv API & formatting helpers for MDLDownloader Chrome Extension

export function sanitize(name) {
    return (name || 'Untitled').replace(/[\\/*?:"<>|]/g, '_').trim().slice(0, 75) || 'Untitled';
}

export function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 MB';
    if (bytes >= 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function getBestVideoUrl(clip) {
    for (const field of ['rawFileUrl', 'contentUrl', 'contentUrl1080p', 'contentUrl720p', 'contentUrl480p', 'contentUrl360p', 'socialMediaVideo']) {
        const val = clip[field];
        if (val && !val.includes('privacy-protected-guest') && !val.endsWith('&missing')) {
            return val;
        }
    }
    return null;
}

export async function getCookieSession() {
    try {
        const cookie = await chrome.cookies.get({ url: 'https://medal.tv', name: 'medal-auth' });
        if (cookie && cookie.value) {
            const decoded = JSON.parse(atob(decodeURIComponent(cookie.value)));
            const userId = decoded.userId || decoded.id || decoded.auth?.userId;
            const key = decoded.key || decoded.auth?.key;
            const registeredUser = Boolean(decoded.registeredUser);
            if (userId && key) {
                return { userId: String(userId), key: String(key), registeredUser, userName: null };
            }
        }
    } catch {}
    return null;
}

export async function ensureAuthHeader(sessionAuth) {
    if (sessionAuth && sessionAuth.userId && sessionAuth.key) {
        return { header: `${sessionAuth.userId},${sessionAuth.key}`, sessionAuth };
    }
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
    const uid = String(data.auth?.userId || data.user?.userId || '');
    const key = String(data.auth?.key || '');
    const nextAuth = { userId: uid, key, registeredUser: false, userName: null };
    return { header: `${uid},${key}`, sessionAuth: nextAuth };
}

export async function fetchUserProfileById(userId, authHeader) {
    try {
        const res = await fetch(`https://medal.tv/api/users/${encodeURIComponent(userId)}`, {
            headers: {
                'Medal-User-Agent': 'Medal-Nextjs/1.0 (simplified_signup)',
                'X-Authentication': authHeader,
                'Accept': 'application/json'
            }
        });
        if (res.ok) {
            const u = await res.json();
            if (u && u.userId) {
                return {
                    userId: String(u.userId),
                    userName: u.userName || String(userId),
                    displayName: u.displayName || u.userName || String(userId),
                    thumbnail: u.thumbnail || null,
                    submissions: u.submissions || 0
                };
            }
        }
    } catch {}
    return { userId: String(userId), userName: String(userId), displayName: String(userId), thumbnail: null, submissions: 0 };
}

export async function resolveUsernameOrUrl(input, sessionAuth) {
    let clean = input.trim();
    const urlMatch = clean.match(/medal\.tv\/(?:[a-zA-Z-]+\/)?u\/([^/?#]+)/i);
    if (urlMatch) {
        clean = decodeURIComponent(urlMatch[1]);
    }
    const { header } = await ensureAuthHeader(sessionAuth);
    if (/^\d+$/.test(clean)) {
        return fetchUserProfileById(clean, header);
    }

    try {
        const res = await fetch(`https://medal.tv/api/users?username=${encodeURIComponent(clean)}`, {
            headers: {
                'Medal-User-Agent': 'Medal-Nextjs/1.0 (simplified_signup)',
                'X-Authentication': header,
                'Accept': 'application/json'
            }
        });
        if (res.ok) {
            const arr = await res.json();
            if (Array.isArray(arr) && arr.length > 0 && arr[0].userId) {
                return {
                    userId: String(arr[0].userId),
                    userName: arr[0].userName || clean,
                    displayName: arr[0].displayName || arr[0].userName || clean,
                    thumbnail: arr[0].thumbnail || null,
                    submissions: arr[0].submissions || 0
                };
            }
        }
    } catch {}

    // Fallback: HTML scrape
    const htmlRes = await fetch(`https://medal.tv/u/${encodeURIComponent(clean)}`);
    const text = await htmlRes.text();
    const uidMatch = text.match(/\\"userId\\":\\"?(\d+)\\"?/) || text.match(/"userId":"?(\d+)"?/);
    if (uidMatch) {
        return { userId: uidMatch[1], userName: clean, displayName: clean, thumbnail: null, submissions: 0 };
    }
    throw new Error(`User "${clean}" not found.`);
}

export async function scanClipsForUser({ userId, fallbackName, isOwnAccount, sessionAuth, onProgress }) {
    const { header } = await ensureAuthHeader(sessionAuth);
    const rawList = [];
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
                    'X-Authentication': header,
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
                        rawList.push(c);
                    } else if ((c.contentUrl || '').includes('privacy-protected-guest')) {
                        protectedCount++;
                    }
                }
            }
            if (typeof onProgress === 'function') {
                onProgress(rawList.length, protectedCount);
            }
            if (batch.length < 50) break;
            offset += 50;
        }
    }

    const resolvedName = rawList[0]?.poster?.userName || fallbackName || String(userId);
    const padWidth = rawList.length >= 1000 ? 4 : 3;

    // Normalize into compact clip descriptors safe to store in chrome.storage.local
    const clips = rawList.map((c, idx) => ({
        index: idx + 1,
        contentId: c.contentId,
        title: c.contentTitle || 'Untitled',
        game: c.category?.categoryName || 'Gaming',
        duration: Number(c.videoLengthSeconds) || 0,
        height: Number(c.sourceHeight) || 1080,
        created: c.created || Date.now(),
        videoUrl: getBestVideoUrl(c),
        filename: `${String(idx + 1).padStart(padWidth, '0')}_${sanitize(c.contentTitle)}_${c.contentId}.mp4`
    }));

    const gameCounts = {};
    for (const c of clips) {
        gameCounts[c.game] = (gameCounts[c.game] || 0) + 1;
    }

    return {
        targetUser: { userId: String(userId), userName: resolvedName },
        clips,
        gameCounts,
        protectedCount
    };
}
