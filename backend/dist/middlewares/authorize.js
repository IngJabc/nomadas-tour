import { ForbiddenError } from '../errors/index.js';
export function authorize(...allowedRoles) {
    return (req, _res, next) => {
        if (!req.ctx) {
            throw new ForbiddenError('Authentication required');
        }
        if (!allowedRoles.includes(req.ctx.role)) {
            throw new ForbiddenError('Insufficient permissions');
        }
        next();
    };
}
//# sourceMappingURL=authorize.js.map