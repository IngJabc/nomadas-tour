import { supabase } from '../config/database.js';
import { UnauthorizedError } from '../errors/index.js';
function extractContext(user) {
    return {
        userId: user.id,
        role: user.user_metadata?.role,
        agencyId: user.user_metadata?.agency_id ?? null,
    };
}
export async function auth(req, _res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        throw new UnauthorizedError('Missing or invalid authorization header');
    }
    const token = header.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        throw new UnauthorizedError('Invalid or expired token');
    }
    req.ctx = extractContext(user);
    next();
}
export async function optionalAuth(req, _res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        next();
        return;
    }
    const token = header.slice(7);
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) {
        req.ctx = extractContext(user);
    }
    next();
}
//# sourceMappingURL=auth.js.map