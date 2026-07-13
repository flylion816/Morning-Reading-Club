// 用法: node scripts/apply-tenant.js <slug>
// 切换当前构建租户：生成 current-tenant.js / theme.wxss，外科式改写 app.json / project.config.json
const fs = require('fs');
const path = require('path');
const {
  buildSharedAssetIgnoreEntries,
  isManagedSharedAssetIgnoreEntry
} = require('./tenant-pack-ignore');

const ROOT = path.resolve(__dirname, '..');           // miniprogram/
const REPO = path.resolve(ROOT, '..');                // 仓库根

const slug = process.argv[2];
if (!slug) {
  console.error('用法: node scripts/apply-tenant.js <slug>\n  例: node scripts/apply-tenant.js fanren');
  process.exit(1);
}

// 1) 加载并校验租户配置（失败安全：校验不过直接退出）
const tenantPath = path.join(ROOT, 'config', 'tenants', `${slug}.js`);
if (!fs.existsSync(tenantPath)) {
  console.error(`❌ 租户配置不存在: ${tenantPath}`);
  console.error(`   可用租户: ${fs.readdirSync(path.join(ROOT, 'config', 'tenants')).filter(f => f.endsWith('.js') && !f.startsWith('_')).map(f => f.replace('.js', '')).join(', ')}`);
  process.exit(1);
}

// 清除 require 缓存，保证多次 apply 时读到最新文件
delete require.cache[tenantPath];
const cfg = require(tenantPath);

const { validateTenant } = require(path.join(ROOT, 'config', 'tenants', '_schema.js'));
const errors = validateTenant(cfg);
if (errors.length) {
  console.error(`❌ 租户 [${slug}] 配置校验失败:`);
  errors.forEach(e => console.error(`   - ${e}`));
  process.exit(1);
}

function isManagedIgnoreEntry(item, entries) {
  if (!item || !item.value || !item.type) {
    return false;
  }
  if (entries.some(entry => entry.value === item.value && entry.type === item.type)) {
    return true;
  }
  if (isManagedSharedAssetIgnoreEntry(item)) {
    return true;
  }
  return /^(miniprogram\/)?assets\/tenants\/[^/]+$/.test(item.value) ||
    /^(miniprogram\/)?assets\/tenants\/[^/]+\/share-cover\.jpg$/.test(item.value);
}

function upsertIgnoreEntries(projectConfig, entries) {
  projectConfig.packOptions = projectConfig.packOptions || {};
  const ignore = Array.isArray(projectConfig.packOptions.ignore)
    ? projectConfig.packOptions.ignore
    : [];
  const nextIgnore = ignore.filter(item => !isManagedIgnoreEntry(item, entries));

  entries.forEach(entry => {
    nextIgnore.push(entry);
  });

  projectConfig.packOptions.ignore = nextIgnore;
  projectConfig.packOptions.include = Array.isArray(projectConfig.packOptions.include)
    ? projectConfig.packOptions.include
    : [];
}

function buildIgnoreEntries(prefix = '') {
  const tenantAssetRoot = path.join(ROOT, 'assets', 'tenants');
  const tenantDirs = fs.existsSync(tenantAssetRoot)
    ? fs.readdirSync(tenantAssetRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
    : [];
  const entries = [
    { value: `${prefix}scripts`, type: 'folder' },
    { value: `${prefix}__tests__`, type: 'folder' },
    { value: `${prefix}e2e`, type: 'folder' },
    { value: `${prefix}.omc`, type: 'folder' },
    { value: `${prefix}assets/icons/.omc`, type: 'folder' },
    ...buildSharedAssetIgnoreEntries({ prefix, shareCover: cfg.shareCover })
  ];

  tenantDirs
    .filter(tenantSlug => tenantSlug !== slug)
    .forEach(tenantSlug => {
      entries.push({ value: `${prefix}assets/tenants/${tenantSlug}`, type: 'folder' });
    });

  const currentTenantShareCover = `/assets/tenants/${slug}/share-cover.jpg`;
  if (cfg.shareCover !== currentTenantShareCover) {
    entries.push({ value: `${prefix}assets/tenants/${slug}/share-cover.jpg`, type: 'file' });
  }

  return entries;
}

function clampColorChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex) {
  const normalized = String(hex || '').replace('#', '');
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map(channel => clampColorChannel(channel).toString(16).padStart(2, '0')).join('')}`;
}

function mixColor(hex, targetHex, weight) {
  const source = hexToRgb(hex);
  const target = hexToRgb(targetHex);
  return rgbToHex({
    r: source.r + (target.r - source.r) * weight,
    g: source.g + (target.g - source.g) * weight,
    b: source.b + (target.b - source.b) * weight
  });
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildThemeTokens(primaryColor) {
  return {
    primary: primaryColor,
    primaryDark: mixColor(primaryColor, '#000000', 0.18),
    primaryLight: mixColor(primaryColor, '#ffffff', 0.18),
    primaryTint: mixColor(primaryColor, '#ffffff', 0.9),
    primaryAlpha01: hexToRgba(primaryColor, 0.01),
    primaryAlpha05: hexToRgba(primaryColor, 0.05),
    primaryAlpha08: hexToRgba(primaryColor, 0.08),
    primaryAlpha12: hexToRgba(primaryColor, 0.12),
    primaryAlpha15: hexToRgba(primaryColor, 0.15),
    primaryAlpha16: hexToRgba(primaryColor, 0.16),
    primaryAlpha18: hexToRgba(primaryColor, 0.18),
    primaryAlpha20: hexToRgba(primaryColor, 0.2),
    primaryAlpha22: hexToRgba(primaryColor, 0.22),
    primaryAlpha24: hexToRgba(primaryColor, 0.24),
    primaryAlpha26: hexToRgba(primaryColor, 0.26),
    primaryAlpha28: hexToRgba(primaryColor, 0.28),
    primaryAlpha30: hexToRgba(primaryColor, 0.3),
    primaryAlpha40: hexToRgba(primaryColor, 0.4),
    primaryAlpha55: hexToRgba(primaryColor, 0.55),
    primarySoft: hexToRgba(primaryColor, 0.14),
    primaryShadow: hexToRgba(primaryColor, 0.3),
    onPrimary: '#ffffff'
  };
}

function applyPageNavBarConfig(pages, navBar) {
  pages.forEach(pagePath => {
    const pageJsonPath = path.join(ROOT, `${pagePath}.json`);
    if (!fs.existsSync(pageJsonPath)) return;

    let pageJson;
    try {
      pageJson = JSON.parse(fs.readFileSync(pageJsonPath, 'utf8'));
    } catch (e) {
      console.warn(`⚠️ 解析 ${pagePath}.json 失败，跳过页面导航栏同步: ${e.message}`);
      return;
    }

    if (pageJson.navigationStyle === 'custom') return;
    if (!pageJson.navigationBarBackgroundColor && !pageJson.navigationBarTextStyle) return;

    pageJson.navigationBarBackgroundColor = navBar.bgColor;
    pageJson.navigationBarTextStyle = navBar.textStyle;
    fs.writeFileSync(pageJsonPath, JSON.stringify(pageJson, null, 2) + '\n');
  });
}

function applyWechatSIPlugin(appJson, enabled) {
  appJson.plugins = appJson.plugins || {};
  if (enabled) {
    appJson.plugins.WechatSI = {
      version: '0.3.4',
      provider: 'wx069ba97219f66d99'
    };
  } else {
    delete appJson.plugins.WechatSI;
    if (Object.keys(appJson.plugins).length === 0) {
      delete appJson.plugins;
    }
  }

  const orderedAppJson = {};
  let pluginsInserted = false;
  Object.keys(appJson).forEach(key => {
    if (key === 'plugins') return;
    if (key === 'usingComponents' && appJson.plugins) {
      orderedAppJson.plugins = appJson.plugins;
      pluginsInserted = true;
    }
    orderedAppJson[key] = appJson[key];
  });
  if (appJson.plugins && !pluginsInserted) {
    orderedAppJson.plugins = appJson.plugins;
  }

  Object.keys(appJson).forEach(key => delete appJson[key]);
  Object.assign(appJson, orderedAppJson);
}

// 2) 校验 TabBar 图标素材存在（必须本地文件）
const tabIconFiles = [
  'tab-home.png', 'tab-home-active.png',
  'tab-book.png', 'tab-book-active.png',
  'tab-my.png',   'tab-my-active.png'
];
const iconsDirRel = cfg.tabBar.iconsDir.replace(/^\//, '');
const iconsDir = path.join(ROOT, iconsDirRel);
const missingIcons = tabIconFiles.filter(f => !fs.existsSync(path.join(iconsDir, f)));
if (missingIcons.length) {
  console.error(`❌ 缺少 TabBar 图标素材 (${iconsDir}):`);
  missingIcons.forEach(f => console.error(`   - ${f}`));
  process.exit(1);
}

// 3) 生成 config/current-tenant.js（运行时唯一读取入口）
const currentTenantPath = path.join(ROOT, 'config', 'current-tenant.js');
fs.writeFileSync(
  currentTenantPath,
  `// ⚠️ 由 scripts/apply-tenant.js 自动生成，勿手改。提交前运行 npm run tenant:reset 还原 fanren 默认态\n// 源: config/tenants/${slug}.js\nmodule.exports = ${JSON.stringify(cfg, null, 2)};\n`
);

// 4) 生成 theme.wxss（CSS 变量；wxss 无法 require JS，必须生成文件）
const themePath = path.join(ROOT, 'theme.wxss');
const themeTokens = buildThemeTokens(cfg.primaryColor);
fs.writeFileSync(
  themePath,
  `/* ⚠️ 由 apply-tenant.js 生成，勿手改。租户: ${slug} */\npage {\n  --theme-primary: ${themeTokens.primary};\n  --theme-primary-dark: ${themeTokens.primaryDark};\n  --theme-primary-light: ${themeTokens.primaryLight};\n  --theme-primary-tint: ${themeTokens.primaryTint};\n  --theme-primary-soft: ${themeTokens.primarySoft};\n  --theme-primary-shadow: ${themeTokens.primaryShadow};\n  --theme-primary-alpha-01: ${themeTokens.primaryAlpha01};\n  --theme-primary-alpha-05: ${themeTokens.primaryAlpha05};\n  --theme-primary-alpha-08: ${themeTokens.primaryAlpha08};\n  --theme-primary-alpha-12: ${themeTokens.primaryAlpha12};\n  --theme-primary-alpha-15: ${themeTokens.primaryAlpha15};\n  --theme-primary-alpha-16: ${themeTokens.primaryAlpha16};\n  --theme-primary-alpha-18: ${themeTokens.primaryAlpha18};\n  --theme-primary-alpha-20: ${themeTokens.primaryAlpha20};\n  --theme-primary-alpha-22: ${themeTokens.primaryAlpha22};\n  --theme-primary-alpha-24: ${themeTokens.primaryAlpha24};\n  --theme-primary-alpha-26: ${themeTokens.primaryAlpha26};\n  --theme-primary-alpha-28: ${themeTokens.primaryAlpha28};\n  --theme-primary-alpha-30: ${themeTokens.primaryAlpha30};\n  --theme-primary-alpha-40: ${themeTokens.primaryAlpha40};\n  --theme-primary-alpha-55: ${themeTokens.primaryAlpha55};\n  --theme-on-primary: ${themeTokens.onPrimary};\n}\n`
);

// 5) 外科式改写 app.json（仅改租户字段，完整 pages 列表等内容保留不动）
const appJsonPath = path.join(ROOT, 'app.json');
let appJson;
try {
  appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
} catch (e) {
  console.error(`❌ 解析 app.json 失败: ${e.message}`);
  process.exit(1);
}

appJson.window.navigationBarTitleText = cfg.navBar.title;
appJson.window.navigationBarBackgroundColor = cfg.navBar.bgColor;
appJson.window.navigationBarTextStyle = cfg.navBar.textStyle;

appJson.tabBar.color = cfg.tabBar.color;
appJson.tabBar.selectedColor = cfg.tabBar.selectedColor;
appJson.tabBar.backgroundColor = cfg.tabBar.backgroundColor;

// TabBar list 顺序固定: [首页, 晨读营, 我的]（全租户一致）
const iconDirNorm = iconsDirRel;
const tabMap = [
  ['tab-home', 'tab-home-active'],
  ['tab-book', 'tab-book-active'],
  ['tab-my',   'tab-my-active']
];
appJson.tabBar.list.forEach((item, i) => {
  if (tabMap[i]) {
    item.iconPath = `${iconDirNorm}/${tabMap[i][0]}.png`;
    item.selectedIconPath = `${iconDirNorm}/${tabMap[i][1]}.png`;
  }
});

applyWechatSIPlugin(appJson, cfg.wechatSIPlugin === true);

fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');

// 页面级 JSON 会覆盖 app.json 的导航栏颜色，构建租户时一并同步。
applyPageNavBarConfig(appJson.pages || [], cfg.navBar);
applyPageNavBarConfig(['pages/periods/periods'], cfg.navBar);

// 6) 改写 project.config.json(+private) 的 appid，并维护上传忽略规则
for (const name of ['project.config.json', 'project.private.config.json']) {
  const p = path.join(REPO, name);
  if (!fs.existsSync(p)) continue;
  let j;
  try {
    j = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn(`⚠️ 解析 ${name} 失败，跳过: ${e.message}`);
    continue;
  }
  j.appid = cfg.wxAppId;
  if (name === 'project.config.json') {
    upsertIgnoreEntries(j, [
      ...buildIgnoreEntries(),
      ...buildIgnoreEntries('miniprogram/')
    ]);
  }
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}

const miniProjectConfigPath = path.join(ROOT, 'project.config.json');
if (fs.existsSync(miniProjectConfigPath)) {
  try {
    const miniProjectConfig = JSON.parse(fs.readFileSync(miniProjectConfigPath, 'utf8'));
    upsertIgnoreEntries(miniProjectConfig, buildIgnoreEntries());
    fs.writeFileSync(miniProjectConfigPath, JSON.stringify(miniProjectConfig, null, 2) + '\n');
  } catch (e) {
    console.warn(`⚠️ 解析 miniprogram/project.config.json 失败，跳过: ${e.message}`);
  }
}

// 7) 打印摘要供人工确认
console.log(`\n✅ 已切换到租户「${cfg.brandName}」[${slug}]`);
console.log(`   appId       : ${cfg.wxAppId}`);
console.log(`   cloudEnv    : ${cfg.cloudEnv || '（未启用）'}`);
console.log(`   primaryColor: ${cfg.primaryColor}`);
console.log(`   navBar      : ${cfg.navBar.bgColor} / "${cfg.navBar.title}"`);
console.log(`   ⚠️  上传前请再次确认目标 appId 与微信后台一致\n`);
