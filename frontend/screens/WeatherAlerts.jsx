import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getWeatherAdvisory, getWeatherAdvisoryFallback } from '../services/halApi';
import { useTranslation } from '../services/i18n';
import { cacheWeather, getCachedWeather } from '../services/weatherCache';

export default function WeatherAlerts({ navigation }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState(t('weatherAlerts.locating'));
  const [now, setNow] = useState(null);
  const [hourlyResp, setHourlyResp] = useState([]);
  const [dailyResp, setDailyResp] = useState([]);
  const [advisory, setAdvisory] = useState(null);
  const [loadingAdvisory, setLoadingAdvisory] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') { 
          console.warn('⚠️ Location permission denied');
          setLoading(false); 
          return; 
        }
        
        const pos = await Location.getCurrentPositionAsync({});
        const { latitude, longitude } = pos.coords;
        console.log('📍 Location obtained:', { latitude, longitude });
        
        const places = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (places && places[0]) {
          const p = places[0];
          setCity(`${p.city || p.district || 'Your area'}, ${p.region || p.postalCode || ''}`.trim());
        }

        // Load from cache first (instant display)
        let cachedData = await getCachedWeather(latitude, longitude);
        let hasCachedData = false;
        let cachedAdvisory = null;
        if (cachedData.fromCache) {
          console.log('✅ Loaded weather from cache');
          setNow(cachedData.weather?.now || null);
          setHourlyResp(cachedData.weather?.next48h || []);
          setDailyResp(cachedData.weather?.next7d || []);
          cachedAdvisory = cachedData.advisory;
          setAdvisory(cachedAdvisory);
          setLoading(false); // Show weather immediately
          hasCachedData = true;
        }

        // Fetch fresh weather data in background (non-blocking)
        // If API fails, cached data remains visible
        (async () => {
          try {
            console.log('🌦️ Fetching fresh weather data...');
            let resp = null;
            
            // Try primary weather API first
            try {
              resp = await getWeatherAdvisory({ lat: latitude, lon: longitude });
              if (resp?.ok) {
                console.log('✅ Primary weather API success');
                // Cache the fresh data
                await cacheWeather(latitude, longitude, resp);
                // Only update if we got valid data
                if (resp.weather?.now) setNow(resp.weather.now);
                if (resp.weather?.next48h) setHourlyResp(resp.weather.next48h);
                if (resp.weather?.next7d) setDailyResp(resp.weather.next7d);
                // Don't set advisory here - load it separately
                return;
              } else {
                throw new Error('Primary API returned invalid response');
              }
            } catch (primaryError) {
              console.warn('⚠️ Primary weather API failed:', primaryError.message);
              
              // Fallback to secondary API
              try {
                console.log('🔄 Using fallback weather API...');
                resp = await getWeatherAdvisoryFallback({ lat: latitude, lon: longitude });
                if (resp?.ok) {
                  console.log('✅ Fallback weather API success');
                  // Cache the fallback data
                  await cacheWeather(latitude, longitude, resp);
                  // Only update if we got valid data
                  if (resp.weather?.now) setNow(resp.weather.now);
                  if (resp.weather?.next48h) setHourlyResp(resp.weather.next48h);
                  if (resp.weather?.next7d) setDailyResp(resp.weather.next7d);
                }
              } catch (fallbackError) {
                console.error('❌ Fallback weather API also failed:', fallbackError.message);
                console.log('ℹ️ Keeping cached weather data visible');
                // Cached data remains - don't clear it
              }
            }
          } catch (error) {
            console.error('❌ Background weather fetch error:', error);
            console.log('ℹ️ Keeping cached weather data visible');
            // Cached data remains - don't clear it
          } finally {
            if (loading) setLoading(false);
          }
        })();

        // Load AI advisory separately (can take longer)
        // If it fails, keep existing cached advisory
        (async () => {
          try {
            setLoadingAdvisory(true);
            console.log('🤖 Loading AI advisory...');
            
            // Try with a timeout wrapper
            const advisoryPromise = getWeatherAdvisory({ lat: latitude, lon: longitude });
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Advisory request timeout')), 60000)
            );
            
            const resp = await Promise.race([advisoryPromise, timeoutPromise]);
            
            if (resp?.ok && resp.advisory) {
              // Cache advisory separately
              await cacheWeather(latitude, longitude, { advisory: resp.advisory });
              setAdvisory(resp.advisory);
              console.log('✅ AI advisory loaded');
            } else {
              console.warn('⚠️ AI advisory not in response');
            }
          } catch (error) {
            console.warn('⚠️ AI advisory loading failed:', error.message);
            // Keep existing advisory from cache if available - don't clear it
            // If we had cached advisory, it's already set, so we don't need to set it again
            if (cachedAdvisory) {
              console.log('ℹ️ Keeping cached advisory visible');
            }
          } finally {
            setLoadingAdvisory(false);
          }
        })();

      } catch (e) {
        console.error('❌ Weather loading error:', e);
        setLoading(false);
      } finally {
        if (!hasCachedData) {
          setLoading(false);
        }
      }
    })();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5DC' }}>
      {/* App Bar header - left-aligned only */}
      <View style={styles.appBar}>
        <Text style={styles.screenTitle}>{t('weatherAlerts.title')}</Text>
      </View>
      {/* Location Row */}
      <View style={styles.locRow}>
        <MaterialIcons name="location-on" size={22} color="#3A5F0B" />
        <Text style={styles.locLabel}>{city}</Text>
        <Text style={styles.locUpdated}>{new Date().toLocaleTimeString()}</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 44 }}>
        {/* Conditional critical card based on advisory */}
        {advisory?.risk_summary && /high|storm|heavy|alert/i.test(advisory.risk_summary) ? (
          <View style={styles.criticalCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialIcons name="flood" size={28} color="#fff" style={{ marginRight: 11 }} />
              <View>
                <Text style={styles.criticalTitle}>{t('weatherAlerts.weatherAlert')}</Text>
                <Text style={styles.criticalSub}>{advisory.risk_summary}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.criticalLearnMore} activeOpacity={0.7}>
              <Text style={styles.criticalLearnText}>{t('common.view')}</Text>
              <MaterialIcons name="arrow-forward" size={22} color="#fff" style={{ marginLeft: 3, marginTop: 1 }} />
            </TouchableOpacity>
          </View>
        ) : null}
        {/* Current Weather Card */}
        <View style={styles.weatherCard}>
          <Text style={styles.weatherSection}>{t('weatherAlerts.currentWeather')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.weatherTemp}>{now?.temp != null ? Math.round(now.temp) + '°C' : (loading ? '...' : '--')}</Text>
              <Text style={styles.weatherDesc}>{now?.weather || (loading ? t('weatherAlerts.loading') : 'N/A')}</Text>
              <Text style={styles.weatherMetrics}>{now ? `${t('weatherAlerts.feelsLike')}: ${Math.round(now.feels_like)}°C     |     ${t('weatherAlerts.humidity')}: ${now.humidity}%     |     ${t('weatherAlerts.windSpeed')}: ${Math.round((now.wind_speed||0)*3.6)} km/h` : ''}</Text>
            </View>
            <MaterialIcons name="wb-cloudy" size={70} color="#FCA311" />
          </View>
        </View>
        {/* Green AI advisory box */}
        <View style={styles.aiBanner}>
          <MaterialIcons name="auto-awesome" size={22} color="#3A5F0B" style={{ marginRight: 8 }} />
          {loadingAdvisory ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <ActivityIndicator size="small" color="#3A5F0B" style={{ marginRight: 8 }} />
              <Text style={styles.aiBannerText}>{t('weatherAlerts.fetchingAdvisory')}</Text>
            </View>
          ) : (
            <Text style={styles.aiBannerText}>{advisory?.risk_summary || t('weatherAlerts.noAdvisory')}</Text>
          )}
        </View>
        {/* Hourly Forecast Section */}
        <Text style={styles.sectionTitle}>{t('weatherAlerts.hourlyForecast')}</Text>
        {hourlyResp.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hourlyScroll}>
            {hourlyResp.map((h, i) => (
              <View key={i} style={styles.hourlyCard}>
                <Text style={styles.hourlyCardLabel}>{new Date((h.dt||0)*1000).toLocaleTimeString([], { hour: '2-digit' })}</Text>
                <MaterialIcons name={(h.pop > 0.5 ? 'thunderstorm' : 'wb-sunny')} size={40} color="#FCA311" style={{ marginVertical: 7 }} />
                <Text style={styles.hourlyCardTemp}>{h.temp != null ? Math.round(h.temp) + '°' : '--'}</Text>
              </View>
            ))}
          </ScrollView>
        ) : (
          <Text style={{ color: '#7c8c78', marginLeft: 14 }}>{t('weatherAlerts.noHourlyData')}</Text>
        )}
        {/* 7-Day Forecast Section */}
        <Text style={styles.sectionTitle}>{t('weatherAlerts.dailyForecast')}</Text>
        {dailyResp.length > 0 ? (
          <View style={styles.dailyForecastWrap}>
            {dailyResp.map((d, i) => (
              <View key={i} style={styles.dailyCard}>
                <Text style={styles.dailyDay}>{new Date((d.dt||0)*1000).toLocaleDateString([], { weekday: 'short' })}</Text>
                <MaterialIcons name={(d.rain > 0 ? 'thunderstorm' : 'wb-sunny')} size={29} color={'#4CAF50'} style={{ marginHorizontal: 8 }} />
                <Text style={styles.dailyTemp}>{`${Math.round(d.temp_max||0)}° / ${Math.round(d.temp_min||0)}°`}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ color: '#7c8c78', marginLeft: 14 }}>{t('weatherAlerts.noDailyData')}</Text>
        )}
        {/* Rainfall Card */}
        <View style={styles.infoCard}>
          <View style={styles.infoCardTopRow}>
            <MaterialIcons name="water-drop" size={22} color="#3A5F0B" style={{ marginRight: 7 }} />
            <Text style={styles.infoCardTitle}>{t('weatherAlerts.rainfall')}</Text>
          </View>
          <Text style={styles.infoCardValue}>{hourlyResp.length ? `${Math.round(hourlyResp.reduce((s,h)=>s+(h.rain||0),0))} mm` : '—'}</Text>
          <Text style={styles.infoCardSub}>{advisory?.next_48h?.[0]?.advice || '—'}</Text>
        </View>
        {/* Soil Card */}
        <View style={[styles.infoCard, { borderColor: '#e3bc92' }]}> 
          <View style={styles.infoCardTopRow}>
            <MaterialIcons name="texture" size={22} color="#3A5F0B" style={{ marginRight: 7 }} />
            <Text style={styles.infoCardTitle}>{t('weatherAlerts.soilMoisture')}</Text>
          </View>
          <Text style={styles.infoCardValue}>{now ? (now.humidity ?? 0) + '%' : '—'}</Text>
          <Text style={styles.infoCardSub}>{advisory?.actions_now?.[0] || '—'}</Text>
        </View>
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  appBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 16, paddingTop: 34, borderBottomWidth: 1, borderColor: '#E0E0E0' },
  screenTitle: { flex: 1, fontWeight: 'bold', fontSize: 20, textAlign: 'left', color: '#212121' },
  locRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 6, marginTop: 7, marginBottom: 2 },
  locLabel: { color: '#27361d', fontSize: 16, fontWeight: '500', flex: 1, marginLeft: 6 },
  locUpdated: { color: '#7c8c78', fontSize: 14, marginLeft: 3 },
  criticalCard: { backgroundColor: '#d1433e', padding: 15, borderRadius: 16, marginHorizontal: 12, marginTop: 17, marginBottom: 13, flexDirection: 'column' },
  criticalTitle: { color: '#fff', fontWeight: 'bold', fontSize: 17, marginBottom: 2 },
  criticalSub: { color: '#fff', fontSize: 14, opacity: 0.96 },
  criticalLearnMore: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  criticalLearnText: { color: '#fff', fontWeight: 'bold', fontSize: 15, marginRight: 1 },
  weatherCard: { backgroundColor: '#fff', borderRadius: 15, padding: 17, marginHorizontal: 12, marginBottom: 14, borderWidth: 1, borderColor: '#E0E0E0', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  weatherSection: { color: '#3A5F0B', fontWeight: '600', marginBottom: 5 },
  weatherTemp: { fontWeight: 'bold', fontSize: 33, color: '#212121' },
  weatherDesc: { color: '#7c8c78', fontSize: 16, marginBottom: 3 },
  weatherMetrics: { color: '#3A5F0B', fontSize: 13, marginTop: 9, marginBottom: 2 },
  aiBanner: { backgroundColor: '#ecf5ec', borderRadius: 11, borderWidth: 1, borderColor: '#acdca1', flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 14, paddingVertical: 10, paddingHorizontal: 13 },
  aiBannerText: { color: '#3A5F0B', fontSize: 14, fontWeight: '600', flex: 1 },
  sectionTitle: { fontWeight: 'bold', fontSize: 17, marginLeft: 14, marginTop: 11, marginBottom: 6, color: '#212121' },
  hourlyScroll: { flexDirection: 'row', gap: 8, paddingLeft: 8, paddingRight: 8, marginBottom: 9 },
  hourlyCard: { backgroundColor: '#fff', borderRadius: 11, alignItems: 'center', paddingVertical: 11, width: 70, marginHorizontal: 2, borderWidth: 1, borderColor: '#E0E0E0', gap: 2 },
  hourlyCardLabel: { color: '#7c8c78', fontSize: 13, fontWeight: '500', marginBottom: 0 },
  hourlyCardTemp: { fontSize: 15, fontWeight: 'bold', color: '#212121', marginTop: 2 },
  dailyForecastWrap: { marginHorizontal: 10, marginTop: 3, marginBottom: 11, gap: 6 },
  dailyCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E0E0E0', paddingVertical: 11, paddingHorizontal: 16, marginBottom: 3, gap: 17 },
  dailyDay: { flex: 1, fontWeight: 'bold', fontSize: 14, color: '#212121' },
  dailyTemp: { color: '#3A5F0B', fontWeight: '500', fontSize: 15, marginLeft: 'auto' },
  infoCard: { backgroundColor: '#fff', borderRadius: 11, borderWidth: 1, borderColor: '#E0E0E0', paddingVertical: 13, paddingHorizontal: 18, marginHorizontal: 12, marginTop: 8, marginBottom: 4 },
  infoCardTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  infoCardTitle: { fontWeight: 'bold', fontSize: 15, color: '#3A5F0B' },
  infoCardValue: { fontWeight: 'bold', fontSize: 22, color: '#212121', marginVertical: 4 },
  infoCardSub: { color: '#7c8c78', fontSize: 13 },
});
