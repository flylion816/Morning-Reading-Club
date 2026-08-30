import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../PeriodsView.vue'), 'utf8');

describe('PeriodsView', () => {
  it('gives the fixed operation column an opaque background', () => {
    expect(source).toContain('.el-table-fixed-column--right.el-table__cell');
    expect(source).toContain('background-color: var(--admin-surface-strong, var(--el-bg-color, #fff)) !important;');
    expect(source).toContain('tr.el-table__row--striped > td.el-table-fixed-column--right');
  });
});
