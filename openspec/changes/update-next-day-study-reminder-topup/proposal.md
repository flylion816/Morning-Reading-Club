# 变更：按每日晨读行为补充明日开课通知

## Why

现有明日开课通知主要在打卡、评论和点赞等交互中补充，只阅读后离开的用户可能没有次日通知。同时，发送时间拟从 05:45 调整为 05:55，与首页晨读时间提示重合，需要避免今日待发授权和明日新授权相互覆盖。

## What Changes

- 在首页“去晨读”和课程详情“进入沉浸阅读”两个点击入口请求明日开课通知授权。
- 将明日通知补充从“总库存小于 1”改为“目标期次的明日日期尚未排队”。
- 扩展现有 `SubscribeMessageGrant`，最多保留今日待发和明日待发两个日期，今日成功后原子提升明日项。
- 将主发送时间调整为北京时间 05:55，06:00 起保留最多一次短暂失败重试。
- 为主发送和重试增加按用户、期次和日期的原子领取与幂等保护。
- 最后一天、用户拒绝或授权接口失败均不阻断进入晨读。

## Impact

- Affected specs: `study-reminder-subscriptions`
- Affected miniprogram: `pages/index/index.js`, `pages/course-detail/course-detail.js`, `utils/subscribe-auto-topup.js`, related tests
- Affected backend: `SubscribeMessageGrant`, subscription state/grant recording, study reminder planning and scheduler, related tests
- Data: additive nullable fields only; no database initialization, reset, deletion, or destructive migration

