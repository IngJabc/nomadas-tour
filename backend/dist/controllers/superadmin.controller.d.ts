import { Request, Response, NextFunction } from "express";
export declare class SuperadminController {
    listAgencies(req: Request, res: Response, next: NextFunction): Promise<void>;
    getAgency(req: Request, res: Response, next: NextFunction): Promise<void>;
    createAgency(req: Request, res: Response, next: NextFunction): Promise<void>;
    updateAgency(req: Request, res: Response, next: NextFunction): Promise<void>;
    listRoutes(req: Request, res: Response, next: NextFunction): Promise<void>;
    createRoute(req: Request, res: Response, next: NextFunction): Promise<void>;
    updateRoute(req: Request, res: Response, next: NextFunction): Promise<void>;
    deleteRoute(req: Request, res: Response, next: NextFunction): Promise<void>;
    updateTrip(req: Request, res: Response, next: NextFunction): Promise<void>;
    createTrip(req: Request, res: Response, next: NextFunction): Promise<void>;
    listTrips(req: Request, res: Response, next: NextFunction): Promise<void>;
    getTrip(req: Request, res: Response, next: NextFunction): Promise<void>;
    deleteTrip(req: Request, res: Response, next: NextFunction): Promise<void>;
    updateTripStatus(req: Request, res: Response, next: NextFunction): Promise<void>;
    listInvitations(req: Request, res: Response, next: NextFunction): Promise<void>;
    getDashboard(req: Request, res: Response, next: NextFunction): Promise<void>;
}
export declare const superadminController: SuperadminController;
//# sourceMappingURL=superadmin.controller.d.ts.map