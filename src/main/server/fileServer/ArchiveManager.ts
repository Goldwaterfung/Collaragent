import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { pipeline } from 'stream/promises';

export class ArchiveManager {
  /**
   * Unzips the source .cagent file to a unique temp directory.
   * If source doesn't exist, creates an empty scaffold in temp.
   * returns the path to the temp directory.
   * Note: Refactored to use yauzl for streaming extraction.
   */
  public async mount(sourceCagentPath: string, destDir?: string): Promise<string> {
    const isTemp = !destDir;
    const sessionId = uuidv4();
    const tempDir = destDir || path.join(os.tmpdir(), 'collaragent', sessionId);
    
    // Only force clean if it's a temp dir. If the user provided a destDir and it exists, assume we want to overwrite/merge into it (yauzl pipeline overwrites files).
    if (isTemp && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    if (fs.existsSync(sourceCagentPath)) {
      await new Promise<void>((resolve, reject) => {
        yauzl.open(sourceCagentPath, { lazyEntries: true }, (err, zipfile) => {
          if (err) return reject(err);
          if (!zipfile) return reject(new Error('Failed to open zip file'));

          zipfile.readEntry();
          zipfile.on('entry', (entry) => {
            const fileName = entry.fileName;
            const destPath = path.join(tempDir, fileName);

            if (/\/$/.test(fileName)) {
              // Directory entry
              fs.mkdirSync(destPath, { recursive: true });
              zipfile.readEntry();
            } else {
              // File entry
              // Ensure parent directory exists
              fs.mkdirSync(path.dirname(destPath), { recursive: true });
              
              zipfile.openReadStream(entry, (err, readStream) => {
                if (err) return reject(err);
                if (!readStream) return reject(new Error('Failed to open read stream for entry'));

                const writeStream = fs.createWriteStream(destPath);
                readStream.on('end', () => zipfile.readEntry());
                pipeline(readStream, writeStream).catch((err) => {
                  zipfile.close();
                  reject(err);
                });
              });
            }
          });

          zipfile.on('end', () => resolve());
          zipfile.on('error', (err) => reject(err));
        });
      });
      console.log(`[ArchiveManager] Extracted ${sourceCagentPath} to ${tempDir}`);
    } else {
        console.log(`[ArchiveManager] Source file ${sourceCagentPath} does not exist. Created empty temp dir at ${tempDir}`);
    }

    return tempDir;
  }

  /**
   * Compresses the temp directory back to the source .cagent path.
   * Uses an atomic write pattern (write to .tmp, then rename).
   * Note: Refactored to use archiver for streaming compression.
   */
  public async commit(tempPath: string, destCagentPath: string): Promise<void> {
    const tempZipPath = `${destCagentPath}.tmp`;
    const output = fs.createWriteStream(tempZipPath);
    const archive = new ZipArchive({
      zlib: { level: 5 } // Sets the compression level. (Lowered for phase 1 opt)
    });

    return new Promise<void>((resolve, reject) => {
      output.on('close', async () => {
        try {
          // Atomic rename
          await fs.promises.rename(tempZipPath, destCagentPath);
          console.log(`[ArchiveManager] Committed changes to ${destCagentPath} (${archive.pointer()} total bytes)`);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      // append files from a sub-directory, putting its contents at the root of archive
      archive.directory(tempPath, false);

      archive.finalize();
    });
  }

  public cleanup(tempPath: string): void {
      if (fs.existsSync(tempPath)) {
          try {
              fs.rmSync(tempPath, { recursive: true, force: true });
              console.log(`[ArchiveManager] Cleaned up ${tempPath}`);
          } catch (err) {
              console.error(`[ArchiveManager] Failed to cleanup ${tempPath}:`, err);
          }
      }
  }
}

