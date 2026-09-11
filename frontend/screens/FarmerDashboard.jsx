import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Dimensions, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../services/i18n';

const width = Dimensions.get('window').width;

// Placeholder profile and weather images
const PROFILE_IMG = require('../assets/profile_placeholder.png');
const WEATHER_IMG = require('../assets/weather_sunny.png');
const WHEAT_IMG = require('../assets/wheat_crop.png');
const SOYBEAN_IMG = require('../assets/soybean_field.png');

const navigationGrid = [
  {
    icon: 'grass',
    title: 'Crop Advisory',
    subtitle: 'Get advice',
    color: '#346751',
    translationKey: 'cropAdvisory',
  },
  {
    icon: 'bug-report',
    title: 'Pest & Disease',
    subtitle: '1 new alert',
    color: '#346751',
    alert: true,
    translationKey: 'pestDisease',
  },
  {
    icon: 'storefront',
    title: 'Market Prices',
    subtitle: 'View rates',
    color: '#346751',
    translationKey: 'marketPrices',
  },
  {
    icon: 'layers',
    title: 'Soil Health',
    subtitle: 'Check status',
    color: '#346751',
    translationKey: 'soilHealth',
  },
];

const farms = [
  {
    image: WHEAT_IMG,
    crop: 'Wheat Crop',
    detail: 'Next Action: Irrigation',
  },
  {
    image: SOYBEAN_IMG,
    crop: 'Soybean Field',
    detail: 'Stage: Flowering',
  },
  {
    image: null,
    crop: null,
    detail: null,
    add: true,
  },
];

export default function FarmerDashboard() {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, backgroundColor: '#F8F9FA' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 112 }}>
        {/* Top App Bar */}
        <View style={styles.appBarBox}>
          <View style={styles.appBarRow}>
            <Image source={PROFILE_IMG} style={styles.avatar} />
            <View style={styles.langRow}>
              <MaterialIcons name="language" size={22} color="#346751" />
              <Text style={styles.langText}>English</Text>
            </View>
          </View>
          <Text style={styles.greeting}>{t('dashboard.namaste')}, Ramesh</Text>
        </View>
        {/* Weather Summary */}
        <View style={styles.weatherCardBox}>
          <View style={styles.weatherCardContainer}>
            <View style={{ flex: 2, justifyContent: 'center' }}>
              <Text style={styles.weatherLocation}>Bhopal, Madhya Pradesh</Text>
              <Text style={styles.weatherMain}>32°C Sunny</Text>
              <Text style={styles.weatherSub}>{t('dashboard.clearSkies')} {t('dashboard.rainExpected')} 2 {t('dashboard.hours')}.</Text>
            </View>
            <Image source={WEATHER_IMG} style={styles.weatherImg} />
          </View>
        </View>
        {/* Main Navigation Grid */}
        <View style={styles.gridBox}>
          <View style={styles.gridRow}>
            {navigationGrid.map((item, idx) => (
              <TouchableOpacity key={item.title} style={styles.gridItem}>
                <MaterialIcons name={item.icon} size={32} color={item.color} />
                <View style={{ gap: 2 }}>
                  <Text style={styles.gridTitle}>{t(`dashboard.${item.translationKey}`)}</Text>
                  <Text style={[styles.gridSubtitle, item.alert && styles.alertText]}>
                    {item.subtitle === 'Get advice' ? t('dashboard.getAdvice') : item.subtitle === '1 new alert' ? `1 ${t('dashboard.newAlert')}` : item.subtitle === 'View rates' ? t('dashboard.viewRates') : item.subtitle === 'Check status' ? t('dashboard.checkStatus') : item.subtitle}
                  </Text>
                </View>
                {item.alert && <View style={styles.alertDot} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
        {/* My Farm Section */}
        <Text style={styles.myFarmTitle}>{t('dashboard.myFarm')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.myFarmScroll}>
          {farms.map((farm, idx) => (
            farm.add ? (
              <TouchableOpacity key={idx} style={styles.addFarmCard}>
                <MaterialIcons name="add-circle" size={40} color="#346751" />
                <Text style={styles.addFarmText}>{t('dashboard.addField')}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.farmCard} key={farm.crop}>
                <Image source={farm.image} style={styles.farmImg} />
                <View style={{ marginTop: 4 }}>
                  <Text style={styles.farmCrop}>{farm.crop}</Text>
                  <Text style={styles.farmDetail}>{farm.detail}</Text>
                </View>
              </View>
            )
          ))}
        </ScrollView>
      </ScrollView>
      {/* FAB - AI Mic Assistant */}
      <TouchableOpacity style={styles.fab} activeOpacity={0.8}>
        <MaterialIcons name="mic" size={40} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.07,
  shadowOffset: { width: 0, height: 1 },
  shadowRadius: 8,
  elevation: 4,
}

const styles = StyleSheet.create({
  appBarBox: {
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#F8F9FA',
  },
  appBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    justifyContent: 'space-between',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    resizeMode: 'cover',
    backgroundColor: '#ccc',
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  langText: {
    color: '#346751',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 6,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginTop: 12,
    letterSpacing: -1,
  },
  weatherCardBox: { paddingHorizontal: 16, paddingTop: 2, },
  weatherCardContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#fff',
    marginBottom: 8,
    ...CARD_SHADOW,
  },
  weatherLocation: {
    fontSize: 14,
    color: '#636366',
    marginBottom: 1,
    fontWeight: '500',
  },
  weatherMain: {
    fontSize: 23,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginBottom: 1,
  },
  weatherSub: {
    fontSize: 14,
    color: '#D39E00',
    fontWeight: '400',
    marginTop: 2,
  },
  weatherImg: {
    width: 62,
    height: 62,
    resizeMode: 'contain',
    marginLeft: 6,
    borderRadius: 12,
    backgroundColor: '#f8f9fa',
  },
  gridBox: { paddingHorizontal: 7, paddingTop: 6, },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    justifyContent: 'space-between',
  },
  gridItem: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    padding: 13,
    flex: 1,
    minWidth: width / 2.15,
    maxWidth: width / 2.1,
    marginVertical: 4,
    marginHorizontal: 2,
    alignItems: 'center',
    position: 'relative',
    ...CARD_SHADOW,
  },
  gridTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#1C1C1E',
    marginTop: 4,
  },
  gridSubtitle: {
    color: '#636366',
    fontSize: 13,
  },
  alertDot: {
    position: 'absolute',
    right: 15,
    top: 14,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFC107',
    borderWidth: 1,
    borderColor: '#fff',
  },
  alertText: {
    color: '#D39E00',
    fontWeight: '600',
  },
  myFarmTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1C1C1E',
    marginLeft: 18,
    marginTop: 18,
    marginBottom: 8,
  },
  myFarmScroll: {
    flexDirection: 'row',
    gap: 13,
    paddingHorizontal: 13,
    paddingBottom: 32,
    alignItems: 'flex-start',
  },
  farmCard: {
    width: 176,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 7,
    marginRight: 9,
    ...CARD_SHADOW,
  },
  farmImg: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 11,
    backgroundColor: '#eee',
  },
  farmCrop: {
    color: '#1C1C1E',
    fontWeight: '600',
    fontSize: 16,
  },
  farmDetail: {
    color: '#636366',
    fontSize: 13,
    marginTop: 1,
  },
  addFarmCard: {
    width: 176,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    padding: 14,
    gap: 9,
    borderStyle: 'dashed',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    ...CARD_SHADOW,
  },
  addFarmText: {
    color: '#346751',
    fontSize: 15,
    fontWeight: '500',
    marginTop: 2,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 26,
    backgroundColor: '#346751',
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    ...CARD_SHADOW,
  },
});
