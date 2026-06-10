const express = require('express');
const crypto = require('crypto');
const router = express.Router();

module.exports = function(db, CLIENT_ID, CLIENT_SECRET, CALLBACK_URL) {
    // Dynamic secure flag: only use Secure if the application is accessed over HTTPS
    const isSecure = CALLBACK_URL && CALLBACK_URL.startsWith('https://');
    const cookieFlags = `HttpOnly; Path=/; SameSite=Lax; Max-Age=86400${isSecure ? '; Secure' : ''}`;

    function setSessionCookie(res, sid) {
        res.setHeader('Set-Cookie', `sid=${sid}; ${cookieFlags}`);
    }

    function getSessionId(req) {
        const match = req.headers.cookie?.match(/(?:^|;\s*)sid=([^;]+)/);
        return match ? match[1] : null;
    }

    async function getSession(req) {
        const sid = getSessionId(req);
        return sid ? await db.getSessionById(sid) : null;
    }

    function generateState() {
        return crypto.randomBytes(16).toString('hex');
    }

    // Step 1: Redirect to GitHub
    router.get('/auth/github', async (req, res) => {
        // If no real Github credentials, simulate login for local testing (non-production only)
        if (!CLIENT_ID || CLIENT_ID.trim() === '') {
            if (process.env.NODE_ENV === 'production') {
                console.error('[Auth] GitHub CLIENT_ID is missing. Refusing mock login in production.');
                return res.status(500).send('Authentication setup failed: GITHUB_CLIENT_ID not set');
            }
            console.log('[Auth] Mocking GitHub login because no CLIENT_ID is set.');
            const newSid = crypto.randomBytes(32).toString('hex');
            await db.createSession(newSid, null, 'mock_token');
            setSessionCookie(res, newSid);
            return res.redirect('/');
        }

        const state = generateState();
        const sid = crypto.randomBytes(32).toString('hex');
        try {
            await db.createSession(sid, state);
            setSessionCookie(res, sid);
            const url = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&state=${state}`;
            res.redirect(url);
        } catch (err) {
            console.error('[Auth] Failed to create session:', err.message);
            res.status(500).send('Authentication setup failed');
        }
    });

    // Step 2: Handle GitHub callback, exchange code for token
    router.get('/auth/callback', async (req, res) => {
        const { code, state } = req.query;
        const sid = getSessionId(req);
        let session = await getSession(req);

        // CSRF protection on OAuth state — verify it is exactly 32 hex chars
        if (!state || !/^[0-9a-f]{32}$/.test(state)) {
            console.error('[Auth] Invalid state parameter format:', state);
            return res.status(400).send('Invalid state parameter format');
        }

        // Fallback: If cookie is missing/invalid (e.g. localhost/127.0.0.1 mismatch), retrieve session by state query param
        if (!session) {
            console.warn('[Auth] SECURITY: Cookie session missing — falling back to state-only lookup.');
            session = await db.getSessionByState(state);
        }

        if (!session || session.state !== state) {
            console.error('[Auth] Invalid state. Session exists:', !!session, 'Session state:', session ? session.state : 'N/A', 'Query state:', state);
            return res.status(403).send('Invalid state parameter. Possible CSRF attack.');
        }

        try {
            console.log('[Auth] Exchanging code for token...');
            const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    code: code,
                    redirect_uri: CALLBACK_URL
                })
            });
            const tokenData = await tokenRes.json();

            if (tokenData.error) {
                console.error('[Auth] Token exchange error:', tokenData.error_description || tokenData.error);
                return res.status(400).json({ error: tokenData.error_description || tokenData.error });
            }

            console.log('[Auth] Token obtained successfully');

            // Disabled Session Rotation: Updating token on existing session to prevent 
            // the browser from ignoring Set-Cookie on cross-site redirect chains.
            const currentSid = getSessionId(req) || session.sid;
            await db.updateSessionToken(currentSid, tokenData.access_token);
            
            // Invalidate the state to prevent replay attacks
            await db.updateSessionState(currentSid, null);
            
            // Still ensure the cookie is set just in case it was missing
            setSessionCookie(res, currentSid);
            res.redirect('/');
        } catch (err) {
            console.error('[Auth] Token exchange exception');
            res.status(500).send('Authentication failed');
        }
    });

    // Step 3: Logout - Immediate database session invalidation
    router.get('/auth/logout', async (req, res) => {
        const sid = getSessionId(req);
        if (sid) {
            try {
                await db.deleteSession(sid);
            } catch (err) {
                console.error('[Auth] Failed to delete session on logout:', err.message);
            }
        }
        res.setHeader('Set-Cookie',
            `sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${isSecure ? '; Secure' : ''}`
        );
        res.redirect('/');
    });

    return router;
};
