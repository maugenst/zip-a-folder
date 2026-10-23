import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import {describe, expect, it} from 'vitest';
import {_assertInsideCwd, collectEntriesFromDirectory, collectGlobEntries} from '../lib/core/FileCollector';

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

    it('collectEntriesFromDirectory: skips special files (e.g. Unix sockets)', async () => {
        const tmp = makeTmpDir('fc-socket-');
        try {
            // Create a regular file alongside a Unix socket
            fs.writeFileSync(path.join(tmp, 'regular.txt'), 'hello');

            const sockPath = path.join(tmp, 'test.sock');
            const server = net.createServer();
            await new Promise<void>((resolve) => server.listen(sockPath, resolve));
            server.close();

            const entries = await collectEntriesFromDirectory(tmp, 1);
            const names = entries.map((e) => e.relativePath).sort();

            // Socket should be ignored; only the regular file should appear
            expect(names).toEqual(['regular.txt']);
            expect(names.includes('test.sock')).toBe(false);
        } finally {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });

    describe('collectGlobEntries: cwd escape prevention', () => {
        it('rejects a "../" traversal pattern', async () => {
            const tmp = makeTmpDir('fc-escape-dotdot-');
            try {
                await expect(collectGlobEntries('../*.txt', tmp, 2)).rejects.toThrow(
                    /escapes the working directory/
                );
            } finally {
                fs.rmSync(tmp, {recursive: true, force: true});
            }
        });

        it('rejects a nested "../" traversal pattern', async () => {
            const tmp = makeTmpDir('fc-escape-nested-');
            try {
                await expect(collectGlobEntries('sub/../../*.txt', tmp, 2)).rejects.toThrow(
                    /escapes the working directory/
                );
            } finally {
                fs.rmSync(tmp, {recursive: true, force: true});
            }
        });

        it('rejects an absolute pattern', async () => {
            const tmp = makeTmpDir('fc-escape-abs-');
            try {
                const absPat = path.join(path.dirname(tmp), '*.txt');
                await expect(collectGlobEntries(absPat, tmp, 2)).rejects.toThrow(
                    /escapes the working directory/
                );
            } finally {
                fs.rmSync(tmp, {recursive: true, force: true});
            }
        });

        it('rejects a bad pattern inside a comma-separated list', async () => {
            const tmp = makeTmpDir('fc-escape-comma-');
            try {
                fs.writeFileSync(path.join(tmp, 'a.txt'), 'a');
                await expect(collectGlobEntries('*.txt, ../secret*.txt', tmp, 2)).rejects.toThrow(
                    /escapes the working directory/
                );
            } finally {
                fs.rmSync(tmp, {recursive: true, force: true});
            }
        });

        it('still allows a legitimate in-cwd glob', async () => {
            const tmp = makeTmpDir('fc-escape-ok-');
            try {
                fs.writeFileSync(path.join(tmp, 'a.txt'), 'a');
                fs.writeFileSync(path.join(tmp, 'b.txt'), 'b');
                const entries = await collectGlobEntries('*.txt', tmp, 2);
                const rels = entries.map((e) => e.relativePath).sort();
                expect(rels).toEqual(['a.txt', 'b.txt']);
            } finally {
                fs.rmSync(tmp, {recursive: true, force: true});
            }
        });

        it('still allows subdir globs', async () => {
            const tmp = makeTmpDir('fc-escape-subdir-');
            try {
                const sub = path.join(tmp, 'sub');
                fs.mkdirSync(sub);
                fs.writeFileSync(path.join(sub, 'c.txt'), 'c');
                const entries = await collectGlobEntries('sub/*.txt', tmp, 2);
                const rels = entries.map((e) => e.relativePath).sort();
                expect(rels).toEqual(['sub/c.txt']);
            } finally {
                fs.rmSync(tmp, {recursive: true, force: true});
            }
        });
    });

    describe('_assertInsideCwd (defensive path guard)', () => {
        it('throws when abs resolves outside root', () => {
            const root = '/home/user/app';
            const abs = '/home/user/secrets/db.env';
            expect(() => _assertInsideCwd(abs, root, '../secrets/db.env')).toThrow(
                /Matched file escapes the working directory/
            );
        });

        it('does not throw when abs is directly inside root', () => {
            const root = '/home/user/app';
            const abs = '/home/user/app/file.txt';
            expect(() => _assertInsideCwd(abs, root, 'file.txt')).not.toThrow();
        });

        it('does not throw when abs is inside a subdirectory of root', () => {
            const root = '/home/user/app';
            const abs = '/home/user/app/sub/file.txt';
            expect(() => _assertInsideCwd(abs, root, 'sub/file.txt')).not.toThrow();
        });

        it('does not falsely match a sibling directory with a shared prefix', () => {
            // /home/user/app-extra is NOT inside /home/user/app
            const root = '/home/user/app';
            const abs = '/home/user/app-extra/file.txt';
            expect(() => _assertInsideCwd(abs, root, '../app-extra/file.txt')).toThrow(
                /Matched file escapes the working directory/
            );
        });

        it('handles a root that already ends with path.sep (e.g. filesystem root "/")', () => {
            // root = '/' already has a trailing sep — prefix must not become '//'
            const root = path.sep; // '/' on POSIX
            const abs = path.join(path.sep, 'etc', 'passwd');
            expect(() => _assertInsideCwd(abs, root, 'etc/passwd')).not.toThrow();
        });
    });
});
