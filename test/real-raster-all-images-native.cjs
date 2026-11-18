// Stronger production-policy workload: every original page in sequence, same full-resolution decode and guard.
process.env.NOTEMIND_RASTER_ALL_IMAGES='1';
require('./real-raster-hardware-native.cjs');
