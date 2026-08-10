import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../context/ToastContext';
import { Zap, Mail, ArrowLeft, Loader2, CheckCircle } from 'lucide-react';

const ForgotPassword = () => {
  const { addToast } = useToast();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) {
      addToast('Please enter your email address', 'warning');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/forgot-password', { email });
      setLoading(false);
      if (response.data.success) {
        setSubmitted(true);
        addToast('Recovery instructions sent!', 'success');
      }
    } catch (error) {
      setLoading(false);
      addToast(error.response?.data?.error || 'Failed to request password reset', 'error');
    }
  };

  return (
    <div className="bg-background min-h-screen text-zinc-100 flex flex-col justify-center items-center p-6 relative overflow-hidden bg-grid-pattern">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-3xl -z-10" />

      {/* Logo */}
      <Link to="/" className="flex items-center gap-2 mb-8 text-xl font-bold tracking-tight">
        <Zap className="text-primary h-6 w-6" />
        <span>OptiAPI <span className="text-primary">AI</span></span>
      </Link>

      {/* Box */}
      <div className="w-full max-w-md p-8 rounded-2xl border border-zinc-800 bg-zinc-950/80 backdrop-blur-md shadow-2xl">
        {!submitted ? (
          <>
            <h2 className="text-2xl font-bold mb-1 tracking-tight text-center">Reset your password</h2>
            <p className="text-xs text-zinc-500 mb-6 text-center">We will send password recovery details to your email inbox</p>

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
                    required
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
                    <Loader2 size={16} className="animate-spin" /> Sending Instructions...
                  </>
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </form>
          </>
        ) : (
          <div className="text-center py-4">
            <CheckCircle className="mx-auto text-emerald-400 h-12 w-12 mb-4 animate-bounce" />
            <h3 className="text-xl font-bold mb-2">Check your inbox</h3>
            <p className="text-xs text-zinc-400 leading-relaxed mb-6">
              We have dispatched a simulated password recovery email link to <span className="text-zinc-200 font-semibold">{email}</span>. Click the link to update your security credentials.
            </p>
            <button
              onClick={() => setSubmitted(false)}
              className="text-xs text-primary font-semibold hover:underline"
            >
              Didn't receive email? Try again
            </button>
          </div>
        )}

        <div className="mt-8 border-t border-zinc-900 pt-6 text-center">
          <Link to="/login" className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors">
            <ArrowLeft size={14} /> Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
