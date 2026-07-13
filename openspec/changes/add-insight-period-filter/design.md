## Context

`pages/insights` 已一次加载“我的”列表，并在首次打开“他人的”时汇总已授权用户的列表。页面已持有每条记录的 `periodId`、标题和内容摘要，因此可以在页面内统一完成筛选，无需改动数据库或权限接口。

## Goals / Non-Goals

- Goals: 按期次筛选，叠加关键词，并使两个 Tab 保持一致。
- Non-Goals: 不增加后台配置，不改变小凡看见权限，不修改数据结构。

## Decisions

- 期次选项优先使用 `app.globalData.periods`；若尚未加载，则调用现有 `courseService.getPeriods()` 补齐。
- 页面保留未筛选的源列表，再由一个统一函数叠加 `selectedPeriodId` 和 `activeSearchKeyword`。
- 切换期次、搜索、清空关键词、切换 Tab 都调用同一筛选函数。
- 下拉框、输入框和搜索按钮保持同一行；下拉框使用小程序原生 `picker`。

## Risks / Trade-offs

- 当列表超过现有接口的 100 条加载上限时，前端筛选只覆盖已加载数据。本次保持现有列表范围，不额外引入分页改造。

## Error Handling

- 期次列表请求失败时保留“所有期次”，不阻断小凡看见列表。
- “他人的”尚未加载时，先完成现有授权数据加载，再应用当前筛选。
