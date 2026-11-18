// Same full100 production workload; additionally require the new owner path and zero fallback.
process.env.NOTEMIND_RASTER_REQUIRE_URL_OWNERS='1';
require('./real-raster-all-images-native.cjs');
