import { AppError } from '../errors/index.js';
export function errorHandler(err, _req, res, _next) {
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            error: {
                code: err.code,
                message: err.message,
                details: 'details' in err ? err.details : undefined,
            },
        });
        return;
    }
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
        },
    });
}
//# sourceMappingURL=error-handler.js.map