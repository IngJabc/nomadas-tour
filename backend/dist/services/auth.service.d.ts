export declare class AuthService {
    login(email: string, password: string): Promise<{
        token: string;
        user: any;
    }>;
    validateInvitation(token: string): Promise<{
        agency_name: any;
        email: any;
    }>;
    acceptInvitation(token: string, password: string): Promise<{
        token: string;
        user: {
            id: string;
            email: any;
            role: string;
            agency_id: any;
        };
    }>;
}
export declare const authService: AuthService;
//# sourceMappingURL=auth.service.d.ts.map