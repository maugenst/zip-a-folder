// tsdown.config.ts
import {defineConfig} from 'tsdown';

export default defineConfig([
    {
        entry: 'lib/ZipAFolder.ts',
        format: ['esm', 'cjs'],
        clean: true,
        outDir: 'dist',
        dts: true
    },
    {
        entry: {'cli': 'bin/zip-a-folder.ts'},
        format: ['esm'],
        outDir: 'dist',
        dts: false,
        banner: '#!/usr/bin/env node'
    }
]);
