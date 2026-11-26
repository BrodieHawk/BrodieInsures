async function loadApprovedReviews() {
    const list = document.querySelector('#approved-reviews');
    const status = document.querySelector('#reviews-status');
    try {
        let reviews;
        let includeStatic = false;
        try {
            reviews = await reviewsApi.request('/rest/v1/rpc/get_published_testimonials');
        } catch (error) {
            if (error.status !== 404) throw error;
            includeStatic = true;
            reviews = await reviewsApi.request('/rest/v1/rpc/get_approved_reviews');
        }
        const cards = document.createDocumentFragment();
        for (const review of reviews) {
            const card = document.createElement('article');
            card.className = 'panel coverage-article';
            const name = document.createElement('h3');
            name.textContent = review.city ? `${review.display_name} · ${review.city}` : review.display_name;
            const rating = document.createElement('p');
            rating.className = 'eyebrow';
            rating.textContent = `${review.rating} out of 5 stars`;
            const quote = document.createElement('blockquote');
            const text = document.createElement('p');
            text.className = 'review-text';
            text.textContent = review.review;
            quote.append(text);
            card.append(name, rating, quote);
            cards.append(card);
        }
        if (includeStatic) list.prepend(cards);
        else list.replaceChildren(cards);
        list.hidden = false;
    } catch {
        status.hidden = false;
        status.textContent = 'Recently published reviews are temporarily unavailable.';
    }
}

if (reviewsApi.configured) loadApprovedReviews();
else document.querySelector('#approved-reviews').hidden = false;
