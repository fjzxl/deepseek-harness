import { defineConfig } from 'vitest/config'

/**
 * 插件本地测试配置：npm test 只跑本插件的 tests/，
 * 不向上冒泡到 monorepo 根 vitest 配置（那会跑整个仓库的测试集）。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
