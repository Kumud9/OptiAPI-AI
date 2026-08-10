import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

const CTAButtons = () => {
  return (
    <div className="flex flex-col sm:flex-row gap-4 mt-8 w-full justify-center lg:justify-start pointer-events-auto">
      
      {/* Start Free Button */}
      <motion.div
        whileHover={{ y: -2, scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="w-full sm:w-auto"
      >
        <Link
          to="/register"
          className="w-full sm:w-auto px-8 py-4 rounded-xl font-semibold bg-primary hover:bg-primary-dark text-white transition-all flex items-center justify-center gap-2 shadow-glow-blue text-sm tracking-wide"
        >
          Start Free <ArrowRight size={16} />
        </Link>
      </motion.div>

      {/* View Dashboard Button */}
      <motion.div
        whileHover={{ y: -2, scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="w-full sm:w-auto"
      >
        <Link
          to="/dashboard"
          className="w-full sm:w-auto px-8 py-4 rounded-xl font-semibold border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/80 text-zinc-300 transition-all flex items-center justify-center gap-2 text-sm tracking-wide"
        >
          View Dashboard
        </Link>
      </motion.div>

    </div>
  );
};

export default CTAButtons;
