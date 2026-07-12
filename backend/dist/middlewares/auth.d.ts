import { Request, Response, NextFunction } from 'express';
import { RequestContext } from '../types/index.js';
declare global {
    namespace Express {
        interface Request {
            ctx?: RequestContext;
        }
    }
}
export declare function auth(req: Request, _res: Response, next: NextFunction): Promise<void>;
export declare function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=auth.d.ts.map