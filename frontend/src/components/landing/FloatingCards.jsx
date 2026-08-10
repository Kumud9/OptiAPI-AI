import React from 'react';
import { motion } from 'framer-motion';
import { Check, Zap, Lock, Database, BarChart3, RefreshCw } from 'lucide-react';

const CARDS_CONFIG = [
  { text: 'Cache Hit', icon: Check, color: 'text-emerald-400', border: 'border-emerald-500/20 bg-emerald-500/5', x: '8%', y: '16%', delay: 0 },
  { text: 'Request Optimized', icon: Zap, color: 'text-blue-400', border: 'border-blue-500/20 bg-blue-500/5', x: '78%', y: '12%', delay: 2 },
  { text: 'JWT Verified', icon: Lock, color: 'text-purple-400', border: 'border-purple-500/20 bg-purple-500/5', x: '82%', y: '68%', delay: 1 },
  { text: 'Redis Cache', icon: Database, color: 'text-cyan-400', border: 'border-cyan-500/20 bg-cyan-500/5', x: '6%', y: '72%', delay: 3.5 },
  { text: 'Analytics Updated', icon: BarChart3, color: 'text-amber-400', border: 'border-amber-500/20 bg-amber-500/5', x: '10%', y: '44%', delay: 1.5 },
  { text: 'Retry Successful', icon: RefreshCw, color: 'text-indigo-400', border: 'border-indigo-500/20 bg-indigo-500/5', x: '74%', y: '40%', delay: 2.8 }
];

const FloatingCards = () => {
  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none hidden md:block overflow-hidden">
      {CARDS_CONFIG.map((card, idx) => {
        const Icon = card.icon;
        return (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 15 }}
            animate={{
              opacity: [0, 0.9, 0.9, 0],
              y: [15, -15, -15, -45],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              delay: card.delay,
              ease: 'easeInOut'
            }}
            style={{
              position: 'absolute',
              left: card.x,
              top: card.y,
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border glass-card shadow-lg ${card.border}`}
          >
            <Icon size={14} className={card.color} />
            <span className="text-[10px] font-semibold text-zinc-300 tracking-wide">{card.text}</span>
          </motion.div>
        );
      })}
    </div>
  );
};

export default FloatingCards;
