import { FileEntry } from './types';
export declare function collectEntriesFromDirectory(rootDir: string, statConcurrency?: number): Promise<FileEntry[]>;
export declare function collectGlobEntries(patterns: string, cwd: string, statConcurrency?: number): Promise<FileEntry[]>;
