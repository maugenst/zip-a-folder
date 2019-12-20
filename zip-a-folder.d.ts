declare module 'zip-a-folder' {
  export function zip(srcFolder: string, zipFilePath: string): Promise<void | Error>;
  export function zipFolder(srcFolder: string, zipFilePath: string, callback: (error?: Error) => void) : void;
}
