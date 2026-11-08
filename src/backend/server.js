require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./database');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
app.use(compression());
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const CALLBACK_URL = `${APP_URL}/auth/callback`;

const isDev = process.env.NODE_ENV !== 'production';

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 100000 : 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again in 15 minutes.' }
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 100000 : 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' }
});

const heavyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 100000 : 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded for this resource. Try again later.' }
});

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval' https://api.github.com https://avatars.githubusercontent.com https://github.com https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com https://api.fontshare.com https://cdn.fontshare.com https://nominatim.openstreetmap.org https://ipapi.co; img-src 'self' data: blob: https:;");
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// Static files
const APP_BUNDLE_DIR = path.join(__dirname, '../../public/app') + path.sep;
app.use(express.static(path.join(__dirname, '../../public'), {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        // The React bundle keeps fixed names (public/app/app.js): revalidate with the etag instead of caching for a year
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (filePath.startsWith(APP_BUNDLE_DIR)) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.match(/\.(js|css)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
}));

app.use(express.json({ limit: '16kb' }));

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// User link redirect
app.get('/u/:login', apiLimiter, async (req, res) => {
    const login = req.params.login;
    if (!/^[A-Za-z0-9_.-]{1,39}$/.test(login)) {
        return res.status(400).send('Invalid username format');
    }
    try {
        const user = await db.getUser(login);
        if (!user) return res.redirect('/?notfound=' + encodeURIComponent(login));
        res.redirect(`/?fly=${encodeURIComponent(login)}`);
    } catch (err) {
        res.redirect('/');
    }
});

// Routers
app.use('/auth', authLimiter);
app.use('/api', apiLimiter);
app.use('/', require('./routes/auth')(db, CLIENT_ID, CLIENT_SECRET, CALLBACK_URL));
const apiRouter = require('./routes/api')(db, heavyLimiter);
app.use('/', apiRouter);

// 404 fallback
app.use((req, res) => {
    res.status(404).send(`<!DOCTYPE html><html><head><title>404 — GitSpace</title>
    <style>body{background:#030308;color:#e8e8f0;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
    .c{text-align:center}h1{font-size:48px;color:#06b6d4;margin-bottom:12px}p{color:#8a8acc;margin-bottom:24px}
    a{color:#06b6d4;text-decoration:none;border:1px solid #06b6d4;padding:10px 20px;border-radius:4px;font-size:12px;letter-spacing:.1em;text-transform:uppercase}
    a:hover{background:#06b6d4;color:#000}</style></head>
    <body><div class="c"><h1>404</h1><p>Lost in deep space.</p><a href="/">Return to GitSpace</a></div></body></html>`);
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('[Express] Unhandled error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

process.on('uncaughtException', (err) => {
    console.error('[Node] Uncaught Exception:', err);
    process.exit(1); // state is unknown after an uncaught throw; let Render restart us
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Node] Unhandled Rejection at:', promise, 'reason:', reason);
});

(async () => {
    await db.initDb();
    require('./refresh').start(db, apiRouter); // daily island refresh, independent of sign-ins
    app.listen(PORT, () => {
        console.log(`GitSpace server running at ${APP_URL} (Port: ${PORT})`);
        if (!CLIENT_ID || !CLIENT_SECRET) {
            console.warn('[STARTUP] WARNING: GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set in .env');
        }
    });
})();
