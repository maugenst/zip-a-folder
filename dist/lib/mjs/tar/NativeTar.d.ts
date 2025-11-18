import { FileEntry } from '../core/types';
export declare class NativeTar {
    private stream;
    constructor(stream: NodeJS.WritableStream);
    addDirectory(entry: FileEntry): Promise<void>;
    addFile(entry: FileEntry): Promise<void>;
    finalize(): Promise<void>;
}
