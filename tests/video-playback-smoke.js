const { _electron: electron } = require('playwright');
const electronExecutable = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VaultService } = require('../src/services/vault-service');

(async () => {
  const sample = process.env.NOCTURNE_VIDEO_SAMPLE;
  const imageSample = process.env.NOCTURNE_IMAGE_SAMPLE;
  if (!sample) throw new Error('Set NOCTURNE_VIDEO_SAMPLE to a video file');
  await fs.access(sample);
  if (imageSample) await fs.access(imageSample);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-video-playback-'));
  const copiedSource = path.join(root, `source${path.extname(sample)}`);
  const copiedImage = imageSample ? path.join(root, `image${path.extname(imageSample)}`) : null;
  const password = 'длинный пароль проверки видео 2026';
  await fs.copyFile(sample, copiedSource);
  if (copiedImage) await fs.copyFile(imageSample, copiedImage);
  const vault = new VaultService(path.join(root, 'vault-data'));
  await vault.create(password);
  const imported = await vault.importMedia([...(copiedImage ? [copiedImage] : []), copiedSource]);
  if (imported.added !== (copiedImage ? 2 : 1)) throw new Error('Media was not imported');
  await fs.rm(copiedSource);
  if (copiedImage) await fs.rm(copiedImage);
  vault.lock({ preserveQuickUnlock: false });

  const packagedExecutable = process.env.NOCTURNE_ELECTRON_EXE;
  const electronApp = await electron.launch({
    executablePath: packagedExecutable || electronExecutable,
    args: packagedExecutable ? [] : ['.'],
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NOCTURNE_TEST_USER_DATA: root },
  });
  try {
    const window = await electronApp.firstWindow();
    await window.waitForSelector('#unlock-form');
    await window.locator('#unlock-form input[name="credential"]').fill(password);
    await window.locator('#unlock-form button[type="submit"]').click();
    await window.waitForSelector('.app-shell');
    await window.locator('[data-page="media"]').click();
    if (imageSample) {
      const imageCard = window.locator('.media-card').filter({ has: window.locator('img') }).first();
      const cardGeometry = await imageCard.locator('img').evaluate((element) => ({ objectFit: getComputedStyle(element).objectFit, position: getComputedStyle(element).position }));
      if (cardGeometry.objectFit !== 'contain' || cardGeometry.position !== 'absolute') throw new Error(`Unsafe thumbnail geometry: ${JSON.stringify(cardGeometry)}`);
      await fs.mkdir(path.resolve(__dirname, '..', 'artifacts'), { recursive: true });
      await window.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'nocturne-media-grid-contain.png') });
      await imageCard.click();
      const image = window.locator('#media-dialog .media-preview__stage > img');
      await image.waitFor({ state: 'visible' });
      const geometry = await image.evaluate((element) => {
        const imageRect = element.getBoundingClientRect();
        const stageRect = element.parentElement.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight, imageWidth: imageRect.width, imageHeight: imageRect.height, stageWidth: stageRect.width, stageHeight: stageRect.height, objectFit: style.objectFit, position: style.position };
      });
      if (geometry.objectFit !== 'contain' || geometry.position !== 'absolute') throw new Error(`Unsafe media geometry: ${JSON.stringify(geometry)}`);
      if (Math.abs(geometry.imageWidth - geometry.stageWidth) > 1 || Math.abs(geometry.imageHeight - geometry.stageHeight) > 1) throw new Error(`Viewer image escaped stage: ${JSON.stringify(geometry)}`);
      await window.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'nocturne-media-contain.png') });
      if (await window.locator('.media-counter').textContent() !== '2 / 2') throw new Error('Media counter is incorrect');
      await window.keyboard.press('ArrowLeft');
    } else {
      await window.locator('[data-open-media]').first().click();
    }
    const video = window.locator('#media-dialog video');
    await video.waitFor({ state: 'visible' });
    const metadata = await video.evaluate((element) => new Promise((resolve, reject) => {
      const done = () => resolve({ duration: element.duration, readyState: element.readyState, error: element.error?.message || null });
      if (element.readyState >= HTMLMediaElement.HAVE_METADATA) return done();
      element.addEventListener('loadedmetadata', done, { once: true });
      element.addEventListener('error', () => reject(new Error(element.error?.message || 'Video playback error')), { once: true });
      setTimeout(() => reject(new Error('Video metadata timeout')), 10_000);
    }));
    if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) throw new Error(`Invalid video duration: ${metadata.duration}`);
    console.log(`Video playback smoke passed: ${metadata.duration.toFixed(2)}s, readyState=${metadata.readyState}`);
  } finally {
    await electronApp.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
