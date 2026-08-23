#!/usr/bin/env node
/**
 * 晨读营 - 每日服务器日志巡检报告
 *
 * 功能：读取过去24小时日志 → 分析错误/告警 → 生成HTML邮件 → 发送到指定邮箱
 *
 * 使用方式：
 *   node daily-log-report.js                    # 正常运行
 *   node daily-log-report.js --test             # 测试模式（不发邮件，输出到控制台）
 *   node daily-log-report.js --no-email         # 写正式报告但不发送邮件
 *   node daily-log-report.js --hours 48         # 分析过去48小时
 *   node daily-log-report.js --dry-run          # 达到阈值时只演练清理，不修改日志
 *
 * Cron配置（每天17:00北京时间）：
 *   0 17 * * * /usr/bin/node /var/www/morning-reading/backend/scripts/daily-log-report.js >> /var/www/logs/daily-report.log 2>&1
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { isTrackedApiPath } = require('../src/utils/monitoring-rules');
const {
  bytesToHuman,
  getDiskPenalty,
  getDiskUsage,
  runCleanup,
} = require('./disk-log-cleanup');

// ============================================================
// 配置
// ============================================================

const CONFIG = {
  logDir: '/var/www/logs',
  reportFiles: {
    latestHtml: 'daily-report-latest.html',
    latestJson: 'daily-report-latest.json',
  },

  // 要分析的日志文件
  logFiles: {
    error:       'error.log',        // Winston 错误日志
    warn:        'warn.log',         // Winston 警告日志
    combined:    'combined.log',     // Winston 综合日志
    exceptions:  'exceptions.log',   // 未捕获异常
    rejections:  'rejections.log',   // 未处理的 Promise rejection
    pm2Out:      'morning-reading-out.log',    // PM2 stdout
    pm2Error:    'morning-reading-error.log',  // PM2 stderr
  },

  // 邮件配置
  smtp: {
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: {
      user: '308965039@qq.com',
      pass: process.env.QQ_SMTP_PASS || '',  // QQ邮箱授权码
    }
  },
  mailTo: '308965039@qq.com',
  mailFrom: '"晨读营服务器" <308965039@qq.com>',

  diskCleanup: {
    thresholdPercent: 90,
    emergencyPercent: 99,
    retentionDays: 7,
    cooldownMs: 6 * 60 * 60 * 1000,
    journalFallback: true,
  },
};

// ============================================================
// 参数解析
// ============================================================

const args = process.argv.slice(2);
const isTestMode = args.includes('--test');
const noEmail = args.includes('--no-email');
const isDryRun = args.includes('--dry-run') || process.env.DAILY_LOG_CLEANUP_DRY_RUN === '1';
const hoursIdx = args.indexOf('--hours');
function parseHoursBack(value) {
  if (value === undefined) return 24;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`无效的 --hours 参数: ${value}`);
  }
  return parsed;
}
const hoursBack = parseHoursBack(hoursIdx !== -1 ? args[hoursIdx + 1] : undefined);
const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

// ============================================================
// 日志读取与解析
// ============================================================

function readLogFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').filter(line => line.trim());
  } catch (err) {
    console.error(`读取文件失败 ${filePath}: ${err.message}`);
    return [];
  }
}

/**
 * 读取日志文件（包括 PM2 logrotate 产生的轮转文件）
 * PM2 logrotate 每天 00:00 轮转，文件名格式: name__YYYY-MM-DD_HH-mm-ss.log
 * 对于 17:00-17:00 的窗口，需要读取当前文件 + 轮转文件
 */
function readLogFileWithRotation(filePath) {
  const lines = readLogFile(filePath);

  // 查找同目录下的轮转文件
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, '.log'); // e.g. "morning-reading-out"

  try {
    const files = fs.readdirSync(dir);
    // 匹配轮转文件: morning-reading-out__2026-03-25_00-00-00.log
    const rotatedFiles = files
      .filter(f => f.startsWith(baseName + '__') && f.endsWith('.log'))
      .sort()
      .reverse(); // 最新的在前

    // 只读最近 2 个轮转文件（覆盖 24-48 小时）
    for (const rf of rotatedFiles.slice(0, 2)) {
      const rotatedLines = readLogFile(path.join(dir, rf));
      lines.unshift(...rotatedLines); // 旧的放前面
    }
  } catch (err) {
    // 目录读取失败，只用当前文件
  }

  return lines;
}

/**
 * 解析 Winston JSON 格式日志行
 * 格式: {"timestamp":"2026-03-21 10:30:45 +08:00","level":"error","message":"..."}
 */
function parseWinstonLine(line) {
  // 尝试 JSON 解析
  try {
    const obj = JSON.parse(line);
    if (obj.timestamp) {
      return {
        time: new Date(obj.timestamp),
        level: obj.level || 'info',
        message: obj.message || '',
        raw: line,
        meta: obj,
      };
    }
  } catch (e) { /* 非JSON格式 */ }

  // 跳过 error.log 的 Context 和 Stack 附属行（不是独立错误）
  if (/^(Context:|Stack:|    at )/.test(line)) {
    return { time: null, level: '_skip', message: line, raw: line };
  }

  // 尝试文本格式: [2026-03-21 10:30:45 +08:00] ERROR: message
  const textMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[^\]]*)\]\s*(\w+):\s*(.*)/);
  if (textMatch) {
    return {
      time: new Date(textMatch[1]),
      level: textMatch[2].toLowerCase(),
      message: textMatch[3],
      raw: line,
    };
  }

  // 尝试简单时间戳格式: 2026-03-21T10:30:45.000Z ...
  const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*)\s+(.*)/);
  if (isoMatch) {
    return {
      time: new Date(isoMatch[1]),
      level: 'info',
      message: isoMatch[2],
      raw: line,
    };
  }

  // 无法识别的行，标记为 skip（不计入统计）
  return { time: null, level: '_skip', message: line, raw: line };
}

/**
 * 解析 PM2 日志行
 * 格式: 0|morning- | [内容] 或带时间戳的行
 */
function parsePM2Line(line) {
  // PM2 cluster 前缀: "0|morning- | ..."
  const pm2Match = line.match(/^\d+\|[^|]+\|\s*(.*)/);
  const content = pm2Match ? pm2Match[1] : line;

  // 尝试从内容中提取时间
  const timeMatch = content.match(/(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2})/);
  const time = timeMatch ? new Date(timeMatch[1]) : null;

  const isError = /error|Error|ERR|ECONNREFUSED|ENOENT|TypeError|ReferenceError|SyntaxError/i.test(content);

  return {
    time,
    level: isError ? 'error' : 'info',
    message: content.substring(0, 500),
    raw: line,
  };
}

/**
 * 过滤指定时间范围内的日志
 */
function filterByTime(entries, since) {
  return entries.filter(e => {
    if (e.level === '_skip') return false; // 跳过 Context/Stack 等附属行
    if (!e.time) return false; // 无法判断时间的丢弃（避免历史堆积）
    return e.time >= since;
  });
}

// ============================================================
// 日志分析
// ============================================================

function analyzeEntries(entries) {
  const grouped = {};

  for (const entry of entries) {
    // 提取错误关键特征作为分组key
    const key = normalizeErrorMessage(entry.message);
    if (!grouped[key]) {
      grouped[key] = {
        message: entry.message.substring(0, 200),
        count: 0,
        lastTime: null,
        samples: [],
      };
    }
    grouped[key].count++;
    if (entry.time && (!grouped[key].lastTime || entry.time > grouped[key].lastTime)) {
      grouped[key].lastTime = entry.time;
    }
    if (grouped[key].samples.length < 3) {
      grouped[key].samples.push(entry.raw.substring(0, 500));
    }
  }

  return Object.values(grouped).sort((a, b) => b.count - a.count);
}

/**
 * 将错误消息归一化为分组key
 */
function normalizeErrorMessage(msg) {
  if (!msg) return 'unknown';
  return msg
    .replace(/ObjectId\(['"]\w+['"]\)/g, 'ObjectId(ID)')
    .replace(/\/api\/v1\/\S+/g, '/api/v1/...')
    .replace(/\b[0-9a-f]{24}\b/g, '<ID>')
    .replace(/\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}[^\s]*/g, '<TIME>')
    .replace(/:\d+/g, ':<PORT>')
    .replace(/\s+/g, ' ')
    .substring(0, 150);
}

/**
 * 为错误提供分析建议
 */
function suggestFix(message) {
  const suggestions = [
    [/CastError.*ObjectId/i, '前端传了无效的 ID 参数（可能是 undefined），建议在前端添加参数校验'],
    [/ECONNREFUSED/i, '数据库或Redis连接被拒绝，检查 Docker 容器是否正常运行'],
    [/ENOMEM|heap|memory/i, '内存不足，检查是否有内存泄漏，考虑增加 max-old-space-size'],
    [/ENOSPC/i, '磁盘空间不足，清理日志或扩展磁盘'],
    [/MongoServerError.*duplicate/i, '数据库唯一索引冲突，检查是否有重复数据插入'],
    [/MongoServerError.*timeout/i, 'MongoDB 查询超时，检查是否有慢查询或索引缺失'],
    [/TokenExpiredError/i, 'JWT Token 过期，属于正常现象（用户需要重新登录）'],
    [/JsonWebTokenError/i, 'JWT Token 无效，可能是伪造的请求或 Token 被篡改'],
    [/CORS/i, 'CORS 配置问题，检查请求来源是否在白名单中'],
    [/ER_DUP_ENTRY/i, 'MySQL 唯一键冲突，检查同步逻辑是否正确处理了 upsert'],
    [/ER_NO_SUCH_TABLE/i, 'MySQL 表不存在，需要运行初始化脚本创建表结构'],
    [/Cannot read propert/i, '空值引用错误，某个对象为 null/undefined 时访问了属性'],
    [/status.*undefined|undefined.*status/i, '前端传了 undefined 参数，建议在请求前过滤空值'],
    [/SIGTERM|SIGINT/i, '进程收到终止信号，可能是 PM2 重启或手动停止'],
    [/unhandledRejection/i, '未处理的 Promise 异常，建议添加 try-catch'],
  ];

  for (const [pattern, suggestion] of suggestions) {
    if (pattern.test(message)) return suggestion;
  }
  return '需要查看完整堆栈信息进一步分析';
}

/**
 * 统计 HTTP 请求（从 PM2 out.log）
 *
 * 实际日志格式（Nginx 代理后的 Morgan combined）:
 *   2026-03-26 07:14:09 +08:00: ::ffff:127.0.0.1 - - [25/Mar/2026:23:14:09 +0000] "GET /api/v1/periods HTTP/1.0" 200 - "referer" "ua"
 *
 * 也兼容 Morgan dev 格式:
 *   GET /api/v1/periods 200 19.780 ms
 */
function analyzeHttpRequests(pm2OutLines, since) {
  let total = 0;
  let status4xx = 0;
  let status5xx = 0;
  const endpoints = {};

  // 去除 ANSI 颜色码
  const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m|\[[\d;]*m/g, '');

  for (const line of pm2OutLines) {
    const clean = stripAnsi(line);

    // 匹配时间戳（行首 "2026-03-26 07:14:09"）
    const timeMatch = clean.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
    if (timeMatch) {
      const logTime = new Date(timeMatch[1]);
      if (logTime < since) continue;
    } else {
      continue; // 无时间戳的行跳过
    }

    let method, urlPath, status;

    // 格式1: Combined 格式 - "GET /api/v1/periods HTTP/1.0" 200
    const combinedMatch = clean.match(/"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s+HTTP\/[\d.]+"\s+(\d{3})/);
    if (combinedMatch) {
      method = combinedMatch[1];
      urlPath = combinedMatch[2];
      status = parseInt(combinedMatch[3]);
    } else {
      // 格式2: Morgan dev 格式 - GET /api/v1/periods 200 19.780 ms
      const devMatch = clean.match(/(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s+(\d{3})\s+[\d.]+\s*ms/);
      if (devMatch) {
        method = devMatch[1];
        urlPath = devMatch[2];
        status = parseInt(devMatch[3]);
      }
    }

    if (method) {
      // 只统计真实业务 API，排除 /api/sonicos、/api/vendor 等扫描流量
      if (!isTrackedApiPath(urlPath)) continue;

      total++;
      if (status >= 400 && status < 500) status4xx++;
      if (status >= 500) status5xx++;
      if (status >= 400) {
        const url = urlPath.replace(/[0-9a-f]{24}/g, '<ID>').replace(/\?.*/, '?...');
        const key = `${method} ${url.substring(0, 60)} → ${status}`;
        endpoints[key] = (endpoints[key] || 0) + 1;
      }
    }
  }

  return { total, status4xx, status5xx, topErrors: Object.entries(endpoints).sort((a, b) => b[1] - a[1]).slice(0, 10) };
}

// ============================================================
// PM2 状态获取
// ============================================================

function getPM2Status() {
  try {
    // 服务器上 pm2 通过 npx 访问，尝试多种路径
    let output;
    const pm2Commands = ['pm2 jlist', 'npx pm2 jlist', '/home/ubuntu/.npm/_npx/5f7878ce38f1eb13/node_modules/pm2/bin/pm2 jlist'];
    for (const cmd of pm2Commands) {
      try {
        output = execSync(`${cmd} 2>/dev/null`, { encoding: 'utf-8', timeout: 15000 });
        if (output && output.trim().startsWith('[')) break;
      } catch (e) { continue; }
    }
    if (!output) throw new Error('pm2 not found');
    const list = JSON.parse(output);
    const app = list.filter(p => p.name === 'morning-reading-backend');

    if (app.length === 0) {
      return {
        online: 0,
        total: 0,
        memory: 0,
        uptime: ''
      };
    }

    let totalMemory = 0;
    let online = 0;

    for (const inst of app) {
      if (inst.pm2_env && inst.pm2_env.status === 'online') online++;
      totalMemory += (inst.monit && inst.monit.memory) || 0;
    }

    const uptime = app[0].pm2_env ? formatUptime(Date.now() - app[0].pm2_env.pm_uptime) : 'unknown';

    return {
      online,
      total: app.length,
      memory: Math.round(totalMemory / 1024 / 1024),
      uptime,
    };
  } catch (err) {
    return {
      online: -1,
      total: -1,
      memory: -1,
      uptime: 'PM2 unavailable'
    };
  }
}

function formatUptime(ms) {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}天${hours}小时`;
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}小时${mins}分钟`;
}

function getSystemdServiceStatus(serviceName) {
  try {
    const active = execSync(`systemctl is-active ${serviceName}`, { encoding: 'utf-8', timeout: 3000 }).trim();
    const enabled = execSync(`systemctl is-enabled ${serviceName}`, { encoding: 'utf-8', timeout: 3000 }).trim();
    return {
      service: serviceName,
      active,
      enabled,
      ok: active === 'active' && enabled === 'enabled',
      summary: `${active === 'active' && enabled === 'enabled' ? '✅' : '❌'} ${serviceName}: ${active}/${enabled}`,
    };
  } catch (e) {
    const active = safeExec(`systemctl is-active ${serviceName}`);
    const enabled = safeExec(`systemctl is-enabled ${serviceName}`);
    const state = active || enabled ? `${active || 'unknown'}/${enabled || 'unknown'}` : 'unavailable';
    return {
      service: serviceName,
      active: active || 'unknown',
      enabled: enabled || 'unknown',
      ok: false,
      summary: `❌ ${serviceName}: ${state}`,
    };
  }
}

function safeExec(command, timeout = 3000) {
  try {
    return execSync(command, { encoding: 'utf-8', timeout }).trim();
  } catch (e) {
    return '';
  }
}

function getResolvConfStatus() {
  const target = safeExec('readlink -f /etc/resolv.conf');
  if (!target) {
    return {
      ok: false,
      target: '',
      summary: '❌ /etc/resolv.conf 不存在或无法解析目标',
    };
  }

  if (!fs.existsSync(target)) {
    return {
      ok: false,
      target,
      summary: `❌ /etc/resolv.conf 指向无效目标 (${target})`,
    };
  }

  return {
    ok: true,
    target,
    summary: `✅ /etc/resolv.conf -> ${target}`,
  };
}

function getDnsProbeStatus(hostname) {
  const output = safeExec(`getent hosts ${hostname} | head -n 1`, 5000);
  if (!output) {
    return {
      ok: false,
      host: hostname,
      result: '',
      summary: `❌ DNS 探测失败 (${hostname})`,
    };
  }

  const resolvedTarget = output.split(/\s+/).slice(0, 2).join(' ');
  return {
    ok: true,
    host: hostname,
    result: output,
    summary: `✅ ${hostname} -> ${resolvedTarget}`,
  };
}

function collectInfrastructureAlerts(systemStatus) {
  const alerts = [];
  const dnsReasons = [];

  if (!Number.isFinite(systemStatus.disk?.usedPercent)) {
    alerts.push({
      id: 'disk-check-failed',
      message: systemStatus.disk?.summary || '根分区磁盘检查失败',
      count: 1,
      severity: 'medium',
      category: 'actionable',
      summary: '磁盘检查失败',
      likelyCause: systemStatus.disk?.error || '无法读取 df -P -k / 的结果。',
      recommendedAction: '检查巡检用户的 df 权限和系统命令是否可用。',
      autoRepairEligible: false,
      samples: [systemStatus.disk?.summary || '磁盘检查失败'],
    });
  }

  if (!systemStatus.pm2Autostart?.ok) {
    alerts.push({
      id: 'pm2-autostart-unhealthy',
      message: systemStatus.pm2Autostart?.summary || 'PM2 开机自启状态未知',
      count: 1,
      severity: 'high',
      category: 'actionable',
      summary: 'PM2 开机自启异常',
      likelyCause: 'PM2 的 systemd 服务未处于 active/enabled，重启后应用可能无法自动恢复。',
      recommendedAction: '检查 pm2-<user>.service 是否存在且为 active/enabled，并重新执行 pm2 save 与 pm2 startup。',
      autoRepairEligible: false,
      samples: [systemStatus.pm2Autostart?.summary || 'PM2 开机自启状态未知'],
    });
  }

  if (!systemStatus.dnsResolver?.ok) dnsReasons.push(systemStatus.dnsResolver?.summary || 'systemd-resolved 状态未知');
  if (!systemStatus.resolvConf?.ok) dnsReasons.push(systemStatus.resolvConf?.summary || '/etc/resolv.conf 状态未知');
  if (!systemStatus.dnsProbe?.ok) dnsReasons.push(systemStatus.dnsProbe?.summary || 'DNS 探测失败');

  if (dnsReasons.length > 0) {
    alerts.push({
      id: 'dns-bootstrap-chain-unhealthy',
      message: `DNS 启动链异常: ${dnsReasons.join('；')}`,
      count: 1,
      severity: 'high',
      category: 'actionable',
      summary: 'DNS 启动链异常',
      likelyCause: dnsReasons.join('；'),
      recommendedAction: '确认 systemd-resolved 为 active/enabled，/etc/resolv.conf 指向有效 resolver 文件，并执行 getent hosts 验证域名解析。',
      autoRepairEligible: false,
      samples: dnsReasons,
    });
  }

  return alerts;
}

// ============================================================
// 系统状态
// ============================================================

function getSystemStatus() {
  const status = {};

  // 磁盘使用：使用 POSIX 格式，避免 df -h 的本地化输出无法解析
  status.disk = getDiskUsage('/');

  // 系统负载
  try {
    const load = execSync("cat /proc/loadavg | awk '{print $1, $2, $3}'", { encoding: 'utf-8', timeout: 3000 });
    status.load = load.trim();
  } catch (e) {
    status.load = 'N/A';
  }

  // 最近的 MongoDB 备份
  try {
    const backup = execSync(
      "ls -td /var/backups/mongodb/mongodb-backup-* 2>/dev/null | head -1 | xargs -I{} stat -c '%Y' {} 2>/dev/null",
      { encoding: 'utf-8', timeout: 3000 }
    );
    if (backup.trim()) {
      const backupTime = new Date(parseInt(backup.trim()) * 1000);
      const hoursAgo = Math.round((Date.now() - backupTime.getTime()) / 3600000);
      status.lastBackup = hoursAgo <= 24
        ? `✅ ${hoursAgo}小时前 (${formatTime(backupTime)})`
        : `⚠️ ${hoursAgo}小时前 (${formatTime(backupTime)})`;
    } else {
      status.lastBackup = '❌ 未找到备份文件';
    }
  } catch (e) {
    status.lastBackup = 'N/A';
  }

  // MySQL 同步状态（通过 MongoDB→MySQL 实时同步）
  try {
    const mysqlCheck = execSync(
      `cd /var/www/morning-reading && node -e "
        const mysql = require('./backend/node_modules/mysql2/promise');
        (async () => {
          const conn = await mysql.createConnection({ host:'localhost', port:3306, user:'root', password:'Prod_Root@Secure123!', database:'morning_reading' });
          const [recent] = await conn.query('SELECT MAX(updated_at) as last_sync FROM users');
          console.log(JSON.stringify({ lastSync: recent[0].last_sync }));
          await conn.end();
        })().catch(e => console.log(JSON.stringify({ error: e.message })));
      "`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const mysqlData = JSON.parse(mysqlCheck.trim());
    if (mysqlData.error) {
      status.mysqlSync = `❌ ${mysqlData.error}`;
    } else {
      const syncTime = mysqlData.lastSync ? new Date(mysqlData.lastSync) : null;
      const hoursAgo = syncTime ? Math.round((Date.now() - syncTime.getTime()) / 3600000) : -1;
      status.mysqlSync = hoursAgo <= 24
        ? `✅ 最近同步 ${hoursAgo}小时前`
        : hoursAgo > 24
          ? `⚠️ 最近同步 ${hoursAgo}小时前`
          : '⚠️ 无同步时间';
    }
  } catch (e) {
    status.mysqlSync = 'N/A';
  }

  // Docker 容器状态
  try {
    const docker = execSync(
      "docker ps --format '{{.Names}}:{{.Status}}' | grep morning-reading 2>/dev/null",
      { encoding: 'utf-8', timeout: 5000 }
    );
    status.docker = docker.trim().split('\n').map(line => {
      const [name, st] = line.split(':');
      const shortName = name.replace('morning-reading-', '').replace('-prod', '');
      const isUp = /Up/i.test(st);
      return `${isUp ? '✅' : '❌'} ${shortName}: ${st}`;
    });
  } catch (e) {
    status.docker = ['N/A'];
  }

  // PM2 开机自启状态
  status.pm2Autostart = getSystemdServiceStatus(`pm2-${process.env.USER || 'ubuntu'}`);

  // DNS 解析链状态
  status.dnsResolver = getSystemdServiceStatus('systemd-resolved');
  status.resolvConf = getResolvConfStatus();
  status.dnsProbe = getDnsProbeStatus('wx.shubai01.com');

  return status;
}

// ============================================================
// HTML 邮件生成
// ============================================================

function formatTime(date) {
  if (!date) return '-';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDate(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function generateHTML(report) {
  const { errorGroups, warnGroups, exceptionGroups, httpStats, pm2Status, systemStatus, timeRange, infrastructureAlerts } = report;

  const totalErrors = errorGroups.reduce((s, g) => s + g.count, 0);
  const totalWarns = warnGroups.reduce((s, g) => s + g.count, 0);
  const totalExceptions = exceptionGroups.reduce((s, g) => s + g.count, 0);

  const healthScore = calculateHealthScore(totalErrors, totalExceptions, httpStats.status5xx, infrastructureAlerts, systemStatus.disk);
  const diskPenalty = getDiskPenalty(systemStatus.disk?.usedPercent);
  const diskCleanup = report.diskCleanup || { status: 'pending', actions: [], reclaimedBytes: 0 };

  const healthColor = healthScore >= 80 ? '#27ae60' : healthScore >= 50 ? '#f39c12' : '#e74c3c';
  const healthEmoji = healthScore >= 80 ? '✅' : healthScore >= 50 ? '⚠️' : '🔴';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; background: #f5f5f5; color: #333;">

<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px 25px; border-radius: 12px 12px 0 0;">
  <h1 style="margin: 0; font-size: 20px;">📊 晨读营服务器日志巡检报告</h1>
  <p style="margin: 8px 0 0; opacity: 0.9; font-size: 13px;">
    时间范围: ${formatDate(timeRange.from)} ~ ${formatDate(timeRange.to)}
  </p>
</div>

<div style="background: white; padding: 20px 25px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

<!-- 健康评分 -->
<div style="text-align: center; margin: 15px 0 25px;">
  <span style="font-size: 48px; font-weight: bold; color: ${healthColor};">${healthEmoji} ${healthScore}</span>
  <p style="color: #888; font-size: 13px; margin: 4px 0;">健康评分（满分100）</p>
</div>

<!-- 概览卡片 -->
<div style="display: flex; gap: 10px; margin-bottom: 25px; flex-wrap: wrap;">
  ${overviewCard('请求数', httpStats.total.toLocaleString(), '#3498db')}
  ${overviewCard('错误', totalErrors, totalErrors > 0 ? '#e74c3c' : '#27ae60')}
  ${overviewCard('告警', totalWarns, totalWarns > 5 ? '#f39c12' : '#27ae60')}
  ${overviewCard('异常', totalExceptions, totalExceptions > 0 ? '#e74c3c' : '#27ae60')}
  ${overviewCard('4xx', httpStats.status4xx, httpStats.status4xx > 10 ? '#f39c12' : '#27ae60')}
  ${overviewCard('5xx', httpStats.status5xx, httpStats.status5xx > 0 ? '#e74c3c' : '#27ae60')}
</div>

<!-- 错误详情 -->
${errorGroups.length > 0 ? `
<h2 style="font-size: 16px; color: #e74c3c; border-bottom: 2px solid #e74c3c; padding-bottom: 8px;">🔴 错误详情 (${totalErrors})</h2>
<table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
  <tr style="background: #ffeaea;">
    <th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">错误消息</th>
    <th style="width: 50px; text-align: center; padding: 8px; border-bottom: 1px solid #ddd;">次数</th>
    <th style="width: 70px; text-align: center; padding: 8px; border-bottom: 1px solid #ddd;">最近发生</th>
  </tr>
  ${errorGroups.slice(0, 15).map((g, i) => `
  <tr style="background: ${i % 2 === 0 ? '#fff' : '#fafafa'};">
    <td style="padding: 8px; border-bottom: 1px solid #eee; word-break: break-all;">${escapeHtml(g.message)}</td>
    <td style="text-align: center; padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; color: ${g.count >= 10 ? '#e74c3c' : '#333'};">${g.count}</td>
    <td style="text-align: center; padding: 8px; border-bottom: 1px solid #eee;">${formatTime(g.lastTime)}</td>
  </tr>`).join('')}
</table>

<!-- 错误分析与建议 -->
<h3 style="font-size: 14px; color: #555;">💡 分析与建议</h3>
${errorGroups.slice(0, 8).map(g => `
<div style="background: #f8f9fa; padding: 10px 14px; margin: 8px 0; border-left: 3px solid #667eea; border-radius: 0 6px 6px 0; font-size: 13px;">
  <strong style="color: #e74c3c;">[${g.count}次]</strong> ${escapeHtml(g.message.substring(0, 100))}
  <br><span style="color: #666;">→ ${suggestFix(g.message)}</span>
</div>`).join('')}

<!-- 原始日志示例 -->
<details style="margin: 15px 0;">
  <summary style="cursor: pointer; font-size: 14px; color: #667eea; font-weight: 600;">📋 查看原始日志示例</summary>
  ${errorGroups.slice(0, 5).map(g => `
  <div style="background: #1e1e1e; color: #d4d4d4; padding: 10px; margin: 8px 0; border-radius: 6px; font-size: 11px; font-family: monospace; overflow-x: auto; white-space: pre-wrap;">
${g.samples.map(s => escapeHtml(s)).join('\n---\n')}</div>`).join('')}
</details>
` : `<p style="color: #27ae60; font-size: 14px;">✅ 过去 ${hoursBack} 小时内无错误日志</p>`}

<!-- 告警详情 -->
${warnGroups.length > 0 ? `
<h2 style="font-size: 16px; color: #f39c12; border-bottom: 2px solid #f39c12; padding-bottom: 8px;">⚠️ 告警详情 (${totalWarns})</h2>
<table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
  <tr style="background: #fff8e1;">
    <th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">告警消息</th>
    <th style="width: 50px; text-align: center; padding: 8px; border-bottom: 1px solid #ddd;">次数</th>
    <th style="width: 70px; text-align: center; padding: 8px; border-bottom: 1px solid #ddd;">最近发生</th>
  </tr>
  ${warnGroups.slice(0, 10).map((g, i) => `
  <tr style="background: ${i % 2 === 0 ? '#fff' : '#fafafa'};">
    <td style="padding: 8px; border-bottom: 1px solid #eee; word-break: break-all;">${escapeHtml(g.message)}</td>
    <td style="text-align: center; padding: 8px; border-bottom: 1px solid #eee;">${g.count}</td>
    <td style="text-align: center; padding: 8px; border-bottom: 1px solid #eee;">${formatTime(g.lastTime)}</td>
  </tr>`).join('')}
</table>` : ''}

<!-- HTTP 错误端点 -->
  ${httpStats.topErrors.length > 0 ? `
<h2 style="font-size: 16px; color: #8e44ad; border-bottom: 2px solid #8e44ad; padding-bottom: 8px;">🌐 HTTP 错误端点 Top 10</h2>
<table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
  ${httpStats.topErrors.map(([endpoint, count], i) => `
  <tr style="background: ${i % 2 === 0 ? '#fff' : '#fafafa'};">
    <td style="padding: 6px 8px; border-bottom: 1px solid #eee; font-family: monospace; font-size: 12px;">${escapeHtml(endpoint)}</td>
    <td style="width: 50px; text-align: center; padding: 6px 8px; border-bottom: 1px solid #eee;">${count}</td>
  </tr>`).join('')}
</table>` : ''}

<!-- 未捕获异常 -->
  ${exceptionGroups.length > 0 ? `
<h2 style="font-size: 16px; color: #c0392b; border-bottom: 2px solid #c0392b; padding-bottom: 8px;">💥 未捕获异常 (${totalExceptions})</h2>
${exceptionGroups.map(g => `
<div style="background: #fdf2f2; padding: 12px; margin: 8px 0; border-left: 4px solid #c0392b; border-radius: 0 6px 6px 0;">
  <strong>[${g.count}次]</strong> ${escapeHtml(g.message.substring(0, 200))}
  <div style="font-size: 11px; font-family: monospace; margin-top: 6px; color: #666; white-space: pre-wrap;">${g.samples[0] ? escapeHtml(g.samples[0]) : ''}</div>
</div>`).join('')}` : ''}

<!-- 系统状态 -->
<h2 style="font-size: 16px; color: #2c3e50; border-bottom: 2px solid #bdc3c7; padding-bottom: 8px;">🖥️ 系统状态</h2>
<table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 15px;">
  <tr><td style="padding: 6px 0; color: #888; width: 120px;">当前在线实例</td><td>${pm2Status.online}/${pm2Status.total}</td></tr>
  <tr><td style="padding: 6px 0; color: #888;">当前连续运行时长</td><td>${pm2Status.uptime}</td></tr>
  <tr><td style="padding: 6px 0; color: #888;">当前内存使用</td><td>${pm2Status.memory > 0 ? pm2Status.memory + ' MB' : 'N/A'}</td></tr>
  <tr><td style="padding: 6px 0; color: #888;">磁盘使用</td><td>${escapeHtml(systemStatus.disk?.summary || 'N/A')}（${bytesToHuman(systemStatus.disk?.availableBytes)} 可用）</td></tr>
  <tr><td style="padding: 6px 0; color: #888;">磁盘扣分</td><td>${diskPenalty > 0 ? `-${diskPenalty} 分` : '0 分'}</td></tr>
  <tr><td style="padding: 6px 0; color: #888;">系统负载</td><td>${systemStatus.load}</td></tr>
  <tr><td style="padding: 6px 0; color: #888;">MongoDB 备份</td><td>${systemStatus.lastBackup}</td></tr>
  <tr><td style="padding: 6px 0; color: #888;">MySQL 同步</td><td>${systemStatus.mysqlSync}</td></tr>
  <tr><td style="padding: 6px 0; color: #888;">PM2 自启动</td><td>${systemStatus.pm2Autostart?.summary || 'N/A'}</td></tr>
  <tr><td style="padding: 6px 0; color: #888;">DNS 解析器</td><td>${systemStatus.dnsResolver?.summary || 'N/A'}</td></tr>
  <tr><td style="padding: 6px 0; color: #888;">resolv.conf</td><td>${systemStatus.resolvConf?.summary || 'N/A'}</td></tr>
  <tr><td style="padding: 6px 0; color: #888;">DNS 探测</td><td>${systemStatus.dnsProbe?.summary || 'N/A'}</td></tr>
  ${systemStatus.docker.map(d => `<tr><td style="padding: 6px 0; color: #888;">Docker</td><td>${d}</td></tr>`).join('')}
</table>

<h2 style="font-size: 16px; color: #2c3e50; border-bottom: 2px solid #bdc3c7; padding-bottom: 8px;">🧹 自动日志清理</h2>
<div style="background: #f8f9fa; padding: 12px; margin: 8px 0 18px; border-left: 4px solid ${diskCleanup.status === 'completed' ? '#27ae60' : diskCleanup.status === 'skipped' ? '#3498db' : '#f39c12'}; border-radius: 0 6px 6px 0; font-size: 13px;">
  <strong>${escapeHtml(formatCleanupStatus(diskCleanup))}</strong>
  <div style="margin-top: 6px;">清理前：${escapeHtml(diskCleanup.before?.summary || systemStatus.disk?.summary || 'N/A')}；清理后：${escapeHtml(diskCleanup.after?.summary || 'N/A')}；预计/实际回收：${bytesToHuman(diskCleanup.reclaimedBytes || 0)}</div>
  ${diskCleanup.actions?.length ? `<div style="margin-top: 6px;">${diskCleanup.actions.slice(0, 12).map(action => `${escapeHtml(action.action)} → ${escapeHtml(action.target)}：${escapeHtml(action.result)}${action.error ? `（${escapeHtml(action.error)}）` : ''}`).join('<br>')}</div>` : ''}
</div>

${infrastructureAlerts.length > 0 ? `
<h2 style="font-size: 16px; color: #c0392b; border-bottom: 2px solid #c0392b; padding-bottom: 8px;">🛡️ 基础设施告警</h2>
${infrastructureAlerts.map(alert => `
<div style="background: #fff5f5; padding: 12px; margin: 8px 0; border-left: 4px solid #c0392b; border-radius: 0 6px 6px 0;">
  <strong>${escapeHtml(alert.summary)}</strong>
  <div style="font-size: 13px; color: #444; margin-top: 6px;"><strong>根因：</strong>${escapeHtml(alert.likelyCause)}</div>
  <div style="font-size: 13px; color: #444; margin-top: 4px;"><strong>建议：</strong>${escapeHtml(alert.recommendedAction)}</div>
</div>`).join('')}
` : ''}

<p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 15px;">
  此报告由 daily-log-report.js 自动生成 | ${formatDate(new Date())}
</p>

</div>
</body>
</html>`;
}

function overviewCard(label, value, color) {
  return `<div style="flex: 1; min-width: 80px; text-align: center; background: ${color}11; border: 1px solid ${color}33; border-radius: 8px; padding: 10px 8px;">
    <div style="font-size: 22px; font-weight: bold; color: ${color};">${value}</div>
    <div style="font-size: 11px; color: #888; margin-top: 2px;">${label}</div>
  </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// 邮件发送
// ============================================================

async function sendEmail(html, subject) {
  const nodemailer = require('nodemailer');

  const transporter = nodemailer.createTransport(CONFIG.smtp);

  await transporter.sendMail({
    from: CONFIG.mailFrom,
    to: CONFIG.mailTo,
    subject,
    html,
  });

  console.log(`✅ 邮件已发送至 ${CONFIG.mailTo}`);
}

function resolveOutputDir() {
  try {
    if (fs.existsSync(CONFIG.logDir)) {
      fs.accessSync(CONFIG.logDir, fs.constants.W_OK);
      return CONFIG.logDir;
    }
  } catch (err) {
    // fall through to tmp
  }

  const fallbackDir = path.join('/tmp', 'morning-reading-reports');
  fs.mkdirSync(fallbackDir, { recursive: true });
  return fallbackDir;
}

function calculateHealthScore(totalErrors, totalExceptions, status5xx, infrastructureAlerts = [], disk = null) {
  let healthScore = 100;
  if (totalErrors > 0) healthScore -= Math.min(totalErrors * 5, 40);
  if (totalExceptions > 0) healthScore -= Math.min(totalExceptions * 15, 30);
  if (status5xx > 0) healthScore -= Math.min(status5xx * 5, 25);
  if (infrastructureAlerts.length > 0) {
    const infraPenalty = infrastructureAlerts.reduce((sum, alert) => {
      if (alert.severity === 'high') return sum + 20;
      if (alert.severity === 'medium') return sum + 10;
      return sum + 5;
    }, 0);
    healthScore -= Math.min(infraPenalty, 40);
  }
  healthScore -= getDiskPenalty(disk?.usedPercent);
  return Math.max(0, healthScore);
}

function formatCleanupStatus(cleanup) {
  if (!cleanup || cleanup.status === 'pending') return '等待清理结果';
  if (cleanup.status === 'skipped') {
    const reason = {
      'below-threshold': '磁盘低于90%，未触发',
      cooldown: '处于6小时冷却期，已跳过',
      'disk-check-failed': '磁盘检查失败，未执行',
    }[cleanup.skippedReason] || '未触发';
    return `⏭️ ${reason}`;
  }
  if (cleanup.status === 'completed') return cleanup.dryRun ? '🧪 dry-run：已演练，未修改日志' : '✅ 已完成，未停止线上服务';
  if (cleanup.status === 'partial-failure') return '⚠️ 部分清理失败，线上服务未重启';
  return `❌ 清理失败：${cleanup.skippedReason || '未知原因'}`;
}

function buildReportSummary(report) {
  const totalErrors = report.errorGroups.reduce((s, g) => s + g.count, 0);
  const totalWarns = report.warnGroups.reduce((s, g) => s + g.count, 0);
  const totalExceptions = report.exceptionGroups.reduce((s, g) => s + g.count, 0);
  const diskPenalty = getDiskPenalty(report.systemStatus.disk?.usedPercent);
  const healthScore = calculateHealthScore(totalErrors, totalExceptions, report.httpStats.status5xx, report.infrastructureAlerts, report.systemStatus.disk);

  return {
    reportId: `${report.timeRange.to.toISOString()}-${healthScore}-${totalErrors}-${totalWarns}-${totalExceptions}`,
    generatedAt: new Date().toISOString(),
    hoursBack,
    timeRange: {
      from: report.timeRange.from.toISOString(),
      to: report.timeRange.to.toISOString(),
    },
    score: healthScore,
    scoreBreakdown: {
      errors: totalErrors > 0 ? Math.min(totalErrors * 5, 40) : 0,
      exceptions: totalExceptions > 0 ? Math.min(totalExceptions * 15, 30) : 0,
      status5xx: report.httpStats.status5xx > 0 ? Math.min(report.httpStats.status5xx * 5, 25) : 0,
      infrastructure: Math.min(report.infrastructureAlerts.reduce((sum, alert) => sum + (alert.severity === 'high' ? 20 : alert.severity === 'medium' ? 10 : 5), 0), 40),
      disk: diskPenalty,
    },
    counts: {
      errors: totalErrors,
      warnings: totalWarns,
      exceptions: totalExceptions,
      infrastructureAlerts: report.infrastructureAlerts.length,
      requests: report.httpStats.total,
      status4xx: report.httpStats.status4xx,
      status5xx: report.httpStats.status5xx,
    },
    pm2Status: report.pm2Status,
    systemStatus: report.systemStatus,
    infrastructureAlerts: report.infrastructureAlerts,
    diskCleanup: report.diskCleanup || null,
    topErrors: report.errorGroups.slice(0, 10).map(group => ({
      message: group.message,
      count: group.count,
      lastOccurredAt: group.lastTime ? group.lastTime.toISOString() : null,
      samples: group.samples,
    })),
    topWarnings: report.warnGroups.slice(0, 10).map(group => ({
      message: group.message,
      count: group.count,
      lastOccurredAt: group.lastTime ? group.lastTime.toISOString() : null,
      samples: group.samples,
    })),
    topExceptions: report.exceptionGroups.slice(0, 10).map(group => ({
      message: group.message,
      count: group.count,
      lastOccurredAt: group.lastTime ? group.lastTime.toISOString() : null,
      samples: group.samples,
    })),
    shouldTriggerDiagnosis: totalErrors > 0 || totalWarns > 0 || totalExceptions > 0 || report.httpStats.status5xx > 0 || report.infrastructureAlerts.length > 0,
  };
}

function writeReportArtifacts(reportSummary, html, options = {}) {
  const outputDir = resolveOutputDir();
  const datePart = new Date(reportSummary.timeRange.to).toISOString().slice(0, 10);
  const timePart = new Date(reportSummary.timeRange.to).toISOString().slice(11, 16).replace(':', '');
  const prefix = options.testMode ? 'daily-report-test' : 'daily-report';
  const htmlLatest = path.join(
    outputDir,
    options.testMode ? 'daily-report-test-latest.html' : CONFIG.reportFiles.latestHtml
  );
  const jsonLatest = path.join(
    outputDir,
    options.testMode ? 'daily-report-test-latest.json' : CONFIG.reportFiles.latestJson
  );
  const archiveName = options.testMode
    ? `${prefix}-${datePart}-${timePart}`
    : `${prefix}-${datePart}`;
  const htmlArchive = path.join(outputDir, `${archiveName}.html`);
  const jsonArchive = path.join(outputDir, `${archiveName}.json`);

  fs.writeFileSync(htmlLatest, html);
  fs.writeFileSync(jsonLatest, JSON.stringify(reportSummary, null, 2));
  fs.writeFileSync(htmlArchive, html);
  fs.writeFileSync(jsonArchive, JSON.stringify(reportSummary, null, 2));

  return {
    htmlLatest,
    jsonLatest,
    htmlArchive,
    jsonArchive,
  };
}

function triggerDiagnosisIfNeeded(reportSummary, options = {}) {
  if (!reportSummary.shouldTriggerDiagnosis) {
    console.log('🩺 报告窗口内无需要诊断的问题，跳过自动诊断');
    return;
  }

  const diagnosisScript = path.join(__dirname, 'diagnose-daily-report.js');
  const childArgs = [diagnosisScript, '--input', options.inputFile];
  if (options.testMode) childArgs.push('--test');

  console.log(`🩺 触发自动诊断: ${path.basename(diagnosisScript)}`);
  const result = spawnSync(process.execPath, childArgs, {
    cwd: path.dirname(__dirname),
    env: process.env,
    encoding: 'utf-8',
    timeout: 120000,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    console.error(`⚠️ 自动诊断触发失败: ${result.error.message}`);
    return;
  }

  if (result.status !== 0) {
    console.error(`⚠️ 自动诊断退出码异常: ${result.status}`);
  }
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const now = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 日志巡检开始: ${formatDate(now)}`);
  console.log(`   分析时间范围: ${formatDate(cutoffTime)} ~ ${formatDate(now)}`);
  console.log(`${'='.repeat(60)}\n`);

  // 1. 读取并解析所有日志
  const logDir = CONFIG.logDir;

  const errorLines = readLogFile(path.join(logDir, CONFIG.logFiles.error));
  const warnLines = readLogFile(path.join(logDir, CONFIG.logFiles.warn));
  const combinedLines = readLogFile(path.join(logDir, CONFIG.logFiles.combined));
  const exceptionLines = readLogFile(path.join(logDir, CONFIG.logFiles.exceptions));
  const rejectionLines = readLogFile(path.join(logDir, CONFIG.logFiles.rejections));
  const pm2OutLines = readLogFileWithRotation(path.join(logDir, CONFIG.logFiles.pm2Out));
  const pm2ErrorLines = readLogFileWithRotation(path.join(logDir, CONFIG.logFiles.pm2Error));

  console.log(`📁 日志文件统计:`);
  console.log(`   error.log:       ${errorLines.length} 行`);
  console.log(`   warn.log:        ${warnLines.length} 行`);
  console.log(`   combined.log:    ${combinedLines.length} 行`);
  console.log(`   exceptions.log:  ${exceptionLines.length} 行`);
  console.log(`   rejections.log:  ${rejectionLines.length} 行`);
  console.log(`   pm2-out.log:     ${pm2OutLines.length} 行`);
  console.log(`   pm2-error.log:   ${pm2ErrorLines.length} 行`);

  // 2. 解析日志条目
  const errorEntries = filterByTime(errorLines.map(parseWinstonLine), cutoffTime);
  const warnEntries = filterByTime(warnLines.map(parseWinstonLine), cutoffTime);
  const combinedEntries = filterByTime(combinedLines.map(parseWinstonLine), cutoffTime);
  const exceptionEntries = filterByTime(
    [...exceptionLines, ...rejectionLines].map(parseWinstonLine), cutoffTime
  );
  const pm2ErrorEntries = filterByTime(pm2ErrorLines.map(parsePM2Line), cutoffTime)
    .filter(e => e.level === 'error');

  // 合并所有错误
  const allErrors = [...errorEntries, ...pm2ErrorEntries];

  console.log(`\n📊 过去 ${hoursBack} 小时内:`);
  console.log(`   错误条目: ${allErrors.length}`);
  console.log(`   告警条目: ${warnEntries.length}`);
  console.log(`   异常条目: ${exceptionEntries.length}`);

  // 3. 分析
  const errorGroups = analyzeEntries(allErrors);
  const warnGroups = analyzeEntries(warnEntries.filter(e => !e.message || !e.message.includes('mongodump')));
  const exceptionGroups = analyzeEntries(exceptionEntries);
  const httpStats = analyzeHttpRequests(pm2OutLines, cutoffTime);

  console.log(`   HTTP 请求数: ${httpStats.total}`);
  console.log(`   HTTP 4xx: ${httpStats.status4xx}, 5xx: ${httpStats.status5xx}`);

  // 4. 获取系统状态
  const pm2Status = getPM2Status();
  const systemStatus = getSystemStatus();
  const infrastructureAlerts = collectInfrastructureAlerts(systemStatus);

  console.log(`\n🖥️  PM2 当前状态: ${pm2Status.online}/${pm2Status.total} 在线, 连续运行 ${pm2Status.uptime}, ${pm2Status.memory}MB 内存`);
  console.log(`   磁盘: ${systemStatus.disk?.summary || 'N/A'}, 负载: ${systemStatus.load}`);
  console.log(`   磁盘扣分: ${getDiskPenalty(systemStatus.disk?.usedPercent)}`);
  console.log(`   PM2 自启动: ${systemStatus.pm2Autostart?.summary || 'N/A'}`);
  console.log(`   DNS 解析器: ${systemStatus.dnsResolver?.summary || 'N/A'}`);
  console.log(`   DNS 探测: ${systemStatus.dnsProbe?.summary || 'N/A'}`);
  console.log(`   基础设施告警: ${infrastructureAlerts.length}`);

  // 5. 生成报告
  const report = {
    errorGroups,
    warnGroups,
    exceptionGroups,
    httpStats,
    pm2Status,
    systemStatus,
    infrastructureAlerts,
    timeRange: { from: cutoffTime, to: now },
  };

  // 先落盘本次统计，再执行清理，避免清理动作影响本次日志分析。
  let html = generateHTML(report);
  let reportSummary = buildReportSummary(report);
  let artifacts = writeReportArtifacts(reportSummary, html, { testMode: isTestMode });

  const diskCleanup = runCleanup({
    diskBefore: systemStatus.disk,
    appLogDir: CONFIG.logDir,
    thresholdPercent: CONFIG.diskCleanup.thresholdPercent,
    emergencyPercent: CONFIG.diskCleanup.emergencyPercent,
    retentionDays: CONFIG.diskCleanup.retentionDays,
    cooldownMs: CONFIG.diskCleanup.cooldownMs,
    journalFallback: CONFIG.diskCleanup.journalFallback,
    dryRun: isDryRun,
  });
  report.diskCleanup = diskCleanup;
  console.log(`   自动清理: ${formatCleanupStatus(diskCleanup)}`);

  // 将清理结果写回同一份 HTML/JSON 报告。
  html = generateHTML(report);
  reportSummary = buildReportSummary(report);
  artifacts = writeReportArtifacts(reportSummary, html, { testMode: isTestMode });

  const totalErrors = errorGroups.reduce((s, g) => s + g.count, 0);
  const totalExceptions = exceptionGroups.reduce((s, g) => s + g.count, 0);

  let statusEmoji = reportSummary.score >= 80 ? '✅' : reportSummary.score >= 50 ? '⚠️' : '🔴';
  if (totalErrors > 20 || totalExceptions > 0) statusEmoji = '🔴';

  const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;
  const subject = `${statusEmoji} 晨读营日志巡检 ${dateStr} | 错误${totalErrors} 告警${warnGroups.reduce((s, g) => s + g.count, 0)}`;

  // 6. 发送或输出
  if (isTestMode || noEmail) {
    console.log(`\n📧 [${isTestMode ? '测试模式' : '不发邮件模式'}] 邮件主题: ${subject}`);
    console.log(`   邮件 HTML 长度: ${html.length} 字符`);
    console.log(`   HTML 已保存到: ${artifacts.htmlLatest}`);
    console.log(`   JSON 已保存到: ${artifacts.jsonLatest}`);
    console.log(`   可用浏览器打开预览`);
    triggerDiagnosisIfNeeded(reportSummary, { inputFile: artifacts.jsonLatest, testMode: true });
  } else {
    if (!CONFIG.smtp.auth.pass) {
      console.error('❌ 未配置 QQ_SMTP_PASS 环境变量，无法发送邮件');
      console.error('   请设置: export QQ_SMTP_PASS="你的QQ邮箱授权码"');
      console.log(`   报告已保存到: ${artifacts.htmlArchive}`);
      console.log(`   摘要已保存到: ${artifacts.jsonArchive}`);
      process.exit(1);
    }

    try {
      await sendEmail(html, subject);
      triggerDiagnosisIfNeeded(reportSummary, { inputFile: artifacts.jsonLatest, testMode: false });
    } catch (err) {
      console.error(`❌ 邮件发送失败: ${err.message}`);
      console.log(`   报告已保存到: ${artifacts.htmlArchive}`);
      console.log(`   摘要已保存到: ${artifacts.jsonArchive}`);
      process.exit(1);
    }
  }

  console.log(`\n✅ 日志巡检完成\n`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`❌ 脚本执行失败: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = {
  CONFIG,
  calculateHealthScore,
  collectInfrastructureAlerts,
  formatCleanupStatus,
  generateHTML,
  getSystemStatus,
  getDiskPenalty,
  buildReportSummary,
};
