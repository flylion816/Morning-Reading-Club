/**
 * 受保护的日志清理器。
 *
 * 只处理应用/PM2 日志和明确校验过的 morning-reading-* Docker JSON 日志；
 * 不停止服务、不重启容器、不使用 docker system prune，也不触碰数据库/备份/上传文件。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_APP_LOG_NAMES = [
  'error.log',
  'warn.log',
  'combined.log',
  'exceptions.log',
  'rejections.log',
  'morning-reading-out.log',
  'morning-reading-error.log',
];

const DEFAULTS = {
  mount: '/',
  thresholdPercent: 90,
  emergencyPercent: 99,
  retentionDays: 7,
  cooldownMs: 6 * 60 * 60 * 1000,
  commandTimeoutMs: 8000,
  appLogDir: '/var/www/logs',
  dockerRoot: '/var/lib/docker/containers',
  journalFallback: true,
};

function getDiskUsage(mount = DEFAULTS.mount, deps = {}) {
  const exec = deps.execFileSync || execFileSync;
  try {
    const output = exec('df', ['-P', '-k', mount], {
      encoding: 'utf8',
      timeout: deps.timeoutMs || 3000,
    });
    const rows = String(output).trim().split(/\r?\n/).filter(Boolean);
    const fields = rows[rows.length - 1].trim().split(/\s+/);
    if (fields.length < 6 || !/%$/.test(fields[4])) {
      throw new Error(`无法解析 df 输出: ${rows[rows.length - 1] || '(空)'}`);
    }

    const totalKiB = Number(fields[1]);
    const usedKiB = Number(fields[2]);
    const availableKiB = Number(fields[3]);
    const usedPercent = Number.parseInt(fields[4], 10);
    if (![totalKiB, usedKiB, availableKiB, usedPercent].every(Number.isFinite)) {
      throw new Error(`df 数值无效: ${rows[rows.length - 1]}`);
    }

    return {
      mount,
      usedPercent,
      totalBytes: totalKiB * 1024,
      usedBytes: usedKiB * 1024,
      availableBytes: availableKiB * 1024,
      summary: `${usedPercent >= 90 ? '⚠️' : '✅'} ${usedPercent}%`,
    };
  } catch (error) {
    return {
      mount,
      usedPercent: null,
      totalBytes: null,
      usedBytes: null,
      availableBytes: null,
      summary: `❌ 磁盘检查失败: ${error.message}`,
      error: error.message,
    };
  }
}

function getDiskPenalty(usedPercent) {
  if (!Number.isFinite(usedPercent)) return 0;
  if (usedPercent >= 99) return 100;
  if (usedPercent > 95) return 50;
  if (usedPercent > 90) return 20;
  return 0;
}

function bytesToHuman(bytes) {
  if (!Number.isFinite(bytes)) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function isWithin(parent, target) {
  const parentPath = path.resolve(parent);
  const targetPath = path.resolve(target);
  return targetPath === parentPath || targetPath.startsWith(`${parentPath}${path.sep}`);
}

function chooseStateFile(preferred, fallback) {
  try {
    if (!fs.existsSync(path.dirname(preferred))) return fallback;
    fs.accessSync(path.dirname(preferred), fs.constants.W_OK);
    return preferred;
  } catch (error) {
    return fallback;
  }
}

function acquireLock(lockFile) {
  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    return { fd, lockFile };
  } catch (error) {
    return null;
  }
}

function releaseLock(lock) {
  if (!lock) return;
  try { fs.closeSync(lock.fd); } catch (error) { /* already closed */ }
  try { fs.unlinkSync(lock.lockFile); } catch (error) { /* best effort */ }
}

function isCooldownActive(cooldownFile, cooldownMs, now = Date.now()) {
  try {
    const timestamp = Number(fs.readFileSync(cooldownFile, 'utf8').trim());
    return Number.isFinite(timestamp) && now - timestamp < cooldownMs;
  } catch (error) {
    return false;
  }
}

function markCooldown(cooldownFile, now = Date.now()) {
  fs.mkdirSync(path.dirname(cooldownFile), { recursive: true });
  fs.writeFileSync(cooldownFile, String(now));
}

function actionResult(target, action, beforeBytes, afterBytes, result, error = '') {
  return {
    target,
    action,
    beforeBytes: Number.isFinite(beforeBytes) ? beforeBytes : 0,
    reclaimedBytes: Number.isFinite(beforeBytes) && Number.isFinite(afterBytes)
      ? Math.max(0, beforeBytes - afterBytes)
      : 0,
    afterBytes: Number.isFinite(afterBytes) ? afterBytes : null,
    result,
    error: error || null,
  };
}

function truncateFile(filePath, dryRun) {
  const beforeBytes = fs.statSync(filePath).size;
  if (dryRun) return actionResult(filePath, 'truncate', beforeBytes, 0, 'dry-run');
  fs.truncateSync(filePath, 0);
  return actionResult(filePath, 'truncate', beforeBytes, fs.statSync(filePath).size, 'ok');
}

function removeFile(filePath, dryRun) {
  const beforeBytes = fs.statSync(filePath).size;
  if (dryRun) return actionResult(filePath, 'delete-rotated', beforeBytes, 0, 'dry-run');
  fs.unlinkSync(filePath);
  return actionResult(filePath, 'delete-rotated', beforeBytes, 0, 'ok');
}

function cleanApplicationLogs(options, actions) {
  const logDir = path.resolve(options.appLogDir);
  const names = options.appLogNames || DEFAULT_APP_LOG_NAMES;
  const cutoff = Date.now() - options.retentionDays * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(logDir)) return;

  for (const name of names) {
    const current = path.join(logDir, name);
    if (isWithin(logDir, current) && fs.existsSync(current) && fs.lstatSync(current).isFile()) {
      try {
        actions.push(truncateFile(current, options.dryRun));
      } catch (error) {
        actions.push(actionResult(current, 'truncate', 0, null, 'failed', error.message));
      }
    }

    const base = path.basename(name, '.log');
    let files = [];
    try {
      files = fs.readdirSync(logDir)
        .filter(file => file.startsWith(`${base}__`) && file.endsWith('.log'))
        .map(file => path.join(logDir, file));
    } catch (error) {
      actions.push(actionResult(logDir, 'list-rotated', 0, null, 'failed', error.message));
      continue;
    }

    for (const rotated of files) {
      try {
        const stat = fs.lstatSync(rotated);
        if (stat.isFile() && stat.mtimeMs < cutoff && isWithin(logDir, rotated)) {
          actions.push(removeFile(rotated, options.dryRun));
        }
      } catch (error) {
        actions.push(actionResult(rotated, 'delete-rotated', 0, null, 'failed', error.message));
      }
    }
  }
}

function getDockerLogTargets(options, deps = {}) {
  const exec = deps.execFileSync || execFileSync;
  const dockerRoot = path.resolve(options.dockerRoot);
  const targets = [];
  let ids;
  try {
    const output = exec('docker', ['ps', '-aq', '--filter', 'name=morning-reading-'], {
      encoding: 'utf8', timeout: options.commandTimeoutMs,
    });
    ids = String(output).trim().split(/\r?\n/).filter(Boolean);
  } catch (error) {
    return { targets, error: error.message };
  }

  for (const id of ids) {
    if (!/^[a-f0-9]{12,64}$/i.test(id)) continue;
    try {
      const raw = exec('docker', ['inspect', '--format={{json .}}', id], {
        encoding: 'utf8', timeout: options.commandTimeoutMs,
      }).trim();
      const inspected = JSON.parse(raw);
      const name = inspected.Name || '';
      const fullId = inspected.Id || id;
      const logPath = inspected.LogPath || '';
      const expectedDir = path.join(dockerRoot, fullId);
      const expectedFile = path.join(expectedDir, `${fullId}-json.log`);
      if (!/^\/morning-reading-[^/]+$/.test(name)) continue;
      if (path.resolve(logPath) !== path.resolve(expectedFile)) continue;
      if (!isWithin(dockerRoot, logPath)) continue;
      if (!fs.existsSync(logPath) || !fs.lstatSync(logPath).isFile()) continue;
      targets.push({ name: name.slice(1), id: fullId, logPath });
    } catch (error) {
      // 单个容器异常不阻塞其他日志和日报。
    }
  }
  return { targets, error: null };
}

function cleanDockerLogs(options, actions, deps = {}) {
  const result = getDockerLogTargets(options, deps);
  if (result.error) {
    actions.push(actionResult('docker:morning-reading-*', 'inspect', 0, null, 'failed', result.error));
    return;
  }
  for (const target of result.targets) {
    try {
      const action = truncateFile(target.logPath, options.dryRun);
      actions.push({ ...action, target: `${target.name}:${target.logPath}` });
    } catch (error) {
      actions.push(actionResult(`${target.name}:${target.logPath}`, 'truncate', 0, null, 'failed', error.message));
    }
  }
}

function vacuumJournal(options, actions, deps = {}) {
  const exec = deps.execFileSync || execFileSync;
  try {
    if (options.dryRun) {
      actions.push(actionResult('systemd-journal', 'vacuum-size-100M', 0, 0, 'dry-run'));
      return;
    }
    const output = exec('journalctl', ['--vacuum-size=100M'], {
      encoding: 'utf8', timeout: options.commandTimeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    actions.push(actionResult('systemd-journal', 'vacuum-size-100M', 0, 0, 'ok', String(output).trim()));
  } catch (error) {
    actions.push(actionResult('systemd-journal', 'vacuum-size-100M', 0, null, 'failed', error.message));
  }
}

function runCleanup(input = {}) {
  const options = { ...DEFAULTS, ...input };
  const diskBefore = input.diskBefore || getDiskUsage(options.mount, input);
  const base = {
    triggered: false,
    status: 'skipped',
    skippedReason: null,
    dryRun: Boolean(options.dryRun),
    before: diskBefore,
    after: diskBefore,
    actions: [],
    reclaimedBytes: 0,
  };

  if (!Number.isFinite(diskBefore.usedPercent)) {
    return { ...base, status: 'failed', skippedReason: 'disk-check-failed' };
  }
  if (diskBefore.usedPercent < options.thresholdPercent) {
    return { ...base, skippedReason: 'below-threshold' };
  }

  const stateDir = options.stateDir || options.appLogDir;
  const lockFile = options.lockFile || chooseStateFile(
    path.join(stateDir, '.daily-log-cleanup.lock'),
    '/tmp/morning-reading-daily-log-cleanup.lock'
  );
  const cooldownFile = options.cooldownFile || chooseStateFile(
    path.join(stateDir, '.daily-log-cleanup.cooldown'),
    '/tmp/morning-reading-daily-log-cleanup.cooldown'
  );
  const lock = acquireLock(lockFile);
  if (!lock) return { ...base, status: 'failed', skippedReason: 'lock-unavailable' };

  try {
    const emergency = diskBefore.usedPercent >= options.emergencyPercent;
    if (!options.dryRun && !emergency && isCooldownActive(cooldownFile, options.cooldownMs)) {
      return { ...base, skippedReason: 'cooldown' };
    }

    const actions = [];
    cleanApplicationLogs(options, actions);
    cleanDockerLogs(options, actions, input);
    let diskAfter = input.diskAfter || getDiskUsage(options.mount, input);

    if (Number.isFinite(diskAfter.usedPercent) && diskAfter.usedPercent >= options.thresholdPercent && options.journalFallback) {
      vacuumJournal(options, actions, input);
      diskAfter = input.diskAfterAfterJournal || getDiskUsage(options.mount, input);
    }

    let cooldownError = null;
    if (!options.dryRun) {
      try {
        markCooldown(cooldownFile);
      } catch (error) {
        cooldownError = error.message;
        actions.push(actionResult(cooldownFile, 'write-cooldown', 0, null, 'failed', error.message));
      }
    }
    const reclaimedBytes = actions.reduce((sum, action) => sum + action.reclaimedBytes, 0);
    const failed = actions.some(action => action.result === 'failed');
    return {
      ...base,
      triggered: true,
      status: failed ? 'partial-failure' : 'completed',
      before: diskBefore,
      after: diskAfter,
      actions,
      reclaimedBytes,
      skippedReason: cooldownError ? 'cooldown-write-failed' : null,
    };
  } finally {
    releaseLock(lock);
  }
}

module.exports = {
  DEFAULTS,
  DEFAULT_APP_LOG_NAMES,
  bytesToHuman,
  getDiskPenalty,
  getDiskUsage,
  getDockerLogTargets,
  isCooldownActive,
  runCleanup,
};
