document.querySelectorAll('.drop-toggle').forEach(button => {
    button.addEventListener('click', () => {
        const dropdown = button.closest('.dropdown');
        const open = dropdown.classList.toggle('open');
        button.setAttribute('aria-expanded', String(open));
    });
});

document.addEventListener('click', event => {
    if (!event.target.closest('.dropdown')) {
        document.querySelectorAll('.dropdown.open').forEach(dropdown => {
            dropdown.classList.remove('open');
            dropdown.querySelector('button').setAttribute('aria-expanded', 'false');
        });
    }
});

const form = document.querySelector('#lead');

if (form) {
    const select = form.querySelector('#type');
    const addressGroup = form.querySelector('#homeowners-address');
    const address = form.querySelector('#property-address');
    const type = new URLSearchParams(location.search).get('type');

    if ([...select.options].some(option => option.value === type)) {
        select.value = type;
    }

    function updateAddressField() {
        const isHomeowners = select.value === 'Homeowners';
        addressGroup.hidden = !isHomeowners;
        address.disabled = !isHomeowners;
        address.required = isHomeowners;
    }

    select.addEventListener('change', updateAddressField);
    updateAddressField();
}

document.querySelectorAll('form[data-thank-you]').forEach(submissionForm => {
    const button = submissionForm.querySelector('button[type="submit"]');
    const status = submissionForm.querySelector('[data-submission-status]');

    submissionForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (button.disabled) return;

        button.disabled = true;
        status.textContent = 'Sending…';

        try {
            const response = await fetch(submissionForm.action, {
                method: submissionForm.method,
                body: new FormData(submissionForm),
                headers: { Accept: 'application/json' }
            });
            const result = await response.json();

            if (response.ok && result.ok === true) {
                window.location.assign(submissionForm.dataset.thankYou);
                return;
            }

            status.textContent = response.status === 429
                ? 'Too many requests. Please wait a moment before trying again.'
                : result.errors?.map(error => error.message).filter(Boolean).join(' ')
                    || 'Your submission could not be accepted. Please check your details and try again.';
        } catch {
            status.textContent = 'We couldn’t confirm your submission. Please check your connection.';
        }

        button.disabled = false;
    });
});

const reviewConfirmation = document.querySelector('[data-review-confirmation]');
if (reviewConfirmation && new URLSearchParams(location.search).get('submission') === 'review') {
    reviewConfirmation.textContent = 'I received your review and will read it before it appears on the site.';
}
