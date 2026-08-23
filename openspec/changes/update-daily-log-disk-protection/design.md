# 设计：日志巡检磁盘保护

## 1. 采集与评分

将当前 `status.disk` 从字符串扩展为结构化对象：

```js
{
  mount: '/',
  usedPercent: 92,
  usedBytes: 0,
  availableBytes: 0,
  summary: '⚠️ 92%'
}
```

使用 `df -P -k /`，解析 POSIX 输出而不是依赖 `df -h` 的本地化文本。解析失败时 `usedPercent` 为 `null`，报告标记“磁盘检查失败”，但不虚构扣分。

评分使用独立函数 `getDiskPenalty(usedPercent)`：

- `usedPercent === null`：0 分，产生 medium 基础设施告警；
- `usedPercent >= 99`：100 分；
- `usedPercent > 95`：50 分；
- `usedPercent > 90`：20 分；
- 其他：0 分。

磁盘扣分作为一项明确的基础设施扣分，并与其他基础设施告警采用“各项扣分后再截断为 0”的规则；同一次巡检只应用一次磁盘扣分，不因同时生成多个告警而重复扣分。

## 2. 非中断清理顺序

清理在读取、分析并落盘报告摘要之后执行，避免清理动作破坏本次巡检统计。执行入口建议为独立模块/脚本，例如 `backend/scripts/disk-log-cleanup.js`，主巡检只负责调用和记录结果。

清理步骤：

1. 使用 `flock` 锁文件，防止日报和人工任务并发。
2. 再次读取 `/` 使用率；低于阈值则跳过。
3. 对 `/var/www/logs` 中白名单日志执行安全清理：
   - 当前应用/PM2 日志使用 `truncate -s 0`，不删除文件、不关闭文件句柄；
   - 轮转日志仅删除超过保留期（默认 7 天）的文件；
   - 不触碰 `daily-report-latest.*`、报告归档、备份目录、上传目录。
4. 对 Docker：只通过 `docker inspect` 获取 `morning-reading-*` 容器的日志路径；验证路径必须位于 `/var/lib/docker/containers/` 且文件名与容器 ID 匹配后 `truncate -s 0`。不执行 `docker stop/restart`、`docker compose down`、`docker system prune`。
5. 清理后再次检查空间；如果仍 `>=90%`，最多执行一次受控的系统 journal 历史日志压缩到 100 MB；仍不足则报告“自动清理不足”，不继续猜测性删除。
6. 将每个动作记录为 `{target, action, beforeBytes, reclaimedBytes, afterPercent, result, error}`，并输出到报告 JSON/HTML。

## 3. 保护线上服务

- 清理命令全部设置超时；单个目标失败不阻塞整份日报。
- 清理只改变日志文件内容，不调用 PM2 reload/restart，不操作 MongoDB 数据卷。
- 设置冷却文件（默认 6 小时），避免每次重复清空同一批日志；高于 `>=99%` 时允许绕过冷却执行一次紧急清理。
- 清理前后检查后端健康接口、MongoDB/Redis/MySQL 容器状态只用于报告，不因为检查失败自动重启服务。
- 权限不足时保留评分和告警，发送报告并以非零状态记录清理失败。

## 4. 报告呈现

HTML 增加：

- “磁盘使用：92%（根分区）”；
- “磁盘扣分：-20”；
- “自动清理：已触发 / 未触发 / 跳过（冷却） / 失败”；
- 清理前后空间、回收字节数、目标摘要。

JSON 增加：

```js
systemStatus.disk = { ... }
report.diskCleanup = { triggered, skippedReason, actions, before, after }
report.scoreBreakdown = { errors, exceptions, status5xx, infrastructure, disk }
```

## 5. 验证策略

- 单元测试覆盖 `90%`、`90.1%`、`95%`、`95.1%`、`99%`、`100%` 和解析失败。
- 使用临时目录测试日志白名单、轮转保留期、路径校验、冷却和失败降级。
- `daily-log-report.js --test --hours 1` 验证报告可生成且不会覆盖正式归档。
- 生产上线后先用 `--no-email`/dry-run 观察一次，再开启自动清理；首次运行只清理日志，不重启服务。
