import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/tests-*.ts'],
        testTimeout: 30000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['lib/**/*.ts'],
            exclude: ['lib/**/*.d.ts']
        }
    }
});
