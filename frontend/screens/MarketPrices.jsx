import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getPredictedSellDateHF } from '../services/halApi';
import { useTranslation } from '../services/i18n';

// Common crops available in Uttarakhand
const AVAILABLE_CROPS = [
  { name: 'Rice', displayName: 'Rice (चावल)', icon: require('../assets/wheat.png') }, // Using wheat as placeholder
  { name: 'Wheat', displayName: 'Wheat (गेहूं)', icon: require('../assets/wheat.png') },
  { name: 'Tomato', displayName: 'Tomato (टमाटर)', icon: require('../assets/tomato.png') },
  { name: 'Onion', displayName: 'Onion (प्याज)', icon: require('../assets/onion.png') },
  { name: 'Potato', displayName: 'Potato (आलू)', icon: require('../assets/wheat.png') },
  { name: 'Maize', displayName: 'Maize (मक्का)', icon: require('../assets/wheat.png') },
];

// Common markets in Dehradun district
const AVAILABLE_MARKETS = [
  'Dehradun',
  'Vikasnagar',
  'Haridwar',
  'Rishikesh',
  'Mussoorie',
];

export default function MarketPrices({ navigation }) {
  const { t } = useTranslation();
  const [selectedCrop, setSelectedCrop] = useState('Rice');
  const [selectedMarket, setSelectedMarket] = useState('Dehradun');
  const [showCropPicker, setShowCropPicker] = useState(false);
  const [showMarketPicker, setShowMarketPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [cropData, setCropData] = useState(null);
  const [error, setError] = useState(null);
  const todayDate = new Date().toISOString().split('T')[0];

  // Fetch crop data when crop or market changes
  useEffect(() => {
    fetchCropData();
  }, [selectedCrop, selectedMarket]);

  const fetchCropData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await getPredictedSellDateHF({
        crop: selectedCrop,
        marketName: selectedMarket,
        districtName: 'Dehradun',
        reportedDate: todayDate,
      });
      
      setCropData(data);
    } catch (e) {
      console.error('❌ Error fetching crop data:', e);
      setError(e.message || 'Failed to load crop data');
      setCropData(null);
    } finally {
      setLoading(false);
    }
  };

  // Filter crops based on search
  const filteredCrops = AVAILABLE_CROPS.filter(crop =>
    crop.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    crop.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Get current crop display info
  const currentCrop = AVAILABLE_CROPS.find(c => c.name === selectedCrop) || AVAILABLE_CROPS[0];

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5DC' }}>
      {/* Top App Bar */}
      <View style={styles.appBar}>
        <Text style={styles.appTitle}>{t('marketPrices.title')}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 96 }}>
        {/* Filters */}
        <View style={styles.chipsRow}>
          <TouchableOpacity 
            style={styles.chip} 
            activeOpacity={0.8}
            onPress={() => setShowCropPicker(true)}
          >
            <MaterialIcons name="agriculture" size={20} color="#3A5F0B" />
            <Text style={styles.chipText}>{currentCrop.displayName}</Text>
            <MaterialIcons name="arrow-drop-down" size={20} color="#3A5F0B" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.chip} 
            activeOpacity={0.8}
            onPress={() => setShowMarketPicker(true)}
          >
            <MaterialIcons name="location-on" size={20} color="#3A5F0B" />
            <Text style={styles.chipText}>{selectedMarket} Mandi</Text>
            <MaterialIcons name="arrow-drop-down" size={20} color="#3A5F0B" />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <View style={styles.searchInputBox}>
            <MaterialIcons name="search" size={20} color="#666" style={{ marginLeft: 8 }} />
            <TextInput 
              placeholder={t('marketPrices.search') || 'Search crops...'} 
              placeholderTextColor="#6669" 
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        {/* Loading State */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#3A5F0B" />
            <Text style={styles.loadingText}>Loading crop data...</Text>
          </View>
        )}

        {/* Error State */}
        {error && !loading && (
          <View style={styles.errorContainer}>
            <MaterialIcons name="error-outline" size={48} color="#C62828" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={fetchCropData}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* All Crops */}
        <Text style={styles.sectionTitle}>{t('marketPrices.allCrops') || 'All Crops'}</Text>
        
        {filteredCrops.map((crop, idx) => {
          const isSelected = crop.name === selectedCrop;
          const hasData = cropData && crop.name === selectedCrop;
          
          return (
            <TouchableOpacity
              key={`crop-${idx}`}
              style={[styles.card, isSelected && styles.cardSelected]}
              activeOpacity={0.85}
              onPress={() => {
                setSelectedCrop(crop.name);
                navigation.navigate('MarketPricesWithPredictedSellDate', {
                  crop: crop.name,
                  market: selectedMarket,
                  district: 'Dehradun',
                  date: todayDate,
                });
              }}
            >
              <View style={styles.cardTopRow}>
                <View style={styles.cardLeft}>
                  <Image source={crop.icon} style={styles.avatar} />
                  <Text style={styles.cardTitle}>{crop.displayName}</Text>
                </View>
                <MaterialIcons 
                  name={isSelected ? "star" : "star-border"} 
                  size={22} 
                  color={isSelected ? "#3A5F0B" : "#999"} 
                />
              </View>
              <View style={styles.divider} />
              
              {hasData && !loading ? (
                <>
                  <View style={styles.priceSplitRow}>
                    <View style={styles.splitCol}>
                      <Text style={styles.splitLabel}>{t('marketPrices.district') || 'District'}</Text>
                      <Text style={styles.splitValue}>{cropData.District_Name || 'Dehradun'}</Text>
                    </View>
                    <View style={[styles.splitCol, styles.splitColMid]}>
                      <Text style={styles.splitLabel}>{t('marketPrices.market') || 'Market'}</Text>
                      <Text style={[styles.splitValue, { color: '#3A5F0B', fontWeight: 'bold', fontSize: 16 }]}>
                        {cropData.Market_Name || selectedMarket}
                      </Text>
                    </View>
                    <View style={styles.splitCol}>
                      <Text style={styles.splitLabel}>{t('marketPrices.date') || 'Date'}</Text>
                      <Text style={styles.splitValue}>
                        {cropData.Reported_Date ? new Date(cropData.Reported_Date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.deltaRow}>
                    <MaterialIcons name="info-outline" size={18} color="#3A5F0B" />
                    <Text style={[styles.deltaText, { color: '#3A5F0B' }]}>
                      Tap to view detailed prediction
                    </Text>
                  </View>
                </>
              ) : (
                <View style={styles.noDataRow}>
                  <Text style={styles.noDataText}>Tap to view details and predictions</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {/* Data source footer */}
        <View style={{ alignItems: 'center', marginTop: 16, paddingBottom: 8 }}>
          <Text style={{ color: '#3338', fontSize: 12 }}>{t('marketPrices.dataSource') || 'Data from Uttarakhand Mandi API'}</Text>
        </View>
      </ScrollView>

      {/* Crop Picker Modal */}
      {showCropPicker && (
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Select Crop</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {AVAILABLE_CROPS.map((crop) => (
                <TouchableOpacity
                  key={crop.name}
                  style={[styles.pickerItem, selectedCrop === crop.name && styles.pickerItemSelected]}
                  onPress={() => {
                    setSelectedCrop(crop.name);
                    setShowCropPicker(false);
                  }}
                >
                  <Text style={[styles.pickerItemText, selectedCrop === crop.name && styles.pickerItemTextSelected]}>
                    {crop.displayName}
                  </Text>
                  {selectedCrop === crop.name && (
                    <MaterialIcons name="check" size={20} color="#3A5F0B" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.pickerCancel} onPress={() => setShowCropPicker(false)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Market Picker Modal */}
      {showMarketPicker && (
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Select Market</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {AVAILABLE_MARKETS.map((market) => (
                <TouchableOpacity
                  key={market}
                  style={[styles.pickerItem, selectedMarket === market && styles.pickerItemSelected]}
                  onPress={() => {
                    setSelectedMarket(market);
                    setShowMarketPicker(false);
                  }}
                >
                  <Text style={[styles.pickerItemText, selectedMarket === market && styles.pickerItemTextSelected]}>
                    {market}
                  </Text>
                  {selectedMarket === market && (
                    <MaterialIcons name="check" size={20} color="#3A5F0B" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.pickerCancel} onPress={() => setShowMarketPicker(false)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingTop: 32,
    paddingBottom: 7,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderColor: '#E0E0E0',
  },
  appTitle: { flex: 1, textAlign: 'left', fontWeight: 'bold', fontSize: 20, color: '#212121' },
  chipsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(58,95,11,0.2)', paddingHorizontal: 14, height: 40, borderRadius: 999, gap: 6 },
  chipText: { color: '#3A5F0B', fontSize: 14, fontWeight: '600' },
  searchWrap: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 8 },
  searchInputBox: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: 16, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 2, borderWidth: 1, borderColor: '#E0E0E0' },
  searchInput: { flex: 1, color: '#333', fontSize: 16, paddingHorizontal: 8 },
  sectionTitle: { fontWeight: 'bold', fontSize: 18, color: '#333', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  card: { backgroundColor: '#FFFFFF', marginHorizontal: 14, marginVertical: 8, borderRadius: 14, padding: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, elevation: 1, borderWidth: 1, borderColor: '#E0E0E0' },
  cardSelected: { borderColor: '#3A5F0B', borderWidth: 2, backgroundColor: '#f0f7ed' },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, resizeMode: 'cover' },
  cardTitle: { fontWeight: 'bold', color: '#333', fontSize: 16 },
  divider: { height: 1, backgroundColor: '#E0E0E0', marginVertical: 10 },
  priceSplitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  splitCol: { alignItems: 'center', flex: 1 },
  splitColMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#E0E0E0', paddingHorizontal: 12 },
  splitLabel: { fontSize: 12, color: '#6669', marginBottom: 2 },
  splitValue: { fontSize: 14, color: '#333' },
  deltaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 8 },
  deltaText: { fontSize: 14, fontWeight: '600' },
  noDataRow: { alignItems: 'center', paddingVertical: 8 },
  noDataText: { fontSize: 13, color: '#666', fontStyle: 'italic' },
  loadingContainer: { alignItems: 'center', paddingVertical: 40 },
  loadingText: { marginTop: 12, color: '#666', fontSize: 14 },
  errorContainer: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  errorText: { marginTop: 12, color: '#C62828', fontSize: 14, textAlign: 'center' },
  retryButton: { marginTop: 16, backgroundColor: '#3A5F0B', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  pickerOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  pickerCard: { width: '85%', maxWidth: 400, backgroundColor: '#fff', borderRadius: 16, padding: 20, maxHeight: '80%' },
  pickerTitle: { fontWeight: 'bold', fontSize: 18, color: '#212121', marginBottom: 16 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 12, borderRadius: 8, marginBottom: 4, backgroundColor: '#f9f9f9' },
  pickerItemSelected: { backgroundColor: '#e8f5e9', borderWidth: 1, borderColor: '#3A5F0B' },
  pickerItemText: { fontSize: 16, color: '#333' },
  pickerItemTextSelected: { color: '#3A5F0B', fontWeight: 'bold' },
  pickerCancel: { marginTop: 16, alignSelf: 'flex-end' },
  pickerCancelText: { color: '#3A5F0B', fontWeight: 'bold', fontSize: 16 },
});
