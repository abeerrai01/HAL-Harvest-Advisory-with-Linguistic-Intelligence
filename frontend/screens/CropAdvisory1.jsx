import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Speech from 'expo-speech';
import { addDoc, collection } from 'firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, KeyboardAvoidingView, Linking, Modal, Platform, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Polygon } from 'react-native-maps';
import { auth, db } from '../firebase';
import { createJob, extractTextFromSoilHealthCard, getAiRecommendations, getFieldJobs, getNearestKisanCenters, getReport, getWeatherAdvisory, uploadSoilHealthCard } from '../services/halApi';
import { useTranslation } from '../services/i18n';

const wheatImage = require('../assets/wheat_card.png');

// Uttarakhand-specific data
const UTTARAKHAND_DISTRICTS = [
  { name: 'Almora', value: 'almora' },
  { name: 'Bageshwar', value: 'bageshwar' },
  { name: 'Chamoli', value: 'chamoli' },
  { name: 'Champawat', value: 'champawat' },
  { name: 'Dehradun', value: 'dehradun' },
  { name: 'Haridwar', value: 'haridwar' },
  { name: 'Nainital', value: 'nainital' },
  { name: 'Pauri Garhwal', value: 'pauri_garhwal' },
  { name: 'Pithoragarh', value: 'pithoragarh' },
  { name: 'Rudraprayag', value: 'rudraprayag' },
  { name: 'Tehri Garhwal', value: 'tehri_garhwal' },
  { name: 'Udham Singh Nagar', value: 'udham_singh_nagar' },
  { name: 'Uttarkashi', value: 'uttarkashi' },
];

const UTTARAKHAND_SOIL_TYPES = {
  'almora': ['Sandy Loam', 'Red to Dark'],
  'bageshwar': ['Residual Sandy Soil', 'Red to Dark'],
  'chamoli': ['Red to Dark', 'Red to dark Black clay'],
  'champawat': ['Alluvial Sandy Soil', 'Residual Sandy Soil', 'Sandy Loam'],
  'dehradun': ['Alluvial mixed with boulders and shingles', 'Alluvial Sandy Soil', 'Residual Sandy Soil', 'Sandy Loam'],
  'haridwar': ['Alluvial'],
  'nainital': ['Alluvial mixed with boulders and shingles', 'Alluvial Sandy Soil', 'Residual Sandy Soil', 'Sandy Loam'],
  'pauri_garhwal': ['Alluvial mixed with boulders and shingles', 'Alluvial Sandy Soil', 'Residual Sandy Soil', 'Sandy Loam'],
  'pithoragarh': ['Red to Dark', 'Red to dark Black clay'],
  'rudraprayag': [],
  'tehri_garhwal': ['Alluvial Sandy Soil', 'Residual Sandy Soil', 'Sandy Loam'],
  'udham_singh_nagar': ['Alluvial'],
  'uttarkashi': ['Red to dark Black clay'],
};

// Detect current season based on date
const detectSeason = () => {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();
  
  // Kharif: June-July (sowing), Sept-Oct (harvest) - roughly June to October
  // Rabi: Oct-Dec (sowing), April-June (harvest) - roughly October to June
  // Zaid: March-July (short summer season)
  
  if (month >= 6 && month <= 10) {
    return { season: 'Kharif', description: 'Sown around June-July with monsoon, harvested in September-October. Crops require warm, wet weather.' };
  } else if (month >= 10 || month <= 3) {
    return { season: 'Rabi', description: 'Sown from October-December, harvested in April-June. Crops prefer cooler, drier weather.' };
  } else {
    return { season: 'Zaid', description: 'Short period between Rabi and Kharif (March-July). Grown in summer, often requires irrigation.' };
  }
};

// Calculate area in hectares from 4 lat/lon points using spherical excess formula
function calculateArea(lat1, lon1, lat2, lon2, lat3, lon3, lat4, lon4) {
  const R = 6371000; // Earth radius in meters
  
  // Convert degrees to radians
  const toRad = (deg) => (deg * Math.PI) / 180;
  
  const points = [
    { lat: toRad(lat1), lon: toRad(lon1) },
    { lat: toRad(lat2), lon: toRad(lon2) },
    { lat: toRad(lat3), lon: toRad(lon3) },
    { lat: toRad(lat4), lon: toRad(lon4) },
  ];
  
  // Calculate area using spherical excess (simplified for rectangle)
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += (points[i].lon - points[j].lon) * (2 + Math.sin(points[i].lat) + Math.sin(points[j].lat));
  }
  area = Math.abs(area * R * R) / 2;
  
  // Convert to hectares (1 hectare = 10,000 m²)
  return (area / 10000).toFixed(2);
}

export default function CropAdvisory1({ onAddField, fields = [], onFieldsRefresh }) {
  const { t } = useTranslation();
  const [selectedField, setSelectedField] = useState(null);
  const [showFieldSelector, setShowFieldSelector] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [jobStatus, setJobStatus] = useState(null); // null, 'PENDING', 'PROCESSING', 'COMPLETED'
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentJobId, setCurrentJobId] = useState(null);
  const [report, setReport] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCompletionMessage, setShowCompletionMessage] = useState(false);
  const [lastAnalysisDate, setLastAnalysisDate] = useState(null);
  const [nextAnalysisDate, setNextAnalysisDate] = useState(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [isButtonEnabled, setIsButtonEnabled] = useState(true);
  const [satelliteAcquisitionDate, setSatelliteAcquisitionDate] = useState(null);
  const [aiRecommendations, setAiRecommendations] = useState(null);
  const [aiVideos, setAiVideos] = useState([]);
  const [userLanguage, setUserLanguage] = useState('en');
  const [isLoadingAiRecommendations, setIsLoadingAiRecommendations] = useState(false);
  const [pulseAnim] = useState(new Animated.Value(1));
  const [currentCrop, setCurrentCrop] = useState(null);
  const [otherCropText, setOtherCropText] = useState('');
  const [cropSowingDate, setCropSowingDate] = useState(null);
  const [dateInputValue, setDateInputValue] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [cropSelectionStep, setCropSelectionStep] = useState(1); // 1: Select Crop, 2: Select Sowing Date
  const [cropSearchQuery, setCropSearchQuery] = useState('');
  const [showCropDropdown, setShowCropDropdown] = useState(false);
  const COMMON_CROPS = ['Wheat', 'Rice', 'Maize', 'Mustard', 'Sugarcane', 'Cotton', 'Paddy', 'Barley', 'Chickpea', 'Lentil', 'Other'];
  
  // Filter crops based on search query
  const filteredCrops = COMMON_CROPS.filter(crop => 
    crop.toLowerCase().includes(cropSearchQuery.toLowerCase())
  );
  const [lastAiRequestKey, setLastAiRequestKey] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [wxNow, setWxNow] = useState(null);
  const [wxAdvisory, setWxAdvisory] = useState(null);
  const [reportReady, setReportReady] = useState(false);
  const [ttsOn, setTtsOn] = useState(false);
  const [ttsSection, setTtsSection] = useState(null); // id of section currently speaking
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCropSelectionModal, setShowCropSelectionModal] = useState(false);
  const [uploadingCard, setUploadingCard] = useState(false);
  const [extractedText, setExtractedText] = useState(null);
  const [uploadedCardUrl, setUploadedCardUrl] = useState(null);
  
  // Uttarakhand-specific advisory modal states
  const [showAdvisoryModal, setShowAdvisoryModal] = useState(false);
  const [advisoryStep, setAdvisoryStep] = useState(1);
  const [selectedSoilType, setSelectedSoilType] = useState(null);
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [detectedSeason, setDetectedSeason] = useState(null);
  const [soilHealthMethod, setSoilHealthMethod] = useState(null); // 'card', 'manual', 'skip'
  const [manualNPK, setManualNPK] = useState({ nitrogen: '', phosphorus: '', potassium: '' });
  const [irrigationDaysAgo, setIrrigationDaysAgo] = useState(''); // Number of days ago irrigated
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedCardDetail, setSelectedCardDetail] = useState(null);
  const [nearestKisanCenters, setNearestKisanCenters] = useState([]);
  const [loadingKisanCenters, setLoadingKisanCenters] = useState(false);

  const speak = async (text) => {
    try {
      if (!text) return;
      const lang = (report?.language === 'hi') ? 'hi-IN' : 'en-US';
      const speaking = await Speech.isSpeakingAsync();
      if (speaking) { try { await Speech.stop(); } catch {} }
      let voiceId = undefined;
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        const preferred = voices?.find(v => (v.language || '').toLowerCase() === lang.toLowerCase());
        voiceId = preferred?.identifier;
      } catch {}
      console.log('🔊 TTS speak', { lang, hasVoice: !!voiceId });
      setTtsOn(true);
      Speech.speak(String(text), {
        language: lang,
        voice: voiceId,
        rate: 1.0,
        pitch: 1.0,
      });
    } catch (e) {
      console.warn('TTS error:', e?.message || e);
    }
  };

  const toggleHeaderTTS = async () => {
    try {
      const speaking = await Speech.isSpeakingAsync();
      if (speaking && ttsOn) {
        await Speech.stop();
        setTtsOn(false);
        return;
      }
      const p = report?.recommendations?.primary_recommendation || {};
      const msg = [
        report?.ndvi_analysis?.health_score != null ? `Field health score ${report.ndvi_analysis.health_score}.` : null,
        report?.summary?.overall_health ? `Overall ${report.summary.overall_health}.` : null,
        p?.message ? `Primary recommendation: ${p.message}.` : null
      ].filter(Boolean).join(' ');
      await speak(msg || 'Reading report summary.');
      setTtsOn(true);
    } catch {}
  };

  const toggleSectionTTS = async (sectionId, text) => {
    try {
      const speaking = await Speech.isSpeakingAsync();
      if (speaking && ttsSection === sectionId) {
        await Speech.stop();
        setTtsSection(null);
        return;
      }
      await speak(text);
      setTtsSection(sectionId);
    } catch {}
  };

  const joinLines = (arr) => (arr || []).filter(Boolean).join('. ');

  useEffect(() => {
    if (fields.length > 0 && !selectedField) {
      setSelectedField(fields[0]);
    }
  }, [fields]);

  useEffect(() => {
    if (selectedField) {
      checkFieldJobStatus();
      checkLastAnalysisDate(); // Check cooldown when field changes
      loadAiRecommendationsForField(); // Load cached AI recommendations for this field
      // Fetch current weather for field center
      try {
        const region = getFieldRegion(selectedField);
        if (region) {
          getWeatherAdvisory({ lat: region.latitude, lon: region.longitude }).then((r) => {
            if (r?.ok) {
              setWxNow(r.weather?.now || null);
              setWxAdvisory(r.advisory || null);
            }
          }).catch(()=>{});
        }
      } catch {}
    }
  }, [selectedField]);

  // Auto-fetch Kisan centers when step 5 is shown
  useEffect(() => {
    if (advisoryStep === 5 && showAdvisoryModal) {
      const hasSoilHealthData = (soilHealthMethod === 'card' && extractedText) || 
                               (soilHealthMethod === 'manual' && (manualNPK.nitrogen || manualNPK.phosphorus || manualNPK.potassium));
      if (!hasSoilHealthData && nearestKisanCenters.length === 0 && !loadingKisanCenters) {
        console.log('🔄 Auto-fetching Kisan centers for step 5...');
        fetchNearestKisanCenters();
      }
    }
  }, [advisoryStep, showAdvisoryModal]);
  
  // Show crop selection modal when report modal opens and NDVI > 0.5
  useEffect(() => {
    const checkAndShowModal = async () => {
      if (showReportModal && report && !showCropSelectionModal && !currentCrop) {
        const healthScore = report.ndvi_analysis?.health_score;
        const averageNdvi = report.ndvi_analysis?.average_ndvi;
        const ndviValue = averageNdvi !== null && averageNdvi !== undefined 
          ? averageNdvi 
          : (healthScore !== null && healthScore !== undefined ? healthScore / 100 : 0);
        const hasGoodVegetation = ndviValue > 0.5;
        
        if (hasGoodVegetation) {
          // Check if we have crop-specific recommendations
          const hasCropSpecific = report.ai_recommendations?.current_crop_advisory?.enabled;
          const field_ID = selectedField?.id || selectedField?.field_name;
          
          // Check cache
          let hasCachedCropSpecific = false;
          if (field_ID) {
            try {
              const cached = await AsyncStorage.getItem(`ai_recommendations_${field_ID}`);
              if (cached) {
                const recommendations = JSON.parse(cached);
                if (recommendations?.current_crop_advisory?.enabled && currentCrop) {
                  hasCachedCropSpecific = true;
                }
              }
            } catch (e) {
              // Ignore
            }
          }
          
          // Show modal if no crop-specific recommendations
          if (!hasCropSpecific && !hasCachedCropSpecific) {
            console.log('🌾 Report modal opened with NDVI > 0.5 - showing crop selection modal');
            setShowCropSelectionModal(true);
          }
        }
      }
    };
    
    checkAndShowModal();
  }, [showReportModal, report, currentCrop, showCropSelectionModal, selectedField]);
  
  // Load AI recommendations from local storage for current field
  const loadAiRecommendationsForField = async () => {
    try {
      const field_ID = selectedField?.id || selectedField?.field_name;
      if (!field_ID) return;
      
      const cacheKey = `ai_recommendations_${field_ID}`;
      const cached = await AsyncStorage.getItem(cacheKey);
      
      if (cached) {
        const recommendations = JSON.parse(cached);
        setAiRecommendations(recommendations);
        console.log('✅ Loaded AI recommendations from cache for field:', field_ID);
      } else {
        // Clear recommendations if no cache
        setAiRecommendations(null);
        console.log('ℹ️  No cached AI recommendations for field:', field_ID);
      }
    } catch (error) {
      console.error('Error loading AI recommendations from cache:', error);
      setAiRecommendations(null);
    }
  };
  
  // Store AI recommendations in local storage
  const storeAiRecommendations = async (field_ID, recommendations) => {
    try {
      if (!field_ID || !recommendations) return;
      
      const cacheKey = `ai_recommendations_${field_ID}`;
      await AsyncStorage.setItem(cacheKey, JSON.stringify(recommendations));
      console.log('💾 Stored AI recommendations in cache for field:', field_ID);
    } catch (error) {
      console.error('Error storing AI recommendations in cache:', error);
    }
  };

  // Check last analysis date and calculate cooldown
  const checkLastAnalysisDate = async () => {
    try {
      const field_ID = selectedField?.id || selectedField?.field_name;
      if (!field_ID) return;

      const farmer_ID = auth.currentUser?.uid;
      if (!farmer_ID) return;

      // Try to fetch latest report
      try {
        const response = await getReport(field_ID, farmer_ID);
          if (response?.report) {
          const reportData = response.report;
          
          // Get generated_at date (when report was generated)
          let generatedDate = null;
          if (reportData.generated_at) {
            generatedDate = typeof reportData.generated_at === 'string' 
              ? new Date(reportData.generated_at) 
              : reportData.generated_at.toDate();
          }
          
          // Get satellite acquisition date
          let satelliteDate = null;
          if (reportData.ndvi_analysis?.timestamp) {
            satelliteDate = typeof reportData.ndvi_analysis.timestamp === 'string'
              ? new Date(reportData.ndvi_analysis.timestamp)
              : new Date(reportData.ndvi_analysis.timestamp);
          }
          
          // Extract AI recommendations and language
          if (reportData.ai_recommendations && !reportData.ai_recommendations.error) {
            setAiRecommendations(reportData.ai_recommendations);
            // Store in local cache for this field
            const field_ID = selectedField?.id || selectedField?.field_name;
            if (field_ID) {
              await storeAiRecommendations(field_ID, reportData.ai_recommendations);
            }
          }
          if (reportData.language) {
            setUserLanguage(reportData.language);
          }
          
          setLastAnalysisDate(generatedDate);
          setSatelliteAcquisitionDate(satelliteDate);
          
          if (generatedDate) {
            // Calculate next available analysis date (7 days from last analysis)
            const nextDate = new Date(generatedDate);
            nextDate.setDate(nextDate.getDate() + 7);
            setNextAnalysisDate(nextDate);
            
            // Calculate time remaining
            const now = new Date();
            const diff = nextDate.getTime() - now.getTime();
            
            if (diff > 0) {
              setIsButtonEnabled(false);
              setCooldownRemaining(diff);
            } else {
              setIsButtonEnabled(true);
              setCooldownRemaining(0);
            }
          } else {
            setIsButtonEnabled(true);
            setNextAnalysisDate(null);
          }
        } else {
          // No report found, button is enabled
          setIsButtonEnabled(true);
          setLastAnalysisDate(null);
          setNextAnalysisDate(null);
          setSatelliteAcquisitionDate(null);
        }
      } catch (error) {
        // If no report found, button is enabled
        console.log('No previous report found, button enabled');
        setIsButtonEnabled(true);
        setLastAnalysisDate(null);
        setNextAnalysisDate(null);
        setSatelliteAcquisitionDate(null);
      }
    } catch (error) {
      console.error('Error checking last analysis date:', error);
      // On error, enable button as fallback
      setIsButtonEnabled(true);
    }
  };

  // Pulse animation for loading state
  useEffect(() => {
    if (isLoadingAiRecommendations || (isAnalyzing && jobStatus === 'PROCESSING')) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isLoadingAiRecommendations, isAnalyzing, jobStatus, pulseAnim]);
  
  // Update cooldown timer every second
  useEffect(() => {
    if (!isButtonEnabled && cooldownRemaining > 0) {
      const interval = setInterval(() => {
        const now = new Date();
        if (nextAnalysisDate) {
          const diff = nextAnalysisDate.getTime() - now.getTime();
          if (diff > 0) {
            setCooldownRemaining(diff);
          } else {
            setIsButtonEnabled(true);
            setCooldownRemaining(0);
            clearInterval(interval);
          }
        }
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [isButtonEnabled, cooldownRemaining, nextAnalysisDate]);

  // Check for completed jobs and auto-show report
  useEffect(() => {
    if (selectedField && jobStatus === 'COMPLETED') {
      handleJobCompleted();
    }
  }, [jobStatus, selectedField]);

  // Poll for job status while processing
  useEffect(() => {
    let pollInterval = null;
    
    if (selectedField && (jobStatus === 'PENDING' || jobStatus === 'PROCESSING')) {
      // Poll every 5 seconds while processing
      pollInterval = setInterval(() => {
        checkFieldJobStatus();
      }, 5000);
    }
    
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [selectedField, jobStatus]);

  const checkFieldJobStatus = async () => {
    try {
      const field_ID = selectedField?.id || selectedField?.field_name;
      if (!field_ID) return;

      const farmer_ID = auth.currentUser?.uid;
      if (!farmer_ID) return;

      // Check local storage first
      const storedJobId = await AsyncStorage.getItem(`job_${field_ID}`);
      const lastKnownStatus = await AsyncStorage.getItem(`job_status_${field_ID}`);
      
      if (storedJobId && lastKnownStatus) {
        setCurrentJobId(storedJobId);
        setJobStatus(lastKnownStatus);
        
        // If we know it was completed, check if we've shown the message
        if (lastKnownStatus === 'COMPLETED') {
          setReportReady(true);
        }
      }

      // Check Firestore for latest job (using farmer_ID for faster query from subcollection)
      const response = await getFieldJobs(field_ID, farmer_ID);
      const jobs = response?.jobs || [];
      
      if (jobs.length > 0) {
        const latestJob = jobs[0];
        const latestStatus = latestJob.status || 'PENDING';
        const latestJobId = latestJob.job_ID || latestJob.id;
        
        setCurrentJobId(latestJobId);
        setJobStatus(latestStatus);
        
        // Store job ID and status locally
        await AsyncStorage.setItem(`job_${field_ID}`, latestJobId);
        await AsyncStorage.setItem(`job_status_${field_ID}`, latestStatus);
        
        // Check if status changed to COMPLETED
        if (latestStatus === 'COMPLETED' && lastKnownStatus !== 'COMPLETED') {
          setReportReady(true);
        }
      } else {
        setCurrentJobId(null);
        setJobStatus(null);
        await AsyncStorage.removeItem(`job_${field_ID}`);
        await AsyncStorage.removeItem(`job_status_${field_ID}`);
      }
    } catch (error) {
      console.error('Error checking job status:', error);
    }
  };

  const handleJobCompleted = async () => {
    // This is called when jobStatus becomes 'COMPLETED'
    const field_ID = selectedField?.id || selectedField?.field_name;
    const jobId = currentJobId;
    
    if (!field_ID || !jobId) return;
    
    // Check if we've already shown the report for this job
    const shownKey = `report_shown_${field_ID}_${jobId}`;
    const alreadyShown = await AsyncStorage.getItem(shownKey);
    
    if (!alreadyShown) {
      // Automatically fetch and show the report
      console.log('✅ Job completed! Fetching report automatically...');
      await fetchReport(); // This will set the report and open the modal
      await AsyncStorage.setItem(shownKey, 'true');
    }
  };

  const fetchReport = async (showLoading = false) => {
    try {
      const field_ID = selectedField?.id || selectedField?.field_name;
      if (!field_ID) return;

      const farmer_ID = auth.currentUser?.uid;
      if (!farmer_ID) return;

      if (showLoading) {
        setIsAnalyzing(true); // Show loading indicator
      }

      console.log('📥 Fetching report for field:', field_ID);
      let response;
      try {
        response = await getReport(field_ID, farmer_ID);
      } catch (err) {
        const status = err?.response?.status;
        console.warn('⚠️  getReport failed:', status || err?.message);
        if (status === 404) {
          // No report yet for this new field; clear UI state gracefully
          setReport(null);
          setAiRecommendations(null);
          setIsAnalyzing(false);
          setShowReportModal(false);
          return;
        }
        throw err;
      }
      
      if (response?.report) {
        // Ensure still on the same field
        const currentFieldId = selectedField?.id || selectedField?.field_name;
        if (currentFieldId !== field_ID) {
          console.log('⏭️  Field changed during fetch; ignoring stale report');
          return;
        }
        const reportData = response.report;
        
        // Store report locally for offline access
        const reportKey = `report_${field_ID}_${reportData.id || currentJobId}`;
        await AsyncStorage.setItem(reportKey, JSON.stringify(reportData));
        
        // Also store the latest report reference
        await AsyncStorage.setItem(`latest_report_${field_ID}`, reportKey);
        
        setReport(reportData);
        
        if (reportData.language) {
          setUserLanguage(reportData.language);
        }
        
        // Calculate NDVI and determine flow
        const healthScore = reportData.ndvi_analysis?.health_score;
        const averageNdvi = reportData.ndvi_analysis?.average_ndvi;
        // Use average_ndvi if available, otherwise normalize health_score (0-100) to 0-1
        const ndviValue = averageNdvi !== null && averageNdvi !== undefined 
          ? averageNdvi 
          : (healthScore !== null && healthScore !== undefined ? healthScore / 100 : 0);
        const hasGoodVegetation = ndviValue > 0.5;
        
        console.log('📊 NDVI Analysis:', { 
          averageNdvi, 
          healthScore, 
          calculatedNdvi: ndviValue, 
          hasGoodVegetation 
        });
        
        if (hasGoodVegetation) {
          // NDVI > 0.5: Need crop selection before crop-specific recommendations
          console.log('🌾 NDVI > 0.5 detected - crop selection required');
          
          const field_ID = selectedField?.id || selectedField?.field_name;
          
          // Check if we have crop-specific recommendations (current_crop_advisory.enabled)
          const hasCropSpecificInReport = reportData.ai_recommendations?.current_crop_advisory?.enabled;
          
          // Check cache for crop-specific recommendations
          let hasCachedCropSpecific = false;
          let cachedRecommendations = null;
          
          try {
            const cacheKey = `ai_recommendations_${field_ID}`;
            const cached = await AsyncStorage.getItem(cacheKey);
            if (cached) {
              cachedRecommendations = JSON.parse(cached);
              // Only use cached if it has current_crop_advisory (meaning crop was selected)
              if (cachedRecommendations?.current_crop_advisory?.enabled && currentCrop) {
                hasCachedCropSpecific = true;
                console.log('✅ Found cached crop-specific recommendations');
              }
            }
          } catch (e) {
            console.warn('Could not load cached recommendations:', e);
          }
          
          // PRIORITY: Show crop selection modal FIRST if no crop selected and no crop-specific recommendations
          // Don't load general recommendations yet - wait for crop selection
          if (!currentCrop && !hasCropSpecificInReport && !hasCachedCropSpecific) {
            console.log('🌾 Showing crop selection modal (NDVI > 0.5, no crop selected)');
            // Clear any general recommendations - we'll generate crop-specific ones after selection
            setAiRecommendations(null);
            // Show crop selection modal FIRST, don't show report modal yet
            setShowCropSelectionModal(true);
            // Don't show report modal - wait for crop selection
            return; // Exit early - don't show report modal yet
          } else if (hasCropSpecificInReport || hasCachedCropSpecific) {
            // We have crop-specific recommendations - use them
            if (hasCachedCropSpecific && cachedRecommendations) {
              setAiRecommendations(cachedRecommendations);
              console.log('✅ Loaded cached crop-specific recommendations');
            } else if (hasCropSpecificInReport) {
              setAiRecommendations(reportData.ai_recommendations);
              console.log('✅ Loaded crop-specific recommendations from report');
            }
            // Show report modal since we have crop-specific recommendations
            setShowReportModal(true);
          } else if (currentCrop) {
            // Crop is selected but no crop-specific recommendations yet
            // Don't show general recommendations - user needs to generate crop-specific ones
            setAiRecommendations(null);
            console.log('ℹ️  Crop selected but no crop-specific recommendations yet. User can generate them.');
            // Show report modal so user can generate recommendations
            setShowReportModal(true);
          }
        } else {
          // NDVI <= 0.5: Show regular recommendations (no crop selection needed)
          console.log('🌱 NDVI <= 0.5 - showing regular recommendations (no crop selection)');
          
          // Load recommendations from report or cache
          if (reportData.ai_recommendations) {
            setAiRecommendations(reportData.ai_recommendations);
            console.log('✅ AI recommendations loaded from report');
          } else {
            // Try cache
            const field_ID = selectedField?.id || selectedField?.field_name;
            try {
              const cached = await AsyncStorage.getItem(`ai_recommendations_${field_ID}`);
              if (cached) {
                const recommendations = JSON.parse(cached);
                setAiRecommendations(recommendations);
                console.log('✅ Loaded cached AI recommendations');
              }
            } catch (e) {
              console.warn('Could not load cached recommendations:', e);
            }
          }
          // Show report modal for NDVI <= 0.5
          setShowReportModal(true);
        }
        
        console.log('✅ Report fetched and displayed');
      }
    } catch (error) {
      console.error('Error fetching report:', error);
      
      // Try to load from local storage if API fails
      try {
        const field_ID = selectedField?.id || selectedField?.field_name;
        const reportKey = await AsyncStorage.getItem(`latest_report_${field_ID}`);
        if (reportKey) {
          const cachedReport = await AsyncStorage.getItem(reportKey);
          if (cachedReport) {
            setReport(JSON.parse(cachedReport));
            setShowReportModal(true);
            if (showLoading) {
              Alert.alert('Info', 'Showing cached report (offline mode)');
            }
            return;
          }
        }
      } catch (cacheError) {
        console.error('Error loading cached report:', cacheError);
      }
      
      if (showLoading) {
        Alert.alert('Error', 'Failed to fetch report. Please try again.');
      }
    } finally {
      if (showLoading) {
        setIsAnalyzing(false);
      }
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await checkFieldJobStatus();
    await checkLastAnalysisDate(); // Also refresh cooldown info
    setRefreshing(false);
  }, [selectedField]);

  // Auto-detect district from field location using reverse geocoding
  const detectDistrictFromLocation = async (lat, lon) => {
    try {
      // Use Google Maps Geocoding API or a simple district mapping based on coordinates
      // For now, we'll use a simple coordinate-based mapping for Uttarakhand districts
      // In production, you'd use a proper geocoding service
      
      // District center coordinates (approximate)
      const districtCenters = {
        'dehradun': { lat: 30.3165, lon: 78.0322 },
        'haridwar': { lat: 29.9457, lon: 78.1642 },
        'nainital': { lat: 29.3919, lon: 79.4542 },
        'almora': { lat: 29.5972, lon: 79.6531 },
        'pithoragarh': { lat: 29.5833, lon: 80.2167 },
        'udham_singh_nagar': { lat: 29.0333, lon: 79.5167 },
        'chamoli': { lat: 30.4167, lon: 79.3167 },
        'uttarkashi': { lat: 30.7333, lon: 78.4500 },
        'tehri_garhwal': { lat: 30.3833, lon: 78.4833 },
        'pauri_garhwal': { lat: 30.1500, lon: 78.7833 },
        'rudraprayag': { lat: 30.2833, lon: 78.9833 },
        'champawat': { lat: 29.3333, lon: 80.0833 },
        'bageshwar': { lat: 29.8333, lon: 79.7667 },
      };

      // Find nearest district by calculating distance
      let nearestDistrict = null;
      let minDistance = Infinity;

      for (const [districtKey, center] of Object.entries(districtCenters)) {
        const R = 6371; // Earth radius in km
        const dLat = (center.lat - lat) * Math.PI / 180;
        const dLon = (center.lon - lon) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat * Math.PI / 180) * Math.cos(center.lat * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        if (distance < minDistance) {
          minDistance = distance;
          nearestDistrict = districtKey;
        }
      }

      return nearestDistrict;
    } catch (error) {
      console.error('Error detecting district:', error);
      return null;
    }
  };

  // Initialize advisory modal with season detection and auto-detect district
  const openAdvisoryModal = async () => {
    const season = detectSeason();
    setDetectedSeason(season);
    setAdvisoryStep(1);
    setSelectedSoilType(null);
    setSelectedDistrict(null);
    setSoilHealthMethod(null);
    setManualNPK({ nitrogen: '', phosphorus: '', potassium: '' });
    setIrrigationDaysAgo('');
    setNearestKisanCenters([]);
    
    // Auto-detect district from field location
    if (selectedField && selectedField.lat1) {
      const lat = (selectedField.lat1 + selectedField.lat2 + selectedField.lat3 + selectedField.lat4) / 4;
      const lon = (selectedField.lon1 + selectedField.lon2 + selectedField.lon3 + selectedField.lon4) / 4;
      const detectedDistrict = await detectDistrictFromLocation(lat, lon);
      if (detectedDistrict) {
        setSelectedDistrict(detectedDistrict);
        console.log('✅ Auto-detected district:', detectedDistrict);
      }
    }
    
    setShowAdvisoryModal(true);
  };

  // Get nearest Kisan Seva Kendra centers
  const fetchNearestKisanCenters = async () => {
    try {
      setLoadingKisanCenters(true);
      const field = selectedField;
      let lat, lon;
      
      if (!field || !field.lat1) {
        // Use default location (Dehradun) if field location not available
        lat = 30.3165;
        lon = 78.0322;
      } else {
        lat = (field.lat1 + field.lat2 + field.lat3 + field.lat4) / 4;
        lon = (field.lon1 + field.lon2 + field.lon3 + field.lon4) / 4;
      }
      
      console.log('📍 Fetching nearest Kisan centers for:', { lat, lon });
      
      // Call backend API
      const response = await getNearestKisanCenters({ lat, lon, limit: 3 });
      
      console.log('📡 API Response:', JSON.stringify(response, null, 2));
      
      if (response?.centers && response.centers.length > 0) {
        console.log('✅ Received centers from API:', response.centers.length);
        setNearestKisanCenters(response.centers);
      } else if (response?.success === false) {
        throw new Error(response.error || 'Failed to fetch centers');
      } else {
        throw new Error('No centers found in response');
      }
    } catch (error) {
      console.error('❌ Error fetching Kisan centers:', error);
      // Fallback to mock data with translated text
      const field = selectedField;
      if (field && field.lat1) {
        setNearestKisanCenters([
          { 
            name: t('cropAdvisory.kisanCenter1'), 
            address: t('cropAdvisory.basedOnLocation'), 
            distance: '1.2 km', 
            phone: '+91-XXXXX-XXXXX' 
          },
          { 
            name: t('cropAdvisory.kisanCenter2'), 
            address: t('cropAdvisory.districtCenter'), 
            distance: '15 km', 
            phone: '+91-XXXXX-XXXXX' 
          },
          { 
            name: t('cropAdvisory.kisanCenter3'), 
            address: t('cropAdvisory.blockLevel'), 
            distance: '8 km', 
            phone: '+91-XXXXX-XXXXX' 
          },
        ]);
      } else {
        setNearestKisanCenters([
          { 
            name: t('cropAdvisory.kisanCenterDehradun'), 
            address: 'Dehradun, Uttarakhand', 
            distance: '2.5 km', 
            phone: '+91-135-XXXXXXX' 
          },
          { 
            name: t('cropAdvisory.kisanCenterHaridwar'), 
            address: 'Haridwar, Uttarakhand', 
            distance: '45 km', 
            phone: '+91-1334-XXXXXXX' 
          },
          { 
            name: t('cropAdvisory.kisanCenterNainital'), 
            address: 'Nainital, Uttarakhand', 
            distance: '65 km', 
            phone: '+91-5942-XXXXXXX' 
          },
        ]);
      }
      Alert.alert(
        t('cropAdvisory.info'), 
        t('cropAdvisory.usingDefaultCenters')
      );
    } finally {
      setLoadingKisanCenters(false);
    }
  };

  const handleAnalyzeField = async () => {
    if (!selectedField) {
      Alert.alert('Error', 'Please select a field first.');
      return;
    }

    if (!isButtonEnabled) {
      const daysRemaining = Math.floor(cooldownRemaining / (1000 * 60 * 60 * 24));
      const hoursRemaining = Math.floor((cooldownRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      Alert.alert(
        'Analysis Cooldown',
        `Please wait ${daysRemaining} day(s) and ${hoursRemaining} hour(s) before analyzing again. This ensures we have fresh satellite data.`,
        [{ text: 'OK' }]
      );
      return;
    }

    const farmer_ID = auth.currentUser?.uid;
    if (!farmer_ID) {
      Alert.alert('Error', 'You must be logged in to analyze a field.');
      return;
    }

    // Open the advisory modal instead of directly creating job
    openAdvisoryModal();
  };

  // Final submission after all steps
  const submitAdvisoryForm = async () => {
    if (!selectedDistrict || !selectedSoilType) {
      Alert.alert(t('common.error'), t('cropAdvisory.pleaseCompleteAllSteps'));
      return;
    }

    const farmer_ID = auth.currentUser?.uid;
    if (!farmer_ID) {
      Alert.alert('Error', 'You must be logged in to analyze a field.');
      return;
    }

    const field_ID = selectedField?.id || selectedField?.field_name;
    if (!field_ID || typeof field_ID !== 'string' || field_ID.trim().length === 0) {
      Alert.alert('Error', `Invalid field ID: "${field_ID}". Please select a valid field.`);
      return;
    }
    
    setShowAdvisoryModal(false);
    setIsAnalyzing(true);
    
    try {
      // Create job with Uttarakhand-specific parameters
      const response = await createJob({
        field_ID: field_ID.trim(),
        farmer_ID,
        job_type: 'CROP_HEALTH_ANALYSIS',
        // Store advisory parameters for later use in AI recommendations
        advisory_params: {
          state: 'Uttarakhand',
          district: selectedDistrict,
          soil_type: selectedSoilType,
          season: detectedSeason?.season,
          soil_health_method: soilHealthMethod,
          manual_npk: soilHealthMethod === 'manual' ? manualNPK : null,
          soil_health_card_text: soilHealthMethod === 'card' ? extractedText : null,
          irrigation_days_ago: irrigationDaysAgo ? parseInt(irrigationDaysAgo, 10) : null,
        },
      });

      if (response.status === 202) {
        const job_id = response.job_id;
        setCurrentJobId(job_id);
        setJobStatus('PENDING');
        
        await AsyncStorage.setItem(`job_${field_ID}`, job_id);
        await AsyncStorage.setItem(`advisory_params_${field_ID}`, JSON.stringify({
          state: 'Uttarakhand',
          district: selectedDistrict,
          soil_type: selectedSoilType,
          season: detectedSeason?.season,
          soil_health_method: soilHealthMethod,
          manual_npk: soilHealthMethod === 'manual' ? manualNPK : null,
          soil_health_card_text: soilHealthMethod === 'card' ? extractedText : null,
          irrigation_days_ago: irrigationDaysAgo ? parseInt(irrigationDaysAgo, 10) : null,
        }));
        
        setIsButtonEnabled(false);
        
        Alert.alert(
          'Success!',
          `We've started processing your request for ${selectedField.id || selectedField.field_name}. Check back later or pull to refresh to see when your report is ready.`,
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Error creating job:', error);
      Alert.alert('Error', 'Failed to start analysis. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Format time remaining for countdown
  const formatTimeRemaining = (ms) => {
    if (!ms || ms <= 0) return null;

    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) {
      return `${days}d ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };

  const getFieldCoordinates = (field) => {
    if (!field || !field.lat1) return [];
    return [
      { latitude: field.lat1, longitude: field.lon1 },
      { latitude: field.lat2, longitude: field.lon2 },
      { latitude: field.lat3, longitude: field.lon3 },
      { latitude: field.lat4, longitude: field.lon4 },
    ];
  };

  const getFieldRegion = (field) => {
    if (!field || !field.lat1) return null;
    const coords = getFieldCoordinates(field);
    const lats = coords.map((c) => c.latitude);
    const lons = coords.map((c) => c.longitude);
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
    const latDelta = Math.max(...lats) - Math.min(...lats) + 0.002;
    const lonDelta = Math.max(...lons) - Math.min(...lons) + 0.002;
    
    return {
      latitude: centerLat,
      longitude: centerLon,
      latitudeDelta: Math.max(latDelta, 0.01),
      longitudeDelta: Math.max(lonDelta, 0.01),
    };
  };

  const fieldArea = selectedField
    ? calculateArea(
        selectedField.lat1,
        selectedField.lon1,
        selectedField.lat2,
        selectedField.lon2,
        selectedField.lat3,
        selectedField.lon3,
        selectedField.lat4,
        selectedField.lon4
      )
    : '0.00';

  const handleUploadCard = async (source) => {
    try {
      setUploadingCard(true);
      let fileResult = null;

      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Error', 'Camera permission needed');
          setUploadingCard(false);
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          quality: 0.9,
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
        });
        if (result.canceled) {
          setUploadingCard(false);
          return;
        }
        fileResult = result.assets[0];
      } else if (source === 'gallery') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Error', 'Permission needed');
          setUploadingCard(false);
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.All,
          allowsEditing: false,
          quality: 0.9,
        });
        if (result.canceled) {
          setUploadingCard(false);
          return;
        }
        fileResult = result.assets[0];
      }

      if (!fileResult?.uri) {
        setUploadingCard(false);
        return;
      }

      const field_ID = selectedField?.id || selectedField?.field_name;
      const farmer_ID = auth.currentUser?.uid;
      if (!farmer_ID || !field_ID) {
        Alert.alert('Error', 'Please select a field first');
        setUploadingCard(false);
        return;
      }

      console.log('📤 Uploading soil health card for crop advisory...');

      // Upload to Cloudinary
      const uploadResult = await uploadSoilHealthCard({
        uri: fileResult.uri,
        filename: fileResult.name || fileResult.fileName || 'soil_health_card.jpg',
        farmer_ID,
        field_ID,
      });

      const fileUrl = uploadResult.url || uploadResult.fileUrl;
      if (!fileUrl) {
        throw new Error('Upload succeeded but no URL returned');
      }

      setUploadedCardUrl(fileUrl);
      console.log('✅ Card uploaded:', fileUrl);

      // Extract text
      const extractResult = await extractTextFromSoilHealthCard({
        fileUrl,
        farmer_ID,
        field_ID,
      });

      const extractedTextData = extractResult.extractedText || extractResult.text || '';
      setExtractedText(extractedTextData);
      console.log('✅ Text extracted for crop advisory');

      // Save to Firebase
      try {
        await addDoc(collection(db, 'soil_health_cards'), {
          farmer_ID,
          field_ID,
          fileUrl,
          extractedText: extractedTextData,
          uploadedAt: new Date().toISOString(),
          fieldName: selectedField?.id || selectedField?.field_name,
          usedFor: 'crop_advisory',
        });
        console.log('✅ Card saved to database');
      } catch (dbError) {
        console.warn('⚠️ Failed to save to database:', dbError.message);
      }

      Alert.alert(
        'Success',
        'Soil Health Card uploaded and text extracted. This will be used for better crop recommendations.',
        [{ 
          text: 'OK', 
          onPress: () => {
            setShowUploadModal(false);
            // If advisory modal was open, reopen it
            if (soilHealthMethod === 'card') {
              setShowAdvisoryModal(true);
            }
          }
        }]
      );
    } catch (error) {
      console.error('❌ Upload error:', error);
      Alert.alert('Error', error.message || 'Failed to upload card');
    } finally {
      setUploadingCard(false);
    }
  };

  const cooldownLabel = formatTimeRemaining(cooldownRemaining);
  const analyzeButtonLabel = () => {
    if (isAnalyzing) return 'Starting...';
    if (!isButtonEnabled) {
      if (jobStatus === 'PENDING' || jobStatus === 'PROCESSING') {
        return 'Processing...';
      }
      if (cooldownLabel) {
        return `Available in ${cooldownLabel}`;
      }
      return 'Processing...';
    }
    return 'Analyze My Field';
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5DC' }}>
      {/* Top App Bar */}
      <View style={styles.appBar}>
        <Text style={styles.screenTitle}>Crop Advisory</Text>
        <TouchableOpacity
          accessibilityLabel="Add new field"
          onPress={onAddField}
          style={styles.addBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <MaterialIcons name="add" size={24} color="#2A5B30" />
        </TouchableOpacity>
      </View>

      {/* Field Selector */}
      <View style={styles.fieldSelectorContainer}>
        <TouchableOpacity
          style={styles.fieldSelector}
          onPress={() => setShowFieldSelector(true)}
        >
          <MaterialIcons name="agriculture" size={20} color="#3A5F0B" />
          <Text style={styles.fieldSelectorText}>
            {selectedField ? selectedField.id || selectedField.field_name : t('cropAdvisory.selectField')}
          </Text>
          <MaterialIcons name="arrow-drop-down" size={24} color="#3A5F0B" />
        </TouchableOpacity>
        </View>

      {/* Report Ready highlight replaces modal */}

      <ScrollView 
        contentContainerStyle={styles.scrollContent} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3A5F0B"
            colors={["#3A5F0B"]}
          />
        }
      >
        {/* Field Info Card */}
        {selectedField && (
          <View style={styles.fieldCard}>
            <View style={styles.fieldCardHeader}>
              <MaterialIcons name="location-on" size={24} color="#3A5F0B" />
              <Text style={styles.fieldCardTitle}>{selectedField.id || selectedField.field_name}</Text>
            </View>
            <View style={styles.fieldCardBody}>
              <View style={styles.fieldCardRow}>
                <Text style={styles.fieldCardLabel}>Area:</Text>
                <Text style={styles.fieldCardValue}>{fieldArea} hectares</Text>
              </View>
              <View style={styles.fieldCardRow}>
                <Text style={styles.fieldCardLabel}>Coordinates:</Text>
                <Text style={styles.fieldCardValue} numberOfLines={1}>
                  ({selectedField.lat1.toFixed(4)}, {selectedField.lon1.toFixed(4)}), ({selectedField.lat2.toFixed(4)}, {selectedField.lon2.toFixed(4)}), ({selectedField.lat3.toFixed(4)}, {selectedField.lon3.toFixed(4)}), ({selectedField.lat4.toFixed(4)}, {selectedField.lon4.toFixed(4)})
                </Text>
              </View>
              <View style={styles.fieldActions}>
                <TouchableOpacity
                  style={styles.viewMapButton}
                  onPress={() => setShowMapModal(true)}
                >
                  <MaterialIcons name="map" size={18} color="#fff" />
                  <Text style={styles.viewMapButtonText}>View on Map</Text>
                </TouchableOpacity>
                
                {jobStatus === 'PENDING' || jobStatus === 'PROCESSING' ? (
                  <View style={styles.processingContainer}>
                    <ActivityIndicator size="small" color="#3A5F0B" />
                    <View style={styles.processingTextContainer}>
                      <Text style={styles.processingText}>Analyzing Field...</Text>
                      <Text style={styles.processingSubText}>
                        {jobStatus === 'PENDING' ? 'Queued for processing' : 'Processing satellite data & weather'}
                      </Text>
                    </View>
                  </View>
                ) : jobStatus === 'COMPLETED' ? (
                  <TouchableOpacity
                    style={[styles.viewReportButton, reportReady && { backgroundColor: '#2E7D32' }]}
                    onPress={() => fetchReport(true)}
                  >
                    <MaterialIcons name="description" size={20} color="#fff" />
                    <Text style={styles.viewReportButtonText}>{t('cropAdvisory.viewReport')}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.analyzeButton, 
                      (isAnalyzing || !isButtonEnabled) && styles.analyzeButtonDisabled
                    ]}
                    onPress={handleAnalyzeField}
                    disabled={isAnalyzing || !isButtonEnabled}
                  >
                    {isAnalyzing ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <MaterialIcons name="assessment" size={20} color="#fff" />
                    )}
                    <Text style={styles.analyzeButtonText}>{analyzeButtonLabel()}</Text>
                  </TouchableOpacity>
                )}
              </View>
              
              {/* Satellite Data Info */}
              {(satelliteAcquisitionDate || lastAnalysisDate) && (
                <View style={styles.dataInfoCard}>
                  {satelliteAcquisitionDate && (
                    <View style={styles.dataInfoRow}>
                      <MaterialIcons name="satellite-alt" size={20} color="#3A5F0B" />
                      <Text style={styles.dataInfoLabel}>Satellite Image Date:</Text>
                      <Text style={styles.dataInfoValue}>
                        {satelliteAcquisitionDate.toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </Text>
                    </View>
                  )}
                  {satelliteAcquisitionDate && (
                    <View style={[styles.dataInfoRow, { marginTop: 4 }]}>
                      <MaterialIcons name="info-outline" size={16} color="#666" />
                      <Text style={[styles.dataInfoLabel, { fontSize: 11, color: '#999' }]}>
                        Image age: {Math.floor((new Date() - satelliteAcquisitionDate) / (1000 * 60 * 60 * 24))} day(s) old
                      </Text>
                    </View>
                  )}
                  {lastAnalysisDate && (
                    <View style={styles.dataInfoRow}>
                      <MaterialIcons name="history" size={20} color="#3A5F0B" />
                      <Text style={styles.dataInfoLabel}>Last Analysis:</Text>
                      <Text style={styles.dataInfoValue}>
                        {lastAnalysisDate.toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </Text>
                    </View>
                  )}
                  {nextAnalysisDate && !isButtonEnabled && (
                    <View style={[styles.dataInfoRow, { marginTop: 4 }] }>
                      <MaterialIcons name="schedule" size={20} color="#FCA311" />
                      <Text style={[styles.dataInfoLabel, { color: '#FCA311' }]}>Next Available:</Text>
                      <Text style={[styles.dataInfoValue, { color: '#FCA311', fontWeight: 'bold' }] }>
                        {nextAnalysisDate.toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })} ({cooldownLabel || 'Soon'})
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

      {/* Current Weather for Field */}
      {wxNow && (
        <TouchableOpacity 
          style={styles.infoCard}
          onPress={() => {
            setSelectedCardDetail({
              type: 'weather',
              title: 'Current Weather',
              icon: 'wb-cloudy',
              data: wxNow
            });
            setShowDetailModal(true);
          }}
          activeOpacity={0.7}
        >
          <View style={[styles.infoLeftIcon, { backgroundColor: '#ecf5ec' }]}>
            <MaterialIcons name="wb-cloudy" size={24} color="#3A5F0B" />
          </View>
          <View style={styles.infoCardContent}>
            <Text style={styles.infoLabel}>Current Weather</Text>
            <Text style={styles.infoValue} numberOfLines={2} ellipsizeMode="tail">
              {Math.round(wxNow.temp)}°C, {wxNow.weather} • Feels {Math.round(wxNow.feels_like)}°C • H {wxNow.humidity}% • W {Math.round((wxNow.wind_speed||0)*3.6)} km/h
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color="#999" style={{ marginLeft: 8 }} />
        </TouchableOpacity>
      )}
      {wxAdvisory?.risk_summary && (
        <TouchableOpacity 
          style={styles.infoCard}
          onPress={() => {
            setSelectedCardDetail({
              type: 'weather_advisory',
              title: 'Weather Advisory',
              icon: 'warning',
              data: wxAdvisory
            });
            setShowDetailModal(true);
          }}
          activeOpacity={0.7}
        >
          <View style={[styles.infoLeftIcon, { backgroundColor: '#fff3cd' }]}>
            <MaterialIcons name="warning" size={24} color="#927000" />
          </View>
          <View style={styles.infoCardContent}>
            <Text style={styles.infoLabel}>Weather Advisory</Text>
            <Text style={styles.infoValue} numberOfLines={3} ellipsizeMode="tail">{wxAdvisory.risk_summary}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color="#999" style={{ marginLeft: 8 }} />
        </TouchableOpacity>
      )}

        {/* Summary Card - Dynamic from AI */}
        {aiRecommendations?.action_items?.[0] ? (
          <TouchableOpacity 
            style={styles.summaryCard}
            onPress={() => {
              setSelectedCardDetail({
                type: 'action_item',
                title: 'Action Item',
                icon: 'timer',
                data: aiRecommendations.action_items[0]
              });
              setShowDetailModal(true);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.summaryCardContent}>
              <Text style={styles.summaryBigText} numberOfLines={3} ellipsizeMode="tail">
                {aiRecommendations.action_items[0].action}
              </Text>
              <Text style={styles.summarySubText} numberOfLines={1} ellipsizeMode="tail">
                {aiRecommendations.action_items[0].deadline 
                  ? `Deadline: ${aiRecommendations.action_items[0].deadline}`
                  : 'Action required for optimal crop health.'
                }
              </Text>
            </View>
            <View style={styles.summaryTimer}>
              <MaterialIcons name="timer" size={36} color="#fff" />
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.summaryCard}>
            <View style={styles.summaryCardContent}>
              <Text style={styles.summaryBigText} numberOfLines={2} ellipsizeMode="tail">Analyze Your Field</Text>
              <Text style={styles.summarySubText}>
                Get AI-powered recommendations based on satellite data and weather forecast.
              </Text>
            </View>
            <View style={styles.summaryTimer}>
              <MaterialIcons name="assessment" size={36} color="#fff" />
            </View>
          </View>
        )}

        {/* Section Header & AI Recommendation */}
        <Text style={styles.sectionHeader}>AI Recommendations</Text>
        {(!aiRecommendations && report && !isLoadingAiRecommendations) || aiError ? (
          <View style={[styles.infoCard, { alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row' }]}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.infoLabel}>No AI recommendations yet</Text>
              <Text style={styles.infoValue} numberOfLines={2}>
                {aiError ? `Last error: ${aiError}` : 'Tap Retry to generate recommendations.'}
              </Text>
            </View>
            <TouchableOpacity
              disabled={!currentCrop || (currentCrop === 'Other' && !otherCropText.trim()) || isLoadingAiRecommendations}
              onPress={async () => {
                try {
                  if (!report) {
                    Alert.alert('No Report', 'Please analyze your field first to generate recommendations.');
                    return;
                  }
                  if (!currentCrop || (currentCrop === 'Other' && !otherCropText.trim())) {
                    Alert.alert('Select Crop', 'Please select a crop first to generate recommendations.');
                    return;
                  }
                  const field_ID = selectedField?.id || selectedField?.field_name;
                  const farmer_ID = auth.currentUser?.uid;
                  if (!field_ID || !farmer_ID) return;
                  setIsLoadingAiRecommendations(true);
                  const cropToSend = currentCrop === 'Other' ? otherCropText.trim() : currentCrop;
                  // Load stored advisory parameters (district, soil type, season, irrigation, etc.)
                  let advisoryParams = null;
                  try {
                    const stored = await AsyncStorage.getItem(`advisory_params_${field_ID}`);
                    if (stored) {
                      advisoryParams = JSON.parse(stored);
                      console.log('📋 Loaded advisory params for AI recommendations:', advisoryParams);
                    }
                  } catch (e) {
                    console.warn('Could not load advisory params:', e);
                  }
                  // Include extracted text from soil health card if available
                  const aiResp = await getAiRecommendations(
                    report, 
                    farmer_ID, 
                    field_ID, 
                    report.language || 'en', 
                    cropToSend,
                    extractedText, // Pass extracted text for better recommendations
                    advisoryParams // Pass advisory params (district, soil type, season, irrigation days, etc.)
                  );
                  if (aiResp?.recommendations && !aiResp.recommendations.error) {
                    setAiRecommendations(aiResp.recommendations);
                    setAiVideos(aiResp.videos || []);
                    await storeAiRecommendations(field_ID, aiResp.recommendations);
                    setAiError(null);
                  } else if (aiResp?.recommendations?.error) {
                    setAiError(aiResp.recommendations.error);
                  }
                } catch (e) {
                  setAiError(e.message || 'AI request failed');
                } finally {
                  setIsLoadingAiRecommendations(false);
                }
              }}
              style={{ 
                backgroundColor: (!currentCrop || (currentCrop === 'Other' && !otherCropText.trim()) || isLoadingAiRecommendations) ? '#ccc' : '#3A5F0B', 
                paddingVertical: 8, 
                paddingHorizontal: 12, 
                borderRadius: 8 
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowUploadModal(true)}
              style={{ 
                backgroundColor: '#2a2a2a', 
                paddingVertical: 8, 
                paddingHorizontal: 12, 
                borderRadius: 8,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                marginLeft: 8,
              }}
            >
              <MaterialIcons name="upload-file" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '600' }}>{t('cropAdvisory.uploadCard') || 'Upload Card'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {/* Always show crop selector if NDVI >= 0.5, regardless of report status */}
        {/* User must select crop before AI recommendations are generated */}
        {(() => {
          const v = report?.ndvi_analysis?.average_ndvi || 0;
          // Always show if NDVI >= 0.5 and we don't have stage-wise advisory yet
          return v >= 0.5 && (!aiRecommendations || (aiRecommendations && !aiRecommendations.current_crop_advisory?.enabled));
        })() && (
          <View style={[styles.infoCard, { flexDirection: 'column', alignItems: 'flex-start' }]}> 
            <Text style={styles.infoLabel}>{t('cropAdvisory.haveYouSownCrop')}</Text>
            <Text style={[styles.infoValue, { marginTop: 4 }]}>{t('cropAdvisory.selectCurrentCrop')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
              {COMMON_CROPS.map(crop => (
                <TouchableOpacity
                  key={crop}
                  onPress={() => {
                    setCurrentCrop(crop);
                    if (crop !== 'Other') setOtherCropText('');
                  }}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: currentCrop === crop ? '#3A5F0B' : '#ddd',
                    backgroundColor: currentCrop === crop ? '#e8efe1' : '#fff',
                    marginRight: 8,
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ color: '#333', fontSize: 12 }}>{crop}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {currentCrop === 'Other' && (
              <View style={{ width: '100%', marginTop: 8 }}>
                <Text style={[styles.infoLabel, { marginBottom: 6 }]}>Enter crop name</Text>
                <TextInput
                  value={otherCropText}
                  onChangeText={setOtherCropText}
                  placeholder="e.g., Millet, Quinoa, Oat, etc."
                  style={{
                    borderWidth: 1,
                    borderColor: '#ddd',
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: '#fff'
                  }}
                />
              </View>
            )}
            <TouchableOpacity
              disabled={!currentCrop || (currentCrop === 'Other' && !otherCropText.trim()) || isLoadingAiRecommendations}
              onPress={async () => {
                try {
                  const field_ID = selectedField?.id || selectedField?.field_name;
                  const farmer_ID = auth.currentUser?.uid;
                  if (!field_ID || !farmer_ID || !report) return;
                  setIsLoadingAiRecommendations(true);
                  const cropToSend = currentCrop === 'Other' ? otherCropText.trim() : currentCrop;
                  console.log('🌾 Generating stage-wise advisory for crop:', cropToSend);
                  // Load stored advisory parameters
                  let advisoryParams = null;
                  try {
                    const stored = await AsyncStorage.getItem(`advisory_params_${field_ID}`);
                    if (stored) {
                      advisoryParams = JSON.parse(stored);
                    }
                  } catch (e) {
                    console.warn('Could not load advisory params:', e);
                  }
                  const aiResponse = await getAiRecommendations(report, farmer_ID, field_ID, report.language || 'en', cropToSend, extractedText, advisoryParams);
                  if (aiResponse?.recommendations && !aiResponse.recommendations.error) {
                    setAiRecommendations(aiResponse.recommendations);
                    setAiVideos(aiResponse.videos || []);
                    await storeAiRecommendations(field_ID, aiResponse.recommendations);
                    console.log('✅ Stage-wise advisory generated and cached');
                  }
                } catch (e) {
                  console.warn('Stage-wise advisory failed:', e.message);
                } finally {
                  setIsLoadingAiRecommendations(false);
                }
              }}
              style={{
                marginTop: 8,
                backgroundColor: (!currentCrop || isLoadingAiRecommendations) ? '#ccc' : '#3A5F0B',
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 8,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {isLoadingAiRecommendations && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />}
                <Text style={{ color: '#fff', fontWeight: '600' }}>
                  {isLoadingAiRecommendations ? t('common.loading') : t('cropAdvisory.getStageWiseAdvisory')}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}
        
        {/* Best Crop Card - Dynamic from AI */}
        {aiRecommendations?.best_crop ? (
          <View style={styles.recoCard}>
            {aiRecommendations.best_crop.image_url ? (
              <Image source={{ uri: aiRecommendations.best_crop.image_url }} style={styles.recoImg} />
            ) : (
              <View style={[styles.recoImg, styles.recoImgPlaceholder]}>
                <MaterialIcons name="agriculture" size={48} color="#3A5F0B" />
                <Text style={{ marginTop: 8, fontSize: 10, color: '#666' }}>Generated by Gemini AI</Text>
              </View>
            )}
            <View style={{ padding: 12 }}>
              <Text style={styles.recoMeta}>Best Recommended Crop</Text>
              <Text style={styles.recoName} numberOfLines={1} ellipsizeMode="tail">{aiRecommendations.best_crop.crop_name}</Text>
              <Text style={styles.recoDesc} numberOfLines={3} ellipsizeMode="tail">
                {aiRecommendations.best_crop.reasons?.join('. ') || 'Suitable for your field conditions.'}
                {aiRecommendations.best_crop.expected_yield && ` Expected yield: ${aiRecommendations.best_crop.expected_yield}`}
              </Text>
            </View>
          </View>
        ) : isLoadingAiRecommendations || (isAnalyzing && jobStatus === 'PROCESSING') ? (
          <Animated.View style={[styles.recoCard, { transform: [{ scale: pulseAnim }] }]}>
            <View style={[styles.recoImg, styles.recoImgPlaceholder]}>
              <ActivityIndicator size="large" color="#3A5F0B" />
            </View>
            <View style={{ padding: 12 }}>
              <Text style={styles.recoMeta}>Recommended Crop</Text>
              <Text style={styles.recoName}>
                {isAnalyzing && jobStatus === 'PROCESSING' ? 'Analyzing Field...' : 'Generating Recommendations...'}
              </Text>
              <Text style={styles.recoDesc}>
                {isAnalyzing && jobStatus === 'PROCESSING' 
                  ? 'Processing satellite data and generating AI recommendations.'
                  : 'Generating personalized AI recommendations based on your field data.'
                }
              </Text>
            </View>
          </Animated.View>
        ) : aiRecommendations === null && report ? (
          <View style={styles.recoCard}>
            <View style={[styles.recoImg, styles.recoImgPlaceholder]}>
              <MaterialIcons name="assessment" size={48} color="#3A5F0B" />
            </View>
            <View style={{ padding: 12 }}>
              <Text style={styles.recoMeta}>Recommended Crop</Text>
              <Text style={styles.recoName}>Processing...</Text>
              <Text style={styles.recoDesc}>
                Generating personalized recommendations based on your field data.
              </Text>
            </View>
          </View>
        ) : null}
        
        {/* Sowing Window - Dynamic from AI */}
        {aiRecommendations?.recommended_crops?.[0]?.sowing_window && (
          <TouchableOpacity 
            style={styles.infoCard}
            onPress={() => {
              setSelectedCardDetail({
                type: 'sowing',
                title: 'Sowing Window',
                icon: 'calendar-month',
                data: aiRecommendations.recommended_crops[0]
              });
              setShowDetailModal(true);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.infoLeftIcon}>
              <MaterialIcons name="calendar-month" size={28} color="#3A5F0B" />
            </View>
            <View style={styles.infoCardContent}>
              <Text style={styles.infoLabel}>Optimal Sowing Window</Text>
              <Text style={styles.infoValue} numberOfLines={2} ellipsizeMode="tail">
                {aiRecommendations.recommended_crops[0].sowing_window.start} - {aiRecommendations.recommended_crops[0].sowing_window.end}
              </Text>
            </View>
            <View style={styles.infoCardRight}>
              <Text style={styles.infoSmall}>Optimal</Text>
              <Text style={[styles.infoValue, { color: '#FCA311' }]} numberOfLines={2} ellipsizeMode="tail">
                {aiRecommendations.recommended_crops[0].sowing_window.optimal_date || 'Check report'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#999" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        )}
        
        {/* Irrigation Plan - Dynamic from AI */}
        {aiRecommendations?.irrigation_plan && (
          <TouchableOpacity 
            style={styles.infoCard}
            onPress={() => {
              setSelectedCardDetail({
                type: 'irrigation',
                title: 'Irrigation Plan',
                icon: 'water-drop',
                data: aiRecommendations.irrigation_plan
              });
              setShowDetailModal(true);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.infoLeftIcon, { backgroundColor: '#e8efe1' }]}>
              <MaterialIcons name="water-drop" size={28} color="#3A5F0B" />
            </View>
            <View style={styles.infoCardContent}>
              <Text style={styles.infoLabel}>Next Irrigation</Text>
              <Text style={styles.infoValue} numberOfLines={2} ellipsizeMode="tail">
                {aiRecommendations.irrigation_plan.next_irrigation || 'As needed'}
              </Text>
            </View>
            <View style={styles.infoCardRight}>
              <Text style={styles.infoSmall}>Amount</Text>
              <Text style={[styles.infoValue, { color: '#3A5F0B' }]} numberOfLines={2} ellipsizeMode="tail">
                {aiRecommendations.irrigation_plan.amount || 'Moderate'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#999" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        )}
        
        {/* Fertilizer Guide - Dynamic from AI */}
        {aiRecommendations?.fertilizer_guidance?.organic_methods?.[0] && (
          <TouchableOpacity 
            style={styles.infoCard}
            onPress={() => {
              setSelectedCardDetail({
                type: 'fertilizer',
                title: 'Fertilizer Guidance',
                icon: 'science',
                data: aiRecommendations.fertilizer_guidance
              });
              setShowDetailModal(true);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.infoLeftIcon}>
              <MaterialIcons name="science" size={28} color="#3A5F0B" />
            </View>
            <View style={styles.infoCardContent}>
              <Text style={styles.infoLabel}>Fertilizer Guide</Text>
              <Text style={styles.infoValue} numberOfLines={2} ellipsizeMode="tail">
                {aiRecommendations.fertilizer_guidance.organic_methods[0].type || 'Organic Fertilizer'}
              </Text>
            </View>
            <View style={styles.infoCardRight}>
              <Text style={styles.infoSmall}>Apply</Text>
              <Text style={styles.infoValue} numberOfLines={2} ellipsizeMode="tail">
                {aiRecommendations.fertilizer_guidance.organic_methods[0].timing || 'Pre-sowing'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#999" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        )}
        
        {/* Yield Prediction - Dynamic from AI */}
        {aiRecommendations?.recommended_crops?.[0]?.yield_prediction && (
          <TouchableOpacity 
            style={styles.infoCard}
            onPress={() => {
              setSelectedCardDetail({
                type: 'yield',
                title: 'Yield Prediction',
                icon: 'trending-up',
                data: aiRecommendations.recommended_crops[0]
              });
              setShowDetailModal(true);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.infoLeftIcon}>
              <MaterialIcons name="trending-up" size={28} color="#3A5F0B" />
            </View>
            <View style={styles.infoCardContent}>
              <Text style={styles.infoLabel}>Yield Prediction</Text>
              <Text style={styles.infoValue} numberOfLines={2} ellipsizeMode="tail">
                {aiRecommendations.recommended_crops[0].yield_prediction.estimated_yield || 'Calculating...'}
              </Text>
            </View>
            <View style={styles.infoCardRight}>
              <Text style={styles.infoSmall}>Confidence</Text>
              <Text style={[styles.infoValue, { 
                color: aiRecommendations.recommended_crops[0].yield_prediction.confidence === 'high' ? '#3A5F0B' : '#FCA311'
              }]} numberOfLines={1}>
                {aiRecommendations.recommended_crops[0].yield_prediction.confidence || 'Medium'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#999" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        )}
        
        {/* Seasonal Calendar - Dynamic from AI */}
        {aiRecommendations?.seasonal_calendar && (
          <TouchableOpacity 
            style={styles.infoCard}
            onPress={() => {
              setSelectedCardDetail({
                type: 'seasonal',
                title: 'Seasonal Calendar',
                icon: 'calendar-today',
                data: aiRecommendations.seasonal_calendar
              });
              setShowDetailModal(true);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.infoLeftIcon}>
              <MaterialIcons name="calendar-today" size={28} color="#3A5F0B" />
            </View>
            <View style={styles.infoCardContent}>
              <Text style={styles.infoLabel}>Current Season</Text>
              <Text style={styles.infoValue} numberOfLines={2} ellipsizeMode="tail">
                {aiRecommendations.seasonal_calendar.current_season || 'Not specified'}
              </Text>
            </View>
            <View style={styles.infoCardRight}>
              <Text style={styles.infoSmall}>Next Season</Text>
              <Text style={styles.infoValue} numberOfLines={2} ellipsizeMode="tail">
                {aiRecommendations.seasonal_calendar.next_season_preparation || 'Plan ahead'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#999" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        )}
        {/* Buttons */}
        <View style={styles.bottomActions}>
          {/* View Detailed Report button hidden */}
          {/* <TouchableOpacity 
            style={styles.detailsBtn}
            onPress={() => {
              if (report) {
                setShowReportModal(true);
              } else {
                Alert.alert('No Report', 'Please analyze your field first to view detailed report.');
              }
            }}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>View Detailed Report</Text>
          </TouchableOpacity> */}
        </View>
      </ScrollView>

      {/* Field Selector Modal */}
      <Modal
        visible={showFieldSelector}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFieldSelector(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('cropAdvisory.selectField')}</Text>
              <TouchableOpacity onPress={() => setShowFieldSelector(false)}>
                <MaterialIcons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {fields.map((field) => (
                <TouchableOpacity
                  key={field.id || field.field_name}
                  style={[
                    styles.modalFieldItem,
                    selectedField?.id === field.id && styles.modalFieldItemSelected,
                  ]}
                  onPress={() => {
                    setSelectedField(field);
                    setShowFieldSelector(false);
                  }}
                >
                  <MaterialIcons name="location-on" size={20} color="#3A5F0B" />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.modalFieldName}>{field.id || field.field_name}</Text>
                    <Text style={styles.modalFieldArea}>
                      {calculateArea(field.lat1, field.lon1, field.lat2, field.lon2, field.lat3, field.lon3, field.lat4, field.lon4)} hectares
                    </Text>
                  </View>
                  {selectedField?.id === field.id && (
                    <MaterialIcons name="check-circle" size={24} color="#3A5F0B" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Map Modal */}
      {selectedField && (
        <Modal
          visible={showMapModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowMapModal(false)}
        >
          <View style={styles.mapModalOverlay}>
            <View style={styles.mapModalContent}>
              <View style={styles.mapModalHeader}>
                <Text style={styles.mapModalTitle}>
                  {selectedField.id || selectedField.field_name} - {fieldArea} hectares
                </Text>
                <TouchableOpacity onPress={() => setShowMapModal(false)}>
                  <MaterialIcons name="close" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
              <MapView
                style={styles.mapModalMap}
                region={getFieldRegion(selectedField)}
                mapType="satellite"
              >
                <Polygon
                  coordinates={getFieldCoordinates(selectedField)}
                  strokeColor="#3A5F0B"
                  fillColor="rgba(58, 95, 11, 0.3)"
                  strokeWidth={3}
                />
              </MapView>
            </View>
          </View>
        </Modal>
      )}

      {/* Report Modal */}
      <Modal
        visible={showReportModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReportModal(false)}
      >
        <View style={styles.reportModalOverlay}>
          <View style={styles.reportModalContent}>
            <View style={styles.reportModalHeader}>
              <Text style={styles.reportModalTitle}>
                {report?.field_name || selectedField?.id || 'Field Report'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <TouchableOpacity onPress={toggleHeaderTTS}>
                  <MaterialIcons name="volume-up" size={28} color={ttsOn ? '#2E7D32' : '#3A5F0B'} />
                </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowReportModal(false)}>
                <MaterialIcons name="close" size={24} color="#212121" />
              </TouchableOpacity>
              </View>
            </View>
            
            <ScrollView style={styles.reportModalScroll} showsVerticalScrollIndicator={true}>
              {/* NDVI Map Image */}
              {report?.ndvi_analysis?.map_url && (
                <View style={styles.reportSection}>
                  <Text style={styles.reportSectionTitle}>NDVI Map</Text>
                  <Image
                    source={{ uri: report.ndvi_analysis.map_url }}
                    style={styles.reportMapImage}
                    resizeMode="contain"
                  />
                  {/* NDVI Legend */}
                  <View style={{ marginTop: 10 }}>
                    <Text style={[styles.recommendationDetails, { marginBottom: 6 }]}>NDVI Colour Legend</Text>
                    <View style={styles.ndviLegendRow}>
                      <View style={styles.ndviLegendItem}>
                        <View style={[styles.ndviLegendColor, { backgroundColor: '#00441b' }]} />
                        <Text style={styles.ndviLegendLabel}>{'> 0.7'} Dense healthy vegetation</Text>
                      </View>
                      <View style={styles.ndviLegendItem}>
                        <View style={[styles.ndviLegendColor, { backgroundColor: '#238b45' }]} />
                        <Text style={styles.ndviLegendLabel}>{'0.5 – 0.7'} Good vegetation</Text>
                      </View>
                      <View style={styles.ndviLegendItem}>
                        <View style={[styles.ndviLegendColor, { backgroundColor: '#66c2a4' }]} />
                        <Text style={styles.ndviLegendLabel}>{'0.3 – 0.5'} Moderate vegetation</Text>
                      </View>
                      <View style={styles.ndviLegendItem}>
                        <View style={[styles.ndviLegendColor, { backgroundColor: '#b2e2e2' }]} />
                        <Text style={styles.ndviLegendLabel}>{'0.1 – 0.3'} Sparse vegetation</Text>
                      </View>
                      <View style={styles.ndviLegendItem}>
                        <View style={[styles.ndviLegendColor, { backgroundColor: '#fed976' }]} />
                        <Text style={styles.ndviLegendLabel}>{'0.0 – 0.1'} Bare soil</Text>
                      </View>
                      <View style={styles.ndviLegendItem}>
                        <View style={[styles.ndviLegendColor, { backgroundColor: '#ffeda0' }]} />
                        <Text style={styles.ndviLegendLabel}>{'< 0.0'} Water / clouds / shadows</Text>
                      </View>
                      {/* Additional palette often seen on rendered tiles */}
                      <View style={styles.ndviLegendItem}>
                        <View style={[styles.ndviLegendColor, { backgroundColor: '#de2d26' }]} />
                        <Text style={styles.ndviLegendLabel}>Red: Very low NDVI / Unhealthy or barren</Text>
                      </View>
                      <View style={styles.ndviLegendItem}>
                        <View style={[styles.ndviLegendColor, { backgroundColor: '#fd8d3c' }]} />
                        <Text style={styles.ndviLegendLabel}>Orange: Stressed vegetation / Dry soil</Text>
                      </View>
                      <View style={styles.ndviLegendItem}>
                        <View style={[styles.ndviLegendColor, { backgroundColor: '#969696' }]} />
                        <Text style={styles.ndviLegendLabel}>Grey: No data / Urban / Cloud shadow</Text>
                      </View>
                    </View>
                  </View>
                </View>
              )}
              
              {/* Health Score */}
              {report?.ndvi_analysis && (
                <View style={styles.reportSection}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.reportSectionTitle}>Field Health</Text>
                    <TouchableOpacity onPress={() => toggleSectionTTS('field_health', `Field health score ${(report.ndvi_analysis.health_score||0)}. NDVI ${(report.ndvi_analysis.average_ndvi||0)}. Overall ${(report.summary?.overall_health||'unknown')}.`)}>
                      <MaterialIcons name="volume-up" size={28} color={ttsSection==='field_health' ? '#2E7D32' : '#3A5F0B'} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.healthScoreContainer}>
                    <View style={styles.healthScoreCircle}>
                      <Text style={styles.healthScoreValue}>
                        {report.ndvi_analysis.health_score || 0}
                      </Text>
                    </View>
                    <View style={styles.healthScoreDetails}>
                      <Text style={styles.healthScoreLabel}>{t('cropAdvisory.healthScore')}</Text>
                      <Text style={styles.healthScoreSubLabel}>
                        NDVI: {(report.ndvi_analysis.average_ndvi || 0).toFixed(3)}
                      </Text>
                      <Text style={[
                        styles.healthStatusBadge,
                        { backgroundColor: report.summary?.overall_health === 'good' ? '#d4edda' : 
                          report.summary?.overall_health === 'critical' ? '#f8d7da' : '#fff3cd' }
                      ]}>
                        {report.summary?.overall_health?.toUpperCase() || 'UNKNOWN'}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
              
              {/* Primary Recommendation */}
              {report?.recommendations?.primary_recommendation && (
                <View style={styles.reportSection}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.reportSectionTitle}>Primary Recommendation</Text>
                    <TouchableOpacity onPress={() => {
                      const p = report.recommendations.primary_recommendation || {};
                      const msg = `${p.message || ''}. ${p.details || ''}. ${p.action ? 'Action: ' + p.action : ''}. ${p.priority ? 'Priority ' + p.priority : ''}.`;
                      toggleSectionTTS('primary_reco', msg);
                    }}>
                      <MaterialIcons name="volume-up" size={28} color={ttsSection==='primary_reco' ? '#2E7D32' : '#3A5F0B'} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.recommendationCard}>
                    <View style={styles.recommendationHeader}>
                      <MaterialIcons 
                        name={
                          report.recommendations.primary_recommendation.type === 'irrigation' ? 'water-drop' :
                          report.recommendations.primary_recommendation.type === 'fertilizer' ? 'science' :
                          report.recommendations.primary_recommendation.type === 'immediate_action' ? 'warning' :
                          'info'
                        } 
                        size={24} 
                        color="#3A5F0B" 
                      />
                      <Text style={styles.recommendationTitle}>
                        {report.recommendations.primary_recommendation.message}
                      </Text>
                    </View>
                    <Text style={styles.recommendationDetails}>
                      {report.recommendations.primary_recommendation.details}
                    </Text>
                    <View style={styles.recommendationAction}>
                      <MaterialIcons name="arrow-forward" size={16} color="#3A5F0B" />
                      <Text style={styles.recommendationActionText}>
                        {report.recommendations.primary_recommendation.action}
                      </Text>
                    </View>
                    <View style={styles.recommendationPriority}>
                      <Text style={styles.recommendationPriorityText}>
                        Priority: {report.recommendations.primary_recommendation.priority?.toUpperCase()}
                      </Text>
                      {report.recommendations.primary_recommendation.urgency_hours && (
                        <Text style={styles.recommendationUrgency}>
                          Within {Math.round(report.recommendations.primary_recommendation.urgency_hours / 24)} days
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              )}
              
              {/* Weather Forecast */}
              {report?.weather_forecast && report.weather_forecast.length > 0 && (
                <View style={styles.reportSection}>
                  <Text style={styles.reportSectionTitle}>5-Day Weather Forecast</Text>
                  {report.weather_forecast.map((day, index) => (
                    <View key={index} style={styles.weatherDayCard}>
                      <View style={styles.weatherDayHeader}>
                        <Text style={styles.weatherDayDate}>
                          {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </Text>
                        <Text style={styles.weatherDayTemp}>{day.temp}°C</Text>
                      </View>
                      <View style={styles.weatherDayDetails}>
                        <Text style={styles.weatherDayDesc}>{day.description}</Text>
                        <View style={styles.weatherDayStats}>
                          <Text style={styles.weatherDayStat}>🌧️ {day.rainfall}mm</Text>
                          <Text style={styles.weatherDayStat}>💧 {day.humidity}%</Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              )}
              
              {/* All Recommendations */}
              {report?.recommendations?.all_recommendations && report.recommendations.all_recommendations.length > 1 && (
                <View style={styles.reportSection}>
                  <Text style={styles.reportSectionTitle}>All Recommendations</Text>
                  {report.recommendations.all_recommendations.slice(1).map((rec, index) => (
                    <View key={index} style={styles.recommendationCardSmall}>
                      <Text style={styles.recommendationSmallTitle}>{rec.message}</Text>
                      <Text style={styles.recommendationSmallDetails}>{rec.details}</Text>
                      <Text style={styles.recommendationSmallAction}>{rec.action}</Text>
                    </View>
                  ))}
                </View>
              )}
              
              {/* Crop chooser inside modal - always show if NDVI >= 0.5 */}
              {/* User must select crop before AI recommendations are generated */}
              {(() => {
                const v = report?.ndvi_analysis?.average_ndvi || 0;
                // Always show if NDVI >= 0.5 and we don't have stage-wise advisory yet
                return v >= 0.5 && (!aiRecommendations || (aiRecommendations && !aiRecommendations.current_crop_advisory?.enabled));
              })() && (
                <View style={styles.reportSection}>
                  <Text style={styles.reportSectionTitle}>Current Crop</Text>
                  <Text style={[styles.recommendationDetails, { marginBottom: 8 }]}>Select or enter your current crop to get stage-wise guidance.</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {COMMON_CROPS.map(crop => (
                      <TouchableOpacity
                        key={`modal_${crop}`}
                        onPress={() => { setCurrentCrop(crop); if (crop !== 'Other') setOtherCropText(''); }}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: 16,
                          borderWidth: 1,
                          borderColor: currentCrop === crop ? '#3A5F0B' : '#ddd',
                          backgroundColor: currentCrop === crop ? '#e8efe1' : '#fff',
                          marginRight: 8,
                          marginBottom: 8,
                        }}
                      >
                        <Text style={{ color: '#333', fontSize: 12 }}>{crop}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {currentCrop === 'Other' && (
                    <View style={{ width: '100%', marginTop: 8 }}>
                      <Text style={[styles.recommendationDetails, { marginBottom: 6 }]}>Enter crop name</Text>
                      <TextInput
                        value={otherCropText}
                        onChangeText={setOtherCropText}
                        placeholder="e.g., Millet, Quinoa, Oat, etc."
                        style={{
                          borderWidth: 1,
                          borderColor: '#ddd',
                          borderRadius: 8,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          backgroundColor: '#fff'
                        }}
                      />
                    </View>
                  )}
                  <TouchableOpacity
                    disabled={!currentCrop || (currentCrop === 'Other' && !otherCropText.trim()) || isLoadingAiRecommendations}
                    onPress={async () => {
                      try {
                        const field_ID = selectedField?.id || selectedField?.field_name;
                        const farmer_ID = auth.currentUser?.uid;
                        if (!field_ID || !farmer_ID || !report) return;
                        setIsLoadingAiRecommendations(true);
                        const cropToSend = currentCrop === 'Other' ? otherCropText.trim() : currentCrop;
                        // Load stored advisory parameters
                  let advisoryParams = null;
                  try {
                    const stored = await AsyncStorage.getItem(`advisory_params_${field_ID}`);
                    if (stored) {
                      advisoryParams = JSON.parse(stored);
                    }
                  } catch (e) {
                    console.warn('Could not load advisory params:', e);
                  }
                  const aiResponse = await getAiRecommendations(report, farmer_ID, field_ID, report.language || 'en', cropToSend, extractedText, advisoryParams);
                        if (aiResponse?.recommendations && !aiResponse.recommendations.error) {
                          setAiRecommendations(aiResponse.recommendations);
                          setAiVideos(aiResponse.videos || []);
                          await storeAiRecommendations(field_ID, aiResponse.recommendations);
                          setAiError(null);
                        } else if (aiResponse?.recommendations?.error) {
                          setAiError(aiResponse.recommendations.error || 'AI generation failed');
                        }
                      } catch (e) {
                        setAiError(e.message || 'AI request failed');
                      } finally {
                        setIsLoadingAiRecommendations(false);
                      }
                    }}
                    style={{
                      marginTop: 8,
                      backgroundColor: (!currentCrop || (currentCrop === 'Other' && !otherCropText.trim()) || isLoadingAiRecommendations) ? '#ccc' : '#3A5F0B',
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 8,
                      alignSelf: 'flex-start'
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>
                      {isLoadingAiRecommendations ? t('common.loading') : t('cropAdvisory.getStageWiseAdvisory')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* AI Recommendations in Report Modal */}
              {report?.ai_recommendations && (
                <>
                  {report.ai_recommendations.recommended_crops && report.ai_recommendations.recommended_crops.length > 0 && (
                    <View style={styles.reportSection}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={styles.reportSectionTitle}>Recommended Crops</Text>
                        <TouchableOpacity onPress={() => {
                          const list = (report.ai_recommendations.recommended_crops||[]).slice(0,3).map(c => `${c.crop_name}. ${c.reason || ''}. ${c.yield_prediction?.estimated_yield || ''}`);
                          toggleSectionTTS('reco_crops', list.join(' '));
                        }}>
                          <MaterialIcons name="volume-up" size={28} color={ttsSection==='reco_crops' ? '#2E7D32' : '#3A5F0B'} />
                    </TouchableOpacity>
                  </View>
                      {report.ai_recommendations.recommended_crops.map((crop, idx) => (
                        <View key={idx} style={styles.recommendationCard}>
                          <Text style={styles.recommendationHeaderText}>{crop.crop_name} ({crop.scientific_name})</Text>
                          <Text style={styles.recommendationDetails}>Suitability: {crop.suitability_score}/100</Text>
                          <Text style={styles.recommendationDetails}>{crop.reason}</Text>
                          {crop.sowing_window && (
                            <Text style={styles.recommendationDetails}>
                              Sowing: {crop.sowing_window.start} to {crop.sowing_window.end}
                            </Text>
                          )}
                          {crop.yield_prediction && (
                            <Text style={styles.recommendationDetails}>
                              Yield: {crop.yield_prediction.estimated_yield} ({crop.yield_prediction.confidence} confidence)
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                  
                  {report.ai_recommendations.fertilizer_guidance && (
                    <View style={styles.reportSection}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={styles.reportSectionTitle}>Fertilizer Guidance (Organic & Biodegradable)</Text>
                        <TouchableOpacity onPress={() => {
                          const fg = report.ai_recommendations.fertilizer_guidance || {};
                          const org = (fg.organic_methods||[]).slice(0,2).map(m => `${m.type}: ${m.application_rate || m.dosage || ''} ${m.timing || ''}`).join('. ');
                          const bio = (fg.biofertilizers||[]).slice(0,2).map(m => `${m.type}: ${m.dosage || ''}`).join('. ');
                          toggleSectionTTS('fertilizer', [org,bio].filter(Boolean).join('. '));
                        }}>
                          <MaterialIcons name="volume-up" size={28} color={ttsSection==='fertilizer' ? '#2E7D32' : '#3A5F0B'} />
                    </TouchableOpacity>
                  </View>
                      {report.ai_recommendations.fertilizer_guidance.organic_methods && (
                        <>
                          <Text style={styles.reportSubSectionTitle}>Organic Methods</Text>
                          {report.ai_recommendations.fertilizer_guidance.organic_methods.map((method, idx) => (
                            <View key={idx} style={styles.recommendationCard}>
                              <Text style={styles.recommendationHeaderText}>{method.type}</Text>
                              <Text style={styles.recommendationDetails}>Application Rate: {method.application_rate}</Text>
                              <Text style={styles.recommendationDetails}>Timing: {method.timing}</Text>
                              <Text style={styles.recommendationDetails}>Method: {method.method}</Text>
                              <Text style={styles.recommendationDetails}>Benefits: {method.benefits}</Text>
                            </View>
                          ))}
                        </>
                      )}
                      {report.ai_recommendations.fertilizer_guidance.biofertilizers && (
                        <>
                          <Text style={styles.reportSubSectionTitle}>Biofertilizers</Text>
                          {report.ai_recommendations.fertilizer_guidance.biofertilizers.map((bio, idx) => (
                            <View key={idx} style={styles.recommendationCard}>
                              <Text style={styles.recommendationHeaderText}>{bio.type}</Text>
                              <Text style={styles.recommendationDetails}>Application: {bio.application}</Text>
                              <Text style={styles.recommendationDetails}>Dosage: {bio.dosage}</Text>
                            </View>
                          ))}
                        </>
                      )}
                    </View>
                  )}
                  
                  {report.ai_recommendations.indices_analysis && (
                    <View style={styles.reportSection}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={styles.reportSectionTitle}>Field Health Analysis</Text>
                        <TouchableOpacity onPress={() => {
                          const ia = report.ai_recommendations.indices_analysis || {};
                          toggleSectionTTS('analysis', joinLines([ia.ndvi_interpretation, ia.health_status, (ia.stress_indicators||[]).join(', ')]));
                        }}>
                          <MaterialIcons name="volume-up" size={28} color={ttsSection==='analysis' ? '#2E7D32' : '#3A5F0B'} />
                    </TouchableOpacity>
                  </View>
                      <View style={styles.recommendationCard}>
                        <Text style={styles.recommendationDetails}>
                          {report.ai_recommendations.indices_analysis.ndvi_interpretation}
                        </Text>
                        <Text style={styles.recommendationDetails}>
                          Health Status: {report.ai_recommendations.indices_analysis.health_status}
                        </Text>
                        {report.ai_recommendations.indices_analysis.stress_indicators && (
                          <Text style={styles.recommendationDetails}>
                            Stress Indicators: {report.ai_recommendations.indices_analysis.stress_indicators.join(', ')}
                          </Text>
                        )}
                      </View>
                    </View>
                  )}
                  
                  {report.ai_recommendations.market_insights && (
                    <View style={styles.reportSection}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={styles.reportSectionTitle}>Market Insights</Text>
                        <TouchableOpacity onPress={() => {
                          const mi = report.ai_recommendations.market_insights || {};
                          toggleSectionTTS('market', joinLines([`Best selling ${mi.best_selling_period}`, `Expected price ${mi.expected_price_range}`, `Demand ${mi.market_demand}`]));
                        }}>
                          <MaterialIcons name="volume-up" size={28} color={ttsSection==='market' ? '#2E7D32' : '#3A5F0B'} />
                    </TouchableOpacity>
                  </View>
                      <View style={styles.recommendationCard}>
                        <Text style={styles.recommendationDetails}>
                          Best Selling Period: {report.ai_recommendations.market_insights.best_selling_period}
                        </Text>
                        <Text style={styles.recommendationDetails}>
                          Expected Price Range: {report.ai_recommendations.market_insights.expected_price_range}
                        </Text>
                        <Text style={styles.recommendationDetails}>
                          Market Demand: {report.ai_recommendations.market_insights.market_demand}
                        </Text>
                      </View>
                    </View>
                  )}
                </>
              )}
              
              {/* YouTube Videos Section */}
              {aiVideos && aiVideos.length > 0 && (
                <View style={styles.reportSection}>
                  <Text style={styles.reportSectionTitle}>
                    {t('cropAdvisory.learningVideos') || 'Learning Videos'}
                  </Text>
                  <Text style={styles.reportSectionDesc}>
                    {t('cropAdvisory.learningVideosDesc') || 'Watch these videos to learn more about crop management, organic farming, and yield improvement techniques.'}
                  </Text>
                  {aiVideos.map((video, idx) => (
                    <View key={`${video.videoId || idx}`} style={styles.videoCard}>
                      {video.thumbnail && (
                        <Image source={{ uri: video.thumbnail }} style={styles.videoThumb} />
                      )}
                      <View style={styles.videoContent}>
                        <Text style={styles.videoTitle} numberOfLines={2}>
                          {video.title}
                        </Text>
                        <Text style={styles.videoMeta}>
                          {video.channelTitle} • {video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : ''}
                        </Text>
                        {video.url && (
                          <TouchableOpacity
                            onPress={() => Linking.openURL(video.url)}
                            style={styles.videoBtn}
                          >
                            <MaterialIcons name="play-circle-outline" size={20} color="#fff" />
                            <Text style={styles.videoBtnText}>
                              {t('cropAdvisory.watchVideo') || 'Watch Video'}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Report Metadata */}
              {report?.generated_at && (
                <View style={styles.reportSection}>
                  <Text style={styles.reportMeta}>
                    Generated: {new Date(report.generated_at).toLocaleString()}
                  </Text>
                  {report.ndvi_analysis?.provider && (
                    <Text style={styles.reportMeta}>
                      Data Source: {report.ndvi_analysis.provider}
                    </Text>
                  )}
                  {report.language && (
                    <Text style={styles.reportMeta}>
                      Language: {report.language}
                    </Text>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Card Detail Modal */}
      <Modal
        visible={showDetailModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={styles.detailModalOverlay}>
          <View style={styles.detailModalContent}>
            <View style={styles.detailModalHeader}>
              {selectedCardDetail && (
                <View style={styles.detailModalHeaderLeft}>
                  <View style={[styles.detailModalIcon, { backgroundColor: '#e8efe1' }]}>
                    <MaterialIcons name={selectedCardDetail.icon} size={28} color="#3A5F0B" />
                  </View>
                  <Text style={styles.detailModalTitle}>{selectedCardDetail.title}</Text>
                </View>
              )}
              <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                <MaterialIcons name="close" size={24} color="#212121" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.detailModalScroll} showsVerticalScrollIndicator={true}>
              {selectedCardDetail && (
                <>
                  {selectedCardDetail.type === 'irrigation' && selectedCardDetail.data && (
                    <View style={styles.detailSection}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Next Irrigation</Text>
                        <Text style={styles.detailValue}>{selectedCardDetail.data.next_irrigation || 'As needed'}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Amount</Text>
                        <Text style={styles.detailValue}>{selectedCardDetail.data.amount || 'Moderate'}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Frequency</Text>
                        <Text style={styles.detailValue}>{selectedCardDetail.data.frequency || 'N/A'}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Method</Text>
                        <Text style={styles.detailValue}>{selectedCardDetail.data.method || 'N/A'}</Text>
                      </View>
                      {selectedCardDetail.data.last_irrigation_days_ago !== undefined && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Last Irrigation</Text>
                          <Text style={styles.detailValue}>{selectedCardDetail.data.last_irrigation_days_ago} days ago</Text>
                        </View>
                      )}
                      {selectedCardDetail.data.irrigation_status && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Status</Text>
                          <Text style={styles.detailValue}>{selectedCardDetail.data.irrigation_status}</Text>
                        </View>
                      )}
                      {selectedCardDetail.data.water_conservation_tips && selectedCardDetail.data.water_conservation_tips.length > 0 && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Water Conservation Tips</Text>
                          {selectedCardDetail.data.water_conservation_tips.map((tip, idx) => (
                            <Text key={idx} style={styles.detailBullet}>• {tip}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  {selectedCardDetail.type === 'fertilizer' && selectedCardDetail.data && (
                    <View style={styles.detailSection}>
                      {selectedCardDetail.data.organic_methods && selectedCardDetail.data.organic_methods.length > 0 && (
                        <>
                          <Text style={styles.detailSectionTitle}>Organic Methods</Text>
                          {selectedCardDetail.data.organic_methods.map((method, idx) => (
                            <View key={idx} style={styles.detailCard}>
                              <Text style={styles.detailCardTitle}>{method.type}</Text>
                              {method.application_rate && (
                                <View style={styles.detailItem}>
                                  <Text style={styles.detailLabel}>Application Rate</Text>
                                  <Text style={styles.detailValue}>{method.application_rate}</Text>
                                </View>
                              )}
                              {method.timing && (
                                <View style={styles.detailItem}>
                                  <Text style={styles.detailLabel}>Timing</Text>
                                  <Text style={styles.detailValue}>{method.timing}</Text>
                                </View>
                              )}
                              {method.method && (
                                <View style={styles.detailItem}>
                                  <Text style={styles.detailLabel}>Method</Text>
                                  <Text style={styles.detailValue}>{method.method}</Text>
                                </View>
                              )}
                              {method.benefits && (
                                <View style={styles.detailItem}>
                                  <Text style={styles.detailLabel}>Benefits</Text>
                                  <Text style={styles.detailValue}>{method.benefits}</Text>
                                </View>
                              )}
                            </View>
                          ))}
                        </>
                      )}
                      {selectedCardDetail.data.biofertilizers && selectedCardDetail.data.biofertilizers.length > 0 && (
                        <>
                          <Text style={styles.detailSectionTitle}>Biofertilizers</Text>
                          {selectedCardDetail.data.biofertilizers.map((bio, idx) => (
                            <View key={idx} style={styles.detailCard}>
                              <Text style={styles.detailCardTitle}>{bio.type}</Text>
                              {bio.application && (
                                <View style={styles.detailItem}>
                                  <Text style={styles.detailLabel}>Application</Text>
                                  <Text style={styles.detailValue}>{bio.application}</Text>
                                </View>
                              )}
                              {bio.dosage && (
                                <View style={styles.detailItem}>
                                  <Text style={styles.detailLabel}>Dosage</Text>
                                  <Text style={styles.detailValue}>{bio.dosage}</Text>
                                </View>
                              )}
                            </View>
                          ))}
                        </>
                      )}
                      {selectedCardDetail.data.schedule && (
                        <>
                          <Text style={styles.detailSectionTitle}>Schedule</Text>
                          <View style={styles.detailCard}>
                            {selectedCardDetail.data.schedule.pre_sowing && (
                              <View style={styles.detailItem}>
                                <Text style={styles.detailLabel}>Pre-Sowing</Text>
                                <Text style={styles.detailValue}>{selectedCardDetail.data.schedule.pre_sowing}</Text>
                              </View>
                            )}
                            {selectedCardDetail.data.schedule.during_growth && (
                              <View style={styles.detailItem}>
                                <Text style={styles.detailLabel}>During Growth</Text>
                                <Text style={styles.detailValue}>{selectedCardDetail.data.schedule.during_growth}</Text>
                              </View>
                            )}
                            {selectedCardDetail.data.schedule.harvest_preparation && (
                              <View style={styles.detailItem}>
                                <Text style={styles.detailLabel}>Harvest Preparation</Text>
                                <Text style={styles.detailValue}>{selectedCardDetail.data.schedule.harvest_preparation}</Text>
                              </View>
                            )}
                          </View>
                        </>
                      )}
                    </View>
                  )}

                  {selectedCardDetail.type === 'sowing' && selectedCardDetail.data && (
                    <View style={styles.detailSection}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Crop Name</Text>
                        <Text style={styles.detailValue}>{selectedCardDetail.data.crop_name || 'N/A'}</Text>
                      </View>
                      {selectedCardDetail.data.scientific_name && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Scientific Name</Text>
                          <Text style={styles.detailValue}>{selectedCardDetail.data.scientific_name}</Text>
                        </View>
                      )}
                      {selectedCardDetail.data.sowing_window && (
                        <>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Sowing Window Start</Text>
                            <Text style={styles.detailValue}>{selectedCardDetail.data.sowing_window.start}</Text>
                          </View>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Sowing Window End</Text>
                            <Text style={styles.detailValue}>{selectedCardDetail.data.sowing_window.end}</Text>
                          </View>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Optimal Date</Text>
                            <Text style={[styles.detailValue, { color: '#FCA311' }]}>{selectedCardDetail.data.sowing_window.optimal_date || 'N/A'}</Text>
                          </View>
                        </>
                      )}
                      {selectedCardDetail.data.suitability_score !== undefined && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Suitability Score</Text>
                          <Text style={styles.detailValue}>{selectedCardDetail.data.suitability_score}/100</Text>
                        </View>
                      )}
                      {selectedCardDetail.data.reason && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Reason</Text>
                          <Text style={styles.detailValue}>{selectedCardDetail.data.reason}</Text>
                        </View>
                      )}
                      {selectedCardDetail.data.season && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Season</Text>
                          <Text style={styles.detailValue}>{selectedCardDetail.data.season}</Text>
                        </View>
                      )}
                      {selectedCardDetail.data.growth_duration && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Growth Duration</Text>
                          <Text style={styles.detailValue}>{selectedCardDetail.data.growth_duration}</Text>
                        </View>
                      )}
                      {selectedCardDetail.data.yield_prediction && (
                        <>
                          <Text style={styles.detailSectionTitle}>Yield Prediction</Text>
                          <View style={styles.detailCard}>
                            <View style={styles.detailItem}>
                              <Text style={styles.detailLabel}>Estimated Yield</Text>
                              <Text style={styles.detailValue}>{selectedCardDetail.data.yield_prediction.estimated_yield || 'N/A'}</Text>
                            </View>
                            <View style={styles.detailItem}>
                              <Text style={styles.detailLabel}>Confidence</Text>
                              <Text style={[styles.detailValue, { 
                                color: selectedCardDetail.data.yield_prediction.confidence === 'high' ? '#3A5F0B' : '#FCA311'
                              }]}>
                                {selectedCardDetail.data.yield_prediction.confidence || 'Medium'}
                              </Text>
                            </View>
                            {selectedCardDetail.data.yield_prediction.factors && selectedCardDetail.data.yield_prediction.factors.length > 0 && (
                              <View style={styles.detailItem}>
                                <Text style={styles.detailLabel}>Factors</Text>
                                {selectedCardDetail.data.yield_prediction.factors.map((factor, idx) => (
                                  <Text key={idx} style={styles.detailBullet}>• {factor}</Text>
                                ))}
                              </View>
                            )}
                          </View>
                        </>
                      )}
                    </View>
                  )}

                  {selectedCardDetail.type === 'yield' && selectedCardDetail.data && selectedCardDetail.data.yield_prediction && (
                    <View style={styles.detailSection}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Crop Name</Text>
                        <Text style={styles.detailValue}>{selectedCardDetail.data.crop_name || 'N/A'}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Estimated Yield</Text>
                        <Text style={styles.detailValue}>{selectedCardDetail.data.yield_prediction.estimated_yield || 'N/A'}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Confidence</Text>
                        <Text style={[styles.detailValue, { 
                          color: selectedCardDetail.data.yield_prediction.confidence === 'high' ? '#3A5F0B' : '#FCA311'
                        }]}>
                          {selectedCardDetail.data.yield_prediction.confidence || 'Medium'}
                        </Text>
                      </View>
                      {selectedCardDetail.data.yield_prediction.factors && selectedCardDetail.data.yield_prediction.factors.length > 0 && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Factors Affecting Yield</Text>
                          {selectedCardDetail.data.yield_prediction.factors.map((factor, idx) => (
                            <Text key={idx} style={styles.detailBullet}>• {factor}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  {selectedCardDetail.type === 'seasonal' && selectedCardDetail.data && (
                    <View style={styles.detailSection}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Current Season</Text>
                        <Text style={styles.detailValue}>{selectedCardDetail.data.current_season || 'Not specified'}</Text>
                      </View>
                      {selectedCardDetail.data.next_season_preparation && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Next Season Preparation</Text>
                          <Text style={styles.detailValue}>{selectedCardDetail.data.next_season_preparation}</Text>
                        </View>
                      )}
                      {selectedCardDetail.data.year_round_activities && selectedCardDetail.data.year_round_activities.length > 0 && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Year-Round Activities</Text>
                          {selectedCardDetail.data.year_round_activities.map((activity, idx) => (
                            <Text key={idx} style={styles.detailBullet}>• {activity}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  {selectedCardDetail.type === 'weather' && selectedCardDetail.data && (
                    <View style={styles.detailSection}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Temperature</Text>
                        <Text style={styles.detailValue}>{Math.round(selectedCardDetail.data.temp)}°C</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Feels Like</Text>
                        <Text style={styles.detailValue}>{Math.round(selectedCardDetail.data.feels_like)}°C</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Weather Condition</Text>
                        <Text style={styles.detailValue}>{selectedCardDetail.data.weather || 'N/A'}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Humidity</Text>
                        <Text style={styles.detailValue}>{selectedCardDetail.data.humidity}%</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Wind Speed</Text>
                        <Text style={styles.detailValue}>{Math.round((selectedCardDetail.data.wind_speed || 0) * 3.6)} km/h</Text>
                      </View>
                      {selectedCardDetail.data.pressure && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Pressure</Text>
                          <Text style={styles.detailValue}>{selectedCardDetail.data.pressure} hPa</Text>
                        </View>
                      )}
                      {selectedCardDetail.data.visibility && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Visibility</Text>
                          <Text style={styles.detailValue}>{selectedCardDetail.data.visibility / 1000} km</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {selectedCardDetail.type === 'weather_advisory' && selectedCardDetail.data && (
                    <View style={styles.detailSection}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Risk Summary</Text>
                        <Text style={styles.detailValue}>{selectedCardDetail.data.risk_summary || 'N/A'}</Text>
                      </View>
                      {selectedCardDetail.data.risks && selectedCardDetail.data.risks.length > 0 && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Risks</Text>
                          {selectedCardDetail.data.risks.map((risk, idx) => (
                            <Text key={idx} style={styles.detailBullet}>• {risk}</Text>
                          ))}
                        </View>
                      )}
                      {selectedCardDetail.data.recommendations && selectedCardDetail.data.recommendations.length > 0 && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Recommendations</Text>
                          {selectedCardDetail.data.recommendations.map((rec, idx) => (
                            <Text key={idx} style={styles.detailBullet}>• {rec}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  {selectedCardDetail.type === 'action_item' && selectedCardDetail.data && (
                    <View style={styles.detailSection}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Action</Text>
                        <Text style={styles.detailValue}>{selectedCardDetail.data.action || 'N/A'}</Text>
                      </View>
                      {selectedCardDetail.data.deadline && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Deadline</Text>
                          <Text style={[styles.detailValue, { color: '#FCA311', fontWeight: 'bold' }]}>{selectedCardDetail.data.deadline}</Text>
                        </View>
                      )}
                      {selectedCardDetail.data.priority && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Priority</Text>
                          <Text style={[styles.detailValue, { 
                            color: selectedCardDetail.data.priority === 'high' ? '#d32f2f' : 
                                   selectedCardDetail.data.priority === 'medium' ? '#FCA311' : '#3A5F0B'
                          }]}>
                            {selectedCardDetail.data.priority.toUpperCase()}
                          </Text>
                        </View>
                      )}
                      {selectedCardDetail.data.estimated_cost && (
                        <View style={styles.detailItem}>
                          <Text style={styles.detailLabel}>Estimated Cost</Text>
                          <Text style={styles.detailValue}>{selectedCardDetail.data.estimated_cost}</Text>
                        </View>
                      )}
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Upload Soil Health Card Modal */}
      <Modal visible={showUploadModal} transparent animationType="slide" onRequestClose={() => setShowUploadModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.uploadModalCard}>
            <View style={styles.uploadModalHeader}>
              <Text style={styles.uploadModalTitle}>{t('cropAdvisory.uploadSoilHealthCard') || 'Upload Soil Health Card'}</Text>
              <TouchableOpacity onPress={() => setShowUploadModal(false)}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
    </View>

            {extractedText && (
              <View style={styles.extractedTextCard}>
                <Text style={styles.extractedTextLabel}>{t('cropAdvisory.extractedText') || 'Extracted Text'}:</Text>
                <ScrollView style={styles.extractedTextScroll}>
                  <Text style={styles.extractedText}>{extractedText}</Text>
                </ScrollView>
              </View>
            )}

            {uploadedCardUrl && (
              <View style={styles.uploadedCardPreview}>
                <Text style={styles.uploadedCardLabel}>{t('cropAdvisory.uploadedCard') || 'Uploaded Card'}:</Text>
                <Image source={{ uri: uploadedCardUrl }} style={styles.uploadedCardImage} />
              </View>
            )}

            <View style={styles.uploadOptions}>
              <TouchableOpacity
                style={[styles.uploadOptionBtn, uploadingCard && styles.uploadOptionBtnDisabled]}
                onPress={() => handleUploadCard('camera')}
                disabled={uploadingCard}
              >
                <MaterialIcons name="camera-alt" size={24} color="#fff" />
                <Text style={styles.uploadOptionText}>{t('cropAdvisory.takePhoto') || 'Take Photo'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.uploadOptionBtn, uploadingCard && styles.uploadOptionBtnDisabled]}
                onPress={() => handleUploadCard('gallery')}
                disabled={uploadingCard}
              >
                <MaterialIcons name="photo-library" size={24} color="#fff" />
                <Text style={styles.uploadOptionText}>{t('cropAdvisory.chooseFromGallery') || 'Choose from Gallery'}</Text>
              </TouchableOpacity>
            </View>

            {uploadingCard && (
              <View style={styles.uploadingIndicator}>
                <ActivityIndicator size="small" color="#3A5F0B" />
                <Text style={styles.uploadingText}>{t('cropAdvisory.uploadingAndExtracting') || 'Uploading and extracting text...'}</Text>
              </View>
            )}

            {extractedText && (
              <View style={styles.extractedTextInfo}>
                <Text style={styles.extractedTextInfoText}>
                  {t('cropAdvisory.extractedTextInfo') || 'The extracted text will be used to provide better crop recommendations based on your soil health card data.'}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Uttarakhand-Specific Advisory Step-wise Modal */}
      <Modal
        visible={showAdvisoryModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAdvisoryModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.advisoryModalCard}>
            <View style={styles.advisoryModalHeader}>
              <Text style={styles.advisoryModalTitle}>
                {t('cropAdvisory.uttarakhandAdvisory')}
              </Text>
              <TouchableOpacity onPress={() => setShowAdvisoryModal(false)}>
                <MaterialIcons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            {/* Progress Indicator */}
            {(() => {
              // Calculate total steps: Step 5 (Kisan centers) only shows if no soil health data
              const hasSoilHealthData = (soilHealthMethod === 'card' && extractedText) || 
                                       (soilHealthMethod === 'manual' && (manualNPK.nitrogen || manualNPK.phosphorus || manualNPK.potassium));
              const totalSteps = hasSoilHealthData ? 4 : 5; // Step 4: Irrigation, Step 5: Kisan centers (conditional)
              const currentStep = hasSoilHealthData && advisoryStep === 5 ? 4 : advisoryStep;
              
              return (
                <>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${(currentStep / totalSteps) * 100}%` }]} />
                  </View>
                  <Text style={styles.progressText}>
                    {t('cropAdvisory.step')} {currentStep} {t('cropAdvisory.of')} {totalSteps}
                  </Text>
                </>
              );
            })()}

            <ScrollView style={styles.advisoryModalScroll} showsVerticalScrollIndicator={true}>
              {/* Step 1: District and Soil Type */}
              {advisoryStep === 1 && (
                <View>
                  <Text style={styles.stepTitle}>
                    {t('cropAdvisory.selectDistrict')}
                  </Text>
                  <Text style={styles.stepDescription}>
                    {selectedDistrict 
                      ? t('cropAdvisory.districtAutoDetected', { district: UTTARAKHAND_DISTRICTS.find(d => d.value === selectedDistrict)?.name || selectedDistrict })
                      : t('cropAdvisory.selectDistrictDesc')
                    }
                  </Text>
                  
                  <View style={styles.dropdownContainer}>
                    {UTTARAKHAND_DISTRICTS.map((district) => (
                      <TouchableOpacity
                        key={district.value}
                        style={[
                          styles.dropdownItem,
                          selectedDistrict === district.value && styles.dropdownItemSelected,
                        ]}
                        onPress={() => {
                          setSelectedDistrict(district.value);
                          setSelectedSoilType(null); // Reset soil type when district changes
                        }}
                      >
                        <Text style={[
                          styles.dropdownItemText,
                          selectedDistrict === district.value && styles.dropdownItemTextSelected,
                        ]}>
                          {district.name}
                        </Text>
                        {selectedDistrict === district.value && (
                          <MaterialIcons name="check-circle" size={20} color="#3A5F0B" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>

                  {selectedDistrict && UTTARAKHAND_SOIL_TYPES[selectedDistrict]?.length > 0 && (
                    <View style={{ marginTop: 20 }}>
                      <Text style={styles.stepTitle}>
                        {t('cropAdvisory.selectSoilType')}
                      </Text>
                      <View style={styles.dropdownContainer}>
                        {UTTARAKHAND_SOIL_TYPES[selectedDistrict].map((soilType) => (
                          <TouchableOpacity
                            key={soilType}
                            style={[
                              styles.dropdownItem,
                              selectedSoilType === soilType && styles.dropdownItemSelected,
                            ]}
                            onPress={() => setSelectedSoilType(soilType)}
                          >
                            <Text style={[
                              styles.dropdownItemText,
                              selectedSoilType === soilType && styles.dropdownItemTextSelected,
                            ]}>
                              {soilType}
                            </Text>
                            {selectedSoilType === soilType && (
                              <MaterialIcons name="check-circle" size={20} color="#3A5F0B" />
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* Step 2: Season */}
              {advisoryStep === 2 && (
                <View>
                  <Text style={styles.stepTitle}>
                    {t('cropAdvisory.currentSeason')}
                  </Text>
                  <Text style={styles.stepDescription}>
                    {detectedSeason?.description || t('cropAdvisory.seasonAutoDetected')}
                  </Text>
                  
                  <View style={styles.seasonCard}>
                    <View style={styles.seasonIcon}>
                      <MaterialIcons 
                        name={detectedSeason?.season === 'Kharif' ? 'wb-sunny' : detectedSeason?.season === 'Rabi' ? 'ac-unit' : 'local-florist'} 
                        size={40} 
                        color="#3A5F0B" 
                      />
                    </View>
                    <Text style={styles.seasonName}>{detectedSeason?.season || 'Unknown'}</Text>
                    <Text style={styles.seasonDescription}>{detectedSeason?.description}</Text>
                  </View>

                  <View style={styles.infoBox}>
                    <MaterialIcons name="info" size={20} color="#3A5F0B" />
                    <Text style={styles.infoBoxText}>
                      {t('cropAdvisory.seasonInfo')}
                    </Text>
                  </View>
                </View>
              )}

              {/* Step 3: Soil Health */}
              {advisoryStep === 3 && (
                <View>
                  <Text style={styles.stepTitle}>
                    {t('cropAdvisory.soilHealth')}
                  </Text>
                  <Text style={styles.stepDescription}>
                    {t('cropAdvisory.soilHealthDesc')}
                  </Text>

                  <View style={styles.soilHealthOptions}>
                    <TouchableOpacity
                      style={[
                        styles.soilHealthOption,
                        soilHealthMethod === 'card' && styles.soilHealthOptionSelected,
                      ]}
                      onPress={() => {
                        setSoilHealthMethod('card');
                        if (!extractedText) {
                          // Open upload modal
                          setShowAdvisoryModal(false);
                          setShowUploadModal(true);
                        }
                      }}
                    >
                      <MaterialIcons name="upload-file" size={24} color={soilHealthMethod === 'card' ? '#fff' : '#3A5F0B'} />
                      <Text style={[
                        styles.soilHealthOptionText,
                        soilHealthMethod === 'card' && styles.soilHealthOptionTextSelected,
                      ]}>
                        {t('cropAdvisory.uploadCard')}
                      </Text>
                      {extractedText && (
                        <Text style={styles.soilHealthOptionSubtext}>
                          {t('cropAdvisory.cardUploaded')}
                        </Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.soilHealthOption,
                        soilHealthMethod === 'manual' && styles.soilHealthOptionSelected,
                      ]}
                      onPress={() => setSoilHealthMethod('manual')}
                    >
                      <MaterialIcons name="edit" size={24} color={soilHealthMethod === 'manual' ? '#fff' : '#3A5F0B'} />
                      <Text style={[
                        styles.soilHealthOptionText,
                        soilHealthMethod === 'manual' && styles.soilHealthOptionTextSelected,
                      ]}>
                        {t('cropAdvisory.enterManually')}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.soilHealthOption,
                        soilHealthMethod === 'skip' && styles.soilHealthOptionSelected,
                      ]}
                      onPress={() => {
      Alert.alert(
        t('cropAdvisory.warning'),
        t('cropAdvisory.skipWarning'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { 
            text: t('common.skip'), 
            onPress: () => setSoilHealthMethod('skip'),
            style: 'destructive',
          },
        ]
      );
                      }}
                    >
                      <MaterialIcons name="skip-next" size={24} color={soilHealthMethod === 'skip' ? '#fff' : '#666'} />
                      <Text style={[
                        styles.soilHealthOptionText,
                        soilHealthMethod === 'skip' && styles.soilHealthOptionTextSelected,
                      ]}>
                        {t('cropAdvisory.skip')}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Manual N, P, K Input */}
                  {soilHealthMethod === 'manual' && (
                    <View style={styles.npkInputContainer}>
                      <Text style={styles.npkLabel}>{t('cropAdvisory.nitrogen')}</Text>
                      <TextInput
                        style={styles.npkInput}
                        value={manualNPK.nitrogen}
                        onChangeText={(text) => setManualNPK({ ...manualNPK, nitrogen: text })}
                        placeholder="e.g., 0.5"
                        keyboardType="decimal-pad"
                      />
                      <Text style={styles.npkLabel}>{t('cropAdvisory.phosphorus')}</Text>
                      <TextInput
                        style={styles.npkInput}
                        value={manualNPK.phosphorus}
                        onChangeText={(text) => setManualNPK({ ...manualNPK, phosphorus: text })}
                        placeholder="e.g., 0.3"
                        keyboardType="decimal-pad"
                      />
                      <Text style={styles.npkLabel}>{t('cropAdvisory.potassium')}</Text>
                      <TextInput
                        style={styles.npkInput}
                        value={manualNPK.potassium}
                        onChangeText={(text) => setManualNPK({ ...manualNPK, potassium: text })}
                        placeholder="e.g., 0.4"
                        keyboardType="decimal-pad"
                      />
                    </View>
                  )}

                  {/* Info about Soil Health Card */}
                  <View style={styles.infoBox}>
                    <MaterialIcons name="info" size={20} color="#3A5F0B" />
                    <Text style={styles.infoBoxText}>
                      {t('cropAdvisory.soilHealthInfo')}
                    </Text>
                  </View>
                </View>
              )}

              {/* Step 4: Irrigation */}
              {advisoryStep === 4 && (
                <View>
                  <Text style={styles.stepTitle}>
                    {t('cropAdvisory.irrigation')}
                  </Text>
                  <Text style={styles.stepDescription}>
                    {t('cropAdvisory.irrigationDesc')}
                  </Text>

                  <View style={styles.irrigationContainer}>
                    <Text style={styles.irrigationQuestion}>
                      {t('cropAdvisory.haveIrrigation')}
                    </Text>
                    
                    <Text style={styles.irrigationLabel}>
                      {t('cropAdvisory.daysAgoIrrigated')}
                    </Text>
                    <TextInput
                      style={styles.irrigationInput}
                      value={irrigationDaysAgo}
                      onChangeText={(text) => {
                        // Only allow numbers
                        const numericText = text.replace(/[^0-9]/g, '');
                        setIrrigationDaysAgo(numericText);
                      }}
                      placeholder={t('cropAdvisory.enterDays')}
                      keyboardType="number-pad"
                      maxLength={3}
                    />
                    
                    {irrigationDaysAgo && (
                      <View style={styles.infoBox}>
                        <MaterialIcons name="info" size={20} color="#3A5F0B" />
                        <Text style={styles.infoBoxText}>
                          {t('cropAdvisory.irrigationInfo', { days: irrigationDaysAgo })}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* Step 5: Nearest Kisan Seva Kendra - Only show if no soil health data */}
              {(() => {
                // Only show step 5 if no soil health card uploaded AND no manual N,P,K values
                const hasSoilHealthData = (soilHealthMethod === 'card' && extractedText) || 
                                         (soilHealthMethod === 'manual' && (manualNPK.nitrogen || manualNPK.phosphorus || manualNPK.potassium));
                return !hasSoilHealthData && advisoryStep === 5;
              })() && (
                <View>
                  <Text style={styles.stepTitle}>
                    {t('cropAdvisory.nearestCenters')}
                  </Text>
                  <Text style={styles.stepDescription}>
                    {t('cropAdvisory.nearestCentersDesc')}
                  </Text>


                  {loadingKisanCenters ? (
                    <ActivityIndicator size="large" color="#3A5F0B" style={{ marginVertical: 20 }} />
                  ) : (
                    <>
                      {nearestKisanCenters.length > 0 ? (
                        <View style={styles.kisanCentersList}>
                          {nearestKisanCenters.map((center, idx) => (
                            <View key={idx} style={styles.kisanCenterCard}>
                              <MaterialIcons name="location-on" size={24} color="#3A5F0B" />
                              <View style={{ flex: 1, marginLeft: 12 }}>
                                <Text style={styles.kisanCenterName}>{center.name}</Text>
                                <Text style={styles.kisanCenterAddress}>{center.address}</Text>
                                <Text style={styles.kisanCenterDistance}>{center.distance}</Text>
                                {center.phone && (
                                  <Text style={styles.kisanCenterPhone}>{center.phone}</Text>
                                )}
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.fetchCentersBtn}
                          onPress={fetchNearestKisanCenters}
                        >
                          <MaterialIcons name="search" size={20} color="#fff" />
                          <Text style={styles.fetchCentersBtnText}>
                            {t('cropAdvisory.findCenters')}
                          </Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity
                        style={styles.externalLinkBtn}
                        onPress={() => Linking.openURL('https://soilhealth.dac.gov.in')}
                      >
                        <MaterialIcons name="open-in-new" size={20} color="#3A5F0B" />
                        <Text style={styles.externalLinkText}>
                          {t('cropAdvisory.visitPortal')}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}
            </ScrollView>

            {/* Navigation Buttons */}
            <View style={styles.advisoryModalFooter}>
              {advisoryStep > 1 && (
                <TouchableOpacity
                  style={styles.advisoryModalBtnSecondary}
                  onPress={() => setAdvisoryStep(advisoryStep - 1)}
                >
                  <Text style={styles.advisoryModalBtnSecondaryText}>
                    {t('cropAdvisory.previous')}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  styles.advisoryModalBtnPrimary,
                  (() => {
                  // Step-specific validation
                  if (advisoryStep === 1) return !selectedDistrict || !selectedSoilType;
                  if (advisoryStep === 2) return false; // Season is auto-detected, always enabled
                  if (advisoryStep === 3) return !soilHealthMethod; // Must select a method
                  if (advisoryStep === 4) return false; // Irrigation is optional, always enabled
                  if (advisoryStep === 5) return false; // Step 5 is informational, always enabled
                  return true;
                })() && styles.advisoryModalBtnDisabled,
              ]}
              disabled={(() => {
                // Step-specific validation
                if (advisoryStep === 1) return !selectedDistrict || !selectedSoilType;
                if (advisoryStep === 2) return false; // Season is auto-detected, always enabled
                if (advisoryStep === 3) return !soilHealthMethod; // Must select a method
                if (advisoryStep === 4) return false; // Irrigation is optional, always enabled
                if (advisoryStep === 5) return false; // Step 5 is informational, always enabled
                return true;
              })()}
                onPress={() => {
                  // Check if we need step 5 (Kisan centers)
                  const hasSoilHealthData = (soilHealthMethod === 'card' && extractedText) || 
                                           (soilHealthMethod === 'manual' && (manualNPK.nitrogen || manualNPK.phosphorus || manualNPK.potassium));
                  const totalSteps = hasSoilHealthData ? 4 : 5; // Step 4: Irrigation, Step 5: Kisan centers (conditional)
                  
                  if (advisoryStep < totalSteps) {
                    setAdvisoryStep(advisoryStep + 1);
                    // Centers will be auto-fetched via useEffect when step 4 is reached
                  } else {
                    // Final step - submit
                    submitAdvisoryForm();
                  }
                }}
              >
                <Text style={styles.advisoryModalBtnPrimaryText}>
                  {(() => {
                    const hasSoilHealthData = (soilHealthMethod === 'card' && extractedText) || 
                                             (soilHealthMethod === 'manual' && (manualNPK.nitrogen || manualNPK.phosphorus || manualNPK.potassium));
                    const totalSteps = hasSoilHealthData ? 4 : 5; // Step 4: Irrigation, Step 5: Kisan centers (conditional)
                    const isLastStep = advisoryStep === totalSteps;
                    return isLastStep 
                      ? t('cropAdvisory.submit')
                      : t('cropAdvisory.next');
                  })()}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Crop Selection Modal - Shows when NDVI > 0.5 (health score > 50) */}
      <Modal
        visible={showCropSelectionModal}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setShowCropSelectionModal(false)}
      >
        <SafeAreaView style={styles.cropSelectionModalOverlay}>
          <View style={styles.cropSelectionModalCard}>
            <View style={styles.cropSelectionModalHeader}>
              <Text style={styles.cropSelectionModalTitle}>
                {cropSelectionStep === 1 
                  ? t('cropAdvisory.selectCurrentCrop')
                  : t('cropAdvisory.selectSowingDate')
                }
              </Text>
              <TouchableOpacity 
                onPress={() => {
                  if (cropSelectionStep === 2) {
                    setCropSelectionStep(1);
                  } else {
                    setShowCropSelectionModal(false);
                  }
                  setShowCropDropdown(false);
                  setCropSearchQuery('');
                }}
                style={styles.cropSelectionModalCloseBtn}
              >
                <MaterialIcons name="close" size={26} color="#666" />
              </TouchableOpacity>
            </View>

            {/* Progress Indicator */}
            <View style={styles.cropSelectionProgressBar}>
              <View style={[styles.cropSelectionProgressFill, { width: `${(cropSelectionStep / 2) * 100}%` }]} />
            </View>
            <Text style={styles.cropSelectionProgressText}>
              {t('cropAdvisory.step')} {cropSelectionStep} {t('cropAdvisory.of')} 2
            </Text>

            <View style={styles.cropSelectionModalContentWrapper}>
              <ScrollView 
                style={styles.cropSelectionModalContent}
                contentContainerStyle={styles.cropSelectionModalContentContainer}
                showsVerticalScrollIndicator={true}
              >
                {cropSelectionStep === 1 ? (
                  <>
                    <View style={styles.cropSelectionHeaderCard}>
                      <MaterialIcons name="agriculture" size={28} color="#3A5F0B" />
                      <Text style={styles.cropSelectionModalDescription}>
                        {t('cropAdvisory.cropSelectionDesc') || 'Select the crop you have sown in this field to get personalized stage-wise guidance.'}
                      </Text>
                    </View>

                    {/* Searchable Crop Dropdown */}
                    <View style={styles.cropDropdownContainer}>
                      <Text style={styles.cropDropdownLabel}>
                        {t('cropAdvisory.selectCurrentCrop') || 'Select Your Crop'}
                      </Text>
                      
                      <TouchableOpacity
                        style={[
                          styles.cropDropdownButton,
                          currentCrop && styles.cropDropdownButtonSelected,
                        ]}
                        onPress={() => setShowCropDropdown(!showCropDropdown)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.cropDropdownButtonContent}>
                          {currentCrop ? (
                            <>
                              <MaterialIcons name="check-circle" size={20} color="#3A5F0B" />
                              <Text style={styles.cropDropdownButtonText}>
                                {currentCrop === 'Other' ? otherCropText || 'Other Crop' : currentCrop}
                              </Text>
                            </>
                          ) : (
                            <>
                              <MaterialIcons name="expand-more" size={24} color="#999" />
                              <Text style={styles.cropDropdownPlaceholder}>
                                {t('cropAdvisory.selectCropPlaceholder') || 'Tap to select crop'}
                              </Text>
                            </>
                          )}
                        </View>
                        <MaterialIcons 
                          name={showCropDropdown ? "expand-less" : "expand-more"} 
                          size={24} 
                          color={currentCrop ? "#3A5F0B" : "#999"} 
                        />
                      </TouchableOpacity>

                      {showCropDropdown && (
                        <View style={styles.cropDropdownList}>
                          {/* Search Input */}
                          <View style={styles.cropSearchContainer}>
                            <MaterialIcons name="search" size={20} color="#999" />
                            <TextInput
                              style={styles.cropSearchInput}
                              placeholder={t('cropAdvisory.searchCrop') || 'Search crops...'}
                              placeholderTextColor="#999"
                              value={cropSearchQuery}
                              onChangeText={setCropSearchQuery}
                              autoFocus={false}
                            />
                            {cropSearchQuery.length > 0 && (
                              <TouchableOpacity onPress={() => setCropSearchQuery('')}>
                                <MaterialIcons name="clear" size={20} color="#999" />
                              </TouchableOpacity>
                            )}
                          </View>

                          {/* Crop List */}
                          <ScrollView 
                            style={styles.cropDropdownScrollView}
                            nestedScrollEnabled={true}
                            keyboardShouldPersistTaps="handled"
                          >
                            {filteredCrops.length > 0 ? (
                              filteredCrops.map(crop => (
                                <TouchableOpacity
                                  key={crop}
                                  style={[
                                    styles.cropDropdownItem,
                                    currentCrop === crop && styles.cropDropdownItemSelected,
                                  ]}
                                  onPress={() => {
                                    setCurrentCrop(crop);
                                    if (crop !== 'Other') {
                                      setOtherCropText('');
                                    }
                                    setShowCropDropdown(false);
                                    setCropSearchQuery('');
                                  }}
                                  activeOpacity={0.7}
                                >
                                  <View style={styles.cropDropdownItemContent}>
                                    <MaterialIcons 
                                      name={currentCrop === crop ? "check-circle" : "crop-free"} 
                                      size={22} 
                                      color={currentCrop === crop ? "#3A5F0B" : "#999"} 
                                    />
                                    <Text style={[
                                      styles.cropDropdownItemText,
                                      currentCrop === crop && styles.cropDropdownItemTextSelected,
                                    ]}>
                                      {crop}
                                    </Text>
                                  </View>
                                  {currentCrop === crop && (
                                    <MaterialIcons name="check" size={20} color="#3A5F0B" />
                                  )}
                                </TouchableOpacity>
                              ))
                            ) : (
                              <View style={styles.cropDropdownEmpty}>
                                <MaterialIcons name="search-off" size={32} color="#ccc" />
                                <Text style={styles.cropDropdownEmptyText}>
                                  {t('cropAdvisory.noCropFound') || 'No crop found'}
                                </Text>
                              </View>
                            )}
                          </ScrollView>
                        </View>
                      )}
                    </View>

                    {/* Other Crop Input */}
                    {currentCrop === 'Other' && (
                      <View style={styles.cropOtherInputContainer}>
                        <View style={styles.cropOtherInputHeader}>
                          <MaterialIcons name="edit" size={20} color="#3A5F0B" />
                          <Text style={styles.cropOtherLabel}>
                            {t('cropAdvisory.enterCropName') || 'Enter Crop Name'}
                          </Text>
                        </View>
                        <TextInput
                          value={otherCropText}
                          onChangeText={setOtherCropText}
                          placeholder={t('cropAdvisory.cropNamePlaceholder') || 'e.g., Soybean, Groundnut...'}
                          style={styles.cropOtherInput}
                          placeholderTextColor="#999"
                          autoFocus={true}
                        />
                      </View>
                    )}

                    {/* Quick Select Chips (Popular Crops) */}
                    {!currentCrop && (
                      <View style={styles.quickSelectContainer}>
                        <Text style={styles.quickSelectLabel}>
                          {t('cropAdvisory.quickSelect') || 'Quick Select'}
                        </Text>
                        <View style={styles.quickSelectChips}>
                          {['Wheat', 'Rice', 'Maize', 'Mustard'].map(crop => (
                            <TouchableOpacity
                              key={crop}
                              style={styles.quickSelectChip}
                              onPress={() => {
                                setCurrentCrop(crop);
                                setShowCropDropdown(false);
                              }}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.quickSelectChipText}>{crop}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    <View style={styles.sowingDateHeaderCard}>
                      <View style={styles.sowingDateHeaderIcon}>
                        <MaterialIcons name="calendar-today" size={28} color="#3A5F0B" />
                      </View>
                      <View style={styles.sowingDateHeaderContent}>
                        <Text style={styles.sowingDateHeaderTitle}>
                          {t('cropAdvisory.whenWasCropSown') || 'When was the crop sown?'}
                        </Text>
                        <Text style={styles.sowingDateHeaderDesc}>
                          {t('cropAdvisory.sowingDateDesc') || 'Select the sowing date to get accurate growth stage recommendations.'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.sowingDateContainer}>
                      <TouchableOpacity
                        style={[
                          styles.sowingDateInput,
                          cropSowingDate && styles.sowingDateInputSelected,
                        ]}
                        onPress={() => {
                          setShowDatePicker(true);
                          setDateInputValue(cropSowingDate ? new Date(cropSowingDate).toISOString().split('T')[0] : '');
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={styles.sowingDateInputLeft}>
                          <MaterialIcons 
                            name="event" 
                            size={24} 
                            color={cropSowingDate ? "#3A5F0B" : "#999"} 
                          />
                          <View style={styles.sowingDateInputTextContainer}>
                            {cropSowingDate ? (
                              <>
                                <Text style={styles.sowingDateLabelSmall}>
                                  {t('cropAdvisory.sowingDate') || 'Sowing Date'}
                                </Text>
                                <Text style={styles.sowingDateText}>
                                  {new Date(cropSowingDate).toLocaleDateString('en-IN', { 
                                    day: 'numeric', 
                                    month: 'long', 
                                    year: 'numeric' 
                                  })}
                                </Text>
                              </>
                            ) : (
                              <Text style={styles.sowingDatePlaceholder}>
                                {t('cropAdvisory.selectDate') || 'Tap to select date'}
                              </Text>
                            )}
                          </View>
                        </View>
                        <MaterialIcons 
                          name="arrow-forward-ios" 
                          size={18} 
                          color={cropSowingDate ? "#3A5F0B" : "#999"} 
                        />
                      </TouchableOpacity>
                      
                      {cropSowingDate && (
                        <View style={styles.sowingDateInfoCard}>
                          <MaterialIcons name="info" size={20} color="#2E7D32" />
                          <View style={styles.sowingDateInfoContent}>
                            <Text style={styles.sowingDateInfoTitle}>
                              {t('cropAdvisory.dateSelected') || 'Date Selected'}
                            </Text>
                            <Text style={styles.sowingDateInfoText}>
                              {new Date(cropSowingDate).toLocaleDateString('en-IN', { 
                                weekday: 'long',
                                day: 'numeric', 
                                month: 'long', 
                                year: 'numeric' 
                              })}
                            </Text>
                          </View>
                        </View>
                      )}
                    </View>

                    {showDatePicker && (
                      <Modal
                        visible={showDatePicker}
                        transparent={false}
                        animationType="slide"
                        onRequestClose={() => setShowDatePicker(false)}
                      >
                        <SafeAreaView style={styles.datePickerModalOverlay}>
                          <KeyboardAvoidingView
                            style={styles.datePickerModalKeyboardView}
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
                          >
                            <View style={styles.datePickerModalCard}>
                            <View style={styles.datePickerModalHeader}>
                              <View style={styles.datePickerModalHeaderLeft}>
                                <MaterialIcons name="calendar-today" size={24} color="#3A5F0B" />
                                <Text style={styles.datePickerModalTitle}>
                                  {t('cropAdvisory.selectSowingDate') || 'Select Sowing Date'}
                                </Text>
                              </View>
                              <TouchableOpacity 
                                onPress={() => {
                                  setShowDatePicker(false);
                                  setDateInputValue('');
                                }}
                                style={styles.datePickerModalCloseBtn}
                              >
                                <MaterialIcons name="close" size={24} color="#666" />
                              </TouchableOpacity>
                            </View>
                            <View style={styles.datePickerContentWrapper}>
                              <View style={styles.datePickerHeaderCard}>
                                <MaterialIcons name="event" size={32} color="#3A5F0B" />
                                <View style={styles.datePickerHeaderText}>
                                  <Text style={styles.datePickerHeaderTitle}>
                                    {t('cropAdvisory.enterDate') || 'Enter Sowing Date'}
                                  </Text>
                                  <Text style={styles.datePickerHeaderDesc}>
                                    {t('cropAdvisory.dateHelpText') || 'Enter the date when you sowed the crop in YYYY-MM-DD format'}
                                  </Text>
                                </View>
                              </View>

                              <View style={styles.datePickerInputContainer}>
                                <Text style={styles.datePickerLabel}>
                                  {t('cropAdvisory.sowingDate') || 'Sowing Date'}
                                </Text>
                                <TextInput
                                  keyboardType="numeric"
                                  value={dateInputValue || (cropSowingDate ? new Date(cropSowingDate).toISOString().split('T')[0] : '')}
                                  onChangeText={(text) => {
                                    // Format: YYYY-MM-DD
                                    let cleaned = text.replace(/[^0-9]/g, '');
                                    
                                    // Auto-format with dashes
                                    let formatted = cleaned;
                                    if (cleaned.length > 4) {
                                      formatted = cleaned.slice(0, 4) + '-' + cleaned.slice(4);
                                    }
                                    if (cleaned.length > 6) {
                                      formatted = cleaned.slice(0, 4) + '-' + cleaned.slice(4, 6) + '-' + cleaned.slice(6, 8);
                                    }
                                    
                                    setDateInputValue(formatted);
                                    
                                    if (formatted.length === 10) {
                                      // Full date entered - validate
                                      const date = new Date(formatted);
                                      if (!isNaN(date.getTime()) && date.getFullYear() >= 1900 && date.getFullYear() <= 2100) {
                                        setCropSowingDate(date.toISOString());
                                      }
                                    } else {
                                      // Partial input - clear date until complete
                                      setCropSowingDate(null);
                                    }
                                  }}
                                  onBlur={() => {
                                    // Validate on blur
                                    if (dateInputValue && dateInputValue.length === 10) {
                                      const date = new Date(dateInputValue);
                                      if (!isNaN(date.getTime()) && date.getFullYear() >= 1900 && date.getFullYear() <= 2100) {
                                        setCropSowingDate(date.toISOString());
                                      } else {
                                        setDateInputValue('');
                                        setCropSowingDate(null);
                                      }
                                    }
                                  }}
                                  placeholder="YYYY-MM-DD"
                                  style={styles.datePickerInput}
                                  placeholderTextColor="#999"
                                  autoFocus={true}
                                  returnKeyType="done"
                                  blurOnSubmit={true}
                                  onSubmitEditing={() => {
                                    if (cropSowingDate) {
                                      setShowDatePicker(false);
                                    }
                                  }}
                                />
                                <View style={styles.datePickerHintContainer}>
                                  <MaterialIcons name="info-outline" size={18} color="#3A5F0B" />
                                  <Text style={styles.datePickerHint}>
                                    {t('cropAdvisory.dateFormatHint') || 'Format: YYYY-MM-DD (e.g., 2024-01-15)'}
                                  </Text>
                                </View>
                              </View>

                              {cropSowingDate && (
                                <View style={styles.datePickerPreviewCard}>
                                  <MaterialIcons name="check-circle" size={24} color="#2E7D32" />
                                  <View style={styles.datePickerPreviewContent}>
                                    <Text style={styles.datePickerPreviewLabel}>
                                      {t('cropAdvisory.dateSelected') || 'Date Selected'}
                                    </Text>
                                    <Text style={styles.datePickerPreviewText}>
                                      {new Date(cropSowingDate).toLocaleDateString('en-IN', { 
                                        weekday: 'long',
                                        day: 'numeric', 
                                        month: 'long', 
                                        year: 'numeric' 
                                      })}
                                    </Text>
                                  </View>
                                </View>
                              )}
                            </View>
                            <View style={styles.datePickerModalFooter}>
                              <TouchableOpacity
                                style={styles.datePickerCancelBtn}
                                onPress={() => {
                                  setShowDatePicker(false);
                                  setDateInputValue('');
                                }}
                              >
                                <Text style={styles.datePickerCancelBtnText}>
                                  {t('cropAdvisory.cancel') || 'Cancel'}
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.datePickerConfirmBtn,
                                  !cropSowingDate && styles.datePickerConfirmBtnDisabled,
                                ]}
                                onPress={() => {
                                  if (cropSowingDate) {
                                    setShowDatePicker(false);
                                  }
                                }}
                                disabled={!cropSowingDate}
                              >
                                <Text style={styles.datePickerConfirmBtnText}>
                                  {t('cropAdvisory.confirm') || 'Confirm'}
                                </Text>
                              </TouchableOpacity>
                            </View>
                            </View>
                          </KeyboardAvoidingView>
                        </SafeAreaView>
                      </Modal>
                    )}
                  </>
                )}
              </ScrollView>

              {/* Buttons always visible at bottom */}
              <View style={styles.cropSelectionModalFooter}>
                {cropSelectionStep === 1 ? (
                  <TouchableOpacity
                    style={[
                      styles.cropSelectionSubmitBtn,
                      (!currentCrop || (currentCrop === 'Other' && !otherCropText.trim())) && styles.cropSelectionSubmitBtnDisabled,
                    ]}
                    disabled={!currentCrop || (currentCrop === 'Other' && !otherCropText.trim())}
                    onPress={() => {
                      if (currentCrop && (currentCrop !== 'Other' || otherCropText.trim())) {
                        setShowCropDropdown(false);
                        setCropSearchQuery('');
                        setCropSelectionStep(2);
                      }
                    }}
                  >
                    <Text style={styles.cropSelectionSubmitBtnText}>
                      {t('cropAdvisory.next')}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <TouchableOpacity
                      style={styles.cropSelectionBackBtn}
                      onPress={() => {
                        setCropSelectionStep(1);
                        setShowDatePicker(false);
                      }}
                    >
                      <MaterialIcons name="arrow-back" size={20} color="#333" />
                      <Text style={styles.cropSelectionBackBtnText}>
                        {t('cropAdvisory.previous') || 'Previous'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.cropSelectionSubmitBtn,
                        !cropSowingDate && styles.cropSelectionSubmitBtnDisabled,
                      ]}
                      disabled={!cropSowingDate}
                      onPress={async () => {
                        if (!cropSowingDate) {
                          return;
                        }
                        
                        setShowCropSelectionModal(false);
                        setShowDatePicker(false);
                        
                        // Automatically generate AI recommendations after crop and sowing date selection
                        try {
                          const field_ID = selectedField?.id || selectedField?.field_name;
                          const farmer_ID = auth.currentUser?.uid;
                          if (!field_ID || !farmer_ID || !report) return;
                          
                          setIsLoadingAiRecommendations(true);
                          const cropToSend = currentCrop === 'Other' ? otherCropText.trim() : currentCrop;
                          console.log('🌾 Auto-generating crop-specific AI recommendations for:', cropToSend, 'sown on:', cropSowingDate);
                          
                          // Load stored advisory parameters
                          let advisoryParams = null;
                          try {
                            const stored = await AsyncStorage.getItem(`advisory_params_${field_ID}`);
                            if (stored) {
                              advisoryParams = JSON.parse(stored);
                              console.log('📋 Loaded advisory params for AI recommendations:', advisoryParams);
                            }
                          } catch (e) {
                            console.warn('Could not load advisory params:', e);
                          }
                          
                          // Add sowing date to advisory params
                          if (advisoryParams) {
                            advisoryParams.crop_sowing_date = cropSowingDate;
                          } else {
                            advisoryParams = { crop_sowing_date: cropSowingDate };
                          }
                          
                          // Generate crop-specific recommendations with current crop and sowing date
                          const aiResp = await getAiRecommendations(
                            report,
                            farmer_ID,
                            field_ID,
                            report.language || 'en',
                            cropToSend, // CRITICAL: Pass the selected crop
                            extractedText,
                            advisoryParams
                          );
                          
                    if (aiResp?.recommendations && !aiResp.recommendations.error) {
                      setAiRecommendations(aiResp.recommendations);
                      setAiVideos(aiResp.videos || []);
                      await storeAiRecommendations(field_ID, aiResp.recommendations);
                      setAiError(null);
                      console.log('✅ Crop-specific AI recommendations generated successfully');
                      console.log('📺 YouTube videos:', aiResp.videos?.length || 0);
                      // Now show the report modal with crop-specific recommendations
                      setShowReportModal(true);
                    } else if (aiResp?.recommendations?.error) {
                      setAiError(aiResp.recommendations.error);
                      // Still show report modal even if there's an error
                      setShowReportModal(true);
                    }
                        } catch (e) {
                          console.error('Error generating AI recommendations:', e);
                          setAiError(e.message || 'AI request failed');
                          // Still show report modal even if there's an error
                          setShowReportModal(true);
                        } finally {
                          setIsLoadingAiRecommendations(false);
                        }
                      }}
                    >
                      <Text style={styles.cropSelectionSubmitBtnText}>
                        {t('cropAdvisory.generateRecommendations')}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    paddingTop: 34,
    borderBottomWidth: 1,
    borderColor: '#E0E0E0',
  },
  screenTitle: {
    flex: 1,
    fontWeight: 'bold',
    fontSize: 20,
    textAlign: 'left',
    color: '#212121',
  },
  addBtn: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: '#e5e9dc',
  },
  fieldSelectorContainer: {
    backgroundColor: '#fff',
    padding: 12,
    borderBottomWidth: 1,
    borderColor: '#E0E0E0',
  },
  fieldSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F9F9',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    gap: 8,
  },
  fieldSelectorText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#212121',
  },
  scrollContent: {
    paddingBottom: 36,
    paddingTop: 8,
    paddingHorizontal: 6,
    width: '100%',
    gap: 13,
  },
  fieldCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  fieldCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  fieldCardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#212121',
    flex: 1,
  },
  fieldCardBody: {
    gap: 8,
  },
  fieldCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldCardLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
  },
  fieldCardValue: {
    fontSize: 14,
    color: '#212121',
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  fieldActions: {
    gap: 10,
    marginTop: 8,
  },
  viewMapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5f8d3a',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
  },
  viewMapButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3A5F0B',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  analyzeButtonDisabled: {
    opacity: 0.7,
  },
  analyzeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  dataInfoCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  dataInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  dataInfoLabel: {
    fontSize: 13,
    color: '#666',
    marginLeft: 8,
    marginRight: 8,
    flex: 1,
  },
  dataInfoValue: {
    fontSize: 13,
    color: '#212121',
    fontWeight: '600',
  },
  processingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbe7',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fbe9b4',
    gap: 12,
  },
  processingTextContainer: {
    flex: 1,
  },
  processingText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#927000',
    marginBottom: 2,
  },
  processingSubText: {
    fontSize: 12,
    color: '#b5a163',
  },
  sectionHeader: {
    fontWeight: 'bold',
    fontSize: 18,
    marginTop: 18,
    color: '#212121',
    paddingHorizontal: 3,
    marginBottom: 7,
  },
  quickGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 10,
  },
  quickCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 13,
    marginHorizontal: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  quickIconBg: {
    backgroundColor: '#e5e9dc',
    borderRadius: 20,
    padding: 7,
    marginBottom: 2,
  },
  quickText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3A5F0B',
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fffbe7',
    borderRadius: 15,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#fbe9b4',
    minHeight: 80,
  },
  summaryCardContent: {
    flex: 1,
    minWidth: 0, // Allows text to wrap
    paddingRight: 8,
  },
  summaryBigText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#927000',
    marginBottom: 6,
    lineHeight: 22,
  },
  summarySubText: {
    fontSize: 13,
    color: '#b5a163',
    opacity: 0.9,
  },
  summaryTimer: {
    backgroundColor: '#FCA311',
    borderRadius: 32,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recoCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginBottom: 7,
    maxWidth: '100%',
  },
  recoImg: {
    width: '100%',
    height: 115,
    resizeMode: 'cover',
    backgroundColor: '#f5f5f5',
  },
  recoImgPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    width: '100%',
    height: 115,
  },
  recoMeta: {
    color: '#5f8d3a',
    fontSize: 13,
    fontWeight: '700',
  },
  recoName: {
    color: '#212121',
    fontWeight: 'bold',
    fontSize: 16,
    marginVertical: 1,
  },
  recoDesc: {
    color: '#6c7c5a',
    fontSize: 13,
    fontWeight: '400',
    marginTop: 2,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 15,
    padding: 14,
    backgroundColor: '#fff',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 2,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    gap: 12,
    minHeight: 70,
  },
  infoLeftIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e5e9dc',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  infoCardContent: {
    flex: 1,
    minWidth: 0, // Allows text to wrap
    paddingRight: 8,
  },
  infoCardRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
    minWidth: 80,
    maxWidth: 120,
  },
  infoLabel: {
    fontSize: 13,
    color: '#3A5F0B',
    fontWeight: '700',
    marginBottom: 4,
  },
  infoSmall: {
    fontSize: 10,
    color: '#927000',
    opacity: 0.75,
    fontWeight: '500',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#393a2a',
    lineHeight: 18,
    flexWrap: 'wrap',
  },
  bottomActions: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 17,
    paddingBottom: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: '#C3D0B7',
    borderWidth: 1,
    borderRadius: 16,
    backgroundColor: '#fff',
    justifyContent: 'center',
    paddingVertical: 11,
    paddingHorizontal: 5,
  },
  detailsBtn: {
    flex: 2,
    borderRadius: 16,
    backgroundColor: '#3A5F0B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#212121',
  },
  modalFieldItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#F9F9F9',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  modalFieldItemSelected: {
    backgroundColor: '#f5f9f0',
    borderColor: '#3A5F0B',
    borderWidth: 2,
  },
  modalFieldName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 4,
  },
  modalFieldArea: {
    fontSize: 14,
    color: '#666',
  },
  mapModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  mapModalContent: {
    flex: 1,
    paddingTop: 50,
  },
  mapModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  mapModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
  },
  mapModalMap: {
    flex: 1,
  },
  // Completion Message Modal Styles
  completionModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  completionModalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  completionModalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#212121',
    marginTop: 16,
    marginBottom: 8,
  },
  completionModalMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  completionModalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  completionModalButtonSecondary: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  completionModalButtonTextSecondary: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  completionModalButtonPrimary: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#3A5F0B',
    alignItems: 'center',
  },
  completionModalButtonTextPrimary: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // View Report Button
  viewReportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5f8d3a',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
  },
  viewReportButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // Report Modal Styles
  reportModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  reportModalContent: {
    flex: 1,
    backgroundColor: '#F5F5DC',
    marginTop: 50,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  reportModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  reportModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#212121',
    flex: 1,
  },
  reportModalScroll: {
    flex: 1,
    padding: 16,
  },
  reportSection: {
    marginBottom: 24,
  },
  reportSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 12,
  },
  ndviLegendRow: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  ndviLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ndviLegendColor: {
    width: 18,
    height: 12,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  ndviLegendLabel: {
    fontSize: 12,
    color: '#333',
  },
  reportMapImage: {
    width: '100%',
    height: 250,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  healthScoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  healthScoreCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#3A5F0B',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  healthScoreValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  healthScoreDetails: {
    flex: 1,
  },
  healthScoreLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212121',
    marginBottom: 4,
  },
  healthScoreSubLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  healthStatusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 'bold',
    color: '#212121',
  },
  reportSubSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212121',
    marginTop: 12,
    marginBottom: 8,
  },
  reportMeta: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  recommendationCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  recommendationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  recommendationTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  recommendationDetails: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    lineHeight: 20,
  },
  recommendationHeaderText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 8,
  },
  recommendationAction: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e5e9dc',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  recommendationActionText: {
    flex: 1,
    fontSize: 14,
    color: '#3A5F0B',
    fontWeight: '600',
  },
  recommendationPriority: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  recommendationPriorityText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  recommendationUrgency: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FCA311',
  },
  recommendationCardSmall: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#3A5F0B',
  },
  recommendationSmallTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 4,
  },
  recommendationSmallDetails: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  recommendationSmallAction: {
    fontSize: 12,
    color: '#3A5F0B',
    fontWeight: '500',
  },
  weatherDayCard: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  weatherDayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  weatherDayDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#212121',
  },
  weatherDayTemp: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#3A5F0B',
  },
  weatherDayDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weatherDayDesc: {
    fontSize: 12,
    color: '#666',
    textTransform: 'capitalize',
  },
  weatherDayStats: {
    flexDirection: 'row',
    gap: 12,
  },
  weatherDayStat: {
    fontSize: 12,
    color: '#666',
  },
  reportMeta: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  uploadModalCard: { width: '90%', maxHeight: '80%', backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  uploadModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  uploadModalTitle: { fontSize: 18, fontWeight: '800', color: '#2a2a2a' },
  uploadOptions: { gap: 12, marginTop: 16 },
  uploadOptionBtn: { backgroundColor: '#3A5F0B', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  uploadOptionBtnDisabled: { opacity: 0.5 },
  uploadOptionText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  uploadingIndicator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16, gap: 8 },
  uploadingText: { color: '#333', fontSize: 14 },
  extractedTextCard: { backgroundColor: '#f5f5f5', borderRadius: 10, padding: 12, marginBottom: 16 },
  extractedTextLabel: { fontSize: 12, fontWeight: '700', color: '#3A5F0B', marginBottom: 8 },
  extractedTextScroll: { maxHeight: 150 },
  extractedText: { fontSize: 12, color: '#333', lineHeight: 18 },
  uploadedCardPreview: { marginBottom: 16 },
  uploadedCardLabel: { fontSize: 12, fontWeight: '700', color: '#3A5F0B', marginBottom: 8 },
  uploadedCardImage: { width: '100%', height: 200, borderRadius: 10, backgroundColor: '#f0f0f0' },
  extractedTextInfo: { marginTop: 16, padding: 12, backgroundColor: '#e8efe1', borderRadius: 8 },
  extractedTextInfoText: { fontSize: 12, color: '#3A5F0B', lineHeight: 18 },
  // Uttarakhand Advisory Modal Styles
  advisoryModalCard: { width: '95%', maxHeight: '90%', backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  advisoryModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  advisoryModalTitle: { fontSize: 20, fontWeight: '800', color: '#2a2a2a' },
  advisoryModalScroll: { maxHeight: 500 },
  advisoryModalFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20, gap: 12 },
  advisoryModalBtnPrimary: { flex: 1, backgroundColor: '#3A5F0B', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  advisoryModalBtnSecondary: { flex: 1, backgroundColor: '#f0f0f0', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginRight: 12 },
  advisoryModalBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  advisoryModalBtnSecondaryText: { color: '#333', fontWeight: '600', fontSize: 16 },
  advisoryModalBtnDisabled: { opacity: 0.5 },
  progressBar: { height: 4, backgroundColor: '#e0e0e0', borderRadius: 2, marginBottom: 8 },
  progressFill: { height: '100%', backgroundColor: '#3A5F0B', borderRadius: 2 },
  progressText: { fontSize: 12, color: '#666', marginBottom: 16, textAlign: 'center' },
  stepTitle: { fontSize: 18, fontWeight: '700', color: '#2a2a2a', marginBottom: 8 },
  stepDescription: { fontSize: 14, color: '#666', marginBottom: 20, lineHeight: 20 },
  dropdownContainer: { gap: 10 },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: '#f5f5f5', borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  dropdownItemSelected: { borderColor: '#3A5F0B', backgroundColor: '#e8efe1' },
  dropdownItemText: { fontSize: 15, color: '#333', fontWeight: '500' },
  dropdownItemTextSelected: { color: '#3A5F0B', fontWeight: '700' },
  seasonCard: { backgroundColor: '#e8efe1', borderRadius: 12, padding: 20, alignItems: 'center', marginBottom: 16 },
  seasonIcon: { marginBottom: 12 },
  seasonName: { fontSize: 24, fontWeight: '800', color: '#3A5F0B', marginBottom: 8 },
  seasonDescription: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#f0f7ff', padding: 12, borderRadius: 8, marginTop: 16, gap: 10 },
  infoBoxText: { flex: 1, fontSize: 12, color: '#3A5F0B', lineHeight: 18 },
  soilHealthOptions: { gap: 12 },
  soilHealthOption: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#f5f5f5', borderRadius: 10, borderWidth: 2, borderColor: 'transparent', gap: 12 },
  soilHealthOptionSelected: { borderColor: '#3A5F0B', backgroundColor: '#e8efe1' },
  soilHealthOptionText: { flex: 1, fontSize: 15, color: '#333', fontWeight: '500' },
  soilHealthOptionTextSelected: { color: '#3A5F0B', fontWeight: '700' },
  soilHealthOptionSubtext: { fontSize: 12, color: '#3A5F0B', marginTop: 4 },
  npkInputContainer: { marginTop: 16, gap: 12 },
  npkLabel: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 4 },
  npkInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', fontSize: 15 },
  irrigationContainer: { marginTop: 16 },
  irrigationQuestion: { fontSize: 16, fontWeight: '600', color: '#2a2a2a', marginBottom: 16 },
  irrigationLabel: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 },
  irrigationInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fff', fontSize: 16, fontWeight: '500' },
  kisanCentersList: { gap: 12, marginBottom: 16 },
  kisanCenterCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#f5f5f5', padding: 14, borderRadius: 10 },
  kisanCenterName: { fontSize: 16, fontWeight: '700', color: '#2a2a2a', marginBottom: 4 },
  kisanCenterAddress: { fontSize: 13, color: '#666', marginBottom: 4 },
  kisanCenterDistance: { fontSize: 12, color: '#3A5F0B', fontWeight: '600', marginBottom: 2 },
  kisanCenterPhone: { fontSize: 12, color: '#666' },
  fetchCentersBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#3A5F0B', paddingVertical: 14, borderRadius: 10, gap: 8, marginBottom: 16 },
  fetchCentersBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  externalLinkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0', paddingVertical: 12, borderRadius: 10, gap: 8 },
  externalLinkText: { color: '#3A5F0B', fontWeight: '600', fontSize: 14 },
  // Crop Selection Modal Styles
  cropSelectionModalOverlay: {
    flex: 1,
    backgroundColor: '#fff',
  },
  cropSelectionModalCard: { 
    flex: 1,
    width: '100%', 
    backgroundColor: '#fff', 
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    flexDirection: 'column',
  },
  cropSelectionModalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  cropSelectionModalTitle: { 
    fontSize: 22, 
    fontWeight: '800', 
    color: '#1a1a1a',
    flex: 1,
    marginRight: 12,
  },
  cropSelectionModalCloseBtn: {
    padding: 4,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropSelectionProgressBar: { 
    height: 6, 
    backgroundColor: '#E8E8E8', 
    borderRadius: 3, 
    marginBottom: 8,
    overflow: 'hidden',
  },
  cropSelectionProgressFill: { 
    height: '100%', 
    backgroundColor: '#3A5F0B', 
    borderRadius: 3,
  },
  cropSelectionProgressText: { 
    fontSize: 13, 
    color: '#666', 
    marginBottom: 20, 
    textAlign: 'center',
    fontWeight: '600',
  },
  cropSelectionModalContentWrapper: {
    flex: 1,
  },
  cropSelectionModalContent: { 
    flex: 1,
  },
  cropSelectionModalContentContainer: {
    paddingBottom: 16,
  },
  cropSelectionHeaderCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0F7F0',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    gap: 12,
  },
  cropSelectionModalDescription: { 
    fontSize: 15, 
    color: '#444', 
    lineHeight: 22,
    fontWeight: '500',
    flex: 1,
  },
  // Crop Dropdown Styles
  cropDropdownContainer: {
    marginBottom: 24,
    position: 'relative',
    zIndex: 10,
  },
  cropDropdownLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  cropDropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: '#D0D0D0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    minHeight: 56,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cropDropdownButtonSelected: {
    borderColor: '#3A5F0B',
    backgroundColor: '#F0F7F0',
    shadowColor: '#3A5F0B',
    shadowOpacity: 0.2,
  },
  cropDropdownButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  cropDropdownButtonText: {
    fontSize: 16,
    color: '#1a1a1a',
    fontWeight: '600',
    flex: 1,
  },
  cropDropdownPlaceholder: {
    fontSize: 16,
    color: '#999',
    fontWeight: '400',
    flex: 1,
  },
  cropDropdownList: {
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    overflow: 'hidden',
  },
  cropSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    gap: 12,
    backgroundColor: '#FAFAFA',
  },
  cropSearchInput: {
    flex: 1,
    fontSize: 15,
    color: '#1a1a1a',
    paddingVertical: 4,
  },
  cropDropdownScrollView: {
    maxHeight: 240,
  },
  cropDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  cropDropdownItemSelected: {
    backgroundColor: '#F0F7F0',
  },
  cropDropdownItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  cropDropdownItemText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
    flex: 1,
  },
  cropDropdownItemTextSelected: {
    color: '#3A5F0B',
    fontWeight: '700',
  },
  cropDropdownEmpty: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropDropdownEmptyText: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    fontWeight: '500',
  },
  // Quick Select Chips
  quickSelectContainer: {
    marginTop: 8,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  quickSelectLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 12,
  },
  quickSelectChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickSelectChip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  quickSelectChipText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  cropOtherInputContainer: { 
    marginBottom: 24,
    marginTop: 16,
    padding: 16,
    backgroundColor: '#F9F9F9',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#3A5F0B',
    borderStyle: 'dashed',
  },
  cropOtherInputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cropOtherLabel: { 
    fontSize: 15, 
    fontWeight: '700', 
    color: '#1a1a1a',
  },
  cropOtherInput: { 
    borderWidth: 2, 
    borderColor: '#D0D0D0', 
    borderRadius: 10, 
    paddingHorizontal: 14, 
    paddingVertical: 12, 
    backgroundColor: '#fff', 
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  cropSelectionModalFooter: { 
    flexDirection: 'row', 
    gap: 12, 
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 2,
    borderTopColor: '#E0E0E0',
    backgroundColor: '#fff',
    marginTop: 'auto',
  },
  cropSelectionBackBtn: { 
    flex: 1, 
    backgroundColor: '#F5F5F5', 
    paddingVertical: 16, 
    borderRadius: 12, 
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  cropSelectionBackBtnText: { 
    color: '#333', 
    fontWeight: '700', 
    fontSize: 16,
  },
  cropSelectionSubmitBtn: { 
    flex: 1, 
    backgroundColor: '#3A5F0B', 
    paddingVertical: 16, 
    borderRadius: 12, 
    alignItems: 'center',
    shadowColor: '#3A5F0B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  cropSelectionSubmitBtnDisabled: { 
    backgroundColor: '#CCCCCC', 
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  cropSelectionSubmitBtnText: { 
    color: '#fff', 
    fontWeight: '800', 
    fontSize: 16,
    letterSpacing: 0.5,
  },
  sowingDateHeaderCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#F0F7F0',
    borderRadius: 12,
    gap: 16,
  },
  sowingDateHeaderIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sowingDateHeaderContent: {
    flex: 1,
  },
  sowingDateHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  sowingDateHeaderDesc: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    fontWeight: '400',
  },
  sowingDateContainer: { 
    marginBottom: 24,
  },
  sowingDateInput: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    borderWidth: 2, 
    borderColor: '#D0D0D0', 
    borderRadius: 12, 
    paddingHorizontal: 16, 
    paddingVertical: 16, 
    backgroundColor: '#fff',
    minHeight: 64,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  sowingDateInputSelected: {
    borderColor: '#3A5F0B',
    backgroundColor: '#F0F7F0',
    shadowColor: '#3A5F0B',
    shadowOpacity: 0.2,
  },
  sowingDateInputLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 16,
  },
  sowingDateInputTextContainer: {
    flex: 1,
  },
  sowingDateLabelSmall: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
    marginBottom: 2,
  },
  sowingDateText: { 
    fontSize: 16, 
    color: '#1a1a1a',
    fontWeight: '600',
  },
  sowingDatePlaceholder: { 
    fontSize: 16,
    color: '#999',
    fontWeight: '400',
  },
  sowingDateInfoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 16,
    padding: 16,
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  sowingDateInfoContent: {
    flex: 1,
  },
  sowingDateInfoTitle: {
    fontSize: 12,
    color: '#2E7D32',
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sowingDateInfoText: {
    fontSize: 15,
    color: '#1B5E20',
    fontWeight: '600',
  },
  datePickerModalOverlay: {
    flex: 1,
    backgroundColor: '#fff',
  },
  datePickerModalKeyboardView: {
    flex: 1,
  },
  datePickerModalCard: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
    paddingBottom: 0,
    flexDirection: 'column',
  },
  datePickerContentWrapper: {
    flex: 1,
    paddingTop: 8,
  },
  datePickerHeaderCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0F7F0',
    padding: 20,
    borderRadius: 16,
    marginBottom: 32,
    gap: 16,
  },
  datePickerHeaderText: {
    flex: 1,
  },
  datePickerHeaderTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  datePickerHeaderDesc: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    fontWeight: '400',
  },
  datePickerInputContainer: {
    marginBottom: 24,
  },
  datePickerModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  datePickerModalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  datePickerModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    flex: 1,
  },
  datePickerModalCloseBtn: {
    padding: 4,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  datePickerLabel: {
    fontSize: 16,
    color: '#1a1a1a',
    marginBottom: 12,
    fontWeight: '700',
  },
  datePickerInput: {
    borderWidth: 3,
    borderColor: '#3A5F0B',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#F0F7F0',
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 16,
    textAlign: 'center',
    letterSpacing: 2,
  },
  datePickerHintContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  datePickerHint: {
    fontSize: 14,
    color: '#2E7D32',
    flex: 1,
    lineHeight: 20,
    fontWeight: '500',
  },
  datePickerPreviewCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 20,
    backgroundColor: '#E8F5E9',
    borderRadius: 16,
    gap: 16,
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  datePickerPreviewContent: {
    flex: 1,
  },
  datePickerPreviewLabel: {
    fontSize: 12,
    color: '#2E7D32',
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  datePickerPreviewText: {
    fontSize: 18,
    color: '#1B5E20',
    fontWeight: '700',
    lineHeight: 24,
  },
  datePickerModalFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    backgroundColor: '#fff',
  },
  datePickerCancelBtn: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  datePickerCancelBtnText: {
    color: '#333',
    fontWeight: '700',
    fontSize: 16,
  },
  datePickerConfirmBtn: {
    flex: 1,
    backgroundColor: '#3A5F0B',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#3A5F0B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  datePickerConfirmBtnDisabled: {
    backgroundColor: '#CCCCCC',
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  datePickerConfirmBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  // YouTube Video Styles
  videoCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    flexDirection: 'row',
    gap: 12,
  },
  videoThumb: {
    width: 120,
    height: 90,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  videoContent: {
    flex: 1,
  },
  videoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2a2a2a',
    marginBottom: 4,
  },
  videoMeta: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  videoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3A5F0B',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 6,
    alignSelf: 'flex-start',
  },
  videoBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  // Detail Modal Styles
  detailModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  detailModalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    minHeight: '50%',
  },
  detailModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  detailModalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  detailModalIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#212121',
    flex: 1,
  },
  detailModalScroll: {
    flex: 1,
    padding: 20,
  },
  detailSection: {
    marginBottom: 20,
  },
  detailSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#3A5F0B',
    marginBottom: 12,
    marginTop: 8,
  },
  detailCard: {
    backgroundColor: '#F9F9F9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  detailCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#3A5F0B',
    marginBottom: 12,
  },
  detailItem: {
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 13,
    color: '#666',
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 15,
    color: '#212121',
    fontWeight: '500',
    lineHeight: 22,
  },
  detailBullet: {
    fontSize: 14,
    color: '#212121',
    lineHeight: 22,
    marginLeft: 8,
    marginTop: 4,
  },
});
