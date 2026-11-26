const analyticsDashboard = {
    panel: document.querySelector('#website-analytics'),
    days: document.querySelector('#analytics-days'),

    async load(token, isCurrent) {
        this.panel.textContent = 'Loading Google Analytics…';
        try {
            const { reports, breakdowns, geography } = await reviewsApi.request('/functions/v1/website-analytics', {
                method: 'POST',
                body: { days: Number(this.days.value) },
                token
            });
            if (isCurrent()) this.render(reports, breakdowns ?? geography?.slice(1));
        } catch (error) {
            if (!isCurrent()) return;
            if (error.status === 401 || error.status === 403) throw error;
            const notice = document.createElement('p');
            notice.className = 'admin-notice';
            notice.textContent = error.status === 404 || error.status === 503
                ? 'Google Analytics setup is pending.'
                : 'Could not load Google Analytics. Check the property access and try Refresh all.';
            this.panel.replaceChildren(notice);
        }
    },

    render([summary, pages, channels, devices, daily], [cities, countries, events] = []) {
        const totals = document.createElement('dl');
        totals.className = 'admin-metrics analytics-totals';
        const values = summary.rows?.[0]?.metricValues ?? [];
        ['Active users', 'Sessions', 'Page views', 'Key events'].forEach((label, index) => {
            const tile = document.createElement('div');
            const name = document.createElement('dt');
            name.textContent = label;
            const value = document.createElement('dd');
            value.textContent = Number(values[index]?.value ?? 0).toLocaleString();
            tile.append(name, value);
            totals.append(tile);
        });
        const note = document.createElement('p');
        note.className = 'analytics-date-note';
        note.textContent = `Last ${this.days.value} completed days. Today’s traffic is excluded.`;
        const grids = document.createElement('div');
        grids.className = 'analytics-breakdowns';
        grids.append(
            this.breakdown('Top pages', 'Page', 'Views', pages),
            this.breakdown('Traffic channels', 'Channel', 'Sessions', channels),
            this.breakdown('Devices', 'Device', 'Sessions', devices));
        this.panel.replaceChildren(note, totals, this.sessionChart(daily));
        if (cities) grids.append(this.breakdown('California cities', 'City', 'Sessions', cities));
        if (countries) grids.append(this.breakdown('Top countries', 'Country', 'Sessions', countries));
        if (events) grids.append(this.breakdown('Top events', 'Event', 'Count', events));
        this.panel.append(grids);
        const trend = document.createElement('details');
        trend.className = 'admin-record';
        const title = document.createElement('summary');
        title.textContent = 'Daily sessions';
        trend.append(title, this.breakdown('', 'Date', 'Sessions', daily, value =>
            /^\d{8}$/.test(value) ? `${value.slice(4, 6)}/${value.slice(6)}/${value.slice(0, 4)}` : value));
        this.panel.append(trend);
    },

    sessionChart(report) {
        const section = document.createElement('section');
        section.className = 'admin-record analytics-trend';
        const heading = document.createElement('h3');
        heading.textContent = 'Sessions over time';
        section.append(heading);
        if (!report.rows?.length) {
            const empty = document.createElement('p');
            empty.textContent = 'No sessions recorded for this date range.';
            section.append(empty);
            return section;
        }
        const count = Number(this.days.value);
        const data = new Map(report.rows.map(row =>
            [row.dimensionValues[0].value, Number(row.metricValues[0].value)]));
        const lastDay = report.rows.at(-1).dimensionValues[0].value;
        if (!/^\d{8}$/.test(lastDay)) return section;
        // Anchor to GA's report date range, including days with no sessions.
        const rangeEnd = new Date(Date.UTC(Number(lastDay.slice(0, 4)), Number(lastDay.slice(4, 6)) - 1,
            Number(lastDay.slice(6))));
        const timezone = report.metadata?.timeZone || 'UTC';
        try {
            const parts = new Intl.DateTimeFormat('en', {
                timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric'
            }).formatToParts();
            const value = type => Number(parts.find(part => part.type === type).value);
            rangeEnd.setTime(Date.UTC(value('year'), value('month') - 1, value('day') - 1));
        } catch {
            // Retain the last reported day if GA does not supply a usable time zone.
        }
        const values = Array.from({ length: count }, (_, index) => {
            const date = new Date(rangeEnd.getTime() - (count - index - 1) * 86400000);
            const key = date.toISOString().slice(0, 10).replaceAll('-', '');
            return data.get(key) || 0;
        });
        const chart = document.createElement('canvas');
        chart.width = 800;
        chart.height = 150;
        chart.setAttribute('role', 'img');
        chart.setAttribute('aria-label', 'Daily sessions bar chart. Exact values are listed under Daily sessions.');
        const ctx = chart.getContext('2d');
        if (!ctx) return section;
        const max = Math.max(1, ...values);
        const step = chart.width / values.length;
        ctx.fillStyle = '#846244';
        values.forEach((value, index) => {
            const height = Math.round(value / max * 134);
            ctx.fillRect(index * step, chart.height - height, Math.max(1, step - 2), height);
        });
        section.append(chart);
        return section;
    },

    breakdown(title, dimension, metric, report, format = value => value) {
        const section = document.createElement(title ? 'section' : 'div');
        if (title) {
            section.className = 'admin-record';
            const heading = document.createElement('h3');
            heading.textContent = title;
            section.append(heading);
        }
        if (!report.rows?.length) {
            const empty = document.createElement('p');
            empty.textContent = 'No data for this date range.';
            section.append(empty);
            return section;
        }
        const table = document.createElement('table');
        table.className = 'analytics-table';
        const header = table.createTHead().insertRow();
        for (const label of [dimension, metric]) {
            const cell = document.createElement('th');
            cell.scope = 'col';
            cell.textContent = label;
            header.append(cell);
        }
        const body = table.createTBody();
        for (const row of report.rows) {
            const line = body.insertRow();
            line.insertCell().textContent = format(row.dimensionValues?.[0]?.value ?? '');
            line.insertCell().textContent = Number(row.metricValues?.[0]?.value ?? 0).toLocaleString();
        }
        section.append(table);
        return section;
    }
};
