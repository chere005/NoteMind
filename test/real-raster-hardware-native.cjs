// Production-default GPU policy: exact canonical workload and guard; no product startup flags changed.
process.env.NOTEMIND_RASTER_HARDWARE='1';
for(const key of ['NOTEMIND_RASTER_MEMORY_PROBE','NOTEMIND_RASTER_CACHE_ONLY','NOTEMIND_RASTER_NATIVE_ALLOCATORS','NOTEMIND_RASTER_BITMAP_READY','NOTEMIND_RASTER_PRESENT','NOTEMIND_RASTER_SKIA_MB'])delete process.env[key];
require('./real-raster-performance.cjs');
