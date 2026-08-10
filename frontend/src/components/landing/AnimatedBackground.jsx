import React from 'react';
import { motion } from 'framer-motion';
import NetworkGraph from './NetworkGraph';

const AnimatedBackground = () => {
  return (
    <div className="absolute inset-0 w-full h-full bg-background overflow-hidden -z-10 select-none">
      
      {/* 1. Deep Grid Layer */}
      <div className="absolute inset-0 bg-grid-pattern opacity-[0.25] pointer-events-none" />

      {/* 2. Floating Purple Glow Sphere */}
      <motion.div
        animate={{
          x: [0, 40, -20, 0],
          y: [0, -50, 30, 0],
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none"
      />

      {/* 3. Floating Blue Glow Sphere */}
      <motion.div
        animate={{
          x: [0, -30, 50, 0],
          y: [0, 40, -40, 0],
        }}
        transition={{
          duration: 22,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        className="absolute bottom-1/4 right-1/4 w-[450px] h-[450px] bg-primary/10 rounded-full blur-[130px] pointer-events-none"
      />

      {/* 4. Canvas-based Interactive Network Graph */}
      <div className="absolute inset-0 w-full h-full opacity-60">
        <NetworkGraph />
      </div>

      {/* Radial overlay to dim grid edges */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-transparent to-background pointer-events-none" />
    </div>
  );
};

export default AnimatedBackground;
