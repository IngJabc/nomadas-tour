import { RequestContext } from '../types/index.js';
export declare function signToken(ctx: Omit<RequestContext, 'tenantId'> & {
    tenantId?: string | null;
}): string;
//# sourceMappingURL=jwt.d.ts.map