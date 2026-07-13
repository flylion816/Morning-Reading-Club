## Context

`app.json` 原先只声明 `pages`，没有 `subPackages`。主包原始文件统计约 1630 KiB，其中页面约 1167 KiB。多数微信分包根目录可以直接指向现有页面目录；需共享专用 service 的两个工作台页面收敛到同一分包。

## Decisions

- 保留首页、晨读营、我的三个 Tab 页以及课程、打卡、小凡看见核心链路在主包。
- `pages/zaichang` 作为一个分包，包含 list、detail 和 publish。
- 洞见详情/编辑、报名/支付/邀请、通知/设置、结营报告、打卡记录、他人主页、排行榜和成员页均按原页面目录建立分包，保持对外路由不变。
- 分析、工作台和其他管理页进入管理分包；活动报名明细与工作台共用同一分包。
- `adminAnalytics.service.js` 和 `adminWorkbench.service.js` 归属对应管理分包，不再进入主包。
- `danmaku.service.js` 和 `ranking.service.js` 分别归属洞见详情与排行榜分包。
- `payment.service.js` 归属支付分包；社区活动详情通过局部 `payment-confirmation.service.js` 调用唯一需要的确认接口。
- `websocket.service.js` 归属通知分包；旧 `notification-badge` 组件未被任何页面注册，由首页现有未读数逻辑替代。
- 真正通用的 services、utils 和 components 仍位于主包，避免主包反向依赖分包。
- 租户打包脚本生成 `.DS_Store` 忽略项，使切换租户后仍然生效。

## Risks / Mitigations

- 分包根或页面名错误会导致编译或导航失败：通过配置测试验证每个完整页面路径存在。
- 首次进入分包页面需下载：仅迁移低频页面，核心链路保持在主包。
