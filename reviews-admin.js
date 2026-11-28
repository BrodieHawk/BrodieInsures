const login = document.querySelector('#admin-login');
const queue = document.querySelector('#admin-queue');
const status = document.querySelector('#admin-status');
const refresh = document.querySelector('#refresh-reviews');
const logout = document.querySelector('#admin-logout');
const signIn = login.querySelector('button');
const reviewsPath = '/rest/v1/client_reviews';
const quotesPath = '/rest/v1/quote_requests';
const metricNodes = [...document.querySelectorAll('[data-admin-metric]')];
const metricsStatus = document.querySelector('#admin-metrics-status');
const metricQueries = {
    pending: reviewsPath + '?status=eq.pending',
    published: reviewsPath + '?status=eq.approved',
    new: quotesPath + '?stage=eq.new',
    'in-progress': quotesPath + '?stage=in.(contacted,quoting,quote_sent)',
    won: quotesPath + '?stage=eq.won',
    'total-quotes': quotesPath + '?id=not.is.null'
};
const filters = document.querySelector('#review-filter');
const quoteFilter = document.querySelector('#quote-filter');
const quoteCoverage = document.querySelector('#quote-coverage-filter');
const pageSize = 5;
const queues = Object.fromEntries(['reviews', 'quotes'].map(name => {
    const section = document.getElementById(name);
    return [name, {
        name,
        filter: name === 'reviews' ? filters : quoteFilter,
        sort: section.querySelector('[data-queue-sort]'),
        searchForm: section.querySelector('[data-search-form]'),
        search: section.querySelector('[data-queue-search]'),
        clearSearch: section.querySelector('[data-clear-search]'),
        list: section.querySelector('[data-queue-list]'),
        pagination: section.querySelector('[data-pagination]'),
        previous: section.querySelector('[data-previous]'),
        next: section.querySelector('[data-next]'),
        pageLabel: section.querySelector('[data-page]'),
        page: 0,
        keywords: '',
        hasNext: false
    }];
}));
let quoteWorkflowAvailable = true;
let token;
let sessionTimeout;

function showLogin(message) {
    clearTimeout(sessionTimeout);
    token = undefined;
    for (const panel of Object.values(queues)) {
        panel.list.replaceChildren();
        panel.pagination.hidden = true;
        panel.page = 0;
        panel.hasNext = false;
        panel.keywords = '';
        panel.search.value = '';
        panel.clearSearch.hidden = true;
    }
    analyticsDashboard.panel.replaceChildren();
    metricNodes.forEach(node => { node.textContent = '—'; });
    metricsStatus.hidden = true;
    queue.hidden = true;
    login.hidden = false;
    status.textContent = message;
    login.elements.email.focus();
}

async function loadMetrics(activeToken) {
    const results = await Promise.allSettled(metricNodes.map(node =>
        reviewsApi.request(metricQueries[node.dataset.adminMetric] + '&select=id&limit=1',
            { method: 'HEAD', prefer: 'count=exact', token: activeToken })
    ));
    if (token !== activeToken) return;
    results.forEach((result, index) => {
        metricNodes[index].textContent = result.status === 'fulfilled' ? result.value.toLocaleString() : '—';
    });
    const unavailable = results.some(result => result.status === 'rejected');
    metricsStatus.hidden = !unavailable;
    metricsStatus.textContent = unavailable ? 'Some totals are unavailable. Use Refresh to try again.' : '';
}

function showError(error, message) {
    if (error.status === 401 || error.status === 403) {
        showLogin('Your admin session ended. Please sign in again.');
        return;
    }
    status.textContent = message;
}

function submissionSearch(keywords, columns) {
    const terms = keywords.split(/[\s*]+/).filter(Boolean).slice(0, 5);
    if (!terms.length) return '';
    const groups = terms.map(term => {
        const wildcardSafe = term.replace(/[\\%_]/g, '\\$&');
        const pattern = JSON.stringify('%' + wildcardSafe + '%');
        return 'or(' + columns.map(column => column + '.ilike.' + pattern).join(',') + ')';
    });
    return '&' + new URLSearchParams({ and: '(' + groups.join(',') + ')' });
}

async function loadQueue(panel, activeToken) {
    const isReviews = panel.name === 'reviews';
    const { list, pagination } = panel;
    const restriction = isReviews && filters.value !== 'all' ? '&status=eq.' + filters.value : '';
    const coverage = quoteCoverage.value === 'all' ? '' : '&coverage=eq.' + encodeURIComponent(quoteCoverage.value);
    const quoteFields = quotesPath + '?select=id,coverage,first_name,last_name,email,phone,property_address,message,submitted_at';
    const quoteRestriction = quoteFilter.value === 'all' ? '' : '&stage=eq.' + quoteFilter.value;
    const path = isReviews
        ? reviewsPath + '?select=id,first_name,last_name,email,city,rating,review,status,submitted_at' + restriction
        : quoteFields + ',stage,admin_notes,workflow_updated_at' + quoteRestriction;
    const defaultDirection = isReviews && filters.value === 'pending' ? 'asc' : 'desc';
    const direction = panel.sort.value === 'default' ? defaultDirection : panel.sort.value;
    const columns = isReviews
        ? ['first_name', 'last_name', 'email', 'city', 'review']
        : ['first_name', 'last_name', 'email', 'phone', 'property_address', 'message'];
    const criteria = (isReviews ? '' : coverage) + submissionSearch(panel.keywords, columns);
    const paging = `&order=submitted_at.${direction},id.${direction}&limit=${pageSize + 1}&offset=${panel.page * pageSize}`;
    let records;
    try {
        records = await reviewsApi.request(path + criteria + paging, { token: activeToken });
        if (!isReviews && token === activeToken) quoteWorkflowAvailable = true;
    } catch (error) {
        if (isReviews) throw error;
        if (token !== activeToken) return;
        if (error.status === 404) {
            list.textContent = 'The quote dashboard is awaiting database setup.';
            pagination.hidden = true;
            panel.hasNext = false;
            return;
        }
        if (error.code !== '42703' && error.code !== 'PGRST204') throw error;
        records = await reviewsApi.request(quoteFields + criteria + paging, { token: activeToken });
        if (token === activeToken) {
            quoteWorkflowAvailable = false;
            quoteFilter.value = 'all';
        }
    }
    if (token !== activeToken) return;
    if (!records.length && panel.page > 0) {
        panel.page -= 1;
        return loadQueue(panel, activeToken);
    }
    panel.hasNext = records.length > pageSize;
    pagination.hidden = !panel.page && !panel.hasNext;
    panel.pageLabel.textContent = `Page ${panel.page + 1}`;
    list.replaceChildren(...records.slice(0, pageSize).map(isReviews ? reviewCard : quoteCard));
    if (!isReviews && !quoteWorkflowAvailable) {
        const notice = document.createElement('p');
        notice.className = 'admin-notice';
        notice.textContent = 'Quote stages and notes will be available after the database upgrade.';
        list.prepend(notice);
    }
    if (!records.length) {
        const empty = document.createElement('p');
        empty.textContent = isReviews ? 'No testimonials match this view.' : 'No quote requests match this view.';
        list.append(empty);
    }
}

function reviewCard(review) {
    const card = document.createElement('article');
    card.className = 'panel coverage-article admin-record';
    const heading = document.createElement('h3');
    heading.textContent = `Public name: ${review.first_name} ${[...review.last_name][0]}.`
        + (review.city ? ` · ${review.city}` : '');
    const contact = document.createElement('p');
    contact.textContent = review.email ? `Private contact: ${review.first_name} ${review.last_name} (${review.email})`
        : 'Imported testimonial';
    const rating = document.createElement('p');
    const label = { pending: 'Pending', approved: 'Published', rejected: 'Rejected', removed: 'Removed' };
    rating.textContent = `${label[review.status]} · ${review.rating} out of 5 stars · ${new Date(review.submitted_at).toLocaleDateString()}`;
    const text = document.createElement('p');
    text.className = 'review-text';
    text.textContent = review.review;
    const actions = document.createElement('div');
    actions.className = 'review-admin-actions';
    const decisions = review.status === 'pending' ? [['Approve and publish', 'approved'], ['Reject', 'rejected']]
        : review.status === 'removed' ? [] : [['Remove review', 'removed']];
    for (const [label, decision] of decisions) {
        const button = document.createElement('button');
        button.className = 'btn';
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', () => {
            if (decision === 'removed' && !window.confirm('Remove this review? Published reviews will disappear from Testimonials.')) return;
            decide(review, decision);
        });
        actions.append(button);
    }
    card.append(heading, contact, rating, text, actions);
    return card;
}

function quoteCard(quote) {
    const card = document.createElement('article');
    card.className = 'panel coverage-article admin-record';
    const stages = quoteFilter.options;
    const titleRow = document.createElement('div');
    titleRow.className = 'admin-card-title';
    const heading = document.createElement('h3');
    heading.textContent = `${quote.first_name} ${quote.last_name}`;
    titleRow.append(heading);
    const badge = document.createElement('span');
    badge.className = 'admin-stage';
    if (quote.stage) {
        badge.dataset.stage = quote.stage;
        badge.textContent = [...stages].find(option => option.value === quote.stage)?.textContent;
        titleRow.append(badge);
    }
    card.append(titleRow);
    const fields = document.createElement('dl');
    fields.className = 'admin-quote-details';
    const details = [
        ['Coverage', quote.coverage === 'Rental' ? 'Renters' : quote.coverage],
        ['Received', new Date(quote.submitted_at).toLocaleString()],
        ['Email', quote.email],
        ['Phone', quote.phone],
        ['Property address', quote.property_address],
        ['Message', quote.message]
    ];
    for (const [label, value] of details) {
        if (!value) continue;
        const line = document.createElement('div');
        const name = document.createElement('dt');
        const content = document.createElement('dd');
        name.textContent = label;
        content.textContent = value;
        content.className = 'review-text';
        line.append(name, content);
        fields.append(line);
    }
    card.append(fields);
    const actions = document.createElement('div');
    actions.className = 'review-admin-actions admin-quote-actions';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn secondary admin-delete';
    remove.textContent = 'Delete request';
    remove.addEventListener('click', () => {
        if (window.confirm(`Permanently delete the quote request from ${quote.first_name} ${quote.last_name}, including its follow-up notes?`)) {
            void deleteQuote(quote, card);
        }
    });
    actions.append(remove);
    card.append(actions);
    if (!quote.stage) return card;

    const editor = document.createElement('details');
    editor.className = 'admin-quote-editor';
    const summary = document.createElement('summary');
    summary.textContent = 'Stage and follow-up notes';
    const form = document.createElement('form');
    const stageLabel = document.createElement('label');
    stageLabel.textContent = 'Stage';
    const stage = document.createElement('select');
    for (const option of [...stages].slice(1)) stage.append(option.cloneNode(true));
    stage.value = quote.stage;
    stageLabel.append(stage);
    const notesLabel = document.createElement('label');
    notesLabel.textContent = 'Private follow-up notes';
    const notes = document.createElement('textarea');
    notes.rows = 3;
    notes.maxLength = 4000;
    notes.value = quote.admin_notes;
    notesLabel.append(notes);
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn';
    save.textContent = 'Save changes';
    const feedback = document.createElement('p');
    feedback.setAttribute('role', 'status');
    feedback.className = 'admin-save-feedback';
    form.append(stageLabel, notesLabel, save, feedback);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (save.disabled) return;
        const activeToken = token;
        const changes = { stage: stage.value, admin_notes: notes.value.trim() };
        setQueueBusy(true);
        stage.disabled = true;
        notes.disabled = true;
        feedback.textContent = 'Saving…';
        try {
            const updated = await reviewsApi.request(
                `${quotesPath}?id=eq.${quote.id}&workflow_updated_at=eq.${encodeURIComponent(quote.workflow_updated_at)}&select=stage,admin_notes,workflow_updated_at`,
                { method: 'PATCH', token: activeToken, prefer: 'return=representation', body: changes }
            );
            if (token !== activeToken) return;
            if (!updated.length) {
                feedback.textContent = 'This request changed elsewhere. Copy your notes before refreshing.';
                return;
            }
            Object.assign(quote, updated[0]);
            notes.value = quote.admin_notes;
            badge.dataset.stage = quote.stage;
            badge.textContent = stage.selectedOptions[0].textContent;
            feedback.textContent = 'Changes saved.';
            await loadMetrics(activeToken);
            if (quoteFilter.value !== 'all' && quoteFilter.value !== quote.stage) {
                await loadQueue(queues.quotes, activeToken);
                if (token === activeToken) status.textContent = 'Quote moved to its new stage.';
            }
        } catch (error) {
            if (token === activeToken) {
                if (error.status === 401 || error.status === 403) showError(error);
                else feedback.textContent = 'Could not confirm your changes. Try again or refresh.';
            }
        } finally {
            if (token === activeToken) {
                setQueueBusy(false);
                stage.disabled = false;
                notes.disabled = false;
            }
        }
    });
    editor.append(summary, form);
    card.append(editor);
    return card;
}

async function deleteQuote(quote, card) {
    const activeToken = token;
    if (!activeToken) return;
    setQueueBusy(true);
    status.textContent = 'Deleting quote request…';
    try {
        const version = quote.workflow_updated_at
            ? '&workflow_updated_at=eq.' + encodeURIComponent(quote.workflow_updated_at) : '';
        const deleted = await reviewsApi.request(`${quotesPath}?id=eq.${quote.id}${version}&select=id`, {
            method: 'DELETE',
            token: activeToken,
            prefer: 'return=representation'
        });
        if (token !== activeToken) return;
        if (!deleted.length) {
            status.textContent = 'This quote changed or was already deleted. Refresh to see the latest requests.';
            return;
        }
        card.remove();
        status.textContent = 'Quote request deleted.';
        try {
            await Promise.all([loadQueue(queues.quotes, activeToken), loadMetrics(activeToken)]);
        } catch (error) {
            if (token === activeToken) showError(error, 'Quote deleted. Use Refresh all to reload the quote list.');
        }
        if (token === activeToken) document.querySelector('#quotes-heading').focus();
    } catch (error) {
        if (token === activeToken) {
            if (error.status === 403 && error.code === '42501') {
                status.textContent = 'Quote deletion requires the Supabase database update.';
            } else {
                showError(error, 'Could not confirm deletion. Refresh the quote list before trying again.');
            }
        }
    } finally {
        if (token === activeToken) setQueueBusy(false);
    }
}

function setQueueBusy(busy) {
    queue.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    filters.disabled = busy;
    analyticsDashboard.days.disabled = busy;
    quoteFilter.disabled = busy || !quoteWorkflowAvailable;
    quoteCoverage.disabled = busy;
    for (const panel of Object.values(queues)) {
        panel.sort.disabled = busy;
        panel.search.disabled = busy;
        panel.previous.disabled = busy || panel.page === 0;
        panel.next.disabled = busy || !panel.hasNext;
    }
}

async function decide(review, decision) {
    const activeToken = token;
    setQueueBusy(true);
    status.textContent = 'Saving decision…';
    try {
        const updated = await reviewsApi.request(`${reviewsPath}?id=eq.${review.id}&status=eq.${review.status}&select=id`, {
            method: 'PATCH',
            token: activeToken,
            prefer: 'return=representation',
            body: { status: decision }
        });
        if (token !== activeToken) return;
        const message = updated.length === 0 ? 'This review was already handled.'
            : { approved: 'Review published.', rejected: 'Review rejected.', removed: 'Review removed.' }[decision];
        status.textContent = message;
        try {
            await Promise.all([loadQueue(queues.reviews, activeToken), loadMetrics(activeToken)]);
        } catch (error) {
            if (token === activeToken) showError(error, `${message} Use Refresh to reload the queue.`);
        }
        if (token === activeToken) refresh.focus();
    } catch (error) {
        if (token === activeToken) showError(error, 'Could not confirm the decision. Refresh before trying again.');
    } finally {
        if (token === activeToken) setQueueBusy(false);
    }
}

login.addEventListener('submit', async event => {
    event.preventDefault();
    signIn.disabled = true;
    status.textContent = 'Signing in…';
    const { email, password } = Object.fromEntries(new FormData(login));
    let session;
    try {
        session = await reviewsApi.request('/auth/v1/token?grant_type=password', {
            method: 'POST',
            body: { email, password }
        });
        const allowed = await reviewsApi.request('/rest/v1/rpc/is_review_admin', { token: session.access_token });
        if (!allowed) {
            status.textContent = 'This account does not have review admin access.';
            return;
        }
        token = session.access_token;

        sessionTimeout = setTimeout(() => showLogin('Your admin session expired. Please sign in again.'),
            session.expires_in * 1000);
        status.textContent = '';
        login.hidden = true;
        queue.hidden = false;
        setQueueBusy(false);
        refresh.focus();
        void refreshDashboard();
    } catch (error) {
        showLogin(error.status === 429 ? 'Too many sign-in attempts. Please try again later.'
            : session ? 'Could not open the review queue. Please try again.'
                : 'Sign-in failed. Check your email and password and try again.');
    } finally {
        login.elements.password.value = '';
        signIn.disabled = false;
    }
});

async function refreshDashboard(section) {
    const activeToken = token;
    if (!activeToken) return;
    setQueueBusy(true);
    const panels = section && section !== 'analytics' ? [queues[section]] : Object.values(queues);
    const tasks = section === 'analytics' ? [] : panels.map(async panel => {
        try {
            await loadQueue(panel, activeToken);
        } catch (error) {
            if (token !== activeToken) return;
            if (error.status === 401 || error.status === 403) throw error;
            panel.list.textContent = 'Could not load this queue. Use Refresh all to try again.';
            panel.pagination.hidden = true;
        }
    });
    if (!section) tasks.push(loadMetrics(activeToken));
    if (!section || section === 'analytics') {
        tasks.push(analyticsDashboard.load(activeToken, () => token === activeToken));
    }
    try {
        await Promise.all(tasks);
    } catch (error) {
        if (token === activeToken) showError(error, 'Could not refresh the dashboard. Please try again.');
    } finally {
        if (token === activeToken) setQueueBusy(false);
    }
}

refresh.addEventListener('click', () => refreshDashboard());
analyticsDashboard.days.addEventListener('change', () => refreshDashboard('analytics'));
quoteCoverage.addEventListener('change', () => {
    queues.quotes.page = 0;
    refreshDashboard('quotes');
});
for (const panel of Object.values(queues)) {
    const applyFilters = () => {
        panel.page = 0;
        return refreshDashboard(panel.name);
    };
    panel.filter.addEventListener('change', applyFilters);
    panel.sort.addEventListener('change', applyFilters);
    panel.searchForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (panel.search.disabled) return;
        panel.keywords = panel.search.value.trim();
        panel.clearSearch.hidden = !panel.keywords;
        await applyFilters();
        if (token) panel.search.focus();
    });
    panel.clearSearch.addEventListener('click', async () => {
        panel.search.value = '';
        panel.keywords = '';
        panel.clearSearch.hidden = true;
        await applyFilters();
        if (token) panel.search.focus();
    });
    panel.previous.addEventListener('click', () => {
        panel.page -= 1;
        refreshDashboard(panel.name);
    });
    panel.next.addEventListener('click', () => {
        panel.page += 1;
        refreshDashboard(panel.name);
    });
}

logout.addEventListener('click', () => showLogin('Signed out.'));

if (reviewsApi.configured) {
    login.hidden = false;
} else {
    status.textContent = 'Review administration is awaiting setup.';
}
