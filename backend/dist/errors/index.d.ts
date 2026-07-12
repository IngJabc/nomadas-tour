export declare class AppError extends Error {
    statusCode: number;
    code: string;
    constructor(message: string, statusCode?: number, code?: string);
}
export declare class NotFoundError extends AppError {
    constructor(message?: string);
}
export declare class UnauthorizedError extends AppError {
    constructor(message?: string);
}
export declare class ForbiddenError extends AppError {
    constructor(message?: string);
}
export declare class ConflictError extends AppError {
    constructor(message?: string);
}
export declare class ValidationError extends AppError {
    details?: unknown | undefined;
    constructor(message?: string, details?: unknown | undefined);
}
//# sourceMappingURL=index.d.ts.map