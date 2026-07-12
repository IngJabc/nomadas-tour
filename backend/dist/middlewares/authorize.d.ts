import { Request, Response, NextFunction } from 'express';
import { Role } from '../types/index.js';
export declare function authorize(...allowedRoles: Role[]): (req: Request, _res: Response, next: NextFunction) => void;
//# sourceMappingURL=authorize.d.ts.map