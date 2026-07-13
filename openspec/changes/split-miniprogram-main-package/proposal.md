# Change: Split low-frequency pages out of the miniprogram main package

## Why

微信开发者工具代码质量扫描显示主包超过 1.5 MiB。当前 41 个页面全部在主包，低频管理、社区活动和在场功能会增加首次下载体积。

## What Changes

- 将在场功能声明为一个分包。
- 将移动管理和社区活动的低频页面声明为按需下载分包。
- 将洞见详情、报名支付、通知、报告、排行等非 Tab 详情流程声明为按需分包，为编译后主包保留足够余量。
- 保持对外页面路径不变；将内部管理报名明细页并入工作台分包。
- 将只被管理分包使用的 service 移入对应分包，避免主包出现未使用 JS。
- 将只被洞见详情和排行榜使用的 service 一并移入对应分包。
- 将支付与 WebSocket service 移入所属分包；社区活动仅保留局部支付确认接口。
- 删除未注册、未使用的旧 `notification-badge` 组件。
- 从打包输出中排除 `.DS_Store` 系统文件。

## Impact

- Affected specs: `miniprogram-packaging`
- Affected code: `miniprogram/app.json`, tenant package ignore generation, package configuration tests
- Database and APIs: no changes
- User experience: first entry into a subpackage may briefly download that package; external routes remain unchanged
