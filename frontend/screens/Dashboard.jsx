import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth } from '../firebase';
import { fetchUserProfile } from '../services/auth';
import { getFields, getPestHistory, getWeatherAdvisory, getWeatherAdvisoryFallback } from '../services/halApi';
import { useTranslation } from '../services/i18n';
import { cacheWeather, getCachedWeather } from '../services/weatherCache';

const weatherIcon = require('../assets/weather_sunny.png');
const profileImage = require('../assets/profile_placeholder.png');
const wheatCropImage = require('../assets/wheat_crop.png');
const soybeanFieldImage = require('../assets/soybean_field.png');
const screenW = Dimensions.get('window').width;

export default function Dashboard({ navigation }) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('Farmer');
  const [weather, setWeather] = useState(null);
  const [location, setLocation] = useState('Locating...');
  const [fields, setFields] = useState([]);
  const [pestAlertCount, setPestAlertCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        
        // Load user name
        const display = auth?.currentUser?.displayName || '';
        let name = display?.split(' ')[0] || 'Farmer';
        try {
          if (auth?.currentUser?.uid) {
            const profile = await fetchUserProfile(auth.currentUser.uid);
            if (profile?.fullName) {
              name = String(profile.fullName).split(' ')[0];
            }
          }
        } catch (_) {}
        setFirstName(name);

        // Load weather
        await loadWeather();

        // Load fields
        await loadFields();

        // Load pest alerts
        await loadPestAlerts();
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const loadWeather = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('Location permission denied');
        setLocation('Location unavailable');
        return;
      }

      const pos = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = pos.coords;
      
      // Get location name
      const places = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (places && places[0]) {
        const p = places[0];
        setLocation(`${p.city || p.district || 'Your area'}, ${p.region || ''}`.trim());
      }

      // Load from cache first (instant display)
      const cachedData = await getCachedWeather(latitude, longitude);
      if (cachedData.fromCache) {
        console.log('✅ Loaded weather from cache');
        setWeather({
          ok: true,
          weather: cachedData.weather,
          advisory: cachedData.advisory,
        });
      }

      // Fetch fresh data in background (non-blocking)
      (async () => {
        try {
          console.log('🌦️ Fetching fresh weather data...');
          // Try primary weather API
          try {
            const resp = await getWeatherAdvisory({ lat: latitude, lon: longitude });
            if (resp?.ok) {
              // Cache the fresh data
              await cacheWeather(latitude, longitude, resp);
              setWeather(resp);
              console.log('✅ Weather updated from primary API');
              return;
            }
          } catch (primaryError) {
            console.warn('⚠️ Primary weather API failed:', primaryError.message);
          }

          // Fallback to secondary API
          try {
            const fallbackResp = await getWeatherAdvisoryFallback({ lat: latitude, lon: longitude });
            if (fallbackResp?.ok) {
              // Cache the fallback data
              await cacheWeather(latitude, longitude, fallbackResp);
              setWeather(fallbackResp);
              console.log('✅ Weather updated from fallback API');
            }
          } catch (fallbackError) {
            console.error('❌ Fallback weather API also failed:', fallbackError.message);
          }
        } catch (error) {
          console.error('❌ Background weather fetch error:', error);
        }
      })();
    } catch (error) {
      console.error('❌ Weather loading error:', error);
    }
  };

  const loadFields = async () => {
    try {
      const farmer_ID = auth?.currentUser?.uid;
      if (!farmer_ID) return;
      
      const response = await getFields(farmer_ID);
      const fieldsData = response?.fields || [];
      setFields(fieldsData);
      console.log('✅ Loaded fields:', fieldsData.length);
    } catch (error) {
      console.error('❌ Error loading fields:', error);
    }
  };

  const loadPestAlerts = async () => {
    try {
      const farmer_ID = auth?.currentUser?.uid;
      if (!farmer_ID) return;
      
      const { items } = await getPestHistory({ farmer_ID, limit: 100 });
      // Count recent alerts (last 7 days)
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      const recentAlerts = (items || []).filter(item => {
        const itemDate = item.timestamp || item.createdAt || item.date;
        return itemDate && new Date(itemDate).getTime() > sevenDaysAgo;
      });
      setPestAlertCount(recentAlerts.length);
      console.log('✅ Pest alerts count:', recentAlerts.length);
    } catch (error) {
      console.error('❌ Error loading pest alerts:', error);
    }
  };

  const getWeatherIcon = (condition) => {
    if (!condition) return 'wb-sunny';
    const lower = condition.toLowerCase();
    if (lower.includes('rain') || lower.includes('drizzle')) return 'grain';
    if (lower.includes('cloud')) return 'cloud';
    if (lower.includes('storm')) return 'thunderstorm';
    return 'wb-sunny';
  };

  const getWeatherDescription = (now) => {
    if (!now) return 'N/A';
    return now.weather || now.description || 'Clear';
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5DC' }}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Top Bar with Back Arrow and Profile */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => navigation.navigate('Profile')} style={styles.profileNavBtn}>
            <MaterialIcons name="person-outline" size={20} color="#3A5F0B" style={{ marginRight: 6 }} />
            <Text style={styles.profileNavText}>{t('dashboard.myProfile')}</Text>
            <MaterialIcons name="chevron-right" size={22} color="#3A5F0B" />
          </TouchableOpacity>
        </View>
        {/* Greeting */}
        <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
          <Text style={styles.greetingMain}>{t('dashboard.namaste')}, {firstName}</Text>
        </TouchableOpacity>
        {/* Weather Card (press to open Weather Alerts) */}
        <TouchableOpacity style={styles.weatherCard} activeOpacity={0.85} onPress={() => navigation.navigate('Weather Alerts')}>
          <View style={{ flex: 1 }}>
            <Text style={styles.weatherLocation}>{location}</Text>
            {loading ? (
              <ActivityIndicator size="small" color="#3A5F0B" style={{ marginVertical: 8 }} />
            ) : (
              <>
                <Text style={styles.weatherMain}>
                  {weather?.weather?.now?.temp != null 
                    ? `${Math.round(weather.weather.now.temp)}°C ${getWeatherDescription(weather.weather.now)}`
                    : '--'}
                </Text>
                <Text style={styles.weatherSub}>
                  <Text style={styles.weatherSubTextHi}>
                    {weather?.advisory?.risk_summary 
                      ? weather.advisory.risk_summary.split('.')[0] 
                      : t('dashboard.clearSkies')}
                  </Text>
                  {weather?.weather?.next48h && weather.weather.next48h.length > 0 && (
                    ` ${t('dashboard.rainExpected')} ${weather.weather.next48h.find(h => h.rain > 0) ? '2' : '0'} ${t('dashboard.hours')}.`
                  )}
                </Text>
                <View style={styles.aiBannerRow}>
                  <MaterialIcons name="auto-awesome" size={18} color="#3A5F0B" style={{ marginRight: 8 }} />
                  <Text style={styles.aiBannerText}>
                    {weather?.advisory?.actions_now?.[0] 
                      ? weather.advisory.actions_now[0].substring(0, 50) + '...'
                      : t('dashboard.aiAdvisory') + ': ' + t('dashboard.riskOfPestAttack')}
                  </Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Weather Alerts')} style={styles.aiBannerArrow}>
                    <MaterialIcons name="arrow-forward" size={20} color="#3A5F0B" />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
          <MaterialIcons 
            name={getWeatherIcon(weather?.weather?.now?.weather || weather?.weather?.now?.description)} 
            size={62} 
            color="#FCA311" 
            style={{ marginLeft: 16 }}
          />
        </TouchableOpacity>
        {/* Feature Grid */}
        <View style={styles.featureGrid}>
          <TouchableOpacity style={styles.featureCard} onPress={() => navigation.navigate('Crop Advisory')}>
            <MaterialIcons name="eco" size={32} color="#5c7e2b" style={styles.featureCardIcon} />
            <Text style={styles.featureTitle}>{t('dashboard.cropAdvisory')}</Text>
            <Text style={styles.featureSubtitle}>{t('dashboard.getAdvice')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.featureCard, { position: 'relative' }]} onPress={() => navigation.navigate('Pest & Disease')}>
            <MaterialIcons name="bug-report" size={32} color="#bb9a03" style={styles.featureCardIcon} />
            <Text style={styles.featureTitle}>{t('dashboard.pestDisease')}</Text>
            <Text style={[styles.featureSubtitle, { color: pestAlertCount > 0 ? '#bfa300' : '#7c8c78', fontWeight: pestAlertCount > 0 ? '600' : '400' }]}>
              {pestAlertCount > 0 ? `${pestAlertCount} ${t('dashboard.newAlert')}` : t('dashboard.noAlerts') || 'No alerts'}
            </Text>
            {pestAlertCount > 0 && <View style={styles.alertDot} />}
          </TouchableOpacity>
          <TouchableOpacity style={styles.featureCard} onPress={() => navigation.navigate('Market Prices')}>
            <MaterialIcons name="trending-up" size={32} color="#3A5F0B" style={styles.featureCardIcon} />
            <Text style={styles.featureTitle}>{t('dashboard.marketPrices')}</Text>
            <Text style={styles.featureSubtitle}>{t('dashboard.viewRates')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.featureCard} onPress={() => navigation.navigate('Soil Health')}>
            <MaterialIcons name="grass" size={32} color="#498256" style={styles.featureCardIcon} />
            <Text style={styles.featureTitle}>{t('dashboard.soilHealth')}</Text>
            <Text style={styles.featureSubtitle}>{t('dashboard.checkStatus')}</Text>
          </TouchableOpacity>
        </View>
        {/* Government Schemes Section */}
        <Text style={styles.sectionTitle}>{t('dashboard.governmentSchemes') || 'Government Schemes'}</Text>
        <TouchableOpacity 
          style={styles.schemesCard} 
          onPress={() => navigation.navigate('Government Schemes')}
          activeOpacity={0.85}
        >
          <View style={styles.schemesContent}>
            <View style={styles.schemesHeader}>
              <MaterialIcons name="account-balance" size={28} color="#3A5F0B" />
              <View style={styles.schemesTextContainer}>
                <Text style={styles.schemesTitle}>{t('dashboard.governmentSchemes') || 'Government Schemes'}</Text>
                <Text style={styles.schemesSubtitle}>{t('dashboard.exploreSchemes') || 'Explore agricultural schemes'}</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#3A5F0B" />
          </View>
        </TouchableOpacity>
        {/* My Farm Section */}
        <Text style={styles.sectionTitle}>{t('dashboard.myFarm')}</Text>
        {loading ? (
          <ActivityIndicator size="small" color="#3A5F0B" style={{ marginVertical: 20 }} />
        ) : fields.length > 0 ? (
          <View style={styles.farmRow}>
            {fields.slice(0, 2).map((field, idx) => (
              <View key={field.id || idx} style={styles.farmCard}>
                <Image 
                  source={idx % 2 === 0 ? wheatCropImage : soybeanFieldImage} 
                  style={styles.farmImage} 
                />
                <Text style={styles.farmTitle}>{field.id || `Field ${idx + 1}`}</Text>
                <Text style={styles.farmSub}>
                  {field.crop_name || 'Crop'} - {field.stage || 'Active'}
                </Text>
              </View>
            ))}
            {fields.length === 0 && (
              <View style={styles.farmCard}>
                <MaterialIcons name="add-circle-outline" size={40} color="#ccc" style={{ marginBottom: 8 }} />
                <Text style={styles.farmTitle}>{t('dashboard.addField') || 'Add Field'}</Text>
                <Text style={styles.farmSub}>{t('dashboard.setupField') || 'Setup your field'}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.farmRow}>
            <View style={styles.farmCard}>
              <MaterialIcons name="add-circle-outline" size={40} color="#ccc" style={{ marginBottom: 8 }} />
              <Text style={styles.farmTitle}>{t('dashboard.addField') || 'Add Field'}</Text>
              <Text style={styles.farmSub}>{t('dashboard.setupField') || 'Setup your first field'}</Text>
            </View>
          </View>
        )}
      </ScrollView>
      {/* Mic Floating Action Button (fixed) */}
      <TouchableOpacity style={styles.micFab} onPress={() => navigation.navigate('Voice Assistant')}>
        <MaterialIcons name="keyboard-voice" size={34} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 21,
    paddingHorizontal: 14,
    paddingBottom: 54,
    backgroundColor: '#F5F5DC',
    minHeight: '100%',
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 4, marginTop: 3,
  },
  profileWrap: {
    width: 52, height: 52, borderRadius: 26, overflow: 'hidden', borderWidth: 2, borderColor: '#e0e0e0', marginRight: 10,
  },
  profileImg: {
    width: '100%', height: '100%', resizeMode: 'cover',
  },
  profileNavBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(58,95,11,0.10)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  profileNavText: { color: '#3A5F0B', fontWeight: '700', marginRight: 2 },
  
  greetingMain: {
    fontWeight: 'bold', fontSize: 28, marginVertical: 7, color: '#333', marginBottom: 11, marginTop: 2, paddingLeft: 2,
  },
  weatherCard: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 15, padding: 21, alignItems: 'center', marginBottom: 15, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 3, borderWidth: 1, borderColor: '#E0E0E0', elevation: 1,
  },
  weatherLocation: {
    fontSize: 16, color: '#444', marginBottom: 0, fontWeight: '600',
  },
  weatherMain: {
    fontWeight: 'bold', fontSize: 23, color: '#212121', marginBottom: 7, marginTop: 2,
  },
  weatherSub: {
    color: '#bfa300', fontSize: 14, fontWeight: '600',
  },
  weatherSubTextHi: {
    color: '#333', fontWeight: 'bold',
  },
  aiBannerRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#ecf5ec', borderWidth: 1, borderColor: '#acdca1', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10, marginTop: 8,
  },
  aiBannerText: {
    color: '#3A5F0B', fontSize: 13, fontWeight: '600', flex: 1,
  },
  aiBannerArrow: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e7f1e7',
  },
  weatherIcon: {
    width: 62, height: 62, marginLeft: 16, borderRadius: 14, resizeMode: 'cover',
  },
  featureGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 13, justifyContent: 'space-between', marginBottom: 21,
  },
  featureCard: {
    backgroundColor: '#fff', width: '47.5%', minWidth: 150, borderRadius: 15, padding: 17, marginBottom: 8, alignItems: 'flex-start', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 2, elevation: 1, borderWidth: 1, borderColor: '#E0E0E0',
  },
  featureCardIcon: { marginBottom: 8 },
  featureTitle: { fontSize: 16, fontWeight: '700', color: '#292e22', marginBottom: 1 },
  featureSubtitle: { color: '#7c8c78', fontSize: 13, },
  alertDot: { position: 'absolute', top: 10, right: 14, width: 10, height: 10, borderRadius: 5, backgroundColor: '#EFBC18', },
  sectionTitle: { marginTop: 14, fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 11, paddingHorizontal: 4 },
  farmRow: { flexDirection: 'row', justifyContent: 'space-between' },
  farmCard: { flex: 1, backgroundColor: '#fff', borderRadius: 14, marginRight: 10, padding: 13, alignItems: 'flex-start', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 2, elevation: 1, minWidth: 140, borderWidth: 1, borderColor: '#E0E0E0', },
  farmImage: { width: '100%', height: 88, borderRadius: 12, marginBottom: 10, resizeMode: 'cover', },
  farmTitle: { fontSize: 15, fontWeight: 'bold', marginBottom: 2, color: '#333', },
  farmSub: { fontSize: 13, color: '#6e6f68', },
  schemesCard: {
    backgroundColor: '#fff', borderRadius: 15, padding: 18, marginBottom: 15, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 2, elevation: 1, borderWidth: 1, borderColor: '#E0E0E0',
  },
  schemesContent: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  schemesHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1,
  },
  schemesTextContainer: {
    flex: 1,
  },
  schemesTitle: {
    fontSize: 18, fontWeight: 'bold', color: '#3A5F0B', marginBottom: 4,
  },
  schemesSubtitle: {
    fontSize: 14, color: '#7c8c78',
  },
  micFab: { position: 'absolute', right: 22, bottom: 33, width: 62, height: 62, backgroundColor: '#3A5F0B', borderRadius: 31, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 7, elevation: 8, zIndex: 91 },
});
