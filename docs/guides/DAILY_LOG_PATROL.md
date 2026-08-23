# 每日日志巡检与磁盘保护

## 调度

现有服务器 Cron 保持每天 **17:00（Asia/Shanghai）** 执行：

```cron
0 17 * * * /usr/bin/node /var/www/morning-reading/backend/scripts/daily-log-report.js >> /var/www/logs/daily-report.log 2>&1
```

如果确实要改为北京时间每天 05:00，应将 Cron 改为 `0 5 * * *`，本次机制不主动改变调度时间。

## 磁盘评分

- `<=90%`：0 分
- `>90% 且 <=95%`：扣 20 分
- `>95% 且 <99%`：扣 50 分
- `>=99%`：扣 100 分，健康分最低为 0

巡检使用 `df -P -k /`，解析失败会产生基础设施告警，但不会虚构磁盘占用率或扣分。

## 自动清理边界

根分区达到 `>=90%` 后，日报完成日志读取、分析和第一次摘要落盘，再触发受保护清理：

- 当前应用/PM2 日志：使用 `truncate -s 0`，不关闭文件句柄、不重启服务；
- 超过 7 天的白名单轮转日志：删除；
- 仅清理名称以 `morning-reading-` 开头且经 `docker inspect` 校验路径的 Docker JSON 日志；
- 清理使用锁、6 小时冷却和命令超时；
- 清理后复查磁盘，仍高于阈值时最多执行一次 `journalctl --vacuum-size=100M`。

明确禁止：`docker stop`、`docker restart`、`docker compose down`、`docker system prune`、数据库卷、备份、上传文件、源代码和任何 `init-*`/重置脚本。

## Dry-run

本地或线上首次验证：

```bash
node backend/scripts/daily-log-report.js --test --dry-run --hours 1
```

线上也可以设置 `DAILY_LOG_CLEANUP_DRY_RUN=1`，该模式只记录拟清理目标，不修改日志、不写冷却标记。确认报告内容和目标无误后，移除该环境变量或不传 `--dry-run`，下一次巡检才会启用实际清理。

## 事故预防

2026 年 8 月 24 日曾出现根分区 100% 满，MongoDB 日志膨胀导致服务端口消失和 Nginx 502。此次保护机制只清理白名单日志并保留服务进程，不能替代磁盘扩容、日志轮转和定期检查。

## 手动恢复

如果自动清理失败，应先查看日报 JSON 的 `diskCleanup.actions` 和错误原因，确认服务状态后再人工处理日志；禁止为了“恢复”执行数据库初始化或重置脚本。
