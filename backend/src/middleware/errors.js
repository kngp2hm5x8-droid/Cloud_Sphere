export function notFound(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
}

// Express recognises error handlers by their 4-argument signature.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const mapped = {
    CS001: [409, 'CAPACITY_EXCEEDED', 'No eligible host has enough available capacity.'],
    CS002: [409, 'QUOTA_EXCEEDED', 'The request exceeds the available quota.'],
    CS003: [422, 'INVALID_REQUEST', 'The request is invalid.'],
    CS004: [409, 'INVALID_STATE', 'The requested state change is not allowed.'],
    CS005: [409, 'BUDGET_EXCEEDED', 'The request exceeds the available budget.'],
    CS006: [404, 'NOT_FOUND', 'Resource not found.'],
    '23505': [409, 'CONFLICT', 'A resource with those details already exists.'],
    '23503': [409, 'CONFLICT', 'The request conflicts with an existing resource.'],
  }[err.code];
  const status = err.status ?? mapped?.[0] ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: {
      code: mapped?.[1] ?? err.publicCode ?? (status >= 500 ? 'INTERNAL_ERROR' : (err.code?.startsWith('CS') ? err.code : 'BAD_REQUEST')),
      message: status >= 500 ? 'Internal server error' : (mapped?.[2] ?? err.message),
    },
  });
}
