import AsyncStorage from '@react-native-async-storage/async-storage';

// Cache TTLs (in milliseconds)
const CACHE_TTL = {
  CURRENT_WEATHER: 5 * 60 * 1000,      // 5 minutes
  HOURLY_FORECAST: 30 * 60 * 1000,    // 30 minutes
  DAILY_FORECAST: 6 * 60 * 60 * 1000,  // 6 hours
  ADVISORY: 10 * 60 * 1000,            // 10 minutes (can be longer)
};

// Generate cache key based on location
function getCacheKey(lat, lon, type) {
  // Round to 2 decimal places for cache key (about 1km precision)
  const latRounded = Math.round(lat * 100) / 100;
  const lonRounded = Math.round(lon * 100) / 100;
  return `weather_${type}_${latRounded}_${lonRounded}`;
}

// Check if cached data is still valid
function isCacheValid(cachedData, ttl) {
  if (!cachedData || !cachedData.timestamp) return false;
  const age = Date.now() - cachedData.timestamp;
  return age < ttl;
}

// Get cached weather data
export async function getCachedWeather(lat, lon) {
  try {
    const currentKey = getCacheKey(lat, lon, 'current');
    const hourlyKey = getCacheKey(lat, lon, 'hourly');
    const dailyKey = getCacheKey(lat, lon, 'daily');
    const advisoryKey = getCacheKey(lat, lon, 'advisory');

    const [currentData, hourlyData, dailyData, advisoryData] = await Promise.all([
      AsyncStorage.getItem(currentKey),
      AsyncStorage.getItem(hourlyKey),
      AsyncStorage.getItem(dailyKey),
      AsyncStorage.getItem(advisoryKey),
    ]);

    const result = {
      weather: {},
      advisory: null,
      fromCache: false,
    };

    // Check current weather cache
    if (currentData) {
      const parsed = JSON.parse(currentData);
      if (isCacheValid(parsed, CACHE_TTL.CURRENT_WEATHER)) {
        result.weather.now = parsed.data;
        result.fromCache = true;
      }
    }

    // Check hourly forecast cache
    if (hourlyData) {
      const parsed = JSON.parse(hourlyData);
      if (isCacheValid(parsed, CACHE_TTL.HOURLY_FORECAST)) {
        result.weather.next48h = parsed.data;
        result.fromCache = true;
      }
    }

    // Check daily forecast cache
    if (dailyData) {
      const parsed = JSON.parse(dailyData);
      if (isCacheValid(parsed, CACHE_TTL.DAILY_FORECAST)) {
        result.weather.next7d = parsed.data;
        result.fromCache = true;
      }
    }

    // Check advisory cache (optional - can be stale)
    if (advisoryData) {
      const parsed = JSON.parse(advisoryData);
      // Advisory can be older, still show it while loading fresh
      result.advisory = parsed.data;
    }

    return result;
  } catch (error) {
    console.error('Error reading weather cache:', error);
    return { weather: {}, advisory: null, fromCache: false };
  }
}

// Cache weather data
export async function cacheWeather(lat, lon, weatherData) {
  try {
    const currentKey = getCacheKey(lat, lon, 'current');
    const hourlyKey = getCacheKey(lat, lon, 'hourly');
    const dailyKey = getCacheKey(lat, lon, 'daily');
    const advisoryKey = getCacheKey(lat, lon, 'advisory');

    const cachePromises = [];

    // Cache current weather
    if (weatherData?.weather?.now) {
      cachePromises.push(
        AsyncStorage.setItem(
          currentKey,
          JSON.stringify({
            timestamp: Date.now(),
            data: weatherData.weather.now,
          })
        )
      );
    }

    // Cache hourly forecast
    if (weatherData?.weather?.next48h) {
      cachePromises.push(
        AsyncStorage.setItem(
          hourlyKey,
          JSON.stringify({
            timestamp: Date.now(),
            data: weatherData.weather.next48h,
          })
        )
      );
    }

    // Cache daily forecast
    if (weatherData?.weather?.next7d) {
      cachePromises.push(
        AsyncStorage.setItem(
          dailyKey,
          JSON.stringify({
            timestamp: Date.now(),
            data: weatherData.weather.next7d,
          })
        )
      );
    }

    // Cache advisory separately (can be updated independently)
    if (weatherData?.advisory) {
      cachePromises.push(
        AsyncStorage.setItem(
          advisoryKey,
          JSON.stringify({
            timestamp: Date.now(),
            data: weatherData.advisory,
          })
        )
      );
    }

    await Promise.all(cachePromises);
    console.log('✅ Weather data cached successfully');
  } catch (error) {
    console.error('Error caching weather data:', error);
  }
}

// Check if we need to fetch fresh data
export function shouldFetchWeather(lat, lon, cachedData) {
  if (!cachedData || !cachedData.fromCache) return true;

  // Check if any critical data is missing or stale
  const hasCurrent = cachedData.weather?.now;
  const hasHourly = cachedData.weather?.next48h?.length > 0;
  const hasDaily = cachedData.weather?.next7d?.length > 0;

  // If we have all data from cache, we can still fetch in background for freshness
  // But we don't need to block UI
  return !hasCurrent || !hasHourly || !hasDaily;
}

