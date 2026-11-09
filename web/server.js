const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Cache a guest token in memory so public profile lookups are instant
let cachedGuestAuth = null;

function httpsRequest(urlStr, options = {}, body = null) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const reqOpts = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Medal-User-Agent': 'Medal-Nextjs/1.0 (simplified_signup)',
                'Accept': 'application/json',
                ...(options.headers || {})
            }
        };
        const req = https.request(reqOpts, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf-8');
                resolve({ status: res.statusCode, headers: res.headers, text });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function getGuestAuth() {
    if (cachedGuestAuth && cachedGuestAuth.expiresAt > Date.now()) {
        return cachedGuestAuth.header;
    }
    const payload = JSON.stringify({
        userName: 'guest',
        email: 'guest',
        password: crypto.randomUUID()
    });
    const res = await httpsRequest('https://medal.tv/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, payload);
    if (res.status >= 200 && res.status < 300) {
        const data = JSON.parse(res.text);
        const uid = data.auth?.userId || data.user?.userId;
        const key = data.auth?.key;
        if (uid && key) {
            cachedGuestAuth = {
                header: `${uid},${key}`,
                expiresAt: Date.now() + 1000 * 60 * 30 // 30 mins
            };
            return cachedGuestAuth.header;
        }
    }
    throw new Error('Could not initialize guest session');
}

async function resolveProfile(input) {
    let clean = input.trim();
    // Extract username if full URL is passed (e.g. https://medal.tv/u/username or https://medal.tv/tr/u/username)
    const urlMatch = clean.match(/medal\.tv\/(?:[a-zA-Z-]+\/)?u\/([^/?#]+)/i);
    if (urlMatch) {
        clean = decodeURIComponent(urlMatch[1]);
    }
    // If numeric userId was passed directly
    if (/^\d+$/.test(clean)) {
        return { userId: clean, userName: clean, displayName: clean, thumbnail: null };
    }

    // Try API lookup first
    try {
        const guestAuth = await getGuestAuth();
        const apiRes = await httpsRequest(`https://medal.tv/api/users?username=${encodeURIComponent(clean)}`, {
            headers: { 'X-Authentication': guestAuth }
        });
        if (apiRes.status === 200) {
            const arr = JSON.parse(apiRes.text);
            if (Array.isArray(arr) && arr.length > 0 && arr[0].userId) {
                const u = arr[0];
                return {
                    userId: String(u.userId),
                    userName: u.userName || clean,
                    displayName: u.displayName || u.userName || clean,
                    thumbnail: u.thumbnail || null,
                    submissions: u.submissions || 0
                };
            }
        }
    } catch (e) {
        // Fallback to HTML scraping
    }

    // Fallback: Fetch public profile page HTML
    const htmlRes = await httpsRequest(`https://medal.tv/u/${encodeURIComponent(clean)}`, {
        headers: { 'Accept': 'text/html' }
    });
    const uidMatch = htmlRes.text.match(/\\"userId\\":\\"?(\d+)\\"?/) || htmlRes.text.match(/"userId":"?(\d+)"?/);
    if (uidMatch) {
        const subMatch = htmlRes.text.match(/\\"submissions\\":(\d+)/);
        const thumbMatch = htmlRes.text.match(/\\"thumbnail\\":\\"(https:\/\/cdn\.medal\.tv\/avatars\/[^\\"]+)\\"/);
        return {
            userId: uidMatch[1],
            userName: clean,
            displayName: clean,
            thumbnail: thumbMatch ? thumbMatch[1] : null,
            submissions: subMatch ? Number(subMatch[1]) : 0
        };
    }
    throw new Error(`User "${clean}" not found. Please check the username or profile URL.`);
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = parsedUrl.pathname;

    // 1. API: Resolve username/URL -> userId + metadata
    if (pathname === '/api/resolve') {
        const query = parsedUrl.searchParams.get('q') || '';
        if (!query) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing query parameter' }));
        }
        try {
            const profile = await resolveProfile(query);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(profile));
        } catch (err) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    // 2. API: Fetch paginated clips
    if (pathname === '/api/clips') {
        const userId = parsedUrl.searchParams.get('userId') || '';
        const offset = parsedUrl.searchParams.get('offset') || '0';
        const limit = parsedUrl.searchParams.get('limit') || '50';
        const customKey = req.headers['x-custom-auth'] || '';

        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing userId' }));
        }

        try {
            let authHeader = '';
            let includePrivate = false;
            if (customKey) {
                authHeader = customKey.includes(',') ? customKey : `${userId},${customKey}`;
                includePrivate = true;
            } else {
                authHeader = await getGuestAuth();
            }

            const privParam = includePrivate ? '' : '&privacy=0';
            const apiUrl = `https://medal.tv/api/content?userId=${encodeURIComponent(userId)}${privParam}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}&sortDirection=DESC`;
            const apiRes = await httpsRequest(apiUrl, {
                headers: { 'X-Authentication': authHeader }
            });

            if (apiRes.status !== 200) {
                res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: `API returned status ${apiRes.status}`, details: apiRes.text }));
            }

            const rawClips = JSON.parse(apiRes.text);
            const normalized = (Array.isArray(rawClips) ? rawClips : []).map(c => {
                let bestUrl = null;
                let isProtected = false;
                for (const field of ['rawFileUrl', 'contentUrl', 'contentUrl1080p', 'contentUrl720p', 'contentUrl480p', 'contentUrl360p', 'socialMediaVideo']) {
                    const val = c[field];
                    if (val) {
                        if (val.includes('privacy-protected-guest')) {
                            isProtected = true;
                        } else if (!val.endsWith('&missing')) {
                            bestUrl = val;
                            isProtected = false;
                            break;
                        }
                    }
                }
                return {
                    contentId: c.contentId,
                    title: c.contentTitle || 'Untitled',
                    categoryName: c.category?.categoryName || 'Gaming',
                    duration: c.videoLengthSeconds || 0,
                    created: c.created || Date.now(),
                    privacy: c.privacy, // 0 = public, 1 = unlisted/private
                    views: c.views || 0,
                    thumbnail: c.thumbnail720p || c.thumbnail480p || c.thumbnail360p || c.thumbnailUrl || '',
                    videoUrl: bestUrl,
                    isProtected
                };
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ items: normalized }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    // 3. API: Stream video with CORS headers and automatic 301/302/307/308 redirect following
    if (pathname === '/api/proxy-video') {
        const videoUrl = parsedUrl.searchParams.get('url') || '';
        const filename = parsedUrl.searchParams.get('filename') || 'clip.mp4';
        if (!videoUrl || !videoUrl.startsWith('https://')) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Invalid video URL');
        }

        function streamWithRedirects(targetUrl, redirectsLeft = 5) {
            if (redirectsLeft <= 0) {
                if (!res.headersSent) res.writeHead(502);
                return res.end('Too many redirects');
            }
            let u;
            try {
                u = new URL(targetUrl);
            } catch (e) {
                if (!res.headersSent) res.writeHead(400);
                return res.end('Bad URL');
            }
            const proxyReq = https.request({
                hostname: u.hostname,
                path: u.pathname + u.search,
                method: 'GET',
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            }, (proxyRes) => {
                if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
                    const nextUrl = new URL(proxyRes.headers.location, targetUrl).toString();
                    proxyRes.resume(); // discard body
                    return streamWithRedirects(nextUrl, redirectsLeft - 1);
                }
                const headers = {
                    'Content-Type': proxyRes.headers['content-type'] || 'video/mp4',
                    'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
                    'Access-Control-Allow-Origin': '*'
                };
                if (proxyRes.headers['content-length']) {
                    headers['Content-Length'] = proxyRes.headers['content-length'];
                }
                res.writeHead(proxyRes.statusCode || 200, headers);
                proxyRes.pipe(res);
            });
            proxyReq.on('error', () => {
                if (!res.headersSent) res.writeHead(502);
                res.end();
            });
            proxyReq.end();
        }

        return streamWithRedirects(videoUrl);
    }

    // 4. Static files
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Not found');
        }
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
            '.xml': 'application/xml; charset=utf-8',
            '.txt': 'text/plain; charset=utf-8',
            '.zip': 'application/zip',
            '.exe': 'application/vnd.microsoft.portable-executable'
        };
        const headers = {
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Content-Length': stats.size
        };
        if (ext === '.zip' || ext === '.exe') {
            headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
        }
        if (path.basename(filePath) === 'sw.js') {
            headers['Service-Worker-Allowed'] = '/';
        }
        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`ClipVault Web Server running at http://localhost:${PORT}`);
});
