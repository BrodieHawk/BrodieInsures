const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
};
const encoder = new TextEncoder();
const tokenUrl = 'https://oauth2.googleapis.com/token';
const property = '565833245';
let cachedToken: { value: string; expires: number } | undefined;

function reply(body: unknown, status = 200) {
    return Response.json(body, { status, headers: cors });
}

function base64url(bytes: Uint8Array) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function googleToken(credential: { client_email: string; private_key: string }) {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedToken.expires > now + 60) return cachedToken.value;
    const key = Uint8Array.from(atob(credential.private_key.replace(/-----[^-]+-----|\s/g, '')),
        char => char.charCodeAt(0));
    const signingKey = await crypto.subtle.importKey('pkcs8', key,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const claims = {
        iss: credential.client_email,
        scope: 'https://www.googleapis.com/auth/analytics.readonly',
        aud: tokenUrl,
        iat: now,
        exp: now + 3600,
    };
    const assertion = [JSON.stringify({ alg: 'RS256', typ: 'JWT' }), JSON.stringify(claims)]
        .map(value => base64url(encoder.encode(value))).join('.');
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, encoder.encode(assertion));
    const response = await fetch(tokenUrl, {
        method: 'POST',
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: assertion + '.' + base64url(new Uint8Array(signature)),
        }),
    });
    if (!response.ok) throw new Error('Google token exchange failed');
    const { access_token, expires_in } = await response.json();
    if (typeof access_token !== 'string') throw new Error('Google returned an invalid token');
    cachedToken = { value: access_token, expires: now + Number(expires_in) };
    return cachedToken.value;
}

Deno.serve(async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return reply({ error: 'sign_in_required' }, 401);

    try {
        const permission = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/is_review_admin', {
            headers: { Authorization: authorization, apikey: request.headers.get('apikey') ?? '' },
        });
        if (permission.status === 401) return reply({ error: 'sign_in_required' }, 401);
        if (!permission.ok || await permission.json() !== true) return reply({ error: 'admin_required' }, 403);

        const credential = Deno.env.get('GA4_SERVICE_ACCOUNT_JSON');
        if (!credential) return reply({ error: 'analytics_setup_required' }, 503);
        const body = await request.json().catch(() => null);
        const days = body?.days;
        if (![7, 30, 90].includes(days)) return reply({ error: 'invalid_date_range' }, 400);

        const dateRanges = [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }];
        const breakdown = (dimension: string, metric: string, limit: number) => ({
            dateRanges,
            dimensions: [{ name: dimension }],
            metrics: [{ name: metric }],
            orderBys: [{ metric: { metricName: metric }, desc: true }],
            limit,
        });
        const accessToken = await googleToken(JSON.parse(credential));
        const batch = (requests: unknown[]) => fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:batchRunReports`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests }),
        });
        const exact = (fieldName: string, value: string) => ({
            filter: { fieldName, stringFilter: { value, matchType: 'EXACT' } },
        });
        const optionalReports = (requests: unknown[], label: string) => batch(requests)
            .then(result => {
                if (result.ok) return result.json();
                console.warn(`Google Analytics ${label} report returned HTTP ${result.status}`);
                return null;
            }).catch(() => null);
        const [response, extra] = await Promise.all([
            batch([
                { dateRanges, metrics: ['activeUsers', 'sessions', 'screenPageViews', 'keyEvents'].map(name => ({ name })) },
                breakdown('pagePath', 'screenPageViews', 10),
                breakdown('sessionDefaultChannelGroup', 'sessions', 10),
                breakdown('deviceCategory', 'sessions', 8),
                { ...breakdown('date', 'sessions', days), orderBys: [{ dimension: { dimensionName: 'date' } }] },
            ]),
            optionalReports([
                { ...breakdown('city', 'sessions', 15), dimensionFilter: { andGroup: {
                    expressions: [exact('countryId', 'US'), exact('region', 'California')],
                } } },
                breakdown('country', 'sessions', 12),
                breakdown('eventName', 'eventCount', 12),
            ], 'breakdown'),
        ]);
        if (response.status === 403) return reply({ error: 'google_access_required' }, 502);
        if (!response.ok) throw new Error('Google Analytics report failed');
        const { reports } = await response.json();
        if (!Array.isArray(reports) || reports.length !== 5) throw new Error('Google returned an incomplete report');
        return reply({ reports, breakdowns: extra?.reports ?? [] });
    } catch {
        console.error('Website analytics request failed');
        return reply({ error: 'analytics_unavailable' }, 502);
    }
});
