// This one public manifest drives preview and static export, so neither can expose extra project files by accident.
const site = new URL('../site/', import.meta.url);
const demo = new URL('../prototype/', import.meta.url);
export const siteAssets = new Map();
for (const name of ['index.html', 'styles.css', 'app.js']) {
  siteAssets.set(`/${name}`, new URL(name, site));
}
siteAssets.set('/', new URL('index.html', site));
for (const name of [
  'brand.webp',
  'book.svg',
  'run.svg',
  'music.svg',
  'writing.svg',
  'dumbbell.svg',
  'LICENSE-Phosphor.txt',
]) {
  siteAssets.set(`/assets/${name}`, new URL(`assets/${name}`, site));
}
// Publish the supplied official code verbatim from its source; do not redraw, crop, or recompress its encoded pattern.
siteAssets.set(
  '/assets/miniprogram-code.jpg',
  new URL('../images/gh_32d36c5a6904_258.jpg', import.meta.url),
);
for (const name of [
  'index.html',
  'board.html',
  'styles.css',
  'app.js',
  'appearance.js',
  'confetti-review.js',
  'vendor/tsparticles-confetti-4.6.0.min.js',
  'vendor/LICENSE-tsparticles-confetti.txt',
]) {
  siteAssets.set(`/demo/${name}`, new URL(name, demo));
}
