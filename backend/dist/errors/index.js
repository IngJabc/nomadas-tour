export class AppError extends Error {
    statusCode;
    code;
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = this.constructor.name;
    }
}
export class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
        super(message, 404, 'NOT_FOUND');
    }
}
export class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
        super(message, 401, 'UNAUTHORIZED');
    }
}
export class ForbiddenError extends AppError {
    constructor(message = 'Forbidden') {
        super(message, 403, 'FORBIDDEN');
    }
}
export class ConflictError extends AppError {
    constructor(message = 'Conflict') {
        super(message, 409, 'CONFLICT');
    }
}
export class ValidationError extends AppError {
    details;
    constructor(message = 'Validation failed', details) {
        super(message, 400, 'VALIDATION_ERROR');
        this.details = details;
    }
}
//# sourceMappingURL=index.js.map