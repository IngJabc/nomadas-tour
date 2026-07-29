'use client';

import { motion } from 'framer-motion';
import { staggerContainer, staggerItem } from '@/lib/motion/variants';

export function AdminSkeletonShell({ children }: { children: React.ReactNode }) {
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible">
      {children}
    </motion.div>
  );
}

export function AdminSkeletonItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  );
}
