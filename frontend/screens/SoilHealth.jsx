import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
// Note: For PDF support, install: npx expo install expo-document-picker
// For now, we use ImagePicker which supports images and some PDFs
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, Image, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebase';
import { collection, addDoc, query, where, getDocs, orderBy, limit as firestoreLimit } from 'firebase/firestore';
import { getFields, getSoilAdvisory, getSoilAdvisoryFallback, uploadSoilHealthCard, extractTextFromSoilHealthCard, getSoilHealthCardHistory } from '../services/halApi';
import { useTranslation } from '../services/i18n';

function computeCentroid(field) {
  const { lat1, lon1, lat2, lon2, lat3, lon3, lat4, lon4 } = field || {};
  if ([lat1, lon1, lat2, lon2, lat3, lon3, lat4, lon4].some(v => typeof v !== 'number')) return null;
  const lat = (lat1 + lat2 + lat3 + lat4) / 4;
  const lon = (lon1 + lon2 + lon3 + lon4) / 4;
  return { lat, lon };
}

export default function SoilHealth() {
  const { t } = useTranslation();
  const [fields, setFields] = useState([]);
  const [selectedField, setSelectedField] = useState(null);
  const [showFieldSelector, setShowFieldSelector] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pulseAnim] = useState(new Animated.Value(1));
  const [advisory, setAdvisory] = useState(null);
  const [soil, setSoil] = useState(null);
  const [soilScore, setSoilScore] = useState(null);
  const [videos, setVideos] = useState([]);
  const [debugInfo, setDebugInfo] = useState(null);
  const [error, setError] = useState(null);
  const [downloads, setDownloads] = useState([]);
  // Removed search input based on UX request
  const [lastUpdated, setLastUpdated] = useState(null);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [progressTimer, setProgressTimer] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadingCard, setUploadingCard] = useState(false);
  const [extractedText, setExtractedText] = useState(null);
  const [uploadedCardUrl, setUploadedCardUrl] = useState(null);
  const [cardHistory, setCardHistory] = useState([]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 600, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulseAnim]);

  useEffect(() => {
    (async () => {
      try {
        const farmer_ID = auth.currentUser?.uid;
        if (!farmer_ID) return;
        const { fields: fs } = await getFields(farmer_ID);
        setFields(fs || []);
        if (fs && fs.length > 0) setSelectedField(fs[0]);
      } catch (e) {
        setError(e.message || 'Failed to load fields');
      }
      try {
        const saved = await AsyncStorage.getItem('soil_downloads');
        if (saved) setDownloads(JSON.parse(saved));
      } catch {}
      // Load card history
      loadCardHistory();
    })();
  }, []);

  const loadCardHistory = async () => {
    try {
      const farmer_ID = auth.currentUser?.uid;
      if (!farmer_ID) return;
      const field_ID = selectedField?.id || selectedField?.field_name;
      const history = await getSoilHealthCardHistory({ farmer_ID, field_ID });
      setCardHistory(history?.items || []);
    } catch (e) {
      console.warn('Failed to load card history:', e.message);
    }
  };

  const fieldLocation = useMemo(() => computeCentroid(selectedField), [selectedField]);

  // Load cached advisory on field change
  useEffect(() => {
    (async () => {
      try {
        setError(null);
        setAdvisory(null);
        setSoil(null);
        setSoilScore(null);
        setVideos([]);
        setLastUpdated(null);
        const field_ID = selectedField?.id || selectedField?.field_name;
        if (!field_ID) return;
        const cacheKey = `soil_advisory_${field_ID}`;
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          const payload = JSON.parse(cached);
          console.log('♻️  Loaded soil advisory from cache for field:', field_ID);
          setAdvisory(payload.advisory || null);
          setSoil(payload.soil || null);
          setSoilScore(payload.soil_score ?? null);
          setVideos(payload.videos || []);
          setLastUpdated(payload.timestamp || null);
        } else {
          console.log('ℹ️  No cached soil advisory for field:', field_ID);
        }
      } catch (e) {
        console.warn('Cache load failed:', e.message);
      }
      // Reload card history when field changes
      loadCardHistory();
    })();
  }, [selectedField]);

  function startProgress() {
    // Reset
    setProgress(2);
    setProgressText(t('soilHealth.preparingRequest'));
    if (progressTimer) clearInterval(progressTimer);
    const steps = [
      t('soilHealth.preparingRequest'),
      t('soilHealth.fetchingSoilData'),
      t('soilHealth.generatingAI'),
      t('soilHealth.fetchingVideos'),
      t('soilHealth.finalizing')
    ];
    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      // Update text
      setProgressText(steps[(Math.floor(tick / 4)) % steps.length]);
      // Smoothly progress until 90%
      setProgress((p) => {
        if (p < 90) return Math.min(90, p + 2);
        return p;
      });
    }, 500);
    setProgressTimer(timer);
  }

  function stopProgress(done = false) {
    if (progressTimer) clearInterval(progressTimer);
    setProgressTimer(null);
    if (done) {
      setProgress(100);
      setProgressText(t('soilHealth.completed'));
    }
  }

  const handleUploadCard = async (source) => {
    try {
      setUploadingCard(true);
      setError(null);
      let fileResult = null;

      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert(t('common.error'), t('soilHealth.cameraPermissionNeeded'));
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
          Alert.alert(t('common.error'), t('soilHealth.permissionNeeded'));
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
      } else if (source === 'document') {
        // Use ImagePicker for documents (supports PDFs on some platforms)
        // For full PDF support, install: npx expo install expo-document-picker
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert(t('common.error'), t('soilHealth.permissionNeeded'));
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
        Alert.alert(t('common.error'), t('soilHealth.selectFieldFirst'));
        setUploadingCard(false);
        return;
      }

      console.log('📤 Uploading soil health card...', { uri: fileResult.uri, type: fileResult.mimeType });

      // Step 1: Upload to Cloudinary
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

      // Step 2: Extract text from card
      console.log('🔍 Extracting text from card...');
      const extractResult = await extractTextFromSoilHealthCard({
        fileUrl,
        farmer_ID,
        field_ID,
      });

      const extractedTextData = extractResult.extractedText || extractResult.text || '';
      setExtractedText(extractedTextData);
      console.log('✅ Text extracted:', extractedTextData.substring(0, 100) + '...');

      // Step 3: Save to Firebase
      try {
        await addDoc(collection(db, 'soil_health_cards'), {
          farmer_ID,
          field_ID,
          fileUrl,
          extractedText: extractedTextData,
          uploadedAt: new Date().toISOString(),
          fieldName: selectedField?.id || selectedField?.field_name,
        });
        console.log('✅ Card saved to database');
      } catch (dbError) {
        console.warn('⚠️ Failed to save to database:', dbError.message);
      }

      // Step 4: Reload history
      await loadCardHistory();

      Alert.alert(
        t('soilHealth.success'),
        t('soilHealth.cardUploadedAndExtracted'),
        [
          {
            text: t('common.ok'),
            onPress: () => {
              setShowUploadModal(false);
              // Auto-trigger soil analysis with extracted text
              if (extractedTextData) {
                fetchSoilWithExtractedText(extractedTextData);
              }
            },
          },
        ]
      );
    } catch (error) {
      console.error('❌ Upload error:', error);
      Alert.alert(t('common.error'), error.message || t('soilHealth.uploadFailed'));
    } finally {
      setUploadingCard(false);
    }
  };

  async function fetchSoilWithExtractedText(extractedTextData) {
    // This will be called after card upload to analyze with extracted text
    // We'll modify fetchSoil to accept extracted text parameter
    fetchSoil(extractedTextData);
  }

  async function fetchSoil(extractedTextFromCard = null) {
    try {
      const field_ID = selectedField?.id || selectedField?.field_name;
      const farmer_ID = auth.currentUser?.uid;
      console.log('📥 Soil advisory request:', { field_ID, farmer_ID, fieldLocation, hasExtractedText: !!extractedTextFromCard });
      setIsLoading(true);
      startProgress();
      setError(null);
      setAdvisory(null);
      setSoil(null);
      setSoilScore(null);
      setVideos([]);
      if (!farmer_ID || !field_ID) return;

      let resp = null;
      let useFallback = false;

      // Try primary API first
      try {
        console.log('🔄 Attempting primary soil API...');
        // Include extracted text if available
        const requestParams = { field_ID, farmer_ID, field_location: fieldLocation };
        if (extractedTextFromCard) {
          requestParams.extractedText = extractedTextFromCard;
          requestParams.hasSoilHealthCard = true;
        }
        resp = await getSoilAdvisory(requestParams);
        console.log('✅ Primary soil API response summary:', {
          hasAdvisory: !!resp.advisory,
          hasSoil: !!resp.soil,
          soil_score: resp.soil_score,
          videos: (resp.videos || []).length
        });
      } catch (primaryError) {
        console.warn('⚠️ Primary soil API failed:', primaryError.message);
        console.log('🔄 Falling back to secondary soil API...');
        useFallback = true;

        // Try fallback API with default/estimated values
        // These could be enhanced with actual sensor data if available
        try {
          const fallbackResp = await getSoilAdvisoryFallback({
            temp: 27.5, // Default temperature
            humidity: 60.0, // Default humidity
            moisture: 40.0, // Default moisture
            soil_type: 'Loamy', // Default soil type
            nitrogen: 80, // Default nitrogen
            phosphorus: 60, // Default phosphorus
            potassium: 100, // Default potassium
            fertilizer: 'Urea', // Default fertilizer
            ph: 6.9, // Default pH
          });

          console.log('✅ Fallback API response received');

          // Transform fallback API response to match expected format
          const soilParams = fallbackResp['Soil Parameters'] || {};
          
          // Extract pH value from string like "6.9 (neutral)"
          const phValue = soilParams.pH ? parseFloat(soilParams.pH.split(' ')[0]) : 6.9;

          // Map nutrient levels to numeric values for scoring
          const getNutrientScore = (level) => {
            if (typeof level === 'string') {
              const lower = level.toLowerCase();
              if (lower.includes('high')) return 80;
              if (lower.includes('medium')) return 60;
              if (lower.includes('low')) return 40;
            }
            return 60; // Default
          };

          const nitrogenVal = getNutrientScore(soilParams.Nitrogen);
          const phosphorusVal = getNutrientScore(soilParams.Phosphorus);
          const potassiumVal = getNutrientScore(soilParams.Potassium);
          const moistureVal = soilParams.Moisture ? (soilParams.Moisture.toLowerCase().includes('high') ? 70 : 40) : 40;

          // Calculate soil health score (simplified)
          const soilHealthScore = Math.round(
            (nitrogenVal + phosphorusVal + potassiumVal + moistureVal) / 4
          );

          // Transform to expected format
          resp = {
            advisory: {
              soil_health_score: soilHealthScore,
              score_explanation: fallbackResp['Fertilizer Recommendation'] || 'Soil analysis completed using fallback API.',
              fertilizer_recommendation: fallbackResp['Fertilizer Recommendation'] || 'Maintain current soil management practices.',
              predicted_crop: fallbackResp['Predicted Crop'] || 'Wheat',
              primary_crops: fallbackResp['Primary Crops'] || [],
              secondary_crops: fallbackResp['Secondary Crops'] || [],
            },
            soil: {
              ph: phValue,
              soil_type: 'Loamy', // Could be enhanced
              nitrogen: nitrogenVal,
              phosphorus: phosphorusVal,
              potassium: potassiumVal,
              moisture: moistureVal,
            },
            soil_score: soilHealthScore,
            videos: [], // Fallback API doesn't provide videos
            from_fallback: true,
          };

          console.log('✅ Transformed fallback response:', {
            soil_health_score: resp.soil_score,
            predicted_crop: resp.advisory.predicted_crop,
            has_recommendation: !!resp.advisory.fertilizer_recommendation,
          });
        } catch (fallbackError) {
          console.error('❌ Fallback API also failed:', fallbackError.message);
          throw new Error(`Both APIs failed. Primary: ${primaryError.message}, Fallback: ${fallbackError.message}`);
        }
      }

      setProgress(95);
      setProgressText(t('soilHealth.finalizing'));
      if (resp.debug) setDebugInfo(resp.debug);
      const payload = {
        advisory: resp.advisory || null,
        soil: resp.soil || null,
        soil_score: resp.soil_score ?? null,
        videos: resp.videos || [],
        timestamp: Date.now(),
        from_fallback: useFallback || resp.from_fallback || false,
      };
      setAdvisory(payload.advisory);
      setSoil(payload.soil);
      setSoilScore(payload.soil_score);
      setVideos(payload.videos);
      setLastUpdated(payload.timestamp);
      stopProgress(true);
      
      if (useFallback || resp.from_fallback) {
        console.log('ℹ️ Results from fallback API - some features may be limited');
      }

      try {
        const cacheKey = `soil_advisory_${field_ID}`;
        await AsyncStorage.setItem(cacheKey, JSON.stringify(payload));
        console.log('💾 Cached soil advisory for field:', field_ID);
      } catch (e) {
        console.warn('Cache save failed:', e.message);
      }
    } catch (e) {
      stopProgress(false);
      setError(e.message || t('soilHealth.advisoryFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function saveDownload(item) {
    try {
      // Download thumbnail to app storage
      let localThumb = null;
      if (item.thumbnail) {
        try {
          const filename = `yt_${item.videoId || Date.now()}.jpg`;
          const to = FileSystem.documentDirectory + filename;
          await FileSystem.downloadAsync(item.thumbnail, to);
          localThumb = to;
        } catch {}
      }
      const list = [...downloads, { ...item, localThumbnail: localThumb, savedAt: Date.now() }];
      setDownloads(list);
      await AsyncStorage.setItem('soil_downloads', JSON.stringify(list));
    } catch {}
  }

  function filteredVideos() { return videos; }

  return (
    <View style={styles.container}>
      {/* Top App Bar */}
      <View style={styles.appBar}>
        <Text style={styles.screenTitle}>{t('soilHealth.title')}</Text>
      </View>
      {/* Field Selector */}
      <TouchableOpacity style={styles.fieldSelector} onPress={() => setShowFieldSelector(true)}>
        <Text style={styles.fieldSelectorText}>{selectedField?.id || selectedField?.field_name || t('cropAdvisory.selectField')}</Text>
        <MaterialIcons name="arrow-drop-down" size={22} color="#333" />
      </TouchableOpacity>

      <Modal visible={showFieldSelector} transparent animationType="fade" onRequestClose={() => setShowFieldSelector(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('cropAdvisory.selectField')}</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {(fields || []).map(f => (
                <TouchableOpacity key={f.id} style={styles.modalItem} onPress={() => { setSelectedField(f); setShowFieldSelector(false); }}>
                  <Text style={styles.modalItemText}>{f.id}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowFieldSelector(false)}>
              <Text style={styles.modalCloseText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => fetchSoil(extractedText)} disabled={!selectedField || !fieldLocation || isLoading}>
          <Text style={styles.primaryBtnText}>{isLoading ? t('soilHealth.generating') : (advisory ? t('soilHealth.reAnalyze') : t('soilHealth.analyzeSoil'))}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.uploadBtn} onPress={() => setShowUploadModal(true)} disabled={!selectedField}>
          <MaterialIcons name="upload-file" size={20} color="#fff" />
          <Text style={styles.uploadBtnText}>{t('soilHealth.uploadCard')}</Text>
        </TouchableOpacity>
        {lastUpdated && (
          <Text style={styles.lastUpdated}>{t('soilHealth.lastUpdated')}: {new Date(lastUpdated).toLocaleString()}</Text>
        )}
      </View>

      {isLoading && (
        <View style={styles.progressWrap}>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${Math.max(2, Math.min(100, progress))}%` }]} />
          </View>
          <Text style={styles.progressText}>{progressText} ({Math.round(progress)}%)</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Debug info intentionally removed for production UI */}

      {/* Scrollable content */}
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {/* Summary */}
        {advisory ? (
        <View style={styles.summaryCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryTitle}>{t('soilHealth.soilHealthScore')}</Text>
            <Text style={styles.summaryValue}>{(advisory.soil_health_score ?? soilScore ?? 0).toFixed(0)}/100</Text>
            <Text style={styles.summaryDesc}>{advisory.score_explanation || t('soilHealth.scoreExplanation')}</Text>
          </View>
          <Animated.View style={[styles.summaryBadge, { transform: [{ scale: pulseAnim }] }]}>
            <MaterialIcons name="grass" size={28} color="#fff" />
          </Animated.View>
        </View>
        ) : (
        <View style={styles.summaryCardAlt}>
          <Text style={styles.summaryTitle}>{t('soilHealth.title')}</Text>
          <Text style={styles.summaryDesc}>
            {selectedField && fieldLocation
              ? t('soilHealth.tapToAnalyze')
              : t('soilHealth.selectFieldToAnalyze')}
          </Text>
        </View>
        )}

        {/* Soil details */}
        {soil && (
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>{t('soilHealth.soilDepth')}</Text>
          <Text style={styles.infoValue}>
            pH: {soil.ph?.toFixed(1) ?? 'N/A'}
            {soil.nitrogen !== undefined && ` | Nitrogen: ${soil.nitrogen}%`}
            {soil.phosphorus !== undefined && ` | Phosphorus: ${soil.phosphorus}%`}
            {soil.potassium !== undefined && ` | Potassium: ${soil.potassium}%`}
            {soil.moisture !== undefined && ` | Moisture: ${soil.moisture}%`}
            {soil.clay_percent !== undefined && ` | Clay: ${soil.clay_percent}%`}
            {soil.sand_percent !== undefined && ` | Sand: ${soil.sand_percent}%`}
            {soil.silt_percent !== undefined && ` | Silt: ${soil.silt_percent}%`}
            {soil.soil_organic_carbon !== undefined && ` | SOC: ${soil.soil_organic_carbon}`}
          </Text>
        </View>
        )}

        {/* Predicted Crop (from fallback API) */}
        {advisory?.predicted_crop && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Predicted Crop</Text>
          <View style={styles.recoCard}>
            <Text style={styles.recoHeader}>{advisory.predicted_crop}</Text>
            {advisory.primary_crops && advisory.primary_crops.length > 0 && (
              <Text style={styles.recoText}>
                <Text style={styles.recoTextStrong}>Primary Crops:</Text> {advisory.primary_crops.join(', ')}
              </Text>
            )}
            {advisory.secondary_crops && advisory.secondary_crops.length > 0 && (
              <Text style={styles.recoText}>
                <Text style={styles.recoTextStrong}>Secondary Crops:</Text> {advisory.secondary_crops.join(', ')}
              </Text>
            )}
          </View>
        </View>
        )}

        {/* Fertilizer Recommendation (from fallback API) */}
        {advisory?.fertilizer_recommendation && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Fertilizer Recommendation</Text>
          <View style={styles.recoCard}>
            <Text style={styles.recoText}>{advisory.fertilizer_recommendation}</Text>
          </View>
        </View>
        )}

        {/* Guidance */}
        {advisory?.bio_fertilizer_guidance && advisory.bio_fertilizer_guidance.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('soilHealth.bioFertilizerGuidance')}</Text>
          {advisory.bio_fertilizer_guidance.map((g, idx) => (
            <View key={idx} style={styles.recoCard}>
              <Text style={styles.recoHeader}>{g.type}</Text>
              <Text style={styles.recoText}>{t('soilHealth.dosage')}: {g.dosage}</Text>
              <Text style={styles.recoText}>{t('soilHealth.timing')}: {g.timing}</Text>
              <Text style={styles.recoText}>{t('soilHealth.method')}: {g.method}</Text>
              <Text style={styles.recoText}>{t('soilHealth.benefits')}: {g.benefits}</Text>
            </View>
          ))}
        </View>
        )}

        {advisory?.improvement_plan && advisory.improvement_plan.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('soilHealth.improvementPlan')}</Text>
          {advisory.improvement_plan.map((w, idx) => (
            <View key={idx} style={styles.planCard}>
              <Text style={styles.planWeek}>{t('soilHealth.week')} {w.week}</Text>
              {(w.actions || []).map((a, i) => (
                <Text key={i} style={styles.planAction}>• {a}</Text>
              ))}
            </View>
          ))}
        </View>
        )}

        {/* Videos */}
        <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('soilHealth.learnMore')}</Text>
        {filteredVideos().length === 0 ? (
          <Text style={styles.emptyText}>{t('soilHealth.noVideos')}</Text>
        ) : (
          filteredVideos().map((item, idx) => (
            <View key={`${item.videoId || idx}`} style={styles.videoCard}>
              {item.thumbnail ? (
                <Image source={{ uri: item.thumbnail }} style={styles.videoThumb} />
              ) : null}
              <Text style={styles.videoTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.videoMeta}>{item.channelTitle} • {new Date(item.publishedAt).toDateString()}</Text>
              <View style={styles.videoActions}>
                {item.url && (
                  <TouchableOpacity onPress={() => Linking.openURL(item.url)} style={styles.videoBtn}>
                    <Text style={styles.videoBtnText}>{t('soilHealth.open')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => saveDownload(item)} style={styles.videoBtnAlt}>
                  <Text style={styles.videoBtnText}>{t('soilHealth.download')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
        </View>

        {/* Downloads */}
        <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('soilHealth.myDownloads')}</Text>
        {(downloads || []).length === 0 ? (
          <Text style={styles.emptyText}>{t('soilHealth.noDownloads')}</Text>
        ) : (
          (downloads || []).map((d, i) => (
            <View key={`${d.videoId || i}`} style={styles.videoCard}>
              {d.localThumbnail ? (
                <Image source={{ uri: d.localThumbnail }} style={styles.videoThumb} />
              ) : d.thumbnail ? (
                <Image source={{ uri: d.thumbnail }} style={styles.videoThumb} />
              ) : null}
              <Text style={styles.videoTitle} numberOfLines={2}>{d.title}</Text>
              <Text style={styles.videoMeta}>{d.channelTitle}</Text>
              <View style={styles.videoActions}>
                {d.url && (
                  <TouchableOpacity onPress={() => Linking.openURL(d.url)} style={styles.videoBtn}>
                    <Text style={styles.videoBtnText}>{t('soilHealth.open')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}
        </View>
      </ScrollView>

      {/* Upload Modal */}
      <Modal visible={showUploadModal} transparent animationType="slide" onRequestClose={() => setShowUploadModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.uploadModalCard}>
            <View style={styles.uploadModalHeader}>
              <Text style={styles.uploadModalTitle}>{t('soilHealth.uploadSoilHealthCard') || 'Upload Soil Health Card'}</Text>
              <TouchableOpacity onPress={() => setShowUploadModal(false)}>
                <MaterialIcons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {extractedText && (
              <View style={styles.extractedTextCard}>
                <Text style={styles.extractedTextLabel}>{t('soilHealth.extractedText') || 'Extracted Text'}:</Text>
                <ScrollView style={styles.extractedTextScroll}>
                  <Text style={styles.extractedText}>{extractedText}</Text>
                </ScrollView>
              </View>
            )}

            {uploadedCardUrl && (
              <View style={styles.uploadedCardPreview}>
                <Text style={styles.uploadedCardLabel}>{t('soilHealth.uploadedCard') || 'Uploaded Card'}:</Text>
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
                <Text style={styles.uploadOptionText}>{t('soilHealth.takePhoto') || 'Take Photo'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.uploadOptionBtn, uploadingCard && styles.uploadOptionBtnDisabled]}
                onPress={() => handleUploadCard('gallery')}
                disabled={uploadingCard}
              >
                <MaterialIcons name="photo-library" size={24} color="#fff" />
                <Text style={styles.uploadOptionText}>{t('soilHealth.chooseFromGallery') || 'Choose from Gallery'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.uploadOptionBtn, uploadingCard && styles.uploadOptionBtnDisabled]}
                onPress={() => handleUploadCard('document')}
                disabled={uploadingCard}
              >
                <MaterialIcons name="description" size={24} color="#fff" />
                <Text style={styles.uploadOptionText}>{t('soilHealth.chooseDocument') || 'Choose Document (PDF/Image)'}</Text>
              </TouchableOpacity>
            </View>

            {uploadingCard && (
              <View style={styles.uploadingIndicator}>
                <ActivityIndicator size="small" color="#3A5F0B" />
                <Text style={styles.uploadingText}>{t('soilHealth.uploadingAndExtracting') || 'Uploading and extracting text...'}</Text>
              </View>
            )}

            {cardHistory.length > 0 && (
              <View style={styles.cardHistorySection}>
                <Text style={styles.cardHistoryTitle}>{t('soilHealth.previousUploads') || 'Previous Uploads'}</Text>
                <ScrollView style={styles.cardHistoryList}>
                  {cardHistory.map((card, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={styles.cardHistoryItem}
                      onPress={() => {
                        setExtractedText(card.extractedText || '');
                        setUploadedCardUrl(card.fileUrl);
                      }}
                    >
                      <MaterialIcons name="description" size={20} color="#3A5F0B" />
                      <Text style={styles.cardHistoryText}>
                        {new Date(card.uploadedAt).toLocaleDateString()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8f6', padding: 16 },
  fieldSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#eee' },
  fieldSelectorText: { fontSize: 14, color: '#333', fontWeight: '600' },
  actionsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  lastUpdated: { marginLeft: 12, color: '#666', fontSize: 12 },
  primaryBtn: { backgroundColor: '#3A5F0B', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, flexDirection: 'row', alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  summaryCard: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#e8efe1', borderRadius: 12, marginTop: 14 },
  summaryCardAlt: { padding: 14, backgroundColor: '#fff', borderRadius: 12, marginTop: 14, borderWidth: 1, borderColor: '#eee' },
  summaryTitle: { fontSize: 12, fontWeight: '700', color: '#3A5F0B' },
  summaryValue: { fontSize: 22, fontWeight: '800', color: '#2a2a2a', marginTop: 2 },
  summaryDesc: { fontSize: 12, color: '#555', marginTop: 6 },
  summaryBadge: { backgroundColor: '#3A5F0B', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  infoCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#eee' },
  infoLabel: { fontSize: 12, color: '#666', fontWeight: '700' },
  infoValue: { fontSize: 12, color: '#2a2a2a', marginTop: 4 },
  section: { marginTop: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#2a2a2a', marginBottom: 8 },
  recoCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  recoHeader: { fontWeight: '800', color: '#3A5F0B', marginBottom: 6 },
  recoText: { color: '#333', fontSize: 12, marginBottom: 2 },
  recoTextStrong: { fontWeight: '700', color: '#2a2a2a' },
  planCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  planWeek: { fontWeight: '800', marginBottom: 6, color: '#3A5F0B' },
  planAction: { color: '#333', fontSize: 12 },
  videoCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 12, marginBottom: 10 },
  videoTitle: { fontWeight: '700', color: '#2a2a2a' },
  videoMeta: { fontSize: 12, color: '#666', marginTop: 2 },
  videoThumb: { width: '100%', height: 180, borderRadius: 10, marginBottom: 8, backgroundColor: '#f0f0f0' },
  videoActions: { flexDirection: 'row', marginTop: 10 },
  videoBtn: { backgroundColor: '#3A5F0B', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginRight: 8 },
  videoBtnAlt: { backgroundColor: '#2a2a2a', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  videoBtnText: { color: '#fff', fontWeight: '700' },
  emptyText: { color: '#888', fontSize: 12, marginTop: 6 },
  errorBox: { backgroundColor: '#fdecea', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#f5c2c0', marginTop: 10 },
  errorText: { color: '#a94442', fontSize: 12 },
  debugBox: { backgroundColor: '#f1f5ed', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#dbe4cf', marginTop: 10 },
  debugTitle: { color: '#3A5F0B', fontWeight: '800', marginBottom: 6 },
  debugText: { color: '#333', fontSize: 11 },
  debugErr: { color: '#a94442', fontSize: 11 },
  appBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  screenTitle: { fontSize: 18, fontWeight: '800', color: '#2a2a2a' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '86%', backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  modalTitle: { fontWeight: '800', color: '#2a2a2a', fontSize: 16, marginBottom: 8 },
  modalItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f1f1' },
  modalItemText: { color: '#333' },
  modalClose: { alignSelf: 'flex-end', marginTop: 10 },
  modalCloseText: { color: '#3A5F0B', fontWeight: '800' },
  progressWrap: { marginTop: 10 },
  progressBarBg: { height: 8, backgroundColor: '#e5eadf', borderRadius: 999, overflow: 'hidden' },
  progressBarFill: { height: 8, backgroundColor: '#3A5F0B' },
  progressText: { marginTop: 6, color: '#333', fontSize: 12 },
  uploadBtn: { backgroundColor: '#2a2a2a', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
  uploadBtnText: { color: '#fff', fontWeight: '700', marginLeft: 6 },
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
  cardHistorySection: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 16 },
  cardHistoryTitle: { fontSize: 14, fontWeight: '700', color: '#2a2a2a', marginBottom: 12 },
  cardHistoryList: { maxHeight: 150 },
  cardHistoryItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f5f5f5', borderRadius: 8, marginBottom: 8 },
  cardHistoryText: { fontSize: 12, color: '#333' },
});

// Removed duplicate prototype component appended by mistake
