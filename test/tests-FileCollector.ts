import {describe, expect, it} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {collectEntriesFromDirectory, collectGlobEntries} from '../lib/core/FileCollector';

function makeTmpDir(prefix: string) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('FileCollector', () => {
    it('collectEntriesFromDirectory: returns files and directories (with trailing slash), normalizes separators, ignores symlinks', async () => {
        const tmp = makeTmpDir('fc-test-');
        try {
            // Create structure:
            // tmp/
            //   a/ (dir)
            //     a1.txt (file)
            //   b.txt (file)
            //   b/ (dir)
            //     c/ (dir)
            //       c1.txt (file)
            //   link -> b.txt (symlink)
            const dirA = path.join(tmp, 'a');
            const dirB = path.join(tmp, 'b');
            const dirC = path.join(dirB, 'c');
            fs.mkdirSync(dirA);
            fs.mkdirSync(dirB);
            fs.mkdirSync(dirC);

            const fileA1 = path.join(dirA, 'a1.txt');
            const fileB = path.join(tmp, 'b.txt');
            const fileC1 = path.join(dirC, 'c1.txt');
            fs.writeFileSync(fileA1, 'a1');
            fs.writeFileSync(fileB, 'b');
            fs.writeFileSync(fileC1, 'c1');

            // Create a symlink that should be ignored
            const linkPath = path.join(tmp, 'link');
            try {
                fs.symlinkSync(fileB, linkPath);
            } catch {
                // On some file systems, symlink may not be permitted. Ignore.
            }

            const entries = await collectEntriesFromDirectory(tmp, 2);
            // Root dir itself is NOT included; only children and their descendants.
            // Expect: a/ (dir), a/a1.txt (file), b.txt (file), b/ (dir), b/c/ (dir), b/c/c1.txt (file)
            const names = entries.map((e) => e.relativePath).sort();

            expect(names).toEqual(['a/', 'a/a1.txt', 'b.txt', 'b/', 'b/c/', 'b/c/c1.txt']);

            // Directory entries should have trailing slash and isDirectory true
            const dirEntries = entries.filter((e) => e.isDirectory);
            for (const d of dirEntries) {
                expect(d.relativePath.endsWith('/')).toBe(true);
            }

            // No symlink entry present
            expect(names.includes('link')).toBe(false);

            // All paths should use forward slashes (POSIX)
            for (const e of entries) {
                expect(e.relativePath.includes('\\')).toBe(false);
            }
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });

    it('collectGlobEntries: respects patterns, returns files only, no-match yields empty array', async () => {
        const tmp = makeTmpDir('fc-glob-');
        try {
            // Create files and dirs
            const dir = path.join(tmp, 'd');
            fs.mkdirSync(dir);
            const f1 = path.join(tmp, 'one.txt');
            const f2 = path.join(tmp, 'two.md');
            const f3 = path.join(dir, 'inner.txt');
            const hidden = path.join(tmp, '.hidden.txt');
            fs.writeFileSync(f1, '1');
            fs.writeFileSync(f2, '2');
            fs.writeFileSync(f3, '3');
            fs.writeFileSync(hidden, 'h');

            // Pattern list tests: comma-separated
            const entriesTxt = await collectGlobEntries('*.txt, d/*.txt', tmp, 2);
            const relsTxt = entriesTxt.map((e) => e.relativePath).sort();
            // glob is configured with dot:false, so .hidden.txt should be excluded
            expect(relsTxt).toEqual(['d/inner.txt', 'one.txt']);
            // Should not include directory entries
            for (const e of entriesTxt) {
                expect(e.isDirectory).toBe(false);
            }

            // No matches returns []
            const none = await collectGlobEntries('nope-*.xyz', tmp, 2);
            expect(none).toEqual([]);
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });

    it('collectGlobEntries: handles malformed glob patterns gracefully (catch path)', async () => {
        const tmp = makeTmpDir('fc-glob-bad-');
        try {
            // Malformed pattern that should cause glob.sync to throw
            const bad = await collectGlobEntries('[', tmp, 2);
            expect(bad).toEqual([]);
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });

    it('collectEntriesFromDirectory: normalizes non-positive statConcurrency to 1', async () => {
        const tmp = makeTmpDir('fc-conc-dir-');
        try {
            fs.mkdirSync(path.join(tmp, 'x'));
            fs.writeFileSync(path.join(tmp, 'x', 'f.txt'), 'f');
            const entries = await collectEntriesFromDirectory(tmp, 0);
            const names = entries.map((e) => e.relativePath).sort();
            expect(names).toEqual(['x/', 'x/f.txt']);
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });

    it('collectGlobEntries: normalizes non-positive statConcurrency to 1', async () => {
        const tmp = makeTmpDir('fc-conc-glob-');
        try {
            fs.writeFileSync(path.join(tmp, 'a.txt'), 'a');
            fs.writeFileSync(path.join(tmp, 'b.txt'), 'b');
            const entries = await collectGlobEntries('*.txt', tmp, 0);
            const rels = entries.map((e) => e.relativePath).sort();
            expect(rels).toEqual(['a.txt', 'b.txt']);
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });
});
