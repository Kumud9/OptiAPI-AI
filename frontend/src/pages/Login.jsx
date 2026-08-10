import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Zap, Mail, Lock, ArrowRight, Loader2 } from 'lucide-react';

const Login = () => {
  const { login } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      addToast('Please enter both email and password', 'warning');
      return;
    }

    setLoading(true);
    const result = await login(email, password);
    setLoading(false);

    if (result.success) {
      addToast('Logged in successfully!', 'success');
      navigate('/dashboard');
    } else {
      addToast(result.error, 'error');
    }
  };

  return (
    <div className="bg-background min-h-screen text-zinc-100 flex flex-col justify-center items-center p-6 relative overflow-hidden bg-grid-pattern">
      {/* Decorative Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-3xl -z-10 animate-pulse" />

      {/* Logo */}
      <Link to="/" className="flex items-center gap-2 mb-8 text-xl font-bold tracking-tight">
        <Zap className="text-primary h-6 w-6" />
        <span>OptiAPI <span className="text-primary">AI</span></span>
      </Link>

      {/* Form Container */}
      <div className="w-full max-w-md p-8 rounded-2xl border border-zinc-800 bg-zinc-950/80 backdrop-blur-md shadow-2xl">
        <h2 className="text-2xl font-bold mb-1 tracking-tight text-center">Welcome back</h2>
        <p className="text-xs text-zinc-500 mb-6 text-center">Sign in to your cost optimization console</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Email Address</label>
            <div className="relative">
              <Mail className="absolute top-3 left-3 text-zinc-500 h-4 w-4" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                disabled={loading}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-semibold text-zinc-400">Password</label>
              <Link to="/forgot-password" className="text-[10px] font-medium text-primary hover:text-primary-light transition-colors">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute top-3 left-3 text-zinc-500 h-4 w-4" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                disabled={loading}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary-dark disabled:bg-primary/50 text-white rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 shadow-glow-blue mt-6 transition-all"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Verifying Credentials...
              </>
            ) : (
              <>
                Sign In <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-zinc-500">
          New to OptiAPI?{' '}
          <Link to="/register" className="text-primary font-semibold hover:underline">
            Create an account free
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
