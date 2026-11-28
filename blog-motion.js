const photos = [...document.querySelectorAll('img.blog-cover')];
const photoDialog = document.createElement('dialog');
photoDialog.className = 'blog-photo-dialog';
photoDialog.setAttribute('aria-label', 'Expanded photo');

const closePhoto = document.createElement('button');
closePhoto.className = 'btn';
closePhoto.type = 'button';
closePhoto.textContent = 'Close photo';
const expandedPhoto = document.createElement('img');
photoDialog.append(closePhoto, expandedPhoto);
document.body.append(photoDialog);

closePhoto.addEventListener('click', () => photoDialog.close());
photoDialog.addEventListener('click', event => {
    if (event.target === photoDialog) photoDialog.close();
});

for (const photo of photos) {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'blog-photo-trigger';
    trigger.setAttribute('aria-label', photo.alt ? 'Enlarge photo of ' + photo.alt.toLowerCase() : 'Enlarge photo');
    trigger.setAttribute('aria-haspopup', 'dialog');
    photo.replaceWith(trigger);
    trigger.append(photo);
    trigger.addEventListener('click', () => {
        expandedPhoto.src = photo.currentSrc || photo.src;
        expandedPhoto.alt = photo.alt;
        photoDialog.showModal();
    });
}

if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('blog-in-view');
            observer.unobserve(entry.target);
        }
    }, { threshold: 0.12 });

    document.querySelectorAll('.blog-post-card, .blog-photo-stack').forEach(element => {
        element.classList.add('blog-reveal');
        observer.observe(element);
    });
}
