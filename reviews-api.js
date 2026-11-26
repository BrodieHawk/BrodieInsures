const reviewsApi = {
    configured: /^https:\/\/[^/]+\/?$/.test(reviewsConfig.url)
        && reviewsConfig.publishableKey.startsWith('sb_publishable_'),

    async request(path, { method = 'GET', body, token, prefer } = {}) {
        const headers = { apikey: reviewsConfig.publishableKey };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;
        if (prefer) headers.Prefer = prefer;
        const response = await fetch(reviewsConfig.url.replace(/\/$/, '') + path, {
            method,
            headers,
            body: JSON.stringify(body),
            cache: 'no-store'
        });
        if (!response.ok) {
            const error = new Error('Review request failed');
            error.status = response.status;
            const result = await response.json().catch(() => null);
            error.code = result?.code;
            throw error;
        }
        if (method === 'HEAD' && prefer === 'count=exact') {
            const total = response.headers.get('Content-Range')?.match(/\/(\d+)$/);
            if (!total) throw new Error('Submission count unavailable');
            return Number(total[1]);
        }
        return response.status === 204 || prefer === 'return=minimal' ? null : response.json();
    },

    submit(fields) {
        return this.request('/rest/v1/client_reviews', {
            method: 'POST',
            prefer: 'return=minimal',
            body: {
                first_name: fields.get('firstName').trim(),
                last_name: fields.get('lastName').trim(),
                email: fields.get('email').trim(),
                city: fields.get('city').trim(),
                rating: Number(fields.get('rating')),
                review: fields.get('review').trim(),
                permission: fields.get('publicationPermission') === 'Yes'
            }
        });
    },

    async quoteDashboardReady() {
        try {
            return await this.request('/rest/v1/rpc/quote_dashboard_ready');
        } catch (error) {
            if (error.status === 404) return false;
            throw error;
        }
    },

    submitQuote(fields) {
        return this.request('/rest/v1/quote_requests', {
            method: 'POST',
            prefer: 'return=minimal',
            body: {
                coverage: fields.get('coverage'),
                first_name: fields.get('first').trim(),
                last_name: fields.get('last').trim(),
                email: fields.get('email').trim(),
                phone: fields.get('phone').trim(),
                property_address: (fields.get('propertyAddress') || '').trim(),
                message: fields.get('message').trim()
            }
        });
    }
};
