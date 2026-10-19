import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/features/auth/AuthContext';
import { ApiError } from '@/lib/api-client';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { login, user, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (status === 'authenticated' && user) return <Navigate to={from} replace />;

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      await login(values.email, values.password);
      navigate(from, { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setServerError('Incorrect email or password.');
        else if (e.isNotImplemented) setServerError('The sign-in service is not available yet on the backend.');
        else setServerError(e.message);
      } else {
        setServerError('Sign-in failed. Please try again.');
      }
    }
  };

  return (
    <div className="cs-auth">
      <div className="cs-card cs-auth-card">
        <div className="text-center mb-4">
          <img className="cs-login-wordmark mb-3" src="/cloudsphere-logo.png" alt="CloudSphere" />
          <h1 className="h4 mb-1">Sign in to CloudSphere</h1>
          <p className="text-muted small mb-0">Academic cloud-management simulation</p>
          {import.meta.env.DEV && <p className="small text-muted mt-2 mb-0">Demo account: <strong>alice@acme.test</strong> · password <strong>Demo@12345</strong></p>}
        </div>

        {serverError && <div className="alert alert-danger py-2 small" role="alert">{serverError}</div>}

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="mb-3">
            <label htmlFor="email" className="form-label">Email</label>
            <input id="email" type="email" autoComplete="username" className={`form-control ${errors.email ? 'is-invalid' : ''}`} aria-describedby="email-error" {...register('email')} />
            <div id="email-error" className="invalid-feedback">{errors.email?.message}</div>
          </div>
          <div className="mb-4">
            <label htmlFor="password" className="form-label">Password</label>
            <input id="password" type="password" autoComplete="current-password" className={`form-control ${errors.password ? 'is-invalid' : ''}`} aria-describedby="password-error" {...register('password')} />
            <div id="password-error" className="invalid-feedback">{errors.password?.message}</div>
          </div>
          <button type="submit" className="btn btn-primary w-100" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
