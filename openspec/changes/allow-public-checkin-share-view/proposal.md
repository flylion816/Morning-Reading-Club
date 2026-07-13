# Change: Allow public check-in shares to be viewed by all visitors

## Why

公开打卡分享链接对未登录访客可见，但已登录且未参加当前期次的好友会被期次权限校验拒绝。公开内容的查看规则应与访客是否登录或参加期次无关。

## What Changes

- 公开打卡详情对未登录、已登录未参期和已参期用户统一放行。
- 私密打卡继续拒绝未登录访客。
- 已登录用户查看私密打卡时继续执行原有期次社群权限校验。

## Impact

- Affected specs: `checkin-sharing`
- Affected code: `backend/src/controllers/checkin.controller.js`
- Tests: `backend/tests/unit/controllers/checkin.controller.test.js`
- Database: no schema or data changes
