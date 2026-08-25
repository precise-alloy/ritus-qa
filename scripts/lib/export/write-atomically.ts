import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

function toError(action: string, targetPath: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(`Failed to ${action} ${targetPath}: ${detail}`);
}

export async function writeAtomically(targetPath: string, content: Uint8Array): Promise<void> {
  const parentPath = dirname(targetPath);
  const tempPath = join(parentPath, `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  let tempPendingCleanup = false;

  try {
    try {
      await mkdir(parentPath, { recursive: true });
    } catch (error) {
      throw toError('create parent directory for', targetPath, error);
    }

    try {
      tempPendingCleanup = true;
      await writeFile(tempPath, content);
    } catch (error) {
      throw toError('write temporary file for', targetPath, error);
    }

    try {
      await rename(tempPath, targetPath);
      tempPendingCleanup = false;
    } catch (error) {
      throw toError('replace', targetPath, error);
    }
  } finally {
    if (tempPendingCleanup) {
      try {
        await unlink(tempPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // Best-effort cleanup only; preserve the original write/rename failure.
        }
      }
    }
  }
}
