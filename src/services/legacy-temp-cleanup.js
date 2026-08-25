const fs = require('node:fs/promises');
const path = require('node:path');

const LEGACY_DIRECTORY = 'Nocturne Share';
const UUID_DIRECTORY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function purgeLegacyTemporaryExports({ tempRoot, secureDeleteFile, logger = console }) {
  const resolvedTemp = path.resolve(tempRoot);
  const shareRoot = path.resolve(resolvedTemp, LEGACY_DIRECTORY);
  if (!isInside(resolvedTemp, shareRoot)) throw new Error('INVALID_LEGACY_TEMP_PATH');

  try {
    const rootStat = await fs.lstat(shareRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      logger.warn?.('[legacy-temp-cleanup] refused non-directory or reparse root');
      return { removed: 0, refused: true };
    }

    let removed = 0;
    const entries = await fs.readdir(shareRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !UUID_DIRECTORY.test(entry.name)) continue;
      const exportDirectory = path.resolve(shareRoot, entry.name);
      if (!isInside(shareRoot, exportDirectory)) continue;
      const directoryStat = await fs.lstat(exportDirectory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) continue;

      for (const child of await fs.readdir(exportDirectory, { withFileTypes: true })) {
        if (!child.isFile() || child.isSymbolicLink()) continue;
        const file = path.resolve(exportDirectory, child.name);
        if (!isInside(exportDirectory, file)) continue;
        const fileStat = await fs.lstat(file);
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue;
        await secureDeleteFile(file);
        removed += 1;
      }
      await fs.rmdir(exportDirectory).catch((error) => { if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') throw error; });
    }
    await fs.rmdir(shareRoot).catch((error) => { if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') throw error; });
    return { removed, refused: false };
  } catch (error) {
    if (error.code === 'ENOENT') return { removed: 0, refused: false };
    logger.warn?.('[legacy-temp-cleanup]', error.message);
    return { removed: 0, refused: true };
  }
}

module.exports = { purgeLegacyTemporaryExports };
