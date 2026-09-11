import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polygon } from 'react-native-maps';
import { auth } from '../firebase';
import { createField } from '../services/halApi';
import { useTranslation } from '../services/i18n';

export default function FieldSetup({ onFieldSaved }) {
  const { t } = useTranslation();
  const [region, setRegion] = useState({
    latitude: 28.6139,
    longitude: 77.2090,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  const [markers, setMarkers] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [fieldName, setFieldName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);

  useEffect(() => {
    getCurrentLocation();
  }, []);

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('common.error'), t('fieldSetup.locationPermissionNeeded'));
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = location.coords;
      setCurrentLocation({ latitude, longitude });
      setRegion({
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    } catch (error) {
      console.error('Error getting location:', error);
    }
  };

  const startDrawing = () => {
    setIsDrawing(true);
    setMarkers([]);
  };

  const handleMapPress = (e) => {
    if (!isDrawing) return;
    
    // Limit to exactly 4 points
    if (markers.length >= 4) {
      Alert.alert(t('common.error'), t('fieldSetup.maxPoints'));
      return;
    }

    const { latitude, longitude } = e.nativeEvent.coordinate;
    setMarkers((prev) => [...prev, { latitude, longitude, id: Date.now() }]);
  };

  const undoLastPoint = () => {
    setMarkers((prev) => prev.slice(0, -1));
  };

  const clearAll = () => {
    setMarkers([]);
  };

  const finishDrawing = () => {
    if (markers.length !== 4) {
      Alert.alert('Invalid Field', 'Please add exactly 4 points to define your field boundary.');
      return;
    }
    setIsDrawing(false);
    setShowNameModal(true);
  };

  const saveField = async () => {
    if (!fieldName.trim()) {
      Alert.alert(t('common.error'), t('fieldSetup.invalidName'));
      return;
    }

    if (!auth.currentUser) {
      Alert.alert(t('common.error'), t('fieldSetup.loginRequired'));
      return;
    }

    // Validate exactly 4 points
    if (markers.length !== 4) {
      Alert.alert('Invalid Field', 'Please add exactly 4 points to define your field boundary.');
      return;
    }

    setIsSaving(true);
    try {
      const geometry = markers.map((m) => [m.latitude, m.longitude]);
      const farmer_ID = auth.currentUser.uid;

      await createField({
        farmer_ID,
        field_name: fieldName.trim(),
        geometry,
      });

      Alert.alert(t('common.success'), t('fieldSetup.fieldAdded', { name: fieldName }), [
        {
          text: t('common.ok'),
          onPress: () => {
            setShowNameModal(false);
            setFieldName('');
            setMarkers([]);
            setIsDrawing(false);
            if (onFieldSaved) onFieldSaved();
          },
        },
      ]);
    } catch (error) {
      console.error('Error saving field:', error);
      Alert.alert(t('common.error'), t('fieldSetup.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const polygonCoordinates = markers.length === 4 ? markers.map((m) => ({
    latitude: m.latitude,
    longitude: m.longitude,
  })) : [];

  return (
    <View style={styles.container}>
      {/* Top App Bar */}
      <View style={styles.appBar}>
        <Text style={styles.screenTitle}>{t('fieldSetup.title')}</Text>
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          style={styles.map}
          region={region}
          onRegionChangeComplete={setRegion}
          onPress={handleMapPress}
          mapType="satellite"
        >
          {markers.map((marker) => (
            <Marker
              key={marker.id}
              coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
              pinColor="#3A5F0B"
            />
          ))}
          {polygonCoordinates.length === 4 && (
            <Polygon
              coordinates={polygonCoordinates}
              strokeColor="#3A5F0B"
              fillColor="rgba(58, 95, 11, 0.2)"
              strokeWidth={2}
            />
          )}
        </MapView>

        {/* Crosshair for precise placement */}
        {isDrawing && (
          <View style={styles.crosshair}>
            <View style={[styles.crosshairLine, styles.crosshairVertical]} />
            <View style={[styles.crosshairLine, styles.crosshairHorizontal]} />
          </View>
        )}

        {/* Drawing status */}
        {isDrawing && (
          <View style={styles.drawingStatus}>
            <Text style={styles.drawingStatusText}>
              {t('fieldSetup.drawingStatus', { count: markers.length })}
            </Text>
            {markers.length === 4 && (
              <Text style={styles.drawingStatusHint}>
                {t('fieldSetup.allPointsAdded')}
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Control Buttons */}
      <View style={styles.controls}>
        {!isDrawing ? (
          <TouchableOpacity style={styles.startButton} onPress={startDrawing}>
            <MaterialIcons name="add-location" size={24} color="#fff" />
            <Text style={styles.startButtonText}>{t('fieldSetup.addField')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.drawingControls}>
            <TouchableOpacity style={styles.controlButton} onPress={undoLastPoint} disabled={markers.length === 0}>
              <MaterialIcons name="undo" size={20} color={markers.length === 0 ? '#ccc' : '#3A5F0B'} />
              <Text style={[styles.controlButtonText, markers.length === 0 && styles.controlButtonTextDisabled]}>{t('fieldSetup.undo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlButton} onPress={clearAll} disabled={markers.length === 0}>
              <MaterialIcons name="clear" size={20} color={markers.length === 0 ? '#ccc' : '#3A5F0B'} />
              <Text style={[styles.controlButtonText, markers.length === 0 && styles.controlButtonTextDisabled]}>{t('fieldSetup.clear')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.finishButton, markers.length !== 4 && styles.finishButtonDisabled]}
              onPress={finishDrawing}
              disabled={markers.length !== 4}
            >
              <MaterialIcons name="check" size={20} color="#fff" />
              <Text style={styles.finishButtonText}>{t('fieldSetup.finish')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Field Name Modal */}
      <Modal visible={showNameModal} transparent animationType="slide" onRequestClose={() => setShowNameModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('fieldSetup.saveField')}</Text>
            <Text style={styles.modalSubtitle}>{t('fieldSetup.enterFieldName')}</Text>
            <TextInput
              style={styles.nameInput}
              placeholder={t('fieldSetup.fieldNamePlaceholder')}
              value={fieldName}
              onChangeText={setFieldName}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => {
                  setShowNameModal(false);
                  setFieldName('');
                }}
              >
                <Text style={styles.modalButtonCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={saveField}
                disabled={isSaving || !fieldName.trim()}
              >
                <Text style={styles.modalButtonSaveText}>{isSaving ? t('common.loading') : t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5DC',
  },
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
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  crosshair: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 30,
    height: 30,
    marginLeft: -15,
    marginTop: -15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairLine: {
    position: 'absolute',
    backgroundColor: '#3A5F0B',
  },
  crosshairVertical: {
    width: 2,
    height: 30,
  },
  crosshairHorizontal: {
    width: 30,
    height: 2,
  },
  drawingStatus: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3A5F0B',
  },
  drawingStatusText: {
    fontSize: 14,
    color: '#3A5F0B',
    fontWeight: '600',
    textAlign: 'center',
  },
  drawingStatusHint: {
    fontSize: 12,
    color: '#5f8d3a',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  controls: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderColor: '#E0E0E0',
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3A5F0B',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  drawingControls: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e5e9dc',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
    flex: 1,
    justifyContent: 'center',
  },
  controlButtonText: {
    color: '#3A5F0B',
    fontSize: 14,
    fontWeight: '600',
  },
  controlButtonTextDisabled: {
    color: '#ccc',
  },
  finishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3A5F0B',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
    flex: 2,
    justifyContent: 'center',
  },
  finishButtonDisabled: {
    backgroundColor: '#ccc',
  },
  finishButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: '#F9F9F9',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#E0E0E0',
  },
  modalButtonCancelText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonSave: {
    backgroundColor: '#3A5F0B',
  },
  modalButtonSaveText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

