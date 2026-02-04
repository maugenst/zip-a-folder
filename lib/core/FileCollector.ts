// src/core/FileCollector.ts
import * as fs from 'fs';
import * as path from 'path';
import {FileEntry} from './types';
import {globSync} from 'tinyglobby';

/**
 * Recursively collect entries (files + directories) under a directory,
 * using a worker pool limited by statConcurrency.
 *
 * - The root directory itself is NOT returned as an entry.
 * - Directory entries have relativePath ending with "/".
 */
export async function collectEntriesFromDirectory(rootDir: string, statConcurrency = 4): Promise<FileEntry[]> {
    const root = path.resolve(rootDir);
    const entries: FileEntry[] = [];

    const dirQueue: {fsPath: string; relPath: string}[] = [{fsPath: root, relPath: ''}];

    statConcurrency = Math.max(1, statConcurrency | 0);

    const worker = async () => {
        while (true) {
            const item = dirQueue.shift();
            if (!item) {
                break;
            }

            const dirents = await fs.promises.readdir(item.fsPath, {withFileTypes: true});

            for (const d of dirents) {
                const childFsPath = path.join(item.fsPath, d.name);
                const rel = item.relPath ? path.posix.join(item.relPath, d.name) : d.name;

                const stat = await fs.promises.stat(childFsPath);

                if (d.isDirectory()) {
                    /* istanbul ignore next */
                    const relDirPath = rel.endsWith('/') ? rel : rel + '/';
                    entries.push({
                        fsPath: childFsPath,
                        relativePath: relDirPath.replace(/\\/g, '/'),
                        isDirectory: true,
                        stat
                    });
                    dirQueue.push({fsPath: childFsPath, relPath: rel});
                } else if (d.isFile()) {
                    entries.push({
                        fsPath: childFsPath,
                        relativePath: rel.replace(/\\/g, '/'),
                        isDirectory: false,
                        stat
                    });
                }
                // symlinks / others ignored
            }
        }
    };

    const workers = Array.from({length: statConcurrency}, () => worker());
    await Promise.all(workers);
    return entries;
}

/**
 * Collect file entries from one or more glob patterns, relative to a given cwd.
 *
 * - Uses the "glob" package.
 * - Only files are returned (no explicit directory entries).
 * - Returns [] when there is no match (caller will throw "No glob match found").
 */
export async function collectGlobEntries(patterns: string, cwd: string, statConcurrency = 4): Promise<FileEntry[]> {
    const patternList = patterns
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

    const matchedRelPaths = new Set<string>();

    for (const pattern of patternList) {
        try {
            // Use synchronous glob to be compatible with older glob versions.
            const matches = globSync(pattern, {
                cwd,
                onlyFiles: true,
                dot: false,
            });

            for (const rel of matches) {
                matchedRelPaths.add(rel.replace(/\\/g, '/'));
            }
        } catch {
            /* istanbul ignore next */
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

    // Parallelize fs.stat over matches
    const worker = async () => {
        while (true) {
            const i = index++;
            if (i >= relPaths.length) {
                break;
            }

            const rel = relPaths[i];
            const abs = path.resolve(cwd, rel);
            const stat = await fs.promises.stat(abs);
            /* istanbul ignore next */
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
