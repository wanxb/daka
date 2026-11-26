// Scale the original 390px artboard without duplicating its layout; only the leading preview accepts interaction.
const previews = document.querySelectorAll('.demo-window');
const resize = new ResizeObserver((entries) => {
  for (const entry of entries) {
    entry.target.style.setProperty('--frame-scale', String(entry.contentRect.width / 390));
  }
});
for (const preview of previews) resize.observe(preview);

// A brief, repeatable cue ties the text link to the live phone without covering or interrupting its controls.
const livePhone = document.querySelector('.phone-main');
const homePreview = document.getElementById('hero-home-demo');
let cueFrame;
let cueTimer;
for (const link of document.querySelectorAll('a[href="#experience"]')) {
  link.addEventListener('click', () => {
    cancelAnimationFrame(cueFrame);
    clearTimeout(cueTimer);
    livePhone.classList.remove('experience-cue');
    // Separate removal and insertion across frames so repeated clicks restart the cue without forced layout reads.
    cueFrame = requestAnimationFrame(() => {
      cueFrame = requestAnimationFrame(() => {
        livePhone.classList.add('experience-cue');
        // Preview the existing basketball confirmation without silently adding a record on a navigation click.
        homePreview.contentWindow?.postMessage(
          { type: 'polaris:preview-basketball-success' },
          location.origin,
        );
        // Timed cleanup also works when reduced motion disables animation events.
        cueTimer = setTimeout(() => livePhone.classList.remove('experience-cue'), 1800);
      });
    });
  });
}
