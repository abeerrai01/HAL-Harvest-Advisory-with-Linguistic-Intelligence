import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { auth } from '../firebase';
import CropAdvisory1 from '../screens/CropAdvisory1';
import FieldSetup from '../screens/FieldSetup';
import { getFields } from '../services/halApi';

export default function CropAdvisoryToggle() {
  const [hasFields, setHasFields] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [fields, setFields] = useState([]);

  useEffect(() => {
    checkFields();
  }, []);

  const checkFields = async () => {
    try {
      if (!auth.currentUser) {
        setHasFields(false);
        setLoading(false);
        return;
      }

      const response = await getFields(auth.currentUser.uid);
      const fieldsData = response?.fields || [];
      setFields(fieldsData);
      setHasFields(fieldsData.length > 0);
    } catch (error) {
      console.error('Error checking fields:', error);
      setHasFields(false);
      setFields([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFieldSaved = () => {
    checkFields();
    setShowSetup(false);
  };

  const handleAddField = () => {
    setShowSetup(true);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5DC' }}>
        <ActivityIndicator size="large" color="#3A5F0B" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {hasFields && !showSetup ? (
        <CropAdvisory1 onAddField={handleAddField} fields={fields} onFieldsRefresh={checkFields} />
      ) : (
        <FieldSetup onFieldSaved={handleFieldSaved} />
      )}
    </View>
  );
}
