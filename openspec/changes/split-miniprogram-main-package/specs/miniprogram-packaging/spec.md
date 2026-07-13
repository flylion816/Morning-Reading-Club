## ADDED Requirements

### Requirement: Keep the miniprogram main package below the quality threshold

系统 SHALL 将低频页面声明为按需下载分包，使主包保持在微信代码质量建议的 1.5 MiB 阈值以下。

#### Scenario: Launch a core page

- **WHEN** 用户打开首页、晨读营或个人中心
- **THEN** 页面应从主包直接加载

#### Scenario: Open a low-frequency page

- **WHEN** 用户打开管理、社区活动或在场页面
- **THEN** 微信应下载对应分包并使用 `app.json` 声明的完整页面路径打开页面

### Requirement: Keep subpackage-only JavaScript out of the main package

系统 SHALL 将只被分包页面使用的 JavaScript 模块放入对应分包目录。

#### Scenario: Load mobile admin services

- **WHEN** 用户打开管理分析或管理工作台页面
- **THEN** 页面应从对应分包加载专用 service
- **AND** 主包 `services` 目录不应包含这些分包专用模块

#### Scenario: Load detail-only services

- **WHEN** 用户打开洞见详情或排行榜
- **THEN** 页面应从自身分包加载弹幕或排行专用 service
- **AND** 主包 `services` 目录不应包含这两个专用模块

#### Scenario: Load payment and notification services

- **WHEN** 用户打开支付或通知页面
- **THEN** 页面应从对应分包加载支付或 WebSocket service
- **AND** 主包 `services` 目录不应包含这两个专用模块

### Requirement: Exclude local metadata from uploaded packages

系统 SHALL 在租户打包配置中排除 `.DS_Store` 文件。

#### Scenario: Regenerate tenant package settings

- **WHEN** 开发者应用任一租户配置
- **THEN** 生成的项目配置应排除小程序根目录和资源目录中的 `.DS_Store`
