import { z } from 'zod';
const envSchema = z.object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    JWT_SECRET: z.string().min(1),
    PORT: z.coerce.number().default(3001),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
});
function loadEnv() {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
        console.error('Environment validation failed:', result.error.flatten());
        process.exit(1);
    }
    return result.data;
}
export const env = loadEnv();
//# sourceMappingURL=env.js.map