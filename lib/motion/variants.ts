export const pageFade = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

export const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

export const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};
