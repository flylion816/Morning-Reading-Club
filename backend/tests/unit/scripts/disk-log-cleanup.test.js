const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getDiskPenalty,
  getDiskUsage,
  getDockerLogTargets,
  runCleanup,
} = require('../../../scripts/disk-log-cleanup');
const {
  calculateHealthScore,
} = require('../../../scripts/daily-log-report');

describe('Disk protection for daily log patrol', () => {
  it('maps disk thresholds without boundary ambiguity', () => {
    assert.strictEqual(getDiskPenalty(90), 0);
    assert.strictEqual(getDiskPenalty(90.1), 20);
    assert.strictEqual(getDiskPenalty(95), 20);
    assert.strictEqual(getDiskPenalty(95.1), 50);
    assert.strictEqual(getDiskPenalty(98.9), 50);
    assert.strictEqual(getDiskPenalty(99), 100);
    assert.strictEqual(getDiskPenalty(100), 100);
    assert.strictEqual(getDiskPenalty(null), 0);
  });

  it('parses POSIX df output independently of human-readable units', () => {
    const disk = getDiskUsage('/', {
      execFileSync: () => 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 100000 91000 9000 91% /\n',
    });
    assert.strictEqual(disk.usedPercent, 91);
    assert.strictEqual(disk.usedBytes, 91000 * 1024);
    assert.strictEqual(disk.availableBytes, 9000 * 1024);
  });

  it('returns an explicit parse failure instead of inventing a score', () => {
    const disk = getDiskUsage('/', {
      execFileSync: () => 'not df output',
    });
    assert.strictEqual(disk.usedPercent, null);
    assert.match(disk.summary, /磁盘检查失败/);
  });

  it('adds disk penalty once to the existing health score', () => {
    assert.strictEqual(calculateHealthScore(0, 0, 0, [], { usedPercent: 90.1 }), 80);
    assert.strictEqual(calculateHealthScore(0, 0, 0, [], { usedPercent: 99 }), 0);
  });

  it('cleans only allowlisted application logs and old rotated logs', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morning-reading-disk-'));
    const current = path.join(tempDir, 'error.log');
    const rotated = path.join(tempDir, 'error__old.log');
    const recentRotated = path.join(tempDir, 'error__recent.log');
    const protectedFile = path.join(tempDir, 'daily-report-latest.json');
    fs.writeFileSync(current, 'current log');
    fs.writeFileSync(rotated, 'old rotated log');
    fs.writeFileSync(recentRotated, 'recent rotated log');
    fs.writeFileSync(protectedFile, 'keep me');
    fs.utimesSync(rotated, new Date(Date.now() - 10 * 24 * 3600 * 1000), new Date(Date.now() - 10 * 24 * 3600 * 1000));

    const result = runCleanup({
      appLogDir: tempDir,
      stateDir: tempDir,
      lockFile: path.join(tempDir, 'cleanup.lock'),
      cooldownFile: path.join(tempDir, 'cleanup.cooldown'),
      diskBefore: { mount: '/', usedPercent: 91, summary: '⚠️ 91%' },
      diskAfter: { mount: '/', usedPercent: 40, summary: '✅ 40%' },
      dryRun: false,
      journalFallback: false,
      execFileSync: () => '',
    });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(fs.statSync(current).size, 0);
    assert.strictEqual(fs.existsSync(rotated), false);
    assert.strictEqual(fs.existsSync(recentRotated), true);
    assert.strictEqual(fs.readFileSync(protectedFile, 'utf8'), 'keep me');
  });

  it('skips repeated cleanup during the cooldown window', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morning-reading-cooldown-'));
    fs.writeFileSync(path.join(tempDir, 'error.log'), 'log');
    const options = {
      appLogDir: tempDir,
      stateDir: tempDir,
      lockFile: path.join(tempDir, 'cleanup.lock'),
      cooldownFile: path.join(tempDir, 'cleanup.cooldown'),
      diskBefore: { mount: '/', usedPercent: 91, summary: '⚠️ 91%' },
      diskAfter: { mount: '/', usedPercent: 91, summary: '⚠️ 91%' },
      journalFallback: false,
      execFileSync: () => '',
    };
    const first = runCleanup(options);
    const second = runCleanup(options);
    assert.strictEqual(first.status, 'completed');
    assert.strictEqual(second.status, 'skipped');
    assert.strictEqual(second.skippedReason, 'cooldown');
  });

  it('does not mutate files in dry-run mode', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morning-reading-dry-run-'));
    const current = path.join(tempDir, 'error.log');
    fs.writeFileSync(current, 'keep in dry run');
    const result = runCleanup({
      appLogDir: tempDir,
      stateDir: tempDir,
      lockFile: path.join(tempDir, 'cleanup.lock'),
      cooldownFile: path.join(tempDir, 'cleanup.cooldown'),
      diskBefore: { mount: '/', usedPercent: 91, summary: '⚠️ 91%' },
      diskAfter: { mount: '/', usedPercent: 91, summary: '⚠️ 91%' },
      diskAfterAfterJournal: { mount: '/', usedPercent: 91, summary: '⚠️ 91%' },
      dryRun: true,
      journalFallback: true,
      execFileSync: () => '',
    });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(fs.readFileSync(current, 'utf8'), 'keep in dry run');
    assert.strictEqual(fs.existsSync(path.join(tempDir, 'cleanup.cooldown')), false);
  });

  it('rejects Docker log paths outside the validated container directory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morning-reading-docker-'));
    const id = 'abcdef1234567890';
    const validDir = path.join(tempDir, id);
    fs.mkdirSync(validDir);
    const validLog = path.join(validDir, `${id}-json.log`);
    fs.writeFileSync(validLog, 'docker log');
    const calls = [];
    const result = getDockerLogTargets({ dockerRoot: tempDir, commandTimeoutMs: 1000 }, {
      execFileSync: (command, args) => {
        calls.push([command, args]);
        if (args[0] === 'ps') return `${id}\n`;
        return JSON.stringify({
          Id: id,
          Name: '/morning-reading-backend',
          LogPath: validLog,
        });
      },
    });
    assert.strictEqual(result.targets.length, 1);
    assert.strictEqual(result.targets[0].logPath, validLog);
    assert.ok(calls.length >= 2);
  });
});
