// tsdown.config.ts
import {defineConfig} from 'tsdown';

export default defineConfig({
    entry: 'lib/ZipAFolder.ts',
    // Other options
    format: ['esm', 'cjs']
});
