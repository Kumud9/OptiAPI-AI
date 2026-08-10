import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { User, Mail, Building, Lock, Loader2, Sparkles } from 'lucide-react';

const Profile = () => {
  const { user, updateProfile } = useAuth();
  const { addToast } = useToast();

  const [organization, setOrganization] = useState(user?.organization || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updating, setUpdating] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password && password !== confirmPassword) {
      addToast('Passwords do not match', 'warning');
      return;
    }

    setUpdating(true);
    const result = await updateProfile(organization, password);
    setUpdating(false);

    if (result.success) {
      addToast('Profile details updated successfully!', 'success');
      setPassword('');
      setConfirmPassword('');
    } else {
      addToast(result.error || 'Failed to update profile details', 'error');
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <User className="text-primary" /> Profile Settings
        </h1>
        <p className="text-xs text-zinc-400 mt-1">Manage user account profile settings, organization associations, and passwords</p>
      </div>

      {/* Card Info Box */}
      <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 glass-card">
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Email (Readonly) */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5 font-sans">Account Email</label>
            <div className="relative">
              <Mail className="absolute top-3 left-3 text-zinc-650 h-4 w-4" />
              <input
                type="email"
                value={user?.email || ''}
                readOnly
                className="w-full bg-zinc-900/40 border border-zinc-800/80 text-zinc-500 rounded-xl py-2.5 pl-10 pr-4 text-xs font-medium cursor-not-allowed focus:outline-none"
              />
            </div>
          </div>

          {/* Organization */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Organization / Team Name</label>
            <div className="relative">
              <Building className="absolute top-3 left-3 text-zinc-500 h-4 w-4" />
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="Acme Corp"
                className="w-full bg-zinc-900 border border-zinc-850 rounded-xl py-2.5 pl-10 pr-4 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-primary"
                disabled={updating}
              />
            </div>
          </div>

          {/* New Password */}
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">New Password (Optional)</label>
            <div className="relative">
              <Lock className="absolute top-3 left-3 text-zinc-500 h-4 w-4" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password"
                className="w-full bg-zinc-900 border border-zinc-850 rounded-xl py-2.5 pl-10 pr-4 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-primary"
                disabled={updating}
              />
            </div>
          </div>

          {/* Confirm Password */}
          {password && (
            <div className="animate-slide-in">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Confirm New Password</label>
              <div className="relative">
                <Lock className="absolute top-3 left-3 text-zinc-500 h-4 w-4" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Verify new password"
                  className="w-full bg-zinc-900 border border-zinc-850 rounded-xl py-2.5 pl-10 pr-4 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-primary"
                  disabled={updating}
                  required
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={updating}
            className="w-full bg-primary hover:bg-primary-dark text-white rounded-xl py-3 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-glow-blue transition-all mt-6"
          >
            {updating ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Saving Changes...
              </>
            ) : (
              'Save Profile Changes'
            )}
          </button>
        </form>
      </div>

    </div>
  );
};

export default Profile;
