const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const { Readable } = require('stream');
const { ZipStreamWriter } = require('./zip-stream');

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

function parseCustomAuth(rawInput, fallbackUserId) {
    let val = (rawInput || '').trim().replace(/^["']|["']$/g, '');
    if (!val) return '';
    // Try decoding raw medal-auth cookie (URL-encoded Base64 JSON or raw Base64 JSON)
    try {
        let candidate = val.includes('%') ? decodeURIComponent(val) : val;
        if (candidate.startsWith('{')) {
            const obj = JSON.parse(candidate);
            if (obj && obj.key) return `${obj.userId || fallbackUserId},${obj.key}`;
        }
        // Base64 decode attempt
        const b64 = candidate.replace(/-/g, '+').replace(/_/g, '/');
        const jsonStr = Buffer.from(b64, 'base64').toString('utf8');
        if (jsonStr.trim().startsWith('{')) {
            const obj = JSON.parse(jsonStr);
            if (obj && obj.key) return `${obj.userId || fallbackUserId},${obj.key}`;
        }
    } catch {
        // Not Base64/JSON, fall through to plain key checks
    }
    if (val.includes(',')) return val;
    return `${fallbackUserId},${val}`;
}

function isAllowedMedalHost(hostname) {
    if (!hostname) return false;
    const h = hostname.toLowerCase();
    return h === 'medal.tv' || h === 'cdn.medal.tv' || h.endsWith('.medal.tv');
}

function sanitizeZipPart(name, fallback = 'Untitled') {
    const clean = String(name || fallback)
        .replace(/[/\\*?:"<>|\r\n\t]+/g, '_')
        .replace(/\.{2,}/g, '_')
        .trim();
    return clean.slice(0, 80) || fallback;
}

function readRequestBody(req, maxBytes = 10 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
                reject(new Error('Payload too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function openMedalStream(targetUrl, redirectsLeft = 5, onRequestCreated = null) {
    return new Promise((resolve, reject) => {
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        let u;
        try {
            u = new URL(targetUrl);
        } catch {
            return reject(new Error('Bad URL'));
        }
        if (u.protocol !== 'https:' || !isAllowedMedalHost(u.hostname)) {
            return reject(new Error('Forbidden host'));
        }

        const proxyReq = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        }, (proxyRes) => {
            if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
                const nextUrl = new URL(proxyRes.headers.location, targetUrl).toString();
                proxyRes.resume();
                return openMedalStream(nextUrl, redirectsLeft - 1, onRequestCreated).then(resolve, reject);
            }
            if (proxyRes.statusCode !== 200 && proxyRes.statusCode !== 206) {
                proxyRes.resume();
                return reject(new Error(`Upstream status ${proxyRes.statusCode}`));
            }
            resolve({ upstreamRes: proxyRes, upstreamReq: proxyReq });
        });

        if (typeof onRequestCreated === 'function') {
            onRequestCreated(proxyReq);
        }
        proxyReq.setTimeout(45000, () => {
            proxyReq.destroy(new Error('Upstream timeout'));
        });
        proxyReq.on('error', reject);
        proxyReq.end();
    });
}

// Active ZIP streaming job progress registry for real-time UI progress bar (SSE)
const downloadJobs = new Map();

function getOrCreateJob(jobId) {
    if (!jobId) return null;
    let job = downloadJobs.get(jobId);
    if (!job) {
        job = { clients: new Set(), aborted: false, cancelFn: null, lastEvent: null };
        downloadJobs.set(jobId, job);
    }
    return job;
}

function emitJobEvent(job, data) {
    if (!job) return;
    job.lastEvent = data;
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (const clientRes of job.clients) {
        try {
            if (!clientRes.destroyed && !clientRes.writableEnded) {
                clientRes.write(msg);
            }
        } catch {}
    }
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = parsedUrl.pathname;

    // 0. Health check endpoint for uptime monitoring (e.g., UptimeRobot)
    if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' }));
    }

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
                authHeader = parseCustomAuth(customKey, userId);
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
                    width: c.sourceWidth || 1920,
                    height: c.sourceHeight || 1080,
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

            // Security: Strictly enforce Medal.tv domains to prevent open-proxy abuse
            if (!isAllowedMedalHost(u.hostname)) {
                if (!res.headersSent) res.writeHead(403, { 'Content-Type': 'text/plain' });
                return res.end('Forbidden: Only Medal.tv domains are allowed through this proxy.');
            }

            const reqHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
            if (req.headers.range) {
                reqHeaders['Range'] = req.headers.range;
            }

            const proxyReq = https.request({
                hostname: u.hostname,
                path: u.pathname + u.search,
                method: 'GET',
                headers: reqHeaders
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
                if (proxyRes.headers['content-range']) {
                    headers['Content-Range'] = proxyRes.headers['content-range'];
                }
                if (proxyRes.headers['accept-ranges']) {
                    headers['Accept-Ranges'] = proxyRes.headers['accept-ranges'];
                }
                res.writeHead(proxyRes.statusCode || 200, headers);
                proxyRes.pipe(res);
            });
            proxyReq.setTimeout(30000, () => {
                proxyReq.destroy(new Error('Upstream timeout'));
            });
            proxyReq.on('error', () => {
                if (!res.headersSent) res.writeHead(502);
                res.end();
            });
            req.on('close', () => {
                if (!proxyReq.destroyed) proxyReq.destroy();
            });
            proxyReq.end();
        }

        return streamWithRedirects(videoUrl);
    }

    // 3.4. API: Real-time SSE progress stream & cancel for server-side ZIP downloads
    if (pathname === '/api/download-progress' && req.method === 'GET') {
        const jobId = parsedUrl.searchParams.get('id') || '';
        if (!jobId) {
            res.writeHead(400);
            return res.end('Missing job id');
        }
        const job = getOrCreateJob(jobId);
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        job.clients.add(res);
        if (job.lastEvent) {
            res.write(`data: ${JSON.stringify(job.lastEvent)}\n\n`);
        }
        req.on('close', () => {
            job.clients.delete(res);
        });
        return;
    }

    if (pathname === '/api/download-cancel' && req.method === 'POST') {
        const jobId = parsedUrl.searchParams.get('id') || '';
        const job = downloadJobs.get(jobId);
        if (job) {
            job.aborted = true;
            if (typeof job.cancelFn === 'function') job.cancelFn();
            emitJobEvent(job, { type: 'cancelled' });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
    }

    // 3.5. API: Server-side Streaming Single ZIP Download (No client RAM crash, no parts splitting, native browser Downloads bar)
    if (pathname === '/api/download-zip' && req.method === 'POST') {
        let payload;
        try {
            const rawBody = await readRequestBody(req);
            const ctype = (req.headers['content-type'] || '').toLowerCase();
            if (ctype.includes('application/x-www-form-urlencoded')) {
                const params = new URLSearchParams(rawBody);
                payload = JSON.parse(params.get('payload') || '{}');
            } else {
                payload = JSON.parse(rawBody || '{}');
            }
        } catch (err) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Invalid download payload');
        }

        const rawClips = Array.isArray(payload.clips) ? payload.clips : [];
        const validClips = rawClips.filter(c => {
            if (!c || typeof c.url !== 'string' || !c.url.startsWith('https://')) return false;
            try {
                return isAllowedMedalHost(new URL(c.url).hostname);
            } catch {
                return false;
            }
        });

        if (validClips.length === 0) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('No valid Medal.tv clips supplied.');
        }

        const jobId = typeof payload.jobId === 'string' ? payload.jobId.slice(0, 64) : '';
        const job = getOrCreateJob(jobId);
        const safeZipBase = sanitizeZipPart(payload.zipName || 'MyClips_Archive', 'MyClips_Archive').replace(/\.zip$/i, '');
        const zipFilename = `${safeZipBase}.zip`;
        const groupByGame = payload.groupByGame !== false;

        // Disable Node request/socket idle timeout for multi-GB streaming downloads
        if (typeof req.setTimeout === 'function') req.setTimeout(0);
        if (typeof res.setTimeout === 'function') res.setTimeout(0);

        res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${zipFilename}"; filename*=UTF-8''${encodeURIComponent(zipFilename)}`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });

        let clientAborted = Boolean(job && job.aborted);
        let activeUpstreamReq = null;
        function abortStream() {
            clientAborted = true;
            if (activeUpstreamReq && !activeUpstreamReq.destroyed) {
                activeUpstreamReq.destroy();
            }
            if (!res.destroyed) {
                try { res.destroy(); } catch {}
            }
        }
        if (job) job.cancelFn = abortStream;

        res.on('close', () => {
            if (!res.writableEnded) {
                clientAborted = true;
                if (activeUpstreamReq && !activeUpstreamReq.destroyed) {
                    activeUpstreamReq.destroy();
                }
                emitJobEvent(job, { type: 'cancelled' });
            }
        });

        const zw = new ZipStreamWriter(res);
        const usedPaths = new Set();
        const failedNotes = [];
        const failedIds = [];
        let addedCount = 0;

        try {
            for (let i = 0; i < validClips.length; i++) {
                if (clientAborted || (job && job.aborted) || res.destroyed) break;
                const clip = validClips[i];
                const fname = sanitizeZipPart(clip.filename || `clip_${i + 1}.mp4`, `clip_${i + 1}.mp4`);
                const clipTitle = String(clip.title || fname).slice(0, 80);
                let entryPath = groupByGame
                    ? `MyClips/${sanitizeZipPart(clip.categoryName || 'General', 'General')}/${fname}`
                    : `MyClips/${fname}`;

                if (usedPaths.has(entryPath)) {
                    entryPath = entryPath.replace(/(\.[^.]+)?$/, `_${i + 1}$1`);
                }
                usedPaths.add(entryPath);

                emitJobEvent(job, {
                    type: 'progress',
                    done: i,
                    total: validClips.length,
                    title: clipTitle,
                    bytes: Number(zw.offset)
                });

                let streamInfo = null;
                for (let attempt = 0; attempt < 2; attempt++) {
                    if (clientAborted || (job && job.aborted) || res.destroyed) break;
                    try {
                        streamInfo = await openMedalStream(clip.url, 5, (uReq) => {
                            activeUpstreamReq = uReq;
                        });
                        break;
                    } catch (e) {
                        if (attempt === 0 && !clientAborted) {
                            await new Promise(r => setTimeout(r, 400));
                        }
                    }
                }

                if (!streamInfo) {
                    failedNotes.push(`${fname} (Could not open stream)`);
                    if (clip.contentId) failedIds.push(clip.contentId);
                    continue;
                }

                try {
                    const mtime = clip.created ? new Date(Number(clip.created)) : new Date();
                    let lastEmitAt = Date.now();
                    // Wrap upstream chunks cleanly via async generator so progress bar bytes update live mid-file too
                    async function* trackedStream(src) {
                        for await (const chunk of src) {
                            yield chunk;
                            const now = Date.now();
                            if (job && now - lastEmitAt > 350) {
                                lastEmitAt = now;
                                emitJobEvent(job, {
                                    type: 'progress',
                                    done: i,
                                    total: validClips.length,
                                    title: clipTitle,
                                    bytes: Number(zw.offset)
                                });
                            }
                        }
                    }
                    await zw.addStreamEntry(entryPath, mtime, trackedStream(streamInfo.upstreamRes));
                    addedCount++;
                    emitJobEvent(job, {
                        type: 'progress',
                        done: i + 1,
                        total: validClips.length,
                        title: clipTitle,
                        bytes: Number(zw.offset)
                    });
                } catch (e) {
                    if (clientAborted || (job && job.aborted) || res.destroyed) break;
                    failedNotes.push(`${fname} (${e.message})`);
                    if (clip.contentId) failedIds.push(clip.contentId);
                } finally {
                    activeUpstreamReq = null;
                }
            }

            if (!clientAborted && !(job && job.aborted) && !res.destroyed) {
                if (failedNotes.length > 0) {
                    const noteText = `Some clips could not be included in this archive (expired link or CDN error):\r\n\r\n${failedNotes.join('\r\n')}\r\n`;
                    await zw.addStreamEntry('MyClips/_FAILED_CLIPS.txt', new Date(), Readable.from([Buffer.from(noteText, 'utf8')]));
                }
                await zw.finalize();
                const finalBytes = Number(zw.offset);
                res.end();
                emitJobEvent(job, {
                    type: 'done',
                    added: addedCount,
                    failed: failedNotes.length,
                    failedIds,
                    total: validClips.length,
                    bytes: finalBytes,
                    zipFilename
                });
            }
        } catch (err) {
            if (!res.destroyed) {
                try { res.end(); } catch {}
            }
            emitJobEvent(job, { type: 'error', message: err.message });
        } finally {
            if (job) {
                setTimeout(() => {
                    for (const c of job.clients) { try { c.end(); } catch {} }
                    downloadJobs.delete(jobId);
                }, 10000);
            }
        }
        return;
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
        if (ext === '.html' || ext === '.js' || ext === '.css') {
            headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            headers['Pragma'] = 'no-cache';
            headers['Expires'] = '0';
        }
        if (ext === '.zip' || ext === '.exe') {
            headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
        }
        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`MDLDownloader Web Server running at http://localhost:${PORT}`);
});
