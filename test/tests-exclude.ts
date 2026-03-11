'use strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {collectEntriesFromDirectory, collectGlobEntries} from '../lib/core/FileCollector';
import {tar, zip} from '../lib/ZipAFolder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory tree for testing exclude patterns. */
function makeTmpTree(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zaf-exclude-'));

    // Structure:
    // tmp/
    //   src.txt
    //   .env                 ← dot-file
    //   dist/                ← to exclude by name
    //     bundle.js
    //   node_modules/        ← to exclude by name
    //     dep/
    //       index.js
    //   src/
    //     app.ts
    //     .hidden.ts         ← dot-file inside subdir
    //   assets/
    //     logo.png
    //     styles.css

    fs.mkdirSync(path.join(tmp, 'dist'), {recursive: true});
    fs.mkdirSync(path.join(tmp, 'node_modules', 'dep'), {recursive: true});
    fs.mkdirSync(path.join(tmp, 'src'), {recursive: true});
    fs.mkdirSync(path.join(tmp, 'assets'), {recursive: true});

    fs.writeFileSync(path.join(tmp, 'src.txt'), 'root file');
    fs.writeFileSync(path.join(tmp, '.env'), 'SECRET=123');
    fs.writeFileSync(path.join(tmp, 'dist', 'bundle.js'), '(()=>{})()');
    fs.writeFileSync(path.join(tmp, 'node_modules', 'dep', 'index.js'), 'module.exports={}');
    fs.writeFileSync(path.join(tmp, 'src', 'app.ts'), 'export {}');
    fs.writeFileSync(path.join(tmp, 'src', '.hidden.ts'), '// hidden');
    fs.writeFileSync(path.join(tmp, 'assets', 'logo.png'), '\x89PNG');
    fs.writeFileSync(path.join(tmp, 'assets', 'styles.css'), 'body{}');

    return tmp;
}

// ---------------------------------------------------------------------------
// FileCollector – unit tests for exclude
// ---------------------------------------------------------------------------

describe('FileCollector – exclude option', () => {
    let tmp: string;

    beforeAll(() => {
        tmp = makeTmpTree();
    });

    afterAll(() => {
        fs.rmSync(tmp, {recursive: true, force: true});
    });

    it('collectEntriesFromDirectory: no exclude returns all entries', async () => {
        const entries = await collectEntriesFromDirectory(tmp, 4);
        const names = entries.map((e) => e.relativePath).sort();
        // dist/, node_modules/ and everything inside should be present
        expect(names).toContain('dist/');
        expect(names).toContain('dist/bundle.js');
        expect(names).toContain('node_modules/');
        expect(names).toContain('src/app.ts');
        expect(names).toContain('.env');
    });

    it('collectEntriesFromDirectory: exclude single directory by glob', async () => {
        const entries = await collectEntriesFromDirectory(tmp, 4, ['dist/**', 'dist/']);
        const names = entries.map((e) => e.relativePath).sort();
        expect(names).not.toContain('dist/');
        expect(names).not.toContain('dist/bundle.js');
        // other entries still present
        expect(names).toContain('src/app.ts');
        expect(names).toContain('node_modules/');
    });

    it('collectEntriesFromDirectory: exclude multiple directories', async () => {
        const entries = await collectEntriesFromDirectory(tmp, 4, [
            'dist/**',
            'dist/',
            'node_modules/**',
            'node_modules/'
        ]);
        const names = entries.map((e) => e.relativePath).sort();
        expect(names).not.toContain('dist/');
        expect(names).not.toContain('dist/bundle.js');
        expect(names).not.toContain('node_modules/');
        expect(names).not.toContain('node_modules/dep/');
        expect(names).not.toContain('node_modules/dep/index.js');
        expect(names).toContain('src/app.ts');
        expect(names).toContain('src.txt');
    });

    it('collectEntriesFromDirectory: exclude dot-files and dot-directories', async () => {
        const entries = await collectEntriesFromDirectory(tmp, 4, ['**/.*', '**/.*/**']);
        const names = entries.map((e) => e.relativePath).sort();
        expect(names).not.toContain('.env');
        expect(names).not.toContain('src/.hidden.ts');
        // non-dot entries still present
        expect(names).toContain('src/app.ts');
        expect(names).toContain('assets/logo.png');
    });

    it('collectEntriesFromDirectory: exclude by file extension', async () => {
        const entries = await collectEntriesFromDirectory(tmp, 4, ['**/*.js']);
        const names = entries.map((e) => e.relativePath).sort();
        expect(names).not.toContain('dist/bundle.js');
        expect(names).not.toContain('node_modules/dep/index.js');
        expect(names).toContain('src/app.ts');
    });

    it('collectEntriesFromDirectory: empty exclude array is a no-op', async () => {
        const withEmpty = await collectEntriesFromDirectory(tmp, 4, []);
        const withUndefined = await collectEntriesFromDirectory(tmp, 4, undefined);
        const namesEmpty = withEmpty.map((e) => e.relativePath).sort();
        const namesUndefined = withUndefined.map((e) => e.relativePath).sort();
        expect(namesEmpty).toEqual(namesUndefined);
    });

    it('collectGlobEntries: exclude filters out matching files', async () => {
        const entries = await collectGlobEntries('**/*.js', tmp, 4, ['node_modules/**']);
        const names = entries.map((e) => e.relativePath).sort();
        expect(names).toContain('dist/bundle.js');
        expect(names).not.toContain('node_modules/dep/index.js');
    });
});

// ---------------------------------------------------------------------------
// ZipAFolder – integration tests for exclude option
// ---------------------------------------------------------------------------

describe('zip/tar – exclude option', () => {
    let tmp: string;
    let outDir: string;

    beforeAll(() => {
        tmp = makeTmpTree();
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zaf-out-'));
    });

    afterAll(() => {
        fs.rmSync(tmp, {recursive: true, force: true});
        fs.rmSync(outDir, {recursive: true, force: true});
    });

    it('ZIP: exclude removes directories and their contents from archive', async () => {
        const out = path.join(outDir, 'excl-dir.zip');
        await zip(tmp, out, {exclude: ['dist/**', 'dist/', 'node_modules/**', 'node_modules/']});

        expect(fs.existsSync(out)).toBe(true);
        // Archive must be smaller than one without exclude
        const outFull = path.join(outDir, 'full.zip');
        await zip(tmp, outFull);
        expect(fs.statSync(out).size).toBeLessThan(fs.statSync(outFull).size);
    });

    it('ZIP: exclude removes dot-files from archive', async () => {
        const out = path.join(outDir, 'no-dotfiles.zip');
        await zip(tmp, out, {exclude: ['**/.*', '**/.*/**']});
        expect(fs.existsSync(out)).toBe(true);
        expect(fs.statSync(out).size).toBeGreaterThan(0);
    });

    it('ZIP: exclude by extension', async () => {
        const out = path.join(outDir, 'no-js.zip');
        await zip(tmp, out, {exclude: ['**/*.js']});
        expect(fs.existsSync(out)).toBe(true);
    });

    it('ZIP: exclude empty array is a no-op', async () => {
        const out = path.join(outDir, 'excl-empty.zip');
        await zip(tmp, out, {exclude: []});
        const outFull = path.join(outDir, 'full.zip');
        // Should be the same size as an archive with no exclude option
        expect(fs.statSync(out).size).toBe(fs.statSync(outFull).size);
    });

    it('TGZ: exclude removes directories and their contents', async () => {
        const out = path.join(outDir, 'excl-dir.tgz');
        await tar(tmp, out, {exclude: ['dist/**', 'dist/', 'node_modules/**', 'node_modules/']});

        expect(fs.existsSync(out)).toBe(true);
        const outFull = path.join(outDir, 'full.tgz');
        await tar(tmp, outFull);
        expect(fs.statSync(out).size).toBeLessThan(fs.statSync(outFull).size);
    });

    it('TGZ: exclude dot-files', async () => {
        const out = path.join(outDir, 'no-dotfiles.tgz');
        await tar(tmp, out, {exclude: ['**/.*', '**/.*/**']});
        expect(fs.existsSync(out)).toBe(true);
        expect(fs.statSync(out).size).toBeGreaterThan(0);
    });
});
