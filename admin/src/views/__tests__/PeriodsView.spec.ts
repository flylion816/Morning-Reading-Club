import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../PeriodsView.vue'), 'utf8');

describe('PeriodsView', () => {
  it('gives the fixed operation column an opaque background', () => {
    expect(source).toContain('.el-table__fixed-right');
    expect(source).toContain('background-color: var(--admin-surface-strong, var(--el-bg-color, #fff));');
    expect(source).toContain('.el-table__fixed-body-wrapper tr > td.el-table__cell');
  });
});
