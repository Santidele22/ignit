import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

const ENV_FILES = ['.env.local', '.env'] as const;

export function loadEnv(
  cwd: string = process.cwd(),
  processEnv: NodeJS.ProcessEnv = process.env,
): string[] {
  const loaded: string[] = [];

  for (const file of ENV_FILES) {
    const filePath = resolve(cwd, file);
    if (!existsSync(filePath)) {
      continue;
    }

    dotenv.config({ path: filePath, processEnv, quiet: true });
    loaded.push(filePath);
  }

  return loaded;
}
