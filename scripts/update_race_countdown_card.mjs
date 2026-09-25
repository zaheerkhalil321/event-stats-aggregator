import fs from 'fs';
import path from 'path';

const targetPath = path.resolve('../HyroxHeroMobile/src/components/dashboard/RaceCountdownCard.tsx');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Add raceName and onPress to interface
if (!content.includes('raceName?: string;')) {
  content = content.replace(
    'raceDate?: string;',
    'raceDate?: string;\n  raceName?: string;\n  onPress?: () => void;'
  );
}

// 2. Destructure raceName and onPress
if (!content.includes('raceName,')) {
  content = content.replace(
    'raceDate,',
    'raceDate,\n  raceName,\n  onPress,'
  );
}

// 3. Update the return JSX for countdownContent
const targetReturn = `  return (
    <View style={styles.container}>
      <View style={styles.countdownContent}>
        <Text style={[styles.daysCount, { color: getCountdownColor() }]}>
          {daysUntilRace}
        </Text>
        <Text style={styles.daysLabel}>
          {t('raceCountdown.daysToHyrox', 'days to HYROX')}
        </Text>
      </View>
      <Text style={styles.motivationalText}>
        {getMotivationalText()}
      </Text>
    </View>
  );`;

const newReturn = `  const CountdownBody = (
    <>
      <View style={styles.countdownContent}>
        {raceName ? (
          <View style={styles.raceNameBadge}>
            <Ionicons name="trophy" size={13} color={Colors.electricYellow} style={{ marginRight: 4 }} />
            <Text style={styles.raceNameText} numberOfLines={1}>{raceName}</Text>
          </View>
        ) : null}
        <Text style={[styles.daysCount, { color: getCountdownColor() }]}>
          {daysUntilRace}
        </Text>
        <Text style={styles.daysLabel}>
          {t('raceCountdown.daysToHyrox', 'days to HYROX')}
        </Text>
      </View>
      <Text style={styles.motivationalText}>
        {getMotivationalText()}
      </Text>
    </>
  );

  return onPress ? (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.8}>
      {CountdownBody}
    </TouchableOpacity>
  ) : (
    <View style={styles.container}>
      {CountdownBody}
    </View>
  );`;

if (content.includes(targetReturn)) {
  content = content.replace(targetReturn, newReturn);
}

// 4. Add styles for raceNameBadge
if (!content.includes('raceNameBadge:')) {
  content = content.replace(
    'daysCount: {',
    `raceNameBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.zinc800,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc700,
    marginBottom: Spacing.xs,
    maxWidth: 260,
  },
  raceNameText: {
    fontSize: FontSizes.xs,
    fontWeight: '700',
    color: Colors.electricYellow,
  },
  daysCount: {`
  );
}

fs.writeFileSync(targetPath, content, 'utf8');
console.log('✅ Updated src/components/dashboard/RaceCountdownCard.tsx with raceName and onPress');
