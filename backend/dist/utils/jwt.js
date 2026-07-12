import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
export function signToken(ctx) {
    return jwt.sign(ctx, env.JWT_SECRET, { expiresIn: '7d' });
}
//# sourceMappingURL=jwt.js.map