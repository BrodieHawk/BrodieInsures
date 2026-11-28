(() => {
    const viewer = document.querySelector('#insurance-guides');
    const heading = document.querySelector('#insurance-guides-title');
    const slide = document.querySelector('#insurance-slide');
    const feedback = viewer.querySelector('[role="status"]');
    const choices = [...viewer.querySelectorAll('[data-guide]')];
    const guides = new Map(choices.map(link => [link.dataset.guide, link]));
    const keys = [...guides.keys()];
    const cache = new Map();
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const carrierViewer = document.querySelector('#carriers');
    const carrierLink = document.querySelector('.links a[href="resources.html"]');
    const carrierTitle = carrierViewer.querySelector('h2');
    let selected;
    let displayed;
    let opener;
    let request;
    let touchStart;

    function guideFromLink(link) {
        const raw = link.getAttribute('href');
        if (raw === 'coverage.html') return 'home';
        const key = raw?.replace(/\.html$/, '');
        return keys.includes(key) ? key : undefined;
    }

    function closeGuide(restoreFocus) {
        request?.abort();
        viewer.hidden = true;
        slide.replaceChildren();
        selected = undefined;
        displayed = undefined;
        slide.removeAttribute('aria-busy');
        if (restoreFocus) (opener ?? document.querySelector('.hero a[href="coverage.html"]')).focus();
    }

    async function loadGuide(key, signal) {
        if (cache.has(key)) return cache.get(key);
        let article;
        if (location.protocol === 'file:') {
            article = document.getElementById('guide-preview-' + key)?.content.firstElementChild?.cloneNode(true);
        } else {
            const response = await fetch(guides.get(key).href, { signal });
            if (!response.ok) throw new Error('Could not load guide');
            const page = new DOMParser().parseFromString(await response.text(), 'text/html');
            article = page.querySelector('article.guide-article');
        }
        if (!article) throw new Error('Guide content is missing');
        const originalHeading = article.querySelector('h1');
        if (originalHeading) {
            const title = document.createElement('h3');
            title.className = 'guide-title';
            title.append(...originalHeading.childNodes);
            originalHeading.replaceWith(title);
        }
        article.querySelectorAll(':scope > section > h2, .guide-callout > h2').forEach(original => {
            const title = document.createElement('h4');
            title.append(...original.childNodes);
            original.replaceWith(title);
        });
        cache.set(key, article);
        return article;
    }

    async function openGuide(key, { reveal = false, direction = 0 } = {}) {
        if (!guides.has(key)) return;
        const wasHidden = viewer.hidden;
        viewer.hidden = false;
        const changed = selected !== key || (displayed !== key && !slide.hasAttribute('aria-busy'));
        selected = key;
        for (const [id, link] of guides) {
            if (id === key) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
        }
        if (reveal || wasHidden) {
            heading.focus({ preventScroll: true });
            viewer.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
        }
        if (!changed) return;
        request?.abort();
        const controller = new AbortController();
        request = controller;
        slide.setAttribute('aria-busy', 'true');
        feedback.textContent = cache.has(key) ? '' : 'Loading coverage…';
        try {
            const article = await loadGuide(key, controller.signal);
            if (controller.signal.aborted) return;
            slide.dataset.direction = String(direction);
            slide.replaceChildren(document.importNode(article, true));
            displayed = key;
            feedback.textContent = '';
        } catch {
            if (controller.signal.aborted) return;
            const fallback = document.createElement('a');
            fallback.href = guides.get(key).href;
            fallback.textContent = 'Open the ' + guides.get(key).textContent + ' guide';
            slide.replaceChildren(fallback);
            feedback.textContent = 'Could not load this guide here.';
        } finally {
            if (!controller.signal.aborted) slide.removeAttribute('aria-busy');
        }
    }

    function selectGuide(key, options) {
        const hash = '#insurance-' + key;
        if (location.hash !== hash) {
            history[viewer.hidden ? 'pushState' : 'replaceState'](null, '', hash);
        }
        void openGuide(key, options);
    }

    function syncLocation() {
        const showCarriers = location.hash === '#carriers';
        carrierViewer.hidden = !showCarriers;
        const key = location.hash.startsWith('#insurance-') ? location.hash.slice(11) : undefined;
        if (guides.has(key)) void openGuide(key);
        else if (!viewer.hidden) closeGuide(false);
        if (showCarriers) {
            carrierTitle.focus({ preventScroll: true });
            carrierViewer.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
        }
    }

    function step(direction) {
        if (!selected) return;
        const index = (keys.indexOf(selected) + direction + keys.length) % keys.length;
        selectGuide(keys[index], { direction });
        if (slide.getBoundingClientRect().top < 0) slide.scrollIntoView({ block: 'start',
            behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    }

    document.addEventListener('click', event => {
        const link = event.target.closest('a');
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
            || event.shiftKey || event.altKey) return;
        if (link === carrierLink) {
            event.preventDefault();
            if (location.hash !== '#carriers') history.pushState(null, '', '#carriers');
            syncLocation();
            return;
        }
        const fromViewer = viewer.contains(link);
        const key = fromViewer ? link.dataset.guide : guideFromLink(link);
        if (!key || !guides.has(key)) return;
        event.preventDefault();
        if (!fromViewer) {
            const dropdown = link.closest('.dropdown');
            if (dropdown) {
                dropdown.classList.remove('open');
                dropdown.querySelector('.drop-toggle').setAttribute('aria-expanded', 'false');
            }
            opener = link;
        }
        const direction = selected ? Math.sign(keys.indexOf(key) - keys.indexOf(selected)) : 0;
        selectGuide(key, { reveal: !fromViewer, direction });
        if (!carrierViewer.hidden) syncLocation();
    });

    carrierViewer.querySelector('[data-close-carriers]').addEventListener('click', () => {
        history.replaceState(null, '', location.pathname + location.search);
        syncLocation();
        (carrierLink.hidden ? document.querySelector('nav .logo') : carrierLink).focus();
    });

    viewer.querySelector('[data-close-coverage]').addEventListener('click', () => {
        history.replaceState(null, '', location.pathname + location.search);
        closeGuide(true);
    });
    viewer.querySelectorAll('[data-coverage-step]').forEach(button => {
        button.addEventListener('click', () => step(Number(button.dataset.coverageStep)));
    });
    slide.addEventListener('touchstart', event => {
        if (event.touches.length !== 1 || event.target.closest('a, button, input, select')) {
            touchStart = undefined;
            return;
        }
        const { clientX, clientY } = event.touches[0];
        touchStart = { clientX, clientY };
    }, { passive: true });
    slide.addEventListener('touchend', event => {
        if (!touchStart || !event.changedTouches.length) return;
        const x = event.changedTouches[0].clientX - touchStart.clientX;
        const y = event.changedTouches[0].clientY - touchStart.clientY;
        touchStart = undefined;
        if (Math.abs(x) >= 55 && Math.abs(x) > Math.abs(y) * 1.5) step(x < 0 ? 1 : -1);
    }, { passive: true });
    slide.addEventListener('touchcancel', () => { touchStart = undefined; }, { passive: true });
    window.addEventListener('hashchange', syncLocation);
    syncLocation();
})();
