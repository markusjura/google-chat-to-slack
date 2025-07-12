import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
});

const parsedConfig = configSchema.safeParse(process.env);

if (!parsedConfig.success) {
  console.error(
    'Invalid environment variables:',
    parsedConfig.error.flatten().fieldErrors
  );
  throw new Error('Invalid environment variables.');
}

export const config = parsedConfig.data;
