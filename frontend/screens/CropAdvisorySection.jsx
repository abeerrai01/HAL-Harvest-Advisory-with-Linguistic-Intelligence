import React from 'react';
import { View, StyleSheet } from 'react-native';
import CropAdvisoryToggle from '../components/CropAdvisoryToggle';

export default function CropAdvisorySection() {
  return (
    <View style={styles.container}>
      <CropAdvisoryToggle />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
