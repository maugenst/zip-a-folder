// src/core/FileCollector.ts
import * as fs from 'fs';
import * as path from 'path';
import {globSync} from 'tinyglobby';
import {FileEntry} from './types';

/**
 * Recursively collect entries (files + directories) under a directory,
 * using a worker pool limited by statConcurrency.
 *
 * - The root directory itself is NOT returned as an entry.
 * - Directory entries have relativePath ending with "/".
 * - Entries matching any pattern in `exclude` are omitted (along with their children).
 */
export async function collectEntriesFromDirectory(
    rootDir: string,
    statConcurrency = 4,
    exclude?: string[]
): Promise<FileEntry[]> {
    const root = path.resolve(rootDir);
    const entries: FileEntry[] = [];

    // Use tinyglobby to enumerate all paths (files + dirs), respecting the
    // exclude list via the built-in `ignore` option.
    //
    // followSymbolicLinks: false prevents tinyglobby from descending into a
    // symlinked directory inside the tree (which would otherwise enumerate the
    // link target's files under the link's name, e.g. "linkdir/secret.txt").
    // A symlink that is itself listed as an entry is additionally dropped by the
    // lstat check in the worker below.
    const relPaths = globSync('**/*', {
        cwd: root,
        onlyFiles: false,
        dot: true,
        followSymbolicLinks: false,
        ignore: exclude
    });

    statConcurrency = Math.max(1, statConcurrency | 0);
    let index = 0;

    const worker = async () => {
        while (true) {
            const i = index++;
            if (i >= relPaths.length) {
                break;
            }

            const rel = relPaths[i];
            const fsPath = path.join(root, rel);
            const stat = await fs.promises.lstat(fsPath);

            // Defense-in-depth: skip any symlink. With followSymbolicLinks:false
            // above, tinyglobby already drops symlinks from the listing, so this
            // only fires if one races in between enumeration and lstat (TOCTOU).
            /* v8 ignore next 3 */
            if (stat.isSymbolicLink()) {
                continue;
            }

            if (stat.isDirectory()) {
                /* v8 ignore next */
                const relDirPath = rel.endsWith('/') ? rel : rel + '/';
                entries.push({
                    fsPath,
                    relativePath: relDirPath.replace(/\\/g, '/'),
                    isDirectory: true,
                    stat
                });
            } else {
                /* v8 ignore else */
                if (stat.isFile()) {
                    entries.push({
                        fsPath,
                        relativePath: rel.replace(/\\/g, '/'),
                        isDirectory: false,
                        stat
                    });
                }
            }
            // other special files ignored
        }
    };

    const workers = Array.from({length: statConcurrency}, () => worker());
    await Promise.all(workers);
    return entries;
}

/** Regex matching a ".." path segment (POSIX-normalized). */
const RE_DOTDOT = /(^|\/)\.\.(\/|$)/;

/**
 * Assert that an absolute resolved path is strictly inside the given root.
 * Throws if the path equals the root itself or escapes it.
 *
 * Exported with an underscore prefix for unit testing only — not part of the
 * public API and may change without notice.
 */
export function _assertInsideCwd(abs: string, root: string, rel: string): void {
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (abs !== root && !abs.startsWith(prefix)) {
        throw new Error(`Matched file escapes the working directory: "${rel}"`);
    }
}

/**
 * Collect file entries from one or more glob patterns, relative to a given cwd.
 *
 * - Uses the "tinyglobby" package.
 * - Only files are returned (no explicit directory entries).
 * - Returns [] when there is no match (caller will throw "No glob match found").
 * - Throws if any pattern is absolute or contains ".." segments, or if a
 *   matched file resolves outside cwd.
 */
export async function collectGlobEntries(
    patterns: string,
    cwd: string,
    statConcurrency = 4,
    exclude?: string[]
): Promise<FileEntry[]> {
    const patternList = patterns
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

    const matchedRelPaths = new Set<string>();

    for (const pattern of patternList) {
        // Guard: reject patterns that escape cwd. Must run BEFORE the try/catch
        // below, which swallows all errors (so a throw inside would be lost).
        if (path.isAbsolute(pattern)) {
            throw new Error(
                `Glob pattern escapes the working directory: "${pattern}" (absolute paths are not allowed)`
            );
        }
        if (RE_DOTDOT.test(pattern.replace(/\\/g, '/'))) {
            throw new Error(`Glob pattern escapes the working directory: "${pattern}" (.. segments are not allowed)`);
        }

        try {
            const matches = globSync(pattern, {
                cwd,
                onlyFiles: true,
                dot: false,
                followSymbolicLinks: false,
                ignore: exclude
            });

            for (const rel of matches) {
                matchedRelPaths.add(rel.replace(/\\/g, '/'));
            }
            /* v8 ignore next 4 */
        } catch {
            // Ignore glob internal errors; if nothing matches overall,
            // caller will throw "No glob match found".
        }
    }

    const relPaths = Array.from(matchedRelPaths);
    if (relPaths.length === 0) {
        return [];
    }

    const entries: FileEntry[] = [];
    let index = 0;
    statConcurrency = Math.max(1, statConcurrency | 0);
    const root = path.resolve(cwd);

    // Parallelize fs.stat over matches
    const worker = async () => {
        while (true) {
            const i = index++;
            if (i >= relPaths.length) {
                break;
            }

            const rel = relPaths[i];
            const abs = path.resolve(cwd, rel);

            // Defensive containment check: reject any match that resolves outside cwd.
            _assertInsideCwd(abs, root, rel);

            // Use lstat (not stat) so a symlinked match is detected and skipped
            // rather than followed. Combined with followSymbolicLinks: false on
            // the glob, this prevents archiving files outside the source tree via
            // a symlinked file or a symlinked parent directory. tinyglobby already
            // drops symlinks from the listing, so these guards are defense-in-depth
            // (e.g. a symlink racing in between glob and lstat — TOCTOU).
            const stat = await fs.promises.lstat(abs);
            /* v8 ignore next 3 */
            if (stat.isSymbolicLink()) {
                continue;
            }
            /* v8 ignore next 3 */
            if (!stat.isFile()) {
                continue;
            }

            entries.push({
                fsPath: abs,
                relativePath: rel, // already POSIX-style from glob
                isDirectory: false,
                stat
            });
        }
    };

    const workers = Array.from({length: statConcurrency}, () => worker());
    await Promise.all(workers);

    return entries;
}
