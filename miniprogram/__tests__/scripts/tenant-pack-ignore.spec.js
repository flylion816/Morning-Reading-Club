const {
  buildSharedAssetIgnoreEntries,
  isManagedSharedAssetIgnoreEntry
} = require('../../scripts/tenant-pack-ignore');

describe('tenant package shared asset ignores', () => {
  const legacyTabIcons = [
    'assets/icons/home.png',
    'assets/icons/home-active.png',
    'assets/icons/book.png',
    'assets/icons/book-active.png',
    'assets/icons/my.png',
    'assets/icons/my-active.png'
  ];
  const metadataFiles = [
    '.DS_Store',
    'assets/.DS_Store',
    'assets/images/.DS_Store',
    'assets/tenants/.DS_Store'
  ];

  test('excludes legacy tab icons and duplicate default share image for a branded tenant', () => {
    const entries = buildSharedAssetIgnoreEntries({
      shareCover: '/assets/tenants/fanren/share-cover.jpg'
    });

    expect(entries).toEqual([
      ...legacyTabIcons.map(value => ({ value, type: 'file' })),
      ...metadataFiles.map(value => ({ value, type: 'file' })),
      { value: 'assets/images/share-default.jpg', type: 'file' }
    ]);
  });

  test('keeps the default share image when the current tenant depends on it', () => {
    const entries = buildSharedAssetIgnoreEntries({
      prefix: 'miniprogram/',
      shareCover: '/assets/images/share-default.jpg'
    });

    expect(entries).toEqual(
      [...legacyTabIcons, ...metadataFiles].map(value => ({
        value: `miniprogram/${value}`,
        type: 'file'
      }))
    );
  });

  test('recognizes generated shared asset rules so stale tenant rules can be replaced', () => {
    expect(isManagedSharedAssetIgnoreEntry({
      value: 'assets/images/share-default.jpg',
      type: 'file'
    })).toBe(true);
    expect(isManagedSharedAssetIgnoreEntry({
      value: 'miniprogram/assets/icons/home.png',
      type: 'file'
    })).toBe(true);
    expect(isManagedSharedAssetIgnoreEntry({
      value: 'assets/images/.DS_Store',
      type: 'file'
    })).toBe(true);
    expect(isManagedSharedAssetIgnoreEntry({
      value: 'assets/icons/wechat-pay.svg',
      type: 'file'
    })).toBe(false);
  });
});
