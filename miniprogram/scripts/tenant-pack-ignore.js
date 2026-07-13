const DEFAULT_SHARE_COVER = '/assets/images/share-default.jpg';
const LEGACY_TAB_ICON_PATHS = [
  'assets/icons/home.png',
  'assets/icons/home-active.png',
  'assets/icons/book.png',
  'assets/icons/book-active.png',
  'assets/icons/my.png',
  'assets/icons/my-active.png'
];
const METADATA_PATHS = [
  '.DS_Store',
  'assets/.DS_Store',
  'assets/images/.DS_Store',
  'assets/tenants/.DS_Store'
];

function buildSharedAssetIgnoreEntries({ prefix = '', shareCover = '' } = {}) {
  const entries = LEGACY_TAB_ICON_PATHS.map(value => ({
    value: `${prefix}${value}`,
    type: 'file'
  }));

  METADATA_PATHS.forEach(value => {
    entries.push({ value: `${prefix}${value}`, type: 'file' });
  });

  if (shareCover && shareCover !== DEFAULT_SHARE_COVER) {
    entries.push({
      value: `${prefix}assets/images/share-default.jpg`,
      type: 'file'
    });
  }

  return entries;
}

function isManagedSharedAssetIgnoreEntry(item) {
  if (!item || item.type !== 'file') return false;

  return /^(miniprogram\/)?assets\/icons\/(home|book|my)(-active)?\.png$/.test(item.value) ||
    /^(miniprogram\/)?assets\/images\/share-default\.jpg$/.test(item.value) ||
    /(^|\/)\.DS_Store$/.test(item.value);
}

module.exports = {
  DEFAULT_SHARE_COVER,
  LEGACY_TAB_ICON_PATHS,
  METADATA_PATHS,
  buildSharedAssetIgnoreEntries,
  isManagedSharedAssetIgnoreEntry
};
