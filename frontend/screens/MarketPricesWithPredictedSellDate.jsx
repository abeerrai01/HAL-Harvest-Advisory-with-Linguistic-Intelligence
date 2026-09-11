import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { getMarketMeta, getMarketPrices, getPredictedSellDateHF } from '../services/halApi';
const cropImg = require('../assets/wheat.png'); // use wheat as placeholder

const width = Dimensions.get('window').width;

// simple dummy data for the price chart (0-100 scale)
const DUMMY_SERIES = [35, 42, 28, 55, 48, 62, 50, 40, 58, 80, 45, 30, 66, 72, 54, 38, 61, 57, 63, 70, 52, 46, 68, 77];

export default function MarketPricesWithPredictedSellDate({ navigation, route }) {
  // Get params from route if available
  const cropFromRoute = route?.params?.crop || 'Rice';
  const marketFromRoute = route?.params?.market || 'Dehradun';
  const districtFromRoute = route?.params?.district || 'Dehradun';
  const dateFromRoute = route?.params?.date || new Date().toISOString().split('T')[0];
  
  const [commodity, setCommodity] = useState(cropFromRoute);
  const [stateName, setStateName] = useState('Uttarakhand');
  const [district, setDistrict] = useState(districtFromRoute); // From route or default to Dehradun
  const [market, setMarket] = useState(marketFromRoute);
  const [date, setDate] = useState(dateFromRoute); // From route or today's date
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [bestToday, setBestToday] = useState(null);
  const [last10, setLast10] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [priceData, setPriceData] = useState(null); // Full API response with prices
  const [priceChange, setPriceChange] = useState(null); // Calculated price change
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [showPicker, setShowPicker] = useState(null); // 'market'|'date' (removed state and district)
  const [dateOptions, setDateOptions] = useState([]);

  useEffect(() => {
    // Generate last 10 days options (for date picker)
    const opts = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      opts.push(d.toISOString().split('T')[0]);
    }
    setDateOptions(opts);
    // Set to today's date
    setDate(new Date().toISOString().split('T')[0]);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const meta = await getMarketMeta({ commodity });
        setStates(meta.states || []);
        setDistricts(meta.districts || []);
        setMarkets(meta.markets || []);
        if (!meta.states?.includes(stateName) && meta.states?.length) setStateName(meta.states[0]);
        if (!meta.districts?.includes(district) && meta.districts?.length) setDistrict(meta.districts[0]);
        if (!meta.markets?.includes(market) && meta.markets?.length) setMarket(meta.markets[0]);
      } catch {}
    })();
  }, [commodity]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        console.log('🔍 Fetching market data for:', { commodity, market, district, date });
        
        // Get market prices (existing API) - for historical data
        try {
          const prices = await getMarketPrices({ commodity, state: stateName, district, market, limit: 20, date });
          console.log('📊 Market prices API response:', JSON.stringify(prices, null, 2));
          setBestToday(prices.best_today || null);
          setLast10(prices.last10 || []);
          
          // Calculate price change if we have historical data
          if (prices.last10 && prices.last10.length >= 2) {
            const current = prices.last10[0]?.modal_price;
            const previous = prices.last10[7]?.modal_price || prices.last10[prices.last10.length - 1]?.modal_price;
            if (current && previous) {
              const change = ((current - previous) / previous) * 100;
              setPriceChange({
                percentage: change,
                isPositive: change >= 0,
              });
              console.log('📈 Price change calculated:', { current, previous, change: change.toFixed(2) + '%' });
            }
          }
        } catch (e) {
          console.error('❌ Market prices API error:', e.message);
          console.error('Error details:', e);
          // Continue even if prices fail
        }
        
        // Get prediction from new HF API (this now returns actual price data)
        try {
          console.log('🔮 Calling prediction API with:', {
            crop: commodity,
            marketName: market,
            districtName: district,
            reportedDate: date,
          });
          
          const pred = await getPredictedSellDateHF({
            crop: commodity,
            marketName: market,
            districtName: district,
            reportedDate: date,
          });
          
          console.log('✅ Prediction API response:', JSON.stringify(pred, null, 2));
          
          // Store full price data
          if (pred) {
            setPriceData(pred);
            
            // Extract predicted modal price - handle both field name formats
            const predictedModalPrice = pred['Predicted Modal Price (₹/Quintal)'] || pred['Predicted Modal Price'] || pred['predicted_modal_price'] || null;
            const minPrice = pred['Min Price (Rs./Quintal)'] || pred['Min Price'] || pred['min_price'] || null;
            const maxPrice = pred['Max Price (Rs./Quintal)'] || pred['Max Price'] || pred['max_price'] || null;
            const arrivals = pred['Arrivals (Tonnes)'] || pred['Arrivals'] || pred['arrivals'] || null;
            
            console.log('💰 Extracted prices:', {
              predictedModalPrice,
              minPrice,
              maxPrice,
              arrivals,
              allKeys: Object.keys(pred),
            });
            
            // Update bestToday with prediction data if available
            if (predictedModalPrice) {
              setBestToday({
                modal_price: predictedModalPrice,
                min_price: minPrice,
                max_price: maxPrice,
                market: pred.Market || pred.Market_Name || pred.market || market,
                district: pred.District || pred.District_Name || pred.district || district,
                commodity: pred.Crop || pred.crop || commodity,
                variety: pred.Variety || pred.variety || null,
                grade: pred.Grade || pred.grade || null,
                arrivals: arrivals,
              });
            }
            
            // Set prediction data - handle both uppercase and mixed case keys
            setPrediction({
              date: pred.Reported_Date || pred['Reported_Date'] || pred.reported_date || date,
              district: pred.District || pred.District_Name || pred.district || district,
              market: pred.Market || pred.Market_Name || pred.market || market,
              crop: pred.Crop || pred.crop || commodity,
              state: pred.State || pred.state || stateName,
              group: pred.Group || pred.group || null,
              grade: pred.Grade || pred.grade || null,
              variety: pred.Variety || pred.variety || null,
              arrivals: arrivals,
              minPrice: minPrice,
              maxPrice: maxPrice,
              predictedModalPrice: predictedModalPrice,
            });
          }
        } catch (e) {
          console.error('❌ Prediction API error:', e.message);
          console.error('Error stack:', e.stack);
          console.error('Error details:', e);
          // Prediction is optional, continue without it
        }
      } catch (e) {
        console.error('❌ General error:', e);
        setError(e?.response?.data?.message || e.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    })();
  }, [commodity, market, date, district, stateName]);
  return (
    <View style={{ flex: 1, backgroundColor: '#f2e8cf' }}>
      {/* Top Bar - left-aligned header only */}
      <View style={styles.appBar}>
        <Text style={styles.title}>Crop Intelligence</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 115 }}>
        {/* Error Display */}
        {error && (
          <View style={styles.errorContainer}>
            <MaterialIcons name="error-outline" size={20} color="#d32f2f" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {/* Filters */}
        <View style={styles.filtersRow}>
          <Text style={styles.filterLabel}>District</Text>
          <Text style={styles.filterValue}>{district}</Text>
        </View>
        <View style={styles.filtersRow}>
          <Text style={styles.filterLabel}>Market</Text>
          <Text style={styles.filterValue} onPress={() => setShowPicker('market')}>{market || 'Select'}</Text>
        </View>
        <View style={styles.filtersRow}>
          <Text style={styles.filterLabel}>Crop</Text>
          <Text style={styles.filterValue}>{commodity}</Text>
        </View>
        <View style={styles.filtersRow}>
          <Text style={styles.filterLabel}>Date</Text>
          <Text style={styles.filterValue} onPress={() => setShowPicker('date')}>
            {date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Today'}
          </Text>
        </View>
        {/* Crop details card */}
        <View style={styles.cropCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Image source={cropImg} style={styles.cropIcon} />
            <View>
              <Text style={styles.cropName}>{commodity}</Text>
              <Text style={styles.cropAddr}>{market} Mandi, {stateName}</Text>
            </View>
          </View>
        </View>
        {/* Price + chart card */}
        <View style={styles.sectionCard}>
          <View style={styles.secHeaderRow}>
            <View>
              <Text style={styles.secTitle}>Current Price & Trend</Text>
              <Text style={styles.secSubtitle}>Last 30 Days</Text>
            </View>
            <MaterialIcons name="monitoring" size={27} color="#6a994e" />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 7, marginTop: 2 }}>
            <Text style={styles.price}>
              {bestToday?.modal_price 
                ? `₹${Math.round(bestToday.modal_price).toLocaleString('en-IN')}` 
                : priceData?.['Predicted Modal Price (₹/Quintal)']
                ? `₹${Math.round(priceData['Predicted Modal Price (₹/Quintal)']).toLocaleString('en-IN')}`
                : (loading ? 'Loading...' : '—')}
            </Text>
            <Text style={styles.priceSuffix}>/Quintal</Text>
          </View>
          {bestToday?.min_price && bestToday?.max_price && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Text style={styles.priceRange}>
                Range: ₹{Math.round(bestToday.min_price).toLocaleString('en-IN')} - ₹{Math.round(bestToday.max_price).toLocaleString('en-IN')}
              </Text>
            </View>
          )}
          {priceChange && (
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 2 }}>
              <Text style={[styles.priceChange, priceChange.isPositive ? styles.priceChangePositive : styles.priceChangeNegative]}>
                <MaterialIcons 
                  name={priceChange.isPositive ? "arrow-upward" : "arrow-downward"} 
                  size={13} 
                  color={priceChange.isPositive ? "#6a994e" : "#d32f2f"} 
                /> 
                {priceChange.isPositive ? '+' : ''}{priceChange.percentage.toFixed(1)}%
              </Text>
              <Text style={styles.priceChangeSub}>from last week</Text>
            </View>
          )}
          {bestToday?.arrivals && (
            <View style={{ marginTop: 4 }}>
              <Text style={styles.arrivalsText}>
                Arrivals: {bestToday.arrivals} Tonnes
              </Text>
            </View>
          )}
          {/* Simple bars from last10 modal_price */}
          <View style={styles.chartMock}>
            <View style={styles.chartGradient} />
            <View style={styles.barsRow}>
              {(last10 || []).slice(0, 24).map((p, idx) => {
                const v = Number(p.modal_price || 0);
                const maxPrice = bestToday?.modal_price || priceData?.['Predicted Modal Price (₹/Quintal)'] || Math.max(...(last10 || []).map(x => Number(x.modal_price || 0))) || v || 1;
                const h = isFinite(v) && v > 0 && isFinite(maxPrice) && maxPrice > 0
                  ? 20 + Math.min(80, Math.max(10, (v / maxPrice) * 60))
                  : 20;
                return <View key={idx} style={[styles.bar, { height: h }]} />;
              })}
              {(!last10 || last10.length === 0) && !loading && (
                <View style={styles.noDataContainer}>
                  <Text style={styles.noDataText}>No historical data available</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        {/* Predicted Sell Date */}
        <View style={styles.sectionCard}>
          <View style={styles.secHeaderRow}>
            <View>
              <Text style={styles.secTitle}>Predicted Sell Date</Text>
              <Text style={styles.secSubtitle}>AI Recommendation</Text>
            </View>
            <MaterialIcons name="auto-awesome" size={27} color="#6a994e" />
          </View>
          {prediction?.date || priceData ? (
            <>
              {prediction?.predictedModalPrice && (
                <View style={styles.predictedPriceCard}>
                  <Text style={styles.predictedPriceLabel}>Predicted Modal Price</Text>
                  <Text style={styles.predictedPriceValue}>
                    ₹{Math.round(prediction.predictedModalPrice).toLocaleString('en-IN')}/Quintal
                  </Text>
                </View>
              )}
              <View style={styles.predictionInfo}>
                {prediction?.district && (
                  <Text style={styles.dateReason}>
                    <Text style={styles.dateReasonStrong}>District:</Text> {prediction.district}
                  </Text>
                )}
                {prediction?.market && (
                  <Text style={styles.dateReason}>
                    <Text style={styles.dateReasonStrong}>Market:</Text> {prediction.market}
                  </Text>
                )}
                {prediction?.crop && (
                  <Text style={styles.dateReason}>
                    <Text style={styles.dateReasonStrong}>Crop:</Text> {prediction.crop}
                  </Text>
                )}
                {prediction?.variety && (
                  <Text style={styles.dateReason}>
                    <Text style={styles.dateReasonStrong}>Variety:</Text> {prediction.variety}
                  </Text>
                )}
                {prediction?.grade && (
                  <Text style={styles.dateReason}>
                    <Text style={styles.dateReasonStrong}>Grade:</Text> {prediction.grade}
                  </Text>
                )}
                {prediction?.group && (
                  <Text style={styles.dateReason}>
                    <Text style={styles.dateReasonStrong}>Group:</Text> {prediction.group}
                  </Text>
                )}
                {prediction?.arrivals !== null && prediction?.arrivals !== undefined && (
                  <Text style={styles.dateReason}>
                    <Text style={styles.dateReasonStrong}>Arrivals:</Text> {prediction.arrivals} Tonnes
                  </Text>
                )}
                {prediction?.minPrice && prediction?.maxPrice && (
                  <Text style={styles.dateReason}>
                    <Text style={styles.dateReasonStrong}>Price Range:</Text> ₹{Math.round(prediction.minPrice).toLocaleString('en-IN')} - ₹{Math.round(prediction.maxPrice).toLocaleString('en-IN')}/Quintal
                  </Text>
                )}
                {prediction?.date && (
                  <Text style={styles.dateReason}>
                    <Text style={styles.dateReasonStrong}>Reported Date:</Text> {new Date(prediction.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </Text>
                )}
              </View>
            </>
          ) : (
            <View style={styles.noPredictionContainer}>
              <Text style={styles.noPredictionText}>
                {loading ? 'Loading prediction...' : 'No prediction data available'}
              </Text>
            </View>
          )}
        </View>
        {/* Historical Performance */}
        <View style={styles.sectionCard}>
          <View style={styles.secHeaderRow}>
            <View>
              <Text style={styles.secTitle}>Historical Performance</Text>
              <Text style={styles.secSubtitle}>Vs. Same Period</Text>
            </View>
            <MaterialIcons name="history" size={27} color="#6a994e" />
          </View>
          <View style={{ marginTop: 12, gap: 8 }}>
            {last10 && last10.length > 0 && (() => {
              const avgPrice = last10.reduce((sum, p) => sum + (Number(p.modal_price) || 0), 0) / last10.length;
              const prices = last10.map(p => Number(p.modal_price) || 0).filter(p => p > 0);
              const minPrice = Math.min(...prices);
              const maxPrice = Math.max(...prices);
              const volatility = prices.length > 1 ? ((maxPrice - minPrice) / avgPrice * 100) : 0;
              const volatilityLabel = volatility < 10 ? 'Low' : volatility < 25 ? 'Moderate' : 'High';
              
              return (
                <>
                  <View style={styles.histRow}>
                    <Text style={styles.histLabel}>Average Price (Last {last10.length} records):</Text>
                    <Text style={styles.histVal}>₹{Math.round(avgPrice).toLocaleString('en-IN')}</Text>
                  </View>
                  {last10.length >= 5 && (
                    <View style={styles.histRow}>
                      <Text style={styles.histLabel}>Price Range:</Text>
                      <Text style={styles.histVal}>₹{Math.round(minPrice).toLocaleString('en-IN')} - ₹{Math.round(maxPrice).toLocaleString('en-IN')}</Text>
                    </View>
                  )}
                  <View style={styles.histRow}>
                    <Text style={styles.histLabel}>Volatility:</Text>
                    <Text style={styles.histVolatility}>{volatilityLabel} ({volatility.toFixed(1)}%)</Text>
                  </View>
                </>
              );
            })()}
            {(!last10 || last10.length === 0) && (
              <Text style={styles.noDataText}>No historical data available</Text>
            )}
          </View>
        </View>
        {/* Market Influencers */}
        <View style={styles.sectionCard}>
          <View style={styles.secHeaderRow}>
            <View>
              <Text style={styles.secTitle}>Market Influencers</Text>
              <Text style={styles.secSubtitle}>Key Factors</Text>
            </View>
            <MaterialIcons name="hub" size={27} color="#6a994e" />
          </View>
          <View style={styles.influencersGrid}>
            {[
              { icon: 'rainy', color: '#edc35b', bg: '#fff9e7', title: 'Weather', sub: 'Favorable' },
              { icon: 'shopping-cart', color: '#f68c3a', bg: '#fff3e7', title: 'Demand', sub: 'High' },
              { icon: 'local-shipping', color: '#6ca4e6', bg: '#eef6ff', title: 'Supply', sub: 'Moderate' },
              { icon: 'account-balance', color: '#a48bfc', bg: '#f3eefe', title: 'Policy', sub: 'Stable' },
            ].map((it, idx) => (
              <View key={idx} style={styles.influencerCard}>
                <View style={[styles.influencerIconWrap, { backgroundColor: it.bg }]}>
                  <MaterialIcons name={it.icon} size={26} color={it.color} />
                </View>
                <Text style={styles.influencerName}>{it.title}</Text>
                <Text style={styles.influencerVal}>{it.sub}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      {/* Picker Modal */}
      {showPicker && (
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Select {showPicker}</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {(showPicker === 'market' ? markets : dateOptions).map((it) => (
                <Text key={it} style={styles.pickerItem} onPress={() => {
                  if (showPicker === 'market') {
                    setMarket(it);
                  } else {
                    setDate(it);
                  }
                  setShowPicker(null);
                }}>
                  {showPicker === 'date' 
                    ? new Date(it).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    : it
                  }
                </Text>
              ))}
            </ScrollView>
            <Text style={styles.pickerCancel} onPress={() => setShowPicker(null)}>Cancel</Text>
          </View>
        </View>
      )}
      {/* Sticky Bottom Nav */}
     
    </View>
  );
}

const styles = StyleSheet.create({
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingTop: 32,
    paddingBottom: 8,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderColor: '#E0E0E0',
  },
  title: {
    flex: 1,
    color: '#386641',
    fontWeight: 'bold',
    fontSize: 20,
    textAlign: 'left',
  },
  cropCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 14,
    marginTop: 15,
    marginBottom: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    elevation: 1,
  },
  cropIcon: {
    width: 56,
    height: 56,
    borderRadius: 10,
    marginRight: 5,
    resizeMode: 'cover',
  },
  cropName: { fontWeight: 'bold', fontSize: 20, color: '#212121', marginBottom: 1 },
  cropAddr: { color: '#616161', fontSize: 15 },
  sectionCard: { backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 14, marginBottom: 14, padding: 15, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 2, borderWidth: 1, borderColor: '#e0e0e0', elevation: 1, overflow: 'hidden' },
  secHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 5 },
  secTitle: { fontWeight: 'bold', fontSize: 16, color: '#212121', marginBottom: 1 },
  secSubtitle: { color: '#616161', fontSize: 12 },
  price: { fontWeight: 'bold', fontSize: 27, color: '#212121', letterSpacing: -1 },
  priceSuffix: { color: '#616161', fontSize: 15 },
  priceChange: { flexDirection: 'row', color: '#6a994e', fontWeight: '700', fontSize: 16 },
  priceChangePositive: { color: '#6a994e' },
  priceChangeNegative: { color: '#d32f2f' },
  priceChangeSub: { color: '#616161', fontSize: 13 },
  priceRange: { color: '#616161', fontSize: 13, fontWeight: '500' },
  arrivalsText: { color: '#616161', fontSize: 13, fontWeight: '500' },
  predictedPriceCard: {
    backgroundColor: '#ebffe4',
    borderColor: '#cdf7c1',
    borderWidth: 1,
    borderRadius: 11,
    padding: 14,
    marginBottom: 12,
    alignItems: 'center',
  },
  predictedPriceLabel: { color: '#616161', fontSize: 13, marginBottom: 4 },
  predictedPriceValue: { color: '#212121', fontSize: 24, fontWeight: 'bold' },
  noDataContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
  noDataText: { color: '#999', fontSize: 12, fontStyle: 'italic' },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffebee',
    borderColor: '#d32f2f',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 10,
  },
  errorText: {
    flex: 1,
    color: '#d32f2f',
    fontSize: 13,
    fontWeight: '500',
  },
  chartMock: { marginTop: 10, height: 100, width: '100%', borderRadius: 12, backgroundColor: 'rgba(106,153,78,0.08)', overflow: 'hidden', position: 'relative', borderWidth: 1, borderColor: 'rgba(106,153,78,0.15)' },
  chartGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70, backgroundColor: 'rgba(106,153,78,0.12)' },
  barsRow: { position: 'absolute', left: 10, right: 10, bottom: 8, top: 8, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  bar: { width: 6, backgroundColor: '#6a994e', borderTopLeftRadius: 6, borderTopRightRadius: 6, opacity: 0.85 },
  dateCardWrap: { backgroundColor: '#ebffe4', borderColor: '#cdf7c1', borderWidth: 1, borderRadius: 11, flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, marginTop: 4, marginBottom: 6, marginLeft: 1, width: 220 },
  dateNumWrap: { alignItems: 'center', marginRight: 15, justifyContent: 'center', minWidth: 40 },
  dateNum: { color: '#FCA311', fontWeight: 'bold', fontSize: 32, letterSpacing: 1, lineHeight: 34 },
  dateMonthWrap: { justifyContent: 'center', minWidth: 70 },
  dateMonth: { color: '#212121', fontSize: 21, fontWeight: 'bold', marginTop: 3, lineHeight: 20 },
  dateYear: { color: '#616161', fontSize: 15, marginTop: 2 },
  dateReason: { color: '#616161', fontSize: 13, marginTop: 4, marginLeft: 2 },
  dateReasonStrong: { color: '#212121', fontWeight: 'bold' },
  predictionInfo: { marginTop: 12, padding: 12, backgroundColor: '#f9f9f9', borderRadius: 8, gap: 4 },
  noPredictionContainer: { alignItems: 'center', paddingVertical: 24 },
  noPredictionText: { color: '#616161', fontSize: 14, fontStyle: 'italic' },
  histRow: { flexDirection: 'row', alignItems: 'center', marginTop: 1, gap: 9, justifyContent: 'space-between' },
  histLabel: { color: '#616161', fontSize: 14, flex: 1 },
  histVal: { color: '#212121', fontWeight: 'bold', fontSize: 16, minWidth: 67, textAlign: 'right' },
  histGrowth: { color: '#6a994e', fontWeight: 'bold', fontSize: 16, minWidth: 67, textAlign: 'right' },
  histVolatility: { color: '#a1887f', fontWeight: 'bold', fontSize: 16, minWidth: 67, textAlign: 'right' },
  influencersGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 12, marginTop: 8 },
  influencerCard: { flexBasis: '48%', maxWidth: '48%', backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#ececec', paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', gap: 6 },
  influencerIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  influencerName: { color: '#212121', fontWeight: 'bold', fontSize: 14 },
  influencerVal: { color: '#616161', fontSize: 12 },
  stickyNavBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', borderTopWidth: 1, borderColor: '#e0e0e0', height: 68, paddingBottom: 8, paddingTop: 3, shadowColor: '#000', shadowOpacity: 0.085, shadowRadius: 7, elevation: 8 },
  navItem: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: 1 },
  navItemActive: {},
  navLabel: { fontSize: 12, marginTop: 3, color: '#87946b', fontWeight: '500' },
  navLabelActive: { fontSize: 12, color: '#386641', fontWeight: 'bold', marginTop: 3 },
  filtersRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginHorizontal: 14, marginTop: 10, borderWidth: 1, borderColor: '#eee' },
  filterLabel: { color: '#616161', fontSize: 13, fontWeight: '700' },
  filterValue: { color: '#212121', fontSize: 14, fontWeight: '700' },
  pickerOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  pickerCard: { width: '86%', backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  pickerTitle: { fontWeight: '800', color: '#2a2a2a', fontSize: 16, marginBottom: 8 },
  pickerItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f1f1', color: '#333' },
  pickerCancel: { alignSelf: 'flex-end', marginTop: 10, color: '#386641', fontWeight: '800' },
});
