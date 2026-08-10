import React, { createContext, useContext, useState, useCallback } from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prevToasts) => [...prevToasts, { id, message, type }]);

    setTimeout(() => {
      removeToast(id);
    }, duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prevToasts) => prevToasts.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Toast Portal Render */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-3 max-w-md w-full sm:w-96">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-start justify-between gap-3 p-4 rounded-xl border glass-card shadow-2xl transition-all duration-300 animate-slide-in ${
              toast.type === 'success'
                ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                : toast.type === 'error'
                ? 'border-rose-500/20 bg-rose-500/5 text-rose-300'
                : toast.type === 'warning'
                ? 'border-amber-500/20 bg-amber-500/5 text-amber-300'
                : 'border-blue-500/20 bg-blue-500/5 text-blue-300'
            }`}
          >
            <div className="flex gap-3">
              <span className="mt-0.5">
                {toast.type === 'success' && <CheckCircle size={18} className="text-emerald-400" />}
                {toast.type === 'error' && <AlertCircle size={18} className="text-rose-400" />}
                {toast.type === 'warning' && <AlertCircle size={18} className="text-amber-400" />}
                {toast.type === 'info' && <Info size={18} className="text-blue-400" />}
              </span>
              <p className="text-sm font-medium leading-relaxed">{toast.message}</p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-gray-400 hover:text-gray-200 transition-colors focus:outline-none"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be executed within a ToastProvider scope');
  }
  return context;
};
export default ToastContext;
