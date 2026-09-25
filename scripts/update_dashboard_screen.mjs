import fs from 'fs';
import path from 'path';

const targetPath = path.resolve('../HyroxHeroMobile/src/screens/main/DashboardScreen.tsx');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Add raceName and onPress to RaceCountdownCard in JSX
if (!content.includes('raceName={user?.race_event_name}')) {
  content = content.replace(
    'raceDate={user?.race_date}',
    'raceDate={user?.race_date}\n          raceName={user?.race_event_name}\n          onPress={() => navigation.navigate(\'HyroxEvents\' as never)}'
  );
  console.log('✅ Added raceName and onPress to RaceCountdownCard');
}

// 2. Add HYROX Events button right before Race Calculator button
const hyroxEventsButtonJSX = `{/* HYROX Events Button */}
        <TouchableOpacity
          style={styles.hyroxEventsButton}
          onPress={() => navigation.navigate('HyroxEvents' as never)}
          activeOpacity={0.8}
        >
          <View style={styles.hyroxEventsIconContainer}>
            <Ionicons name="trophy" size={24} color={Colors.electricYellow} />
          </View>
          <View style={styles.hyroxEventsButtonContent}>
            <Text style={styles.hyroxEventsButtonTitle}>{t('dashboard.hyrox_events.title', 'HYROX Events')}</Text>
            <Text style={styles.hyroxEventsButtonSubtitle}>{t('dashboard.hyrox_events.subtitle', 'Official races & global results')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>

        {/* Race Calculator Button */}`;

if (!content.includes('dashboard.hyrox_events.title')) {
  content = content.replace(
    '{/* Race Calculator Button */}',
    hyroxEventsButtonJSX
  );
  console.log('✅ Added HYROX Events button to Dashboard action list');
}

// 3. Add styles for hyroxEventsButton
const hyroxEventsStyles = `  hyroxEventsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.zinc800,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.electricYellow,
    minHeight: 72,
  },
  hyroxEventsIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.zinc700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hyroxEventsButtonContent: {
    marginLeft: Spacing.md,
    flex: 1,
  },
  hyroxEventsButtonTitle: {
    fontSize: FontSizes.md,
    fontWeight: '600',
    color: Colors.pureWhite,
    marginBottom: 2,
  },
  hyroxEventsButtonSubtitle: {
    fontSize: FontSizes.sm,
    color: Colors.textSecondary,
  },
  raceCalculatorButton: {`;

if (!content.includes('hyroxEventsButton:')) {
  content = content.replace(
    'raceCalculatorButton: {',
    hyroxEventsStyles
  );
  console.log('✅ Added hyroxEventsButton styles to DashboardScreen');
}

fs.writeFileSync(targetPath, content, 'utf8');
console.log('✅ DashboardScreen.tsx updated successfully');
