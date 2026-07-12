export declare class SuperadminService {
    listAgencies(): Promise<any[]>;
    getAgency(id: string): Promise<any>;
    createAgency(name: string, email: string, createdBy: string): Promise<any>;
    updateAgency(id: string, updates: {
        name?: string;
        status?: string;
    }): Promise<any>;
    listRoutes(): Promise<any[]>;
    createRoute(origin: string, destination: string): Promise<any>;
    updateRoute(id: string, updates: {
        origin?: string;
        destination?: string;
    }): Promise<any>;
    deleteRoute(id: string): Promise<void>;
    autoCompleteExpiredTrips(): Promise<void>;
    private readonly VEHICLE_CONFIG;
    createTrip(routeId: string, departureTime: string, vehicleType: 'bus' | 'kia', agencyIds: string[], createdBy: string): Promise<any>;
    listTrips(): Promise<any[]>;
    getTrip(id: string): Promise<any>;
    updateTrip(id: string, routeId: string, departureTime: string, vehicleType: 'bus' | 'kia', agencyIds: string[]): Promise<any>;
    deleteTrip(id: string): Promise<void>;
    updateTripStatus(id: string, status: 'completed' | 'cancelled'): Promise<{
        id: string;
        status: "cancelled" | "completed";
    }>;
    listInvitations(): Promise<any[]>;
    getDashboard(): Promise<{
        total_agencies: number;
        active_agencies: number;
        total_trips: number;
        active_trips: number;
        total_routes: number;
        total_reservations: number;
        today_reservations: number;
        pending_boarding_passengers: number;
        upcoming_trips: any[];
        recent_activity: any[];
        reservations_by_date: {
            date: string;
            count: number;
        }[];
        occupancy_by_trip: any[];
    }>;
}
export declare const superadminService: SuperadminService;
//# sourceMappingURL=superadmin.service.d.ts.map