## ADDED Requirements

### Requirement: Filter insight lists by period

系统 SHALL 在小凡看见列表的搜索框前提供期次选择，并默认展示所有期次。

#### Scenario: Select one period

- **WHEN** 用户从期次下拉框选择一个具体期次
- **THEN** 页面立即只展示该期次的小凡看见

#### Scenario: Return to all periods

- **WHEN** 用户选择“所有期次”
- **THEN** 页面恢复展示所有已加载期次的小凡看见

### Requirement: Compose period and keyword filters

系统 SHALL 将当前期次与关键词作为可叠加的筛选条件。

#### Scenario: Search within one period

- **WHEN** 用户已选择具体期次并提交关键词
- **THEN** 页面只展示该期次内标题或内容命中关键词的记录

#### Scenario: Clear keyword

- **WHEN** 用户清空已提交的关键词
- **THEN** 页面取消关键词条件但保留当前期次条件

### Requirement: Share filters across insight tabs

系统 SHALL 在“我的”和“他人的”小凡看见中使用同一期次与关键词筛选状态。

#### Scenario: Switch tabs with active filters

- **WHEN** 用户在已选期次或已提交关键词时切换“我的”和“他人的”
- **THEN** 新 Tab 在数据就绪后立即应用相同筛选条件
