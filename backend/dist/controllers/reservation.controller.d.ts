import { Request, Response, NextFunction } from 'express';
export declare class ReservationController {
    listTrips(req: Request, res: Response, next: NextFunction): Promise<void>;
    getTripWithSeats(req: Request, res: Response, next: NextFunction): Promise<void>;
    getAvailableAgencies(req: Request, res: Response, next: NextFunction): Promise<void>;
    createReservation(req: Request, res: Response, next: NextFunction): Promise<void>;
    cancelReservation(req: Request, res: Response, next: NextFunction): Promise<void>;
    boardPassenger(req: Request, res: Response, next: NextFunction): Promise<void>;
    createAgencyReservation(req: Request, res: Response, next: NextFunction): Promise<void>;
    getAgencyTripById(req: Request, res: Response, next: NextFunction): Promise<void>;
    getAgencyReservations(req: Request, res: Response, next: NextFunction): Promise<void>;
    getAgencyReservationById(req: Request, res: Response, next: NextFunction): Promise<void>;
    cancelAgencyReservation(req: Request, res: Response, next: NextFunction): Promise<void>;
    cancelUserReservation(req: Request, res: Response, next: NextFunction): Promise<void>;
    getUserReservations(req: Request, res: Response, next: NextFunction): Promise<void>;
    getAllReservations(req: Request, res: Response, next: NextFunction): Promise<void>;
    getAgencyTrips(req: Request, res: Response, next: NextFunction): Promise<void>;
    lookupReservation(req: Request, res: Response, next: NextFunction): Promise<void>;
    boardPassengers(req: Request, res: Response, next: NextFunction): Promise<void>;
    lockSeat(req: Request, res: Response, next: NextFunction): Promise<void>;
    unlockSeat(req: Request, res: Response, next: NextFunction): Promise<void>;
    unlockAllSeats(req: Request, res: Response, next: NextFunction): Promise<void>;
    releaseExpiredLocks(req: Request, res: Response, next: NextFunction): Promise<void>;
    getAgencyDashboard(req: Request, res: Response, next: NextFunction): Promise<void>;
}
export declare const reservationController: ReservationController;
//# sourceMappingURL=reservation.controller.d.ts.map