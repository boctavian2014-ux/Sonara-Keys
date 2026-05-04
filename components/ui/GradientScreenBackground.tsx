import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { colors } from '../../theme';

type Props = {
  children: React.ReactNode;
};

/**
 * Full-screen layered gradient: deep navy → indigo with subtle teal vignette feel.
 */
export function GradientScreenBackground({ children }: Props) {
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.bgDeep, colors.bgMid, '#0D1528']}
        locations={[0, 0.45, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['transparent', 'rgba(45, 212, 191, 0.06)', 'transparent']}
        start={{ x: 0.5, y: 0.2 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgDeep,
  },
});
