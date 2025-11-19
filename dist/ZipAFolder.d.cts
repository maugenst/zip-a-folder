import * as zlib0 from "zlib";
import * as fs from "fs";

//#region lib/core/types.d.ts
declare enum COMPRESSION_LEVEL {
  uncompressed = 0,
  medium = 1,
  high = 2,
}
type CoreOptions = {
  statConcurrency?: number;
};
type ZipArchiveOptions = CoreOptions & {
  comment?: string;
  forceLocalTime?: boolean;
  forceZip64?: boolean;
  namePrependSlash?: boolean;
  store?: boolean;
  zlib?: zlib0.ZlibOptions;
  customWriteStream?: fs.WriteStream;
  destPath?: string;
  compression?: COMPRESSION_LEVEL;
};
type TarArchiveOptions = CoreOptions & {
  gzip?: boolean;
  gzipOptions?: zlib0.ZlibOptions;
  customWriteStream?: fs.WriteStream;
  compression?: COMPRESSION_LEVEL;
};
//#endregion
//#region lib/ZipAFolder.d.ts
declare class ZipAFolder {
  static zip(source: string, targetFilePath?: string, options?: ZipArchiveOptions): Promise<void>;
  static tar(source: string, targetFilePath?: string, options?: TarArchiveOptions): Promise<void>;
}
declare function zip(source: string, targetFilePath?: string, options?: ZipArchiveOptions): Promise<void>;
declare function tar(source: string, targetFilePath?: string, options?: TarArchiveOptions): Promise<void>;
//#endregion
export { COMPRESSION_LEVEL, type TarArchiveOptions, ZipAFolder, type ZipArchiveOptions, tar, zip };