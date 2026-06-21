import dotenv from 'dotenv';

const paths = ['.env.real.local', '.env.local', '.env'];

for (const envPath of paths) {
  dotenv.config({ path: envPath, override: false, quiet: true });
}
