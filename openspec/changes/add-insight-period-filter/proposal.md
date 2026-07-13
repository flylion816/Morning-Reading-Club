# Change: Add period filtering to the insight list

## Why

小凡看见列表目前只能按关键词搜索，用户无法快速限定到某一期次。搜索在“我的”和“他人的”中的实现也不一致，需要统一筛选交互。

## What Changes

- 在关键词输入框前增加期次下拉选择，默认为“所有期次”。
- 切换期次后立即按当前期次刷新列表。
- 关键词搜索叠加当前期次条件，清空关键词时保留期次条件。
- “我的”和“他人的”共享同一套期次与关键词筛选状态。

## Impact

- Affected specs: `insight-list-filtering`
- Affected code: `miniprogram/pages/insights/insights.js`, `insights.wxml`, `insights.wxss`
- Tests: `miniprogram/__tests__/pages/insights.spec.js`
- Database: no schema or data changes
