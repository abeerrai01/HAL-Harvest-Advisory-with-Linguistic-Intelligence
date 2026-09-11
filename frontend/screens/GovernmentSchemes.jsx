import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { auth } from '../firebase';
import { getGovernmentSchemes } from '../services/halApi';
import { useTranslation } from '../services/i18n';

export default function GovernmentSchemes({ navigation }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [schemes, setSchemes] = useState([]);
  const [query, setQuery] = useState('');
  const [locationName, setLocationName] = useState('');
  const [lat, setLat] = useState(null);
  const [lon, setLon] = useState(null);
  const [sessionId] = useState('schemes_session_' + Date.now());

  useEffect(() => {
    getCurrentLocation();
    // Load default query on mount after a short delay to ensure location is fetched
    const timer = setTimeout(() => {
      searchSchemes('agricultural schemes for farmers');
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('Location permission denied');
        return;
      }

      const position = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = position.coords;
      setLat(latitude);
      setLon(longitude);

      // Reverse geocode to get location name
      const places = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (places && places[0]) {
        const p = places[0];
        const location = `${p.city || p.district || p.subregion || ''}, ${p.region || p.country || ''}`.trim();
        setLocationName(location || 'India');
      } else {
        setLocationName('India');
      }
    } catch (error) {
      console.error('Error getting location:', error);
      setLocationName('India');
    }
  };

  const searchSchemes = async (searchQuery = null) => {
    const queryToUse = searchQuery || query.trim();
    if (!queryToUse) return;

    const uid = auth?.currentUser?.uid;
    if (!uid) {
      Alert.alert(t('common.error') || 'Error', 'Please login to continue');
      return;
    }

    setLoading(true);
    try {
      const response = await getGovernmentSchemes({
        query: queryToUse,
        uid,
        sessionId,
        locationName,
        lat,
        lon,
      });

      if (response?.schemes && Array.isArray(response.schemes)) {
        setSchemes(response.schemes);
      } else if (response?.schemes?.raw_response) {
        // Handle raw text response
        Alert.alert('Response', response.schemes.raw_response);
      } else {
        setSchemes([]);
        Alert.alert(t('common.info') || 'Info', 'No schemes found');
      }
    } catch (error) {
      console.error('Error fetching schemes:', error);
      Alert.alert(
        t('common.error') || 'Error',
        error.message || 'Failed to fetch schemes. Please try again.'
      );
      setSchemes([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSchemePress = (scheme) => {
    // Navigate to chat screen with scheme context
    navigation.navigate('SchemeChat', {
      scheme,
      sessionId,
      locationName,
      lat,
      lon,
    });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color="#3A5F0B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('dashboard.governmentSchemes') || 'Government Schemes'}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('governmentSchemes.searchPlaceholder') || 'Search for schemes...'}
          placeholderTextColor="#999"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => searchSchemes()}
          returnKeyType="search"
        />
        <TouchableOpacity
          style={styles.searchButton}
          onPress={() => searchSchemes()}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialIcons name="search" size={24} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {/* Location Info */}
      {locationName && (
        <View style={styles.locationInfo}>
          <MaterialIcons name="location-on" size={16} color="#3A5F0B" />
          <Text style={styles.locationText}>
            {t('governmentSchemes.searchingIn') || 'Searching in'}: {locationName} and Full India
          </Text>
        </View>
      )}

      {/* Schemes List */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {schemes.length === 0 && !loading && (
          <View style={styles.emptyState}>
            <MaterialIcons name="inbox" size={64} color="#ccc" />
            <Text style={styles.emptyText}>
              {t('governmentSchemes.noSchemes') || 'No schemes found. Try searching for schemes.'}
            </Text>
          </View>
        )}

        {schemes.map((scheme, index) => (
          <TouchableOpacity
            key={index}
            style={styles.schemeCard}
            onPress={() => handleSchemePress(scheme)}
            activeOpacity={0.7}
          >
            <View style={styles.schemeHeader}>
              <MaterialIcons name="account-balance" size={28} color="#3A5F0B" />
              <View style={styles.schemeTitleContainer}>
                <Text style={styles.schemeName} numberOfLines={2}>
                  {scheme.name}
                </Text>
                {scheme.ministry && (
                  <Text style={styles.schemeMinistry} numberOfLines={1}>
                    {scheme.ministry}
                  </Text>
                )}
              </View>
              <MaterialIcons name="chevron-right" size={24} color="#999" />
            </View>

            {scheme.benefits && (
              <Text style={styles.schemeBenefits} numberOfLines={2}>
                {scheme.benefits}
              </Text>
            )}

            {scheme.eligibility && (
              <View style={styles.eligibilityContainer}>
                <MaterialIcons name="check-circle" size={16} color="#5c7e2b" />
                <Text style={styles.eligibilityText} numberOfLines={1}>
                  {scheme.eligibility}
                </Text>
              </View>
            )}

            <View style={styles.schemeFooter}>
              {scheme.link && (
                <TouchableOpacity
                  style={styles.linkButton}
                  onPress={(e) => {
                    e.stopPropagation();
                    // Handle external link opening if needed
                    Alert.alert('Link', scheme.link);
                  }}
                >
                  <MaterialIcons name="open-in-new" size={16} color="#3A5F0B" />
                  <Text style={styles.linkText}>Learn More</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.chatButton}
                onPress={(e) => {
                  e.stopPropagation();
                  handleSchemePress(scheme);
                }}
              >
                <MaterialIcons name="chat" size={16} color="#fff" />
                <Text style={styles.chatButtonText}>Ask About This</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5DC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: '#F5F5DC',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#3A5F0B',
  },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  searchButton: {
    backgroundColor: '#3A5F0B',
    borderRadius: 12,
    width: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 6,
  },
  locationText: {
    fontSize: 13,
    color: '#666',
    fontStyle: 'italic',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
  schemeCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  schemeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },
  schemeTitleContainer: {
    flex: 1,
  },
  schemeName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  schemeMinistry: {
    fontSize: 13,
    color: '#666',
  },
  schemeBenefits: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
    marginBottom: 10,
  },
  eligibilityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  eligibilityText: {
    fontSize: 13,
    color: '#5c7e2b',
    flex: 1,
  },
  schemeFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#ecf5ec',
  },
  linkText: {
    fontSize: 13,
    color: '#3A5F0B',
    fontWeight: '600',
  },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#3A5F0B',
    flex: 1,
    justifyContent: 'center',
  },
  chatButtonText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
});

